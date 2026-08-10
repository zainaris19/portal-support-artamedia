"""
Shift Handover — modul Operational NOC (redesign penuh).

Endpoints (semua di /api/ops/handovers/...):
    GET    /api/ops/handovers              — list (filter tanggal/shift/petugas/status/dll)
    POST   /api/ops/handovers              — buat handover (draft)
    GET    /api/ops/handovers/{id}         — detail
    PUT    /api/ops/handovers/{id}         — edit (draft/returned; admin/supervisor bisa kapan saja)
    DELETE /api/ops/handovers/{id}         — hapus (admin)
    POST   /api/ops/handovers/{id}/submit  — submit (draft → submitted)
    POST   /api/ops/handovers/{id}/accept  — receiver accept
    POST   /api/ops/handovers/{id}/return  — receiver return (butuh alasan)
    POST   /api/ops/handovers/{id}/review  — supervisor review

    Cases (nested):
    POST   /api/ops/handovers/{id}/cases          — tambah case
    PUT    /api/ops/handovers/{id}/cases/{cid}    — edit case
    DELETE /api/ops/handovers/{id}/cases/{cid}    — hapus case (draft)
    POST   /api/ops/handovers/{id}/cases/{cid}/duplicate — salin case

    Carry over sumber:
    GET    /api/ops/handovers/carry-over-candidates — ambil open case dari handover sebelumnya (Accepted/Submitted terakhir)

    Files:
    POST   /api/ops/handovers/{id}/files          — upload lampiran ({case_id?} form)
    GET    /api/ops/handovers/{id}/files/{fid}/content — download
    DELETE /api/ops/handovers/{id}/files/{fid}    — hapus

    Stats:
    GET    /api/ops/handovers/stats               — dashboard widget
    GET    /api/ops/handovers/counts              — sidebar counter
"""
from __future__ import annotations

import uuid
import logging
import mimetypes
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict

logger = logging.getLogger("noc.shift_handover")

UPLOAD_DIR = Path(__file__).parent / "uploads" / "handovers"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}

# Asia/Jakarta = UTC+7 (no DST)
JKT_OFFSET = timedelta(hours=7)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def now_jkt_date() -> str:
    """YYYY-MM-DD di zona Asia/Jakarta."""
    return (now_utc() + JKT_OFFSET).strftime("%Y-%m-%d")


def new_id() -> str:
    return str(uuid.uuid4())


HandoverStatus = Literal["Draft", "Submitted", "Reviewed", "Accepted", "Returned"]
ShiftCode = Literal["R1", "R2", "R3"]
CaseStatus = Literal[
    "Open", "Monitoring", "Waiting Customer", "Waiting Vendor",
    "Waiting Internal", "Escalated", "Resolved", "Closed",
]
CasePriority = Literal["Low", "Medium", "High", "Critical"]

SHIFT_HOURS = {
    "R1": ("07:00", "15:00"),
    "R2": ("15:00", "23:00"),
    "R3": ("23:00", "07:00"),  # crosses midnight
}

CARRY_OVER_STATUSES = {"Open", "Monitoring", "Waiting Customer", "Waiting Vendor", "Waiting Internal", "Escalated"}


# ----------------------------------------------------------------------------
# Pydantic
# ----------------------------------------------------------------------------
class CaseIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_id: Optional[str] = None
    customer_name: str = ""
    location: str = ""
    category: str = ""
    ticket_id: Optional[str] = None
    ticket_number: Optional[str] = None
    case_detail: str = ""
    action_taken: str = ""
    current_condition: str = ""
    next_action: str = ""
    assigned_pic: str = ""
    priority: CasePriority = "Medium"
    status: CaseStatus = "Open"
    follow_up_at: Optional[str] = None
    previous_case_id: Optional[str] = None
    carry_over_count: int = 0
    attachment_ids: List[str] = Field(default_factory=list)


class HandoverCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    handover_date: Optional[str] = None       # YYYY-MM-DD Asia/Jakarta; default = today
    shift_code: ShiftCode = "R1"
    worker_id: Optional[str] = None            # only admin/supervisor may override
    worker_name: Optional[str] = None
    receiver_id: Optional[str] = None
    receiver_name: str = ""
    general_notes: str = ""
    cases: List[CaseIn] = Field(default_factory=list)


class HandoverUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    handover_date: Optional[str] = None
    shift_code: Optional[ShiftCode] = None
    receiver_id: Optional[str] = None
    receiver_name: Optional[str] = None
    general_notes: Optional[str] = None
    edit_reason: Optional[str] = None          # required for admin/supervisor editing submitted


class AcceptIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    receiver_notes: str = ""


class ReturnIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    return_reason: str


# ----------------------------------------------------------------------------
# Migration + utils
# ----------------------------------------------------------------------------
def _map_shift(shift: str) -> str:
    return {"Morning": "R1", "Afternoon": "R2", "Night": "R3"}.get(shift, "R1")


def _map_case_status(s: str) -> str:
    if not s:
        return "Open"
    s = s.strip()
    mapping = {"Pending": "Waiting Internal", "Resolved": "Resolved", "Open": "Open", "Monitoring": "Monitoring"}
    return mapping.get(s, s if s in {"Open", "Monitoring", "Waiting Customer", "Waiting Vendor", "Waiting Internal", "Escalated", "Resolved", "Closed"} else "Open")


async def run_migration(db) -> dict:
    """Migrate legacy `shift_handovers` (single-record schema) → new schema.
    Idempotent: rows already migrated (`migrated_from_legacy=True`) are skipped."""
    out = {"backed_up": 0, "migrated": 0, "skipped": 0}
    if "shift_handovers" not in await db.list_collection_names():
        return out

    # Only migrate legacy rows: those WITHOUT `handover_number` (new schema has it)
    legacy_rows = []
    async for d in db.shift_handovers.find({"handover_number": {"$exists": False}}, {"_id": 0}):
        legacy_rows.append(d)
    if not legacy_rows:
        return out

    # Backup once per day
    today = now_utc().strftime("%Y%m%d")
    backup_name = f"shift_handovers_backup_{today}"
    if backup_name not in await db.list_collection_names():
        try:
            await db.shift_handovers.aggregate([
                {"$match": {"handover_number": {"$exists": False}}},
                {"$out": backup_name},
            ]).to_list(1)
            out["backed_up"] = await db[backup_name].count_documents({})
            logger.info(f"[shift-handover] Backup legacy → {backup_name} ({out['backed_up']} rows)")
        except Exception as ex:
            logger.error(f"[shift-handover] backup failed: {ex}")

    # Group legacy rows by (date, shift, officer) and create one handover per group
    grouped: dict = {}
    for d in legacy_rows:
        key = (d.get("date") or now_jkt_date(), d.get("shift") or "Morning", d.get("officer") or "Migrated")
        grouped.setdefault(key, []).append(d)

    for (date_, shift_, officer), rows in grouped.items():
        shift_code = _map_shift(shift_)
        h_num = await _gen_handover_number(db, date_, shift_code)
        cases = []
        for row in rows:
            cases.append({
                "id": new_id(),
                "customer_id": row.get("customer_id"),
                "customer_name": "",
                "location": row.get("site") or "",
                "category": "",
                "ticket_id": None,
                "ticket_number": None,
                "case_detail": row.get("issue") or "",
                "action_taken": row.get("action_taken") or "",
                "current_condition": "",
                "next_action": row.get("notes_next_shift") or "",
                "assigned_pic": officer,
                "priority": row.get("priority") or "Medium",
                "status": _map_case_status(row.get("status")),
                "follow_up_at": None,
                "previous_case_id": None,
                "carry_over_count": 0,
                "attachment_ids": [],
                "created_at": row.get("created_at") or now_iso(),
                "created_by": officer,
                "updated_at": row.get("created_at") or now_iso(),
                "updated_by": officer,
            })
        totals = _compute_totals(cases)
        doc = {
            "id": new_id(),
            "handover_number": h_num,
            "handover_date": date_,
            "shift_code": shift_code,
            "shift_start": SHIFT_HOURS[shift_code][0],
            "shift_end": SHIFT_HOURS[shift_code][1],
            "worker_id": None,
            "worker_name": officer,
            "worker_role": "engineer",
            "receiver_id": None,
            "receiver_name": "",
            "general_notes": "",
            "receiver_notes": "",
            "status": "Accepted",  # legacy dianggap sudah closed
            "cases": cases,
            **totals,
            "created_at": rows[0].get("created_at") or now_iso(),
            "created_by": officer,
            "updated_at": now_iso(),
            "submitted_at": rows[0].get("created_at") or now_iso(),
            "submitted_by": officer,
            "accepted_at": now_iso(),
            "accepted_by": "migration",
            "returned_at": None,
            "returned_by": None,
            "return_reason": None,
            "edit_history": [],
            "activity_logs": [{
                "id": new_id(), "action": "migrated_from_legacy", "user_id": None,
                "user_name": "migration", "user_role": "system", "timestamp": now_iso(),
                "description": f"Migrated from legacy shift_handovers ({len(rows)} row(s))",
            }],
            "migrated_from_legacy": True,
        }
        await db.shift_handovers.insert_one(doc)
        # Remove legacy rows we consumed
        for row in rows:
            if row.get("id"):
                await db.shift_handovers.delete_one({"id": row["id"], "handover_number": {"$exists": False}})
        out["migrated"] += 1

    logger.info(f"[shift-handover] migration summary: {out}")
    return out


