"""
CRM Ticket Helpdesk — modul redesign penuh menggantikan CRM lama (broadband + dedicated).

Endpoints (semua di /api/crm/...):
    Tickets:
        POST   /api/crm/tickets                       — buat ticket baru (status MASUK)
        GET    /api/crm/tickets                       — list dengan filter status/priority/q/dll
        GET    /api/crm/tickets/{id}                  — detail ticket
        PUT    /api/crm/tickets/{id}                  — edit data utama ticket
        DELETE /api/crm/tickets/{id}                  — hapus (admin only)
        POST   /api/crm/tickets/{id}/process          — Proses ticket (MASUK → DIPROSES)
        POST   /api/crm/tickets/{id}/progress         — Tambah progress teknisi
        POST   /api/crm/tickets/{id}/reassign         — Alihkan troubleshooter
        POST   /api/crm/tickets/{id}/resolve          — Selesaikan ticket (DIPROSES → SELESAI)
        POST   /api/crm/tickets/{id}/reopen           — Buka kembali (admin/supervisor)

    Files (upload disk-based, metadata di Mongo):
        POST   /api/crm/tickets/{id}/files            — upload 1..N file (multipart)
        GET    /api/crm/tickets/{id}/files            — list metadata
        GET    /api/crm/tickets/{id}/files/{file_id}  — download / preview (FileResponse)
        DELETE /api/crm/tickets/{id}/files/{file_id}  — hapus (admin/supervisor/uploader)

    Categories:
        GET    /api/crm/categories
        POST   /api/crm/categories                    — admin/supervisor
        PUT    /api/crm/categories/{id}               — admin/supervisor
        DELETE /api/crm/categories/{id}               — admin only

    Stats:
        GET    /api/crm/stats                         — untuk dashboard baru
        GET    /api/crm/counts                        — {total, masuk, diproses, selesai}
"""
from __future__ import annotations

import io
import os
import uuid
import logging
import mimetypes
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional, Literal, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict

logger = logging.getLogger("noc.crm_helpdesk")

from notifications import notify_ticket_event, notify_closing_resume  # noqa: E402

# Priority ranking for escalation detection
_PRIORITY_RANK = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}

UPLOAD_DIR = Path(__file__).parent / "uploads" / "crm"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 20 MB per-file cap; images typically < 5 MB, PDFs up to 20 MB.
MAX_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
ALLOWED_MIME = {
    "image/jpeg", "image/png", "image/webp", "application/pdf",
}

TicketStatus = Literal["MASUK", "DIPROSES", "SELESAI"]
Priority = Literal["Low", "Medium", "High", "Critical"]
ReportSource = Literal["WhatsApp", "Telepon", "Email", "Monitoring", "Internal", "Lainnya"]
WorkStage = Literal[
    "Survey lokasi", "Pemeriksaan awal", "Pengerjaan", "Penggantian perangkat",
    "Perbaikan kabel", "Pengujian", "Koordinasi pihak ketiga", "Lainnya",
]
EvidenceType = Literal[
    "CUSTOMER_INITIAL_EVIDENCE", "TECHNICIAN_PROGRESS", "COMPLETION_EVIDENCE", "GENERAL_ATTACHMENT",
]


# ----------------------------------------------------------------------------
# Utils
# ----------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def _actor(user: dict) -> dict:
    return {
        "id": user.get("id"),
        "name": user.get("name") or user.get("email"),
        "role": user.get("role"),
    }


def _diff_seconds(a_iso: Optional[str], b_iso: Optional[str]) -> Optional[int]:
    if not a_iso or not b_iso:
        return None
    try:
        a = datetime.fromisoformat(a_iso.replace("Z", "+00:00"))
        b = datetime.fromisoformat(b_iso.replace("Z", "+00:00"))
        return int((b - a).total_seconds())
    except Exception:
        return None


async def _gen_ticket_number(db) -> str:
    """TCK-YYYYMMDD-NNNN unik per hari."""
    today = now_utc().strftime("%Y%m%d")
    prefix = f"TCK-{today}-"
    # scan last used sequence for today
    latest = await db.helpdesk_tickets.find_one(
        {"ticket_number": {"$regex": f"^{prefix}"}},
        sort=[("ticket_number", -1)],
    )
    seq = 1
    if latest and latest.get("ticket_number"):
        try:
            seq = int(latest["ticket_number"].split("-")[-1]) + 1
        except Exception:
            seq = 1
    return f"{prefix}{seq:04d}"


def _make_audit(user: dict, action: str, meta: Optional[dict] = None) -> dict:
    a = _actor(user)
    return {
        "id": new_id(),
        "at": now_iso(),
        "actor_id": a["id"],
        "actor_name": a["name"],
        "role": a["role"],
        "action": action,
        "meta": meta or {},
    }


# ----------------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------------
class TicketCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_id: Optional[str] = None
    customer_name: str
    location: str = ""
    category_id: Optional[str] = None
    category_name: str = ""
    priority: Priority = "Medium"
    outage_started_at: Optional[str] = None
    description: str = ""
    pic_name: str = ""
    pic_contact: str = ""
    report_source: ReportSource = "Telepon"
    initial_evidence_note: str = ""


class TicketUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    location: Optional[str] = None
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    priority: Optional[Priority] = None
    outage_started_at: Optional[str] = None
    description: Optional[str] = None
    pic_name: Optional[str] = None
    pic_contact: Optional[str] = None
    report_source: Optional[ReportSource] = None
    initial_evidence_note: Optional[str] = None


class ProgressIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    note: str
    work_stage: WorkStage = "Pengerjaan"
    status: str = "on_progress"
    condition_before: str = ""
    action_taken: str = ""
    condition_after: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    file_ids: List[str] = Field(default_factory=list)


class ReassignIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    new_troubleshooter_id: str
    new_troubleshooter_name: str
    reason: str = ""


class ResolveIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    root_cause: str
    action_taken: str
    final_solution: str
    service_restored_at: Optional[str] = None
    service_final_status: str = "Normal"
    closing_notes: str = ""
    completion_file_ids: List[str] = Field(default_factory=list)
    override_reason: Optional[str] = None  # jika supervisor/admin skip completion evidence


class CategoryIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    requires_completion_evidence: bool = True
    description: str = ""


# ----------------------------------------------------------------------------
# Migration + seed
# ----------------------------------------------------------------------------
DEFAULT_CATEGORIES = [
    {"name": "Link Down", "requires_completion_evidence": True, "description": "Koneksi customer down / no link"},
    {"name": "Loss / High Latency", "requires_completion_evidence": True, "description": "Paket loss atau latency tinggi"},
    {"name": "Bandwidth Slow", "requires_completion_evidence": True, "description": "Throughput di bawah SLA"},
    {"name": "Hardware Failure", "requires_completion_evidence": True, "description": "Perangkat rusak / mati"},
    {"name": "Kabel / Fiber Putus", "requires_completion_evidence": True, "description": "Fisik kabel bermasalah"},
    {"name": "Gangguan Routing Remote", "requires_completion_evidence": False, "description": "Selesai remote — tidak wajib foto"},
    {"name": "Perubahan Konfigurasi", "requires_completion_evidence": False, "description": "Change request / config update"},
    {"name": "Konfirmasi Layanan Normal", "requires_completion_evidence": False, "description": "Customer konfirmasi sudah normal"},
]


async def seed_categories(db):
    """Seed default categories jika kosong."""
    if await db.helpdesk_categories.count_documents({}) > 0:
        return
    now = now_iso()
    docs = []
    for c in DEFAULT_CATEGORIES:
        docs.append({
            **c,
            "id": new_id(),
            "created_at": now,
            "created_by": "system",
        })
    if docs:
        await db.helpdesk_categories.insert_many(docs)
        logger.info(f"Seeded {len(docs)} default helpdesk categories")


def _map_old_status(status: str) -> str:
    s = (status or "").lower()
    if s in ("open", ""):
        return "MASUK"
    if s in ("resolved", "closed"):
        return "SELESAI"
    return "DIPROSES"


async def _migrate_old_collection(db, coll_name: str, kind: str) -> dict:
    """Kloning ke `<coll>_backup_<date>` lalu transform + insert ke helpdesk_tickets.
    Returns {source, migrated, skipped}."""
    out = {"source": coll_name, "migrated": 0, "skipped": 0, "backed_up": 0}
    if coll_name not in await db.list_collection_names():
        return out
    total = await db[coll_name].count_documents({})
    if total == 0:
        return out

    # Backup only if not already backed up
    today = now_utc().strftime("%Y%m%d")
    backup_name = f"{coll_name}_backup_{today}"
    if backup_name not in await db.list_collection_names():
        try:
            await db[coll_name].aggregate([{"$out": backup_name}]).to_list(1)
            out["backed_up"] = await db[backup_name].count_documents({})
            logger.info(f"[migration] Backed up {coll_name} → {backup_name} ({out['backed_up']} docs)")
        except Exception as ex:
            logger.error(f"[migration] backup failed for {coll_name}: {ex}")

    async for old in db[coll_name].find({}):
        old.pop("_id", None)
        # Idempotent: skip jika sudah pernah dimigrasi
        if await db.helpdesk_tickets.count_documents({
            "migrated_from": kind,
            "legacy_ticket_number": old.get("ticket_number"),
        }) > 0:
            out["skipped"] += 1
            continue
        # Customer lookup
        cust_name = ""
        if old.get("customer_id"):
            c = await db.customers.find_one({"id": old["customer_id"]}, {"_id": 0, "company_name": 1})
            if c:
                cust_name = c.get("company_name") or ""
        # Build new doc
        created_at = old.get("open_time") or old.get("created_at") or now_iso()
        engineer = old.get("engineer") or old.get("internal_pic") or ""
        new_doc = {
            "id": new_id(),
            "ticket_number": old.get("ticket_number") or f"MIG-{kind}-{new_id()[:8]}",
            "legacy_ticket_number": old.get("ticket_number"),
            "migrated_from": kind,
            "status": _map_old_status(old.get("status") or ""),
            "customer_id": old.get("customer_id"),
            "customer_name": cust_name,
            "location": old.get("location") or "",
            "category_id": None,
            "category_name": old.get("issue_category") or "",
            "priority": old.get("priority") or "Medium",
            "outage_started_at": old.get("open_time"),
            "description": old.get("description") or "",
            "pic_name": "",
            "pic_contact": "",
            "report_source": "Lainnya",
            "initial_evidence_note": "",
            "created_by_id": None,
            "created_by_name": "migration",
            "created_at": created_at,
            "processed_at": None,
            "processed_by_id": None,
            "processed_by_name": None,
            "troubleshooter_id": None,
            "troubleshooter_name": engineer,
            "reassign_history": [],
            "progress": [],
            "resolved_at": old.get("close_time"),
            "resolved_by_id": None,
            "resolved_by_name": None,
            "root_cause": old.get("root_cause") or "",
            "action_taken": old.get("action_taken") or "",
            "final_solution": "",
            "service_restored_at": old.get("restore_time"),
            "service_final_status": "Normal",
            "closing_notes": "",
            "completion_override": None,
            "response_time_seconds": None,
            "execution_time_seconds": None,
            "downtime_seconds": None,
            "total_handling_seconds": None,
            "audit_log": [{
                "id": new_id(),
                "at": now_iso(),
                "actor_id": None,
                "actor_name": "migration",
                "role": "system",
                "action": f"migrated_from_{kind}",
                "meta": {"legacy": old.get("ticket_number")},
            }],
            "updated_at": now_iso(),
        }
        await db.helpdesk_tickets.insert_one(new_doc)
        out["migrated"] += 1
    return out