def _compute_totals(cases: list) -> dict:
    total = len(cases)
    open_ = sum(1 for c in cases if c.get("status") == "Open")
    monitoring = sum(1 for c in cases if c.get("status") == "Monitoring")
    waiting = sum(1 for c in cases if (c.get("status") or "").startswith("Waiting"))
    resolved = sum(1 for c in cases if c.get("status") in ("Resolved", "Closed"))
    critical = sum(1 for c in cases if c.get("priority") == "Critical")
    escalated = sum(1 for c in cases if c.get("status") == "Escalated")
    return {
        "total_cases": total,
        "open_cases": open_,
        "monitoring_cases": monitoring,
        "waiting_cases": waiting,
        "resolved_cases": resolved,
        "critical_cases": critical,
        "escalated_cases": escalated,
    }


async def _gen_handover_number(db, date_str: str, shift_code: str) -> str:
    """SHO-YYYYMMDD-{shift}-NNN"""
    ymd = (date_str or now_jkt_date()).replace("-", "")
    prefix = f"SHO-{ymd}-{shift_code}-"
    latest = await db.shift_handovers.find_one(
        {"handover_number": {"$regex": f"^{prefix}"}},
        sort=[("handover_number", -1)],
    )
    seq = 1
    if latest and latest.get("handover_number"):
        try:
            seq = int(latest["handover_number"].split("-")[-1]) + 1
        except Exception:
            seq = 1
    return f"{prefix}{seq:03d}"


def _actor(user: dict) -> dict:
    return {"id": user.get("id"), "name": user.get("name") or user.get("email"), "role": user.get("role")}


def _log_entry(user: dict, action: str, description: str = "", previous=None, new=None) -> dict:
    a = _actor(user)
    e = {
        "id": new_id(),
        "action": action,
        "user_id": a["id"],
        "user_name": a["name"],
        "user_role": a["role"],
        "timestamp": now_iso(),
        "description": description,
    }
    if previous is not None:
        e["previous_value"] = previous
    if new is not None:
        e["new_value"] = new
    return e


# ----------------------------------------------------------------------------
# Router
# ----------------------------------------------------------------------------
def build_shift_handover_router(get_current_user, get_db):
    router = APIRouter(prefix="/ops/handovers", tags=["shift-handover"])

    ADMIN = {"admin"}
    SUPERVISOR = {"admin", "supervisor"}
    NOC = {"admin", "supervisor", "engineer", "operational"}
    ALL_READ = {"admin", "supervisor", "engineer", "viewer", "operational", "admin_router"}

    def _require(user: dict, roles: set):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    async def _get_or_404(db, hid: str) -> dict:
        h = await db.shift_handovers.find_one({"id": hid}, {"_id": 0})
        if not h:
            raise HTTPException(status_code=404, detail="Handover tidak ditemukan")
        return h

    def _can_edit(user: dict, h: dict) -> bool:
        if user.get("role") in SUPERVISOR:
            return True
        # NOC: hanya bisa edit handover milik sendiri dan status draft/returned
        if h.get("worker_id") and h["worker_id"] == user.get("id") and h.get("status") in ("Draft", "Returned"):
            return True
        return False

    # ---------------- Stats ----------------
    @router.get("/stats")
    async def stats(user: dict = Depends(get_current_user)):
        db = get_db()
        today = now_jkt_date()
        # today handovers
        today_count = await db.shift_handovers.count_documents({"handover_date": today})
        pending_accept = await db.shift_handovers.count_documents({"status": {"$in": ["Submitted", "Reviewed"]}})
        # Aggregate case totals across all handovers
        pipeline = [
            {"$unwind": "$cases"},
            {"$group": {
                "_id": "$cases.status",
                "count": {"$sum": 1},
            }},
        ]
        by_status = {}
        async for row in db.shift_handovers.aggregate(pipeline):
            by_status[row["_id"]] = row["count"]
        critical_pipeline = [
            {"$unwind": "$cases"},
            {"$match": {"cases.priority": "Critical", "cases.status": {"$nin": ["Resolved", "Closed"]}}},
            {"$count": "n"},
        ]
        cagg = await db.shift_handovers.aggregate(critical_pipeline).to_list(1)
        critical_open = cagg[0]["n"] if cagg else 0
        long_carry_pipeline = [
            {"$unwind": "$cases"},
            {"$match": {"cases.carry_over_count": {"$gte": 2}, "cases.status": {"$nin": ["Resolved", "Closed"]}}},
            {"$count": "n"},
        ]
        lagg = await db.shift_handovers.aggregate(long_carry_pipeline).to_list(1)
        long_carry = lagg[0]["n"] if lagg else 0
        # Latest submitted
        latest = await db.shift_handovers.find_one(
            {"submitted_at": {"$ne": None}}, {"_id": 0, "handover_number": 1, "worker_name": 1, "shift_code": 1, "submitted_at": 1},
            sort=[("submitted_at", -1)],
        )
        return {
            "today": today_count,
            "pending_accept": pending_accept,
            "open_cases": by_status.get("Open", 0),
            "monitoring_cases": by_status.get("Monitoring", 0),
            "waiting_customer": by_status.get("Waiting Customer", 0),
            "waiting_vendor": by_status.get("Waiting Vendor", 0),
            "waiting_internal": by_status.get("Waiting Internal", 0),
            "escalated": by_status.get("Escalated", 0),
            "critical_open": critical_open,
            "long_carry_over": long_carry,
            "latest_submitted": latest,
        }

    @router.get("/counts")
    async def counts(user: dict = Depends(get_current_user)):
        db = get_db()
        today = now_jkt_date()
        return {
            "total": await db.shift_handovers.count_documents({}),
            "today": await db.shift_handovers.count_documents({"handover_date": today}),
            "pending_accept": await db.shift_handovers.count_documents({"status": {"$in": ["Submitted", "Reviewed"]}}),
            "draft": await db.shift_handovers.count_documents({"status": "Draft"}),
        }

    # ---------------- Carry-over candidates ----------------
    @router.get("/carry-over-candidates")
    async def carry_over_candidates(
        exclude_handover_id: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        db = get_db()
        # Ambil case OPEN (status di CARRY_OVER_STATUSES) dari handover yang sudah Submitted/Reviewed/Accepted,
        # kecuali handover yang sedang dibuat.
        q = {"status": {"$in": ["Submitted", "Reviewed", "Accepted"]}}
        if exclude_handover_id:
            q["id"] = {"$ne": exclude_handover_id}
        results = []
        async for h in db.shift_handovers.find(q, {"_id": 0}).sort("handover_date", -1).limit(30):
            for c in h.get("cases", []):
                if c.get("status") in CARRY_OVER_STATUSES:
                    results.append({
                        "handover_id": h["id"],
                        "handover_number": h["handover_number"],
                        "handover_date": h["handover_date"],
                        "shift_code": h["shift_code"],
                        "worker_name": h.get("worker_name"),
                        "case": c,
                    })
        # Dedup by case.id (only latest occurrence)
        seen = set()
        deduped = []
        for r in results:
            cid = r["case"]["id"]
            if cid in seen:
                continue
            seen.add(cid)
            deduped.append(r)
        return deduped[:200]

    # ---------------- List ----------------
    @router.get("")
    async def list_handovers(
        q: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        shift_code: Optional[ShiftCode] = None,
        worker_id: Optional[str] = None,
        receiver_id: Optional[str] = None,
        status: Optional[HandoverStatus] = None,
        case_status: Optional[CaseStatus] = None,
        priority: Optional[CasePriority] = None,
        page: int = 1,
        page_size: int = 20,
        user: dict = Depends(get_current_user),
    ):
        db = get_db()
        query: dict = {}
        if status:
            query["status"] = status
        if shift_code:
            query["shift_code"] = shift_code
        if worker_id:
            query["worker_id"] = worker_id
        if receiver_id:
            query["receiver_id"] = receiver_id
        if date_from or date_to:
            df = {}
            if date_from:
                df["$gte"] = date_from
            if date_to:
                df["$lte"] = date_to
            query["handover_date"] = df
        if q:
            import re as _re
            rx = {"$regex": _re.escape(q), "$options": "i"}
            query["$or"] = [
                {"handover_number": rx}, {"worker_name": rx}, {"receiver_name": rx},
                {"general_notes": rx}, {"cases.customer_name": rx}, {"cases.location": rx},
                {"cases.case_detail": rx}, {"cases.ticket_number": rx},
            ]
        if case_status:
            query["cases.status"] = case_status
        if priority:
            query["cases.priority"] = priority

        total = await db.shift_handovers.count_documents(query)
        skip = max(0, (page - 1) * page_size)
        cur = db.shift_handovers.find(query, {"_id": 0}).sort([
            ("handover_date", -1), ("shift_code", -1), ("created_at", -1),
        ]).skip(skip).limit(page_size)
        items = await cur.to_list(page_size)
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    # ---------------- Detail ----------------
    @router.get("/{hid}")
    async def detail(hid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        return await _get_or_404(db, hid)

    # ---------------- Create ----------------
    @router.post("")
    async def create(body: HandoverCreate, user: dict = Depends(get_current_user)):
        _require(user, NOC)
        db = get_db()
        actor = _actor(user)
        # Worker resolution
        worker_id = actor["id"]
        worker_name = actor["name"]
        worker_role = user.get("role")
        if body.worker_id and body.worker_id != actor["id"]:
            _require(user, SUPERVISOR)
            u = await db.users.find_one({"id": body.worker_id}, {"_id": 0, "name": 1, "email": 1, "role": 1})
            if not u:
                raise HTTPException(status_code=400, detail="worker_id tidak ditemukan")
            worker_id = body.worker_id
            worker_name = u.get("name") or u.get("email")
            worker_role = u.get("role")
        elif body.worker_name and user.get("role") in SUPERVISOR:
            worker_name = body.worker_name
            worker_id = None
        date_ = body.handover_date or now_jkt_date()
        shift_code = body.shift_code
        h_num = await _gen_handover_number(db, date_, shift_code)
        now = now_iso()
        cases = []
        for c in body.cases:
            cases.append({
                **c.model_dump(),
                "id": new_id(),
                "created_at": now,
                "created_by": actor["name"],
                "updated_at": now,
                "updated_by": actor["name"],
            })
        totals = _compute_totals(cases)
        doc = {
            "id": new_id(),
            "handover_number": h_num,
            "handover_date": date_,
            "shift_code": shift_code,
            "shift_start": SHIFT_HOURS[shift_code][0],
            "shift_end": SHIFT_HOURS[shift_code][1],
            "worker_id": worker_id,
            "worker_name": worker_name,
            "worker_role": worker_role,
            "receiver_id": body.receiver_id,
            "receiver_name": body.receiver_name,
            "general_notes": body.general_notes,
            "receiver_notes": "",
            "status": "Draft",
            "cases": cases,
            **totals,
            "created_at": now,
            "created_by": actor["name"],
            "updated_at": now,
            "submitted_at": None,
            "submitted_by": None,
            "accepted_at": None,
            "accepted_by": None,
            "returned_at": None,
            "returned_by": None,
            "return_reason": None,
            "edit_history": [],
            "activity_logs": [_log_entry(user, "handover_created", f"Draft dibuat: {h_num}")],
        }
        await db.shift_handovers.insert_one(doc)
        doc.pop("_id", None)
        return doc

    # ---------------- Update ----------------
    @router.put("/{hid}")
    async def update(hid: str, body: HandoverUpdate, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        editable_by_owner = h.get("status") in ("Draft", "Returned") and h.get("worker_id") == user.get("id")
        if not editable_by_owner and user.get("role") not in SUPERVISOR:
            raise HTTPException(status_code=403, detail="Tidak dapat mengedit — status bukan Draft/Returned atau bukan pemilik")
        patch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None and k != "edit_reason"}
        if not patch:
            return h
        # shift_code change auto updates start/end
        if patch.get("shift_code"):
            patch["shift_start"], patch["shift_end"] = SHIFT_HOURS[patch["shift_code"]]
        patch["updated_at"] = now_iso()
        # Supervisor editing submitted → require reason
        needs_reason = h.get("status") not in ("Draft", "Returned") and user.get("role") in SUPERVISOR
        edit_history_push = None
        if needs_reason:
            if not body.edit_reason or len(body.edit_reason.strip()) < 3:
                raise HTTPException(status_code=400, detail="Alasan edit wajib untuk mengubah handover yang sudah submitted")
            edit_history_push = {
                "id": new_id(), "at": now_iso(),
                "by_id": user.get("id"), "by_name": user.get("name") or user.get("email"),
                "reason": body.edit_reason.strip(), "changed_fields": list(patch.keys()),
            }
        log = _log_entry(user, "handover_updated", f"Field: {', '.join(patch.keys())}")
        ops = {"$set": patch, "$push": {"activity_logs": log}}
        if edit_history_push:
            ops["$push"]["edit_history"] = edit_history_push
        await db.shift_handovers.update_one({"id": hid}, ops)
        return await _get_or_404(db, hid)

    # ---------------- Delete ----------------
    @router.delete("/{hid}")
    async def delete(hid: str, user: dict = Depends(get_current_user)):
        _require(user, ADMIN)
        db = get_db()
        h = await _get_or_404(db, hid)
        # Hapus file fisik
        async for f in db.shift_handover_files.find({"handover_id": hid}):
            p = UPLOAD_DIR / f.get("storage_path", "")
            try:
                if p.exists():
                    p.unlink()
            except Exception:
                pass
        await db.shift_handover_files.delete_many({"handover_id": hid})
        await db.shift_handovers.delete_one({"id": hid})
        return {"ok": True}

    # ---------------- Submit / Accept / Return / Review ----------------
    @router.post("/{hid}/submit")
    async def submit(hid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        if h["status"] not in ("Draft", "Returned"):
            raise HTTPException(status_code=400, detail=f"Handover tidak dalam Draft/Returned (sekarang {h['status']})")
        if len(h.get("cases", [])) < 1:
            raise HTTPException(status_code=400, detail="Minimal 1 case wajib sebelum submit")
        if h.get("worker_id") and h["worker_id"] != user.get("id") and user.get("role") not in SUPERVISOR:
            raise HTTPException(status_code=403, detail="Hanya pemilik handover atau supervisor yang dapat submit")
        now = now_iso()
        patch = {
            "status": "Submitted",
            "submitted_at": now,
            "submitted_by": user.get("name") or user.get("email"),
            "updated_at": now,
        }
        log = _log_entry(user, "handover_submitted", "Handover di-submit")
        await db.shift_handovers.update_one({"id": hid}, {"$set": patch, "$push": {"activity_logs": log}})
        return await _get_or_404(db, hid)

    @router.post("/{hid}/review")
    async def review(hid: str, user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        h = await _get_or_404(db, hid)
        if h["status"] != "Submitted":
            raise HTTPException(status_code=400, detail="Hanya handover status Submitted yang dapat direview")
        patch = {"status": "Reviewed", "updated_at": now_iso()}
        log = _log_entry(user, "handover_reviewed", "Ditandai reviewed oleh supervisor")
        await db.shift_handovers.update_one({"id": hid}, {"$set": patch, "$push": {"activity_logs": log}})
        return await _get_or_404(db, hid)

    @router.post("/{hid}/accept")
    async def accept(hid: str, body: AcceptIn, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        if h["status"] not in ("Submitted", "Reviewed"):
            raise HTTPException(status_code=400, detail="Handover tidak dalam Submitted/Reviewed")
        # Receiver-user OR supervisor/admin dapat accept
        if h.get("receiver_id") and h["receiver_id"] != user.get("id") and user.get("role") not in SUPERVISOR:
            raise HTTPException(status_code=403, detail="Hanya penerima shift atau supervisor yang dapat accept")
        now = now_iso()
        patch = {
            "status": "Accepted",
            "accepted_at": now,
            "accepted_by": user.get("name") or user.get("email"),
            "receiver_notes": body.receiver_notes,
            "updated_at": now,
        }
        log = _log_entry(user, "handover_accepted", "Handover diterima")
        await db.shift_handovers.update_one({"id": hid}, {"$set": patch, "$push": {"activity_logs": log}})
        return await _get_or_404(db, hid)

    @router.post("/{hid}/return")
    async def return_handover(hid: str, body: ReturnIn, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        if h["status"] not in ("Submitted", "Reviewed"):
            raise HTTPException(status_code=400, detail="Handover tidak dalam Submitted/Reviewed")
        if not body.return_reason or len(body.return_reason.strip()) < 3:
            raise HTTPException(status_code=400, detail="Alasan pengembalian wajib (min. 3 karakter)")
        if h.get("receiver_id") and h["receiver_id"] != user.get("id") and user.get("role") not in SUPERVISOR:
            raise HTTPException(status_code=403, detail="Hanya penerima atau supervisor yang dapat return")
        now = now_iso()
        patch = {
            "status": "Returned",
            "returned_at": now,
            "returned_by": user.get("name") or user.get("email"),
            "return_reason": body.return_reason.strip(),
            "updated_at": now,
        }
        log = _log_entry(user, "handover_returned", body.return_reason.strip())
        await db.shift_handovers.update_one({"id": hid}, {"$set": patch, "$push": {"activity_logs": log}})
        return await _get_or_404(db, hid)

    # ---------------- Cases ----------------
    @router.post("/{hid}/cases")
    async def add_case(hid: str, body: CaseIn, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        if not _can_edit(user, h):
            raise HTTPException(status_code=403, detail="Tidak dapat menambah case pada handover ini")
        actor = _actor(user)
        now = now_iso()
        case = {**body.model_dump(), "id": new_id(), "created_at": now, "created_by": actor["name"], "updated_at": now, "updated_by": actor["name"]}
        new_cases = list(h.get("cases", [])) + [case]
        log = _log_entry(user, "case_added", f"Tambah case: {case.get('customer_name') or case.get('location') or '-'}")
        await db.shift_handovers.update_one(
            {"id": hid},
            {"$set": {"cases": new_cases, **_compute_totals(new_cases), "updated_at": now}, "$push": {"activity_logs": log}},
        )
        return await _get_or_404(db, hid)

    @router.put("/{hid}/cases/{cid}")
    async def edit_case(hid: str, cid: str, body: CaseIn, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        if not _can_edit(user, h):
            raise HTTPException(status_code=403, detail="Tidak dapat mengedit case")
        actor = _actor(user)
        now = now_iso()
        cases = list(h.get("cases", []))
        idx = next((i for i, c in enumerate(cases) if c.get("id") == cid), -1)
        if idx < 0:
            raise HTTPException(status_code=404, detail="Case tidak ditemukan")
        old = cases[idx]
        merged = {**old, **body.model_dump(), "id": cid, "updated_at": now, "updated_by": actor["name"]}
        cases[idx] = merged
        log = _log_entry(user, "case_updated", f"Update case: {merged.get('customer_name') or merged.get('location') or '-'}")
        await db.shift_handovers.update_one(
            {"id": hid},
            {"$set": {"cases": cases, **_compute_totals(cases), "updated_at": now}, "$push": {"activity_logs": log}},
        )
        return await _get_or_404(db, hid)

    @router.delete("/{hid}/cases/{cid}")
    async def delete_case(hid: str, cid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        if not _can_edit(user, h):
            raise HTTPException(status_code=403, detail="Tidak dapat menghapus case")
        cases = [c for c in h.get("cases", []) if c.get("id") != cid]
        if len(cases) == len(h.get("cases", [])):
            raise HTTPException(status_code=404, detail="Case tidak ditemukan")
        # Delete attached files from disk & metadata
        await db.shift_handover_files.delete_many({"handover_id": hid, "case_id": cid})
        log = _log_entry(user, "case_deleted", f"Case {cid} dihapus")
        await db.shift_handovers.update_one(
            {"id": hid},
            {"$set": {"cases": cases, **_compute_totals(cases), "updated_at": now_iso()}, "$push": {"activity_logs": log}},
        )
        return await _get_or_404(db, hid)

    @router.post("/{hid}/cases/{cid}/duplicate")
    async def duplicate_case(hid: str, cid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        if not _can_edit(user, h):
            raise HTTPException(status_code=403, detail="Tidak dapat menduplikasi case")
        cases = list(h.get("cases", []))
        src = next((c for c in cases if c.get("id") == cid), None)
        if not src:
            raise HTTPException(status_code=404, detail="Case tidak ditemukan")
        actor = _actor(user)
        now = now_iso()
        new_case = {
            **src, "id": new_id(),
            "attachment_ids": [],  # tidak duplikasi lampiran fisik
            "case_detail": (src.get("case_detail") or "") + " (copy)",
            "created_at": now, "created_by": actor["name"],
            "updated_at": now, "updated_by": actor["name"],
            "previous_case_id": None, "carry_over_count": 0,
        }
        cases.append(new_case)
        log = _log_entry(user, "case_duplicated", f"Case {cid} digandakan")
        await db.shift_handovers.update_one(
            {"id": hid},
            {"$set": {"cases": cases, **_compute_totals(cases), "updated_at": now}, "$push": {"activity_logs": log}},
        )
        return await _get_or_404(db, hid)

    # ---------------- Files ----------------
    @router.post("/{hid}/files")
    async def upload_files(
        hid: str,
        files: List[UploadFile] = File(...),
        case_id: Optional[str] = Form(None),
        description: str = Form(""),
        user: dict = Depends(get_current_user),
    ):
        db = get_db()
        h = await _get_or_404(db, hid)
        if not _can_edit(user, h):
            raise HTTPException(status_code=403, detail="Tidak dapat upload pada handover ini")
        if not files:
            raise HTTPException(status_code=400, detail="Tidak ada file")
        a = _actor(user)
        tdir = UPLOAD_DIR / hid
        tdir.mkdir(parents=True, exist_ok=True)
        saved = []
        for f in files:
            ext = Path(f.filename or "file").suffix.lower()
            if ext not in ALLOWED_EXT:
                raise HTTPException(status_code=400, detail=f"Format {ext} tidak diizinkan")
            data = await f.read()
            if len(data) > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail=f"File > {MAX_FILE_SIZE // (1024*1024)} MB")
            file_id = new_id()
            stored = f"{file_id}{ext}"
            path = tdir / stored
            with open(path, "wb") as w:
                w.write(data)
            mime = f.content_type or mimetypes.guess_type(f.filename or "")[0] or "application/octet-stream"
            file_type = "image" if mime.startswith("image/") else "document"
            meta = {
                "id": file_id, "handover_id": hid, "case_id": case_id,
                "original_file_name": f.filename or "file",
                "stored_file_name": stored,
                "storage_path": f"{hid}/{stored}",
                "file_url": f"/api/ops/handovers/{hid}/files/{file_id}/content",
                "mime_type": mime, "file_type": file_type, "file_size": len(data),
                "description": description,
                "uploaded_by_id": a["id"], "uploaded_by_name": a["name"],
                "uploaded_at": now_iso(),
            }
            await db.shift_handover_files.insert_one(meta)
            meta.pop("_id", None)
            saved.append(meta)
        # Attach file ids to the specified case
        if case_id:
            cases = list(h.get("cases", []))
            for c in cases:
                if c.get("id") == case_id:
                    c.setdefault("attachment_ids", []).extend([s["id"] for s in saved])
                    c["updated_at"] = now_iso(); c["updated_by"] = a["name"]
            await db.shift_handovers.update_one({"id": hid}, {"$set": {"cases": cases, "updated_at": now_iso()}})
        log = _log_entry(user, "attachment_added", f"{len(saved)} file diunggah")
        await db.shift_handovers.update_one({"id": hid}, {"$push": {"activity_logs": log}, "$set": {"updated_at": now_iso()}})
        return {"items": saved}

    @router.get("/{hid}/files")
    async def list_files(hid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        cur = db.shift_handover_files.find({"handover_id": hid}, {"_id": 0}).sort("uploaded_at", 1)
        return await cur.to_list(1000)

    @router.get("/{hid}/files/{fid}/content")
    async def file_content(hid: str, fid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        f = await db.shift_handover_files.find_one({"handover_id": hid, "id": fid}, {"_id": 0})
        if not f:
            raise HTTPException(status_code=404, detail="File tidak ditemukan")
        p = UPLOAD_DIR / f.get("storage_path", "")
        if not p.exists():
            raise HTTPException(status_code=404, detail="File fisik hilang")
        return FileResponse(str(p), media_type=f.get("mime_type") or "application/octet-stream",
                            filename=f.get("original_file_name") or f["stored_file_name"])

    @router.delete("/{hid}/files/{fid}")
    async def delete_file(hid: str, fid: str, user: dict = Depends(get_current_user)):
        db = get_db()
        h = await _get_or_404(db, hid)
        f = await db.shift_handover_files.find_one({"handover_id": hid, "id": fid}, {"_id": 0})
        if not f:
            raise HTTPException(status_code=404, detail="File tidak ditemukan")
        if user.get("role") not in SUPERVISOR and user.get("id") != f.get("uploaded_by_id"):
            raise HTTPException(status_code=403, detail="Tidak berwenang menghapus")
        try:
            p = UPLOAD_DIR / f.get("storage_path", "")
            if p.exists():
                p.unlink()
        except Exception:
            pass
        await db.shift_handover_files.delete_one({"id": fid, "handover_id": hid})
        # Detach from case
        cases = list(h.get("cases", []))
        for c in cases:
            if fid in (c.get("attachment_ids") or []):
                c["attachment_ids"] = [x for x in c["attachment_ids"] if x != fid]
        await db.shift_handovers.update_one({"id": hid}, {"$set": {"cases": cases, "updated_at": now_iso()},
                                                          "$push": {"activity_logs": _log_entry(user, "attachment_deleted", f.get("original_file_name") or "")}})
        return {"ok": True}

    return router