async def run_migration(db) -> dict:
    """Migrasi one-shot. Aman dipanggil berkali-kali (idempotent)."""
    bb = await _migrate_old_collection(db, "broadband_tickets", "broadband")
    dd = await _migrate_old_collection(db, "dedicated_tickets", "dedicated")
    total_new = await db.helpdesk_tickets.count_documents({})
    summary = {
        "broadband": bb,
        "dedicated": dd,
        "helpdesk_total_after": total_new,
    }
    logger.info(f"[migration] CRM helpdesk migration summary: {summary}")
    return summary


# ----------------------------------------------------------------------------
# File utils
# ----------------------------------------------------------------------------
async def _save_upload(f: UploadFile, ticket_id: str) -> dict:
    orig = f.filename or "file"
    ext = Path(orig).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Format {ext} tidak diizinkan. Hanya JPG/JPEG/PNG/WEBP/PDF.")
    # sanity check mime
    if f.content_type and f.content_type not in ALLOWED_MIME:
        # allow some browsers sending octet-stream, fallback to ext
        if f.content_type != "application/octet-stream":
            raise HTTPException(status_code=400, detail=f"MIME {f.content_type} tidak diizinkan.")
    data = await f.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File terlalu besar (max {MAX_FILE_SIZE // (1024*1024)} MB)")
    file_id = new_id()
    safe_name = f"{file_id}{ext}"
    tdir = UPLOAD_DIR / ticket_id
    tdir.mkdir(parents=True, exist_ok=True)
    path = tdir / safe_name
    with open(path, "wb") as w:
        w.write(data)
    mime = f.content_type or mimetypes.guess_type(orig)[0] or "application/octet-stream"
    file_type = "image" if mime.startswith("image/") else "document"
    return {
        "id": file_id,
        "file_name": safe_name,
        "original_file_name": orig,
        "file_size": len(data),
        "mime_type": mime,
        "file_type": file_type,
        "storage_path": str(path.relative_to(UPLOAD_DIR)),
    }


# ----------------------------------------------------------------------------
# Router builder
# ----------------------------------------------------------------------------
def build_crm_helpdesk_router(get_current_user, get_db):
    """`get_db` returns the motor db from app.state; passing a callable so this
    module doesn't have to import server.py."""
    router = APIRouter(prefix="/crm", tags=["crm-helpdesk"])

    # --- Roles ---
    ADMIN = {"admin"}
    SUPERVISOR = {"admin", "supervisor"}
    NOC = {"admin", "supervisor", "engineer", "teknisi"}       # NOC / operators (incl. field technicians)
    TECH = {"admin", "supervisor", "engineer", "teknisi"}      # field technicians
    ALL_READ = {"admin", "supervisor", "engineer", "viewer", "operational", "admin_router", "teknisi"}

    def _require(user: dict, roles: set):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    # ---------------- Categories ----------------
    @router.get("/categories")
    async def list_categories(user: dict = Depends(get_current_user)):
        db = get_db()
        cur = db.helpdesk_categories.find({}, {"_id": 0}).sort("name", 1)
        return await cur.to_list(500)

    @router.post("/categories")
    async def create_category(body: CategoryIn, user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        doc = body.model_dump()
        doc["id"] = new_id()
        doc["created_at"] = now_iso()
        doc["created_by"] = user.get("email")
        await db.helpdesk_categories.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @router.put("/categories/{cid}")
    async def update_category(cid: str, body: CategoryIn, user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        r = await db.helpdesk_categories.update_one({"id": cid}, {"$set": body.model_dump()})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return await db.helpdesk_categories.find_one({"id": cid}, {"_id": 0})

    @router.delete("/categories/{cid}")
    async def delete_category(cid: str, user: dict = Depends(get_current_user)):
        _require(user, ADMIN)
        db = get_db()
        r = await db.helpdesk_categories.delete_one({"id": cid})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"ok": True}

    # ---------------- Ticket list & get ----------------
    @router.get("/tickets")
    async def list_tickets(
        q: Optional[str] = None,
        status: Optional[TicketStatus] = None,
        priority: Optional[Priority] = None,
        customer_id: Optional[str] = None,
        troubleshooter_id: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
        user: dict = Depends(get_current_user),
    ):
        db = get_db()
        query: dict = {}
        if status:
            query["status"] = status
        if priority:
            query["priority"] = priority
        if customer_id:
            query["customer_id"] = customer_id
        if troubleshooter_id:
            query["troubleshooter_id"] = troubleshooter_id
        if q:
            import re as _re
            rx = {"$regex": _re.escape(q), "$options": "i"}
            query["$or"] = [
                {"ticket_number": rx}, {"customer_name": rx},
                {"location": rx}, {"category_name": rx},
                {"description": rx}, {"pic_name": rx},
            ]
        total = await db.helpdesk_tickets.count_documents(query)
        skip = max(0, (page - 1) * page_size)
        cur = (
            db.helpdesk_tickets.find(query, {"_id": 0})
            .sort([("status", 1), ("created_at", -1)])
            .skip(skip).limit(page_size)
        )
        items = await cur.to_list(page_size)
        # attach file counts + preview thumb id
        for it in items:
            files = await db.helpdesk_ticket_files.find(
                {"ticket_id": it["id"]}, {"_id": 0, "id": 1, "evidence_type": 1, "file_type": 1}
            ).to_list(500)
            it["files_count"] = len(files)
            it["initial_evidence_count"] = sum(1 for f in files if f["evidence_type"] == "CUSTOMER_INITIAL_EVIDENCE")
            it["progress_evidence_count"] = sum(1 for f in files if f["evidence_type"] == "TECHNICIAN_PROGRESS")
            it["completion_evidence_count"] = sum(1 for f in files if f["evidence_type"] == "COMPLETION_EVIDENCE")
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    async def _get_ticket_or_404(db, tid: str) -> dict:
        t = await db.helpdesk_tickets.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket tidak ditemukan")
        return t

    @router.get("/tickets/{tid}")
    async def get_ticket(tid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        t = await _get_ticket_or_404(db, tid)
        files = await db.helpdesk_ticket_files.find({"ticket_id": tid}, {"_id": 0}).sort("uploaded_at", 1).to_list(1000)
        t["files"] = files
        return t

    # ---------------- Create ticket ----------------
    @router.post("/tickets")
    async def create_ticket(body: TicketCreate, user: dict = Depends(get_current_user)):
        # Teknisi lapangan tidak boleh membuka ticket baru — hanya melihat & memproses
        _require(user, {"admin", "supervisor", "engineer"})
        db = get_db()
        a = _actor(user)
        # Try to auto-fill customer_name if id given but name empty
        cust_name = body.customer_name
        if body.customer_id and not cust_name:
            c = await db.customers.find_one({"id": body.customer_id}, {"_id": 0, "company_name": 1})
            if c:
                cust_name = c.get("company_name") or ""
        # Category — may be by id, by name, or free-text
        cat_name = body.category_name
        cat_id = body.category_id
        if cat_id and not cat_name:
            c = await db.helpdesk_categories.find_one({"id": cat_id}, {"_id": 0, "name": 1})
            if c:
                cat_name = c["name"]
        ticket_number = await _gen_ticket_number(db)
        doc = {
            "id": new_id(),
            "ticket_number": ticket_number,
            "status": "MASUK",
            "customer_id": body.customer_id,
            "customer_name": cust_name,
            "location": body.location,
            "category_id": cat_id,
            "category_name": cat_name,
            "priority": body.priority,
            "outage_started_at": body.outage_started_at,
            "description": body.description,
            "pic_name": body.pic_name,
            "pic_contact": body.pic_contact,
            "report_source": body.report_source,
            "initial_evidence_note": body.initial_evidence_note,
            "created_by_id": a["id"],
            "created_by_name": a["name"],
            "created_at": now_iso(),
            "processed_at": None,
            "processed_by_id": None,
            "processed_by_name": None,
            "troubleshooter_id": None,
            "troubleshooter_name": None,
            "reassign_history": [],
            "progress": [],
            "resolved_at": None,
            "resolved_by_id": None,
            "resolved_by_name": None,
            "root_cause": "",
            "action_taken": "",
            "final_solution": "",
            "service_restored_at": None,
            "service_final_status": None,
            "closing_notes": "",
            "completion_override": None,
            "response_time_seconds": None,
            "execution_time_seconds": None,
            "downtime_seconds": None,
            "total_handling_seconds": None,
            "audit_log": [_make_audit(user, "ticket_created", {"ticket_number": ticket_number})],
            "updated_at": now_iso(),
        }
        await db.helpdesk_tickets.insert_one(doc)
        doc.pop("_id", None)
        await notify_ticket_event(db, "created", doc)
        return doc

    # ---------------- Update ticket ----------------
    @router.put("/tickets/{tid}")
    async def update_ticket(tid: str, body: TicketUpdate, user: dict = Depends(get_current_user)):
        _require(user, NOC)
        db = get_db()
        t = await _get_ticket_or_404(db, tid)
        patch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        # Field technicians (engineer role) tidak boleh ubah data utama customer/lokasi/priority.
        # But since we only differentiate by role name (engineer==field), tetap izinkan for now.
        # Frontend akan sembunyikan tombol edit untuk role viewer/operational.
        patch["updated_at"] = now_iso()
        audit = _make_audit(user, "ticket_updated", {"changed_fields": list(patch.keys())})
        await db.helpdesk_tickets.update_one(
            {"id": tid},
            {"$set": patch, "$push": {"audit_log": audit}},
        )
        fresh = await _get_ticket_or_404(db, tid)
        # Escalation: fire internal notification when priority raised to High/Critical
        old_rank = _PRIORITY_RANK.get(t.get("priority"), 0)
        new_priority = patch.get("priority")
        if new_priority and new_priority in ("High", "Critical") and _PRIORITY_RANK.get(new_priority, 0) > old_rank:
            await notify_ticket_event(db, "escalated", fresh)
        return fresh

    @router.delete("/tickets/{tid}")
    async def delete_ticket(tid: str, user: dict = Depends(get_current_user)):
        _require(user, ADMIN)
        db = get_db()
        t = await _get_ticket_or_404(db, tid)
        # Also remove files metadata + physical files
        files = await db.helpdesk_ticket_files.find({"ticket_id": tid}).to_list(1000)
        for f in files:
            p = UPLOAD_DIR / f.get("storage_path", "")
            try:
                if p.exists():
                    p.unlink()
            except Exception:
                pass
        await db.helpdesk_ticket_files.delete_many({"ticket_id": tid})
        # Remove ticket dir
        try:
            (UPLOAD_DIR / tid).rmdir()
        except Exception:
            pass
        await db.helpdesk_tickets.delete_one({"id": tid})
        return {"ok": True}

    # ---------------- Process ticket ----------------
    @router.post("/tickets/{tid}/process")
    async def process_ticket(tid: str, user: dict = Depends(get_current_user)):
        _require(user, NOC)
        db = get_db()
        t = await _get_ticket_or_404(db, tid)
        if t["status"] != "MASUK":
            raise HTTPException(status_code=400, detail=f"Ticket tidak dalam status MASUK (sekarang {t['status']})")
        a = _actor(user)
        now = now_iso()
        patch = {
            "status": "DIPROSES",
            "processed_at": now,
            "processed_by_id": a["id"],
            "processed_by_name": a["name"],
            "troubleshooter_id": a["id"],
            "troubleshooter_name": a["name"],
            "updated_at": now,
        }
        audit = _make_audit(user, "ticket_processed", {"troubleshooter": a["name"]})
        await db.helpdesk_tickets.update_one({"id": tid}, {"$set": patch, "$push": {"audit_log": audit}})
        fresh = await _get_ticket_or_404(db, tid)
        await notify_ticket_event(db, "assigned", fresh)
        return fresh

    # ---------------- Add progress ----------------
    @router.post("/tickets/{tid}/progress")
    async def add_progress(tid: str, body: ProgressIn, user: dict = Depends(get_current_user)):
        _require(user, NOC)
        db = get_db()
        t = await _get_ticket_or_404(db, tid)
        if t["status"] != "DIPROSES":
            raise HTTPException(status_code=400, detail="Ticket harus dalam status DIPROSES untuk menambah progress")
        a = _actor(user)
        prog_id = new_id()
        prog = {
            "id": prog_id,
            "note": body.note,
            "work_stage": body.work_stage,
            "status": body.status,
            "condition_before": body.condition_before,
            "action_taken": body.action_taken,
            "condition_after": body.condition_after,
            "latitude": body.latitude,
            "longitude": body.longitude,
            "file_ids": body.file_ids,
            "user_id": a["id"],
            "user_name": a["name"],
            "role": a["role"],
            "at": now_iso(),
        }
        # Tag associated files as TECHNICIAN_PROGRESS with work_stage
        if body.file_ids:
            await db.helpdesk_ticket_files.update_many(
                {"id": {"$in": body.file_ids}, "ticket_id": tid},
                {"$set": {
                    "evidence_type": "TECHNICIAN_PROGRESS",
                    "work_stage": body.work_stage,
                    "progress_id": prog_id,
                }},
            )
        audit = _make_audit(user, "progress_added", {"stage": body.work_stage, "file_count": len(body.file_ids)})
        await db.helpdesk_tickets.update_one(
            {"id": tid},
            {"$push": {"progress": prog, "audit_log": audit}, "$set": {"updated_at": now_iso()}},
        )
        fresh = await _get_ticket_or_404(db, tid)
        await notify_ticket_event(db, "progress", fresh, {"progress_note": body.note})
        return fresh

    # ---------------- Reassign ----------------
    # Target troubleshooter roles: NOC Engineer + Teknisi Lapangan only.
    REASSIGN_TARGET_ROLES = {"engineer", "teknisi"}

    @router.post("/tickets/{tid}/reassign")
    async def reassign_ticket(tid: str, body: ReassignIn, user: dict = Depends(get_current_user)):
        db = get_db()
        t = await _get_ticket_or_404(db, tid)
        # (1) Permission — server-side: Administrator OR the current troubleshooter
        # (holder) of THIS specific ticket. Anyone else is forbidden.
        is_admin = user.get("role") == "admin"
        is_holder = bool(t.get("troubleshooter_id")) and t.get("troubleshooter_id") == user.get("id")
        if not (is_admin or is_holder):
            raise HTTPException(status_code=403, detail="Anda tidak memiliki hak untuk mengalihkan tiket ini.")
        # (2) Ticket must still be DIPROSES
        if t.get("status") != "DIPROSES":
            raise HTTPException(status_code=400, detail="Ticket hanya dapat dialihkan saat berstatus DIPROSES.")
        # (3-5) Validate target from DATABASE (never trust client role/name/active)
        target = await db.users.find_one(
            {"id": body.new_troubleshooter_id},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "active": 1},
        )
        if not target:
            raise HTTPException(status_code=400, detail="Target troubleshooter tidak ditemukan.")
        if target.get("active") is False:
            raise HTTPException(status_code=400, detail="Target troubleshooter tidak aktif.")
        if target.get("role") not in REASSIGN_TARGET_ROLES:
            raise HTTPException(status_code=400, detail="Target harus NOC Engineer atau Teknisi Lapangan.")
        if target["id"] == t.get("troubleshooter_id"):
            raise HTTPException(status_code=400, detail="Target sama dengan troubleshooter saat ini.")

        now = now_iso()
        target_name = target.get("name") or target.get("email")
        # (9,11) Audit history entry — NOT overwritten (pushed as history).
        entry = {
            "id": new_id(),
            "at": now,
            "from_id": t.get("troubleshooter_id"),
            "from_name": t.get("troubleshooter_name"),
            "to_id": target["id"],
            "to_name": target_name,
            "to_role": target.get("role"),
            "reason": body.reason or "",
            "by_id": user.get("id"),
            "by_name": user.get("name") or user.get("email"),
            "by_role": user.get("role"),
        }
        # (8) Per-troubleshooter assignment segments (time ranges). This is
        # ADDITIVE and does NOT touch incident timers (created/processed/response/
        # execution/downtime remain based on the existing incident flow).
        segments = list(t.get("assignment_history") or [])
        if not segments and t.get("troubleshooter_id"):
            segments.append({
                "user_id": t.get("troubleshooter_id"),
                "user_name": t.get("troubleshooter_name"),
                "from": t.get("processed_at") or t.get("created_at"),
                "to": None,
            })
        for seg in segments:
            if seg.get("to") is None:
                seg["to"] = now
        segments.append({"user_id": target["id"], "user_name": target_name, "from": now, "to": None})

        audit = _make_audit(user, "troubleshooter_reassigned", entry)
        await db.helpdesk_tickets.update_one(
            {"id": tid},
            {
                "$push": {"reassign_history": entry, "audit_log": audit},
                "$set": {
                    "troubleshooter_id": target["id"],
                    "troubleshooter_name": target_name,
                    "assignment_history": segments,
                    "updated_at": now,
                },
            },
        )
        fresh = await _get_ticket_or_404(db, tid)
        # (9) Internal-only WhatsApp/notification about the reassignment.
        await notify_ticket_event(db, "reassigned", fresh, {
            "from_name": entry["from_name"] or "-",
            "to_name": target_name,
            "by_name": entry["by_name"],
            "reason": entry["reason"] or "-",
        })
        return fresh

    # ---------------- Resolve ----------------
    @router.post("/tickets/{tid}/resolve")
    async def resolve_ticket(tid: str, body: ResolveIn, user: dict = Depends(get_current_user)):
        _require(user, NOC)
        db = get_db()
        t = await _get_ticket_or_404(db, tid)
        if t["status"] != "DIPROSES":
            raise HTTPException(status_code=400, detail="Ticket harus dalam status DIPROSES untuk diselesaikan")

        # Check completion evidence requirement
        completion_files = await db.helpdesk_ticket_files.count_documents({
            "ticket_id": tid, "evidence_type": "COMPLETION_EVIDENCE",
        }) + len(body.completion_file_ids)
        needs_evidence = True
        cat_id = t.get("category_id")
        if cat_id:
            cat = await db.helpdesk_categories.find_one({"id": cat_id}, {"_id": 0, "requires_completion_evidence": 1})
            if cat is not None:
                needs_evidence = bool(cat.get("requires_completion_evidence", True))

        override = None
        if needs_evidence and completion_files == 0:
            if user.get("role") in SUPERVISOR:
                if not body.override_reason or len(body.override_reason.strip()) < 3:
                    raise HTTPException(
                        status_code=400,
                        detail="Alasan override wajib diisi (min. 3 karakter) untuk menyelesaikan tanpa dokumentasi",
                    )
                override = {
                    "by_id": user.get("id"),
                    "by_name": user.get("name") or user.get("email"),
                    "at": now_iso(),
                    "reason": body.override_reason.strip(),
                }
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Minimal 1 dokumentasi selesai (COMPLETION_EVIDENCE) diwajibkan sebelum ticket ditutup",
                )

        # Tag any newly-attached completion files
        if body.completion_file_ids:
            await db.helpdesk_ticket_files.update_many(
                {"id": {"$in": body.completion_file_ids}, "ticket_id": tid},
                {"$set": {"evidence_type": "COMPLETION_EVIDENCE"}},
            )

        a = _actor(user)
        now = now_iso()
        response_time = _diff_seconds(t.get("created_at"), t.get("processed_at"))
        execution_time = _diff_seconds(t.get("processed_at"), now)
        downtime = _diff_seconds(t.get("outage_started_at"), body.service_restored_at)
        total_handling = _diff_seconds(t.get("created_at"), now)

        patch = {
            "status": "SELESAI",
            "resolved_at": now,
            "resolved_by_id": a["id"],
            "resolved_by_name": a["name"],
            "root_cause": body.root_cause,
            "action_taken": body.action_taken,
            "final_solution": body.final_solution,
            "service_restored_at": body.service_restored_at,
            "service_final_status": body.service_final_status,
            "closing_notes": body.closing_notes,
            "completion_override": override,
            "response_time_seconds": response_time,
            "execution_time_seconds": execution_time,
            "downtime_seconds": downtime,
            "total_handling_seconds": total_handling,
            "updated_at": now,
        }
        audit = _make_audit(user, "ticket_resolved", {
            "response_time_s": response_time, "execution_time_s": execution_time,
            "downtime_s": downtime, "override": bool(override),
        })
        await db.helpdesk_tickets.update_one({"id": tid}, {"$set": patch, "$push": {"audit_log": audit}})
        fresh = await _get_ticket_or_404(db, tid)
        # existing operational notifications (internal + customer) — unchanged
        await notify_ticket_event(db, "resolved", fresh)
        # NEW: after a successful close, send ONE resume to the Main/Management
        # group (gated by settings toggle). Best-effort, never rolls back close.
        await notify_closing_resume(db, fresh)
        return fresh

    # ---------------- Reopen ----------------
    @router.post("/tickets/{tid}/reopen")
    async def reopen_ticket(tid: str, user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        t = await _get_ticket_or_404(db, tid)
        if t["status"] != "SELESAI":
            raise HTTPException(status_code=400, detail="Ticket bukan dalam status SELESAI")
        audit = _make_audit(user, "ticket_reopened")
        await db.helpdesk_tickets.update_one({"id": tid}, {"$set": {"status": "DIPROSES", "updated_at": now_iso()}, "$push": {"audit_log": audit}})
        return await _get_ticket_or_404(db, tid)

    # ---------------- Files ----------------
    @router.post("/tickets/{tid}/files")
    async def upload_files(
        tid: str,
        files: List[UploadFile] = File(...),
        evidence_type: EvidenceType = Form("GENERAL_ATTACHMENT"),
        description: str = Form(""),
        work_stage: str = Form(""),
        latitude: Optional[float] = Form(None),
        longitude: Optional[float] = Form(None),
        user: dict = Depends(get_current_user),
    ):
        _require(user, NOC)
        db = get_db()
        await _get_ticket_or_404(db, tid)
        if not files:
            raise HTTPException(status_code=400, detail="Tidak ada file")
        a = _actor(user)
        saved = []
        for f in files:
            meta = await _save_upload(f, tid)
            doc = {
                "id": meta["id"],
                "ticket_id": tid,
                "file_name": meta["file_name"],
                "original_file_name": meta["original_file_name"],
                "storage_path": meta["storage_path"],
                "file_url": f"/api/crm/tickets/{tid}/files/{meta['id']}/content",
                "file_type": meta["file_type"],
                "mime_type": meta["mime_type"],
                "file_size": meta["file_size"],
                "evidence_type": evidence_type,
                "work_stage": work_stage,
                "description": description,
                "uploaded_by_id": a["id"],
                "uploaded_by_name": a["name"],
                "uploaded_at": now_iso(),
                "latitude": latitude,
                "longitude": longitude,
            }
            await db.helpdesk_ticket_files.insert_one(doc)
            doc.pop("_id", None)
            saved.append(doc)
        audit = _make_audit(user, "files_uploaded", {"count": len(saved), "type": evidence_type})
        await db.helpdesk_tickets.update_one({"id": tid}, {"$push": {"audit_log": audit}, "$set": {"updated_at": now_iso()}})
        return {"items": saved}

    @router.get("/tickets/{tid}/files")
    async def list_files(tid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        cur = db.helpdesk_ticket_files.find({"ticket_id": tid}, {"_id": 0}).sort("uploaded_at", 1)
        return await cur.to_list(1000)

    @router.get("/tickets/{tid}/files/{fid}/content")
    async def get_file_content(tid: str, fid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        f = await db.helpdesk_ticket_files.find_one({"ticket_id": tid, "id": fid}, {"_id": 0})
        if not f:
            raise HTTPException(status_code=404, detail="File tidak ditemukan")
        path = UPLOAD_DIR / f.get("storage_path", "")
        if not path.exists():
            raise HTTPException(status_code=404, detail="File fisik hilang")
        return FileResponse(str(path), media_type=f.get("mime_type") or "application/octet-stream", filename=f.get("original_file_name") or f["file_name"])

    @router.delete("/tickets/{tid}/files/{fid}")
    async def delete_file(tid: str, fid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        f = await db.helpdesk_ticket_files.find_one({"ticket_id": tid, "id": fid}, {"_id": 0})
        if not f:
            raise HTTPException(status_code=404, detail="File tidak ditemukan")
        # uploader OR supervisor/admin dapat menghapus
        if user.get("role") not in SUPERVISOR and user.get("id") != f.get("uploaded_by_id"):
            raise HTTPException(status_code=403, detail="Hanya uploader atau supervisor/admin yang dapat menghapus")
        try:
            p = UPLOAD_DIR / f.get("storage_path", "")
            if p.exists():
                p.unlink()
        except Exception:
            pass
        await db.helpdesk_ticket_files.delete_one({"id": fid, "ticket_id": tid})
        audit = _make_audit(user, "file_deleted", {"file": f.get("original_file_name")})
        await db.helpdesk_tickets.update_one({"id": tid}, {"$push": {"audit_log": audit}, "$set": {"updated_at": now_iso()}})
        return {"ok": True}

    # ---------------- Technicians (for reassign dropdown) ----------------
    @router.get("/technicians")
    async def list_technicians(user: dict = Depends(get_current_user)):
        db = get_db()
        # Only ACTIVE NOC Engineer + Teknisi Lapangan are valid reassign targets.
        docs = await db.users.find(
            {"role": {"$in": ["engineer", "teknisi"]}, "active": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
        ).to_list(500)
        return docs

    # ---------------- Migration status ----------------
    @router.get("/counts")
    async def counts(user: dict = Depends(get_current_user)):
        db = get_db()
        total = await db.helpdesk_tickets.count_documents({})
        masuk = await db.helpdesk_tickets.count_documents({"status": "MASUK"})
        diproses = await db.helpdesk_tickets.count_documents({"status": "DIPROSES"})
        selesai = await db.helpdesk_tickets.count_documents({"status": "SELESAI"})
        return {"total": total, "masuk": masuk, "diproses": diproses, "selesai": selesai}

    @router.get("/stats")
    async def stats(user: dict = Depends(get_current_user)):
        db = get_db()
        total = await db.helpdesk_tickets.count_documents({})
        by_status = {}
        for s in ("MASUK", "DIPROSES", "SELESAI"):
            by_status[s] = await db.helpdesk_tickets.count_documents({"status": s})
        by_prio = {}
        for p in ("Low", "Medium", "High", "Critical"):
            by_prio[p] = await db.helpdesk_tickets.count_documents({"priority": p})
        # Report source distribution
        by_source: dict = {}
        async for row in db.helpdesk_tickets.aggregate([
            {"$group": {"_id": "$report_source", "count": {"$sum": 1}}},
        ]):
            k = row["_id"] or "Lainnya"
            by_source[k] = row["count"]
        # Avg times (only closed tickets)
        pipeline = [
            {"$match": {"status": "SELESAI"}},
            {"$group": {
                "_id": None,
                "avg_response": {"$avg": "$response_time_seconds"},
                "avg_execution": {"$avg": "$execution_time_seconds"},
                "avg_total": {"$avg": "$total_handling_seconds"},
            }},
        ]
        agg = await db.helpdesk_tickets.aggregate(pipeline).to_list(1)
        avg = agg[0] if agg else {}
        # Trend 14 hari (based on created_at prefix)
        trend = []
        today = now_utc().date()
        for i in range(13, -1, -1):
            d = today - timedelta(days=i)
            day_key = d.isoformat()
            c = await db.helpdesk_tickets.count_documents({"created_at": {"$regex": f"^{day_key}"}})
            trend.append({"date": day_key, "count": c})
        # Top troubleshooters
        top = []
        async for row in db.helpdesk_tickets.aggregate([
            {"$match": {"troubleshooter_name": {"$ne": None}}},
            {"$group": {"_id": "$troubleshooter_name", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 5},
        ]):
            top.append({"name": row["_id"], "count": row["count"]})
        return {
            "total": total,
            "by_status": by_status,
            "by_priority": by_prio,
            "by_report_source": by_source,
            "avg_response_seconds": (avg or {}).get("avg_response"),
            "avg_execution_seconds": (avg or {}).get("avg_execution"),
            "avg_total_seconds": (avg or {}).get("avg_total"),
            "trend": trend,
            "top_troubleshooters": top,
        }

    return router
