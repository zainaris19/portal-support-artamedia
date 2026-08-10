"""
Centralized Notification Service (provider-agnostic).

Design goals:
    * CRM pages NEVER call WhatsApp directly. They call `notify_ticket_event(...)`.
    * A single service resolves the active provider + templates, renders the
      message and dispatches it. All future modules (Maintenance, Monitoring,
      SLA, Handover) reuse the exact same `NotificationService.send(...)`.
    * The first provider is WhatsApp via Fonnte. Adding Telegram / Email /
      Discord later only means registering a new class in `PROVIDERS` — the CRM
      workflow does not change.

Collections:
    notification_settings   single config doc  (token stored ENCRYPTED)
    notification_templates  customizable message templates (placeholders)
    notification_logs       every outgoing attempt (audit / delivery trail)

Public (no-login) ticket tracking data is also built here so the customer can
follow progress from a secure link embedded in every customer notification.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import secrets
import smtplib
import uuid
import asyncio
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any, Dict, List, Optional

import httpx
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("noc.notifications")

SETTINGS_KEY = "notification_settings"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def _cipher() -> Fernet:
    key = os.environ.get("NOC_ENC_KEY")
    if not key:
        secret = os.environ.get("JWT_SECRET", "artamedia-default-secret")
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()).decode()
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def _mask(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return "*" * len(token)
    return token[:4] + "*" * (len(token) - 8) + token[-4:]


_PLACEHOLDER_RE = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def render_template(body: str, ctx: Dict[str, Any]) -> str:
    def repl(m):
        key = m.group(1)
        val = ctx.get(key)
        return "" if val is None else str(val)

    return _PLACEHOLDER_RE.sub(repl, body or "")


def _fmt_dt(iso: Optional[str]) -> str:
    if not iso:
        return "-"
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return d.strftime("%d %b %Y %H:%M")
    except Exception:
        return iso


def _human_duration(seconds: Optional[int]) -> str:
    if not seconds or seconds < 0:
        return "-"
    seconds = int(seconds)
    d, rem = divmod(seconds, 86400)
    h, rem = divmod(rem, 3600)
    m, _ = divmod(rem, 60)
    parts = []
    if d:
        parts.append(f"{d} hari")
    if h:
        parts.append(f"{h} jam")
    if m or not parts:
        parts.append(f"{m} menit")
    return " ".join(parts)


STATUS_LABEL = {"MASUK": "OPEN", "DIPROSES": "IN PROGRESS", "SELESAI": "RESOLVED"}


# ---------------------------------------------------------------------------
# Providers  (pluggable — future: telegram / email / discord)
# ---------------------------------------------------------------------------
class BaseProvider:
    name = "base"
    label = "Base"
    channels = ["whatsapp"]

    async def send(self, target: str, message: str, subject: Optional[str] = None) -> Dict[str, Any]:  # pragma: no cover
        raise NotImplementedError

    async def test(self) -> Dict[str, Any]:  # pragma: no cover
        raise NotImplementedError


class FonnteProvider(BaseProvider):
    name = "fonnte"
    label = "Fonnte (WhatsApp)"

    def __init__(self, api_url: str, token: str, country_code: str = "62"):
        self.api_url = (api_url or "https://api.fonnte.com").rstrip("/")
        self.token = token
        self.country_code = country_code or "62"

    async def send(self, target: str, message: str, subject: Optional[str] = None) -> Dict[str, Any]:
        is_group = "@g.us" in (target or "")
        data = {"target": target, "message": message}
        # groups ignore countryCode; for phones apply configured country code
        data["countryCode"] = "0" if is_group else self.country_code
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            r = await client.post(
                f"{self.api_url}/send",
                headers={"Authorization": self.token},  # raw token, NO Bearer
                data=data,
            )
        try:
            body = r.json()
        except ValueError:
            return {"ok": False, "http_status": r.status_code, "raw": r.text[:400]}
        ok = bool(body.get("status")) and r.status_code < 400
        return {"ok": ok, "http_status": r.status_code, "provider": body}

    async def test(self) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{self.api_url}/device", headers={"Authorization": self.token}
            )
        try:
            body = r.json()
        except ValueError:
            return {"connected": False, "detail": "Respon provider tidak valid"}
        if not body.get("status"):
            return {"connected": False, "detail": body.get("reason") or "Token tidak valid / device error"}
        return {
            "connected": body.get("device_status") == "connect",
            "device": body.get("device"),
            "device_status": body.get("device_status"),
            "quota": body.get("quota"),
            "expired": body.get("expired"),
        }


class EmailProvider(BaseProvider):
    """SMTP email provider (e.g. the user's own Gmail account via App Password)."""
    name = "email"
    label = "Email (SMTP)"
    channels = ["email"]

    def __init__(self, host: str, port: int, security: str, username: str,
                 password: str, from_email: str, from_name: str):
        self.host = host or "smtp.gmail.com"
        self.port = int(port or 587)
        self.security = (security or "tls").lower()  # tls (587 STARTTLS) | ssl (465)
        self.username = username
        self.password = password
        self.from_email = from_email or username
        self.from_name = from_name or "Artamedia"

    def _connect(self):
        if self.security == "ssl":
            server = smtplib.SMTP_SSL(self.host, self.port, timeout=15)
        else:
            server = smtplib.SMTP(self.host, self.port, timeout=15)
            server.ehlo()
            server.starttls()
            server.ehlo()
        server.login(self.username, self.password)
        return server

    def _send_sync(self, target: str, message: str, subject: str) -> Dict[str, Any]:
        msg = EmailMessage()
        msg["Subject"] = subject or "Notifikasi"
        msg["From"] = formataddr((self.from_name, self.from_email))
        msg["To"] = target
        msg.set_content(message)
        server = self._connect()
        try:
            server.send_message(msg)
        finally:
            try:
                server.quit()
            except Exception:
                pass
        return {"ok": True, "provider": {"status": True, "detail": "email sent"}}

    async def send(self, target: str, message: str, subject: Optional[str] = None) -> Dict[str, Any]:
        return await asyncio.to_thread(self._send_sync, target, message, subject or "Notifikasi")

    def _test_sync(self) -> Dict[str, Any]:
        server = self._connect()
        try:
            server.noop()
        finally:
            try:
                server.quit()
            except Exception:
                pass
        return {"connected": True, "detail": f"Login SMTP berhasil sebagai {self.username}"}

    async def test(self) -> Dict[str, Any]:
        try:
            return await asyncio.to_thread(self._test_sync)
        except Exception as ex:
            return {"connected": False, "detail": f"Gagal login SMTP: {ex}"}


# registry of implemented providers; others are advertised as "coming soon"
PROVIDERS = {FonnteProvider.name: FonnteProvider, EmailProvider.name: EmailProvider}
SUPPORTED_PROVIDERS = [
    {"value": "fonnte", "label": "Fonnte (WhatsApp)", "available": True},
    {"value": "email", "label": "Email (SMTP / Gmail)", "available": True},
    {"value": "telegram", "label": "Telegram", "available": False},
    {"value": "discord", "label": "Discord", "available": False},
]


# ---------------------------------------------------------------------------
# Default message templates (customizable from Settings)
# ---------------------------------------------------------------------------
COMPANY = "PT Artamedia Citra Telematika Indonesia"

DEFAULT_TEMPLATES = [
    {
        "key": "customer_open", "event": "created", "channel": "customer",
        "title": "Customer · Ticket Dibuat",
        "body": (
            "Halo {{customer_name}}\n"
            "Laporan gangguan Anda telah kami terima dan tiket telah berhasil dibuat.\n\n"
            "Nomor Ticket:\n{{ticket_number}}\n\n"
            "Layanan:\n{{service_name}}\n\n"
            "Gangguan:\n{{problem}}\n\n"
            "Status:\nOPEN\n\n"
            "Anda dapat memantau progres penanganan melalui:\n{{tracking_url}}\n\n"
            "Terima kasih.\n" + COMPANY
        ),
    },
    {
        "key": "customer_in_progress", "event": "assigned", "channel": "customer",
        "title": "Customer · Ticket Ditangani",
        "body": (
            "Halo {{customer_name}}\n"
            "Ticket {{ticket_number}} saat ini sedang ditangani oleh teknisi kami.\n\n"
            "Teknisi:\n{{technician_name}}\n\n"
            "Status:\nIN PROGRESS\n\n"
            "Silakan memantau perkembangan pekerjaan melalui:\n{{tracking_url}}\n\n"
            "Terima kasih."
        ),
    },
    {
        "key": "customer_progress", "event": "progress", "channel": "customer",
        "title": "Customer · Update Progres",
        "body": (
            "Halo {{customer_name}}\n"
            "Terdapat pembaruan pada ticket Anda.\n\n"
            "Nomor Ticket:\n{{ticket_number}}\n\n"
            "Update:\n{{progress_note}}\n\n"
            "Silakan lihat detail dan dokumentasi terbaru melalui:\n{{tracking_url}}"
        ),
    },
    {
        "key": "customer_resolved", "event": "resolved", "channel": "customer",
        "title": "Customer · Ticket Selesai",
        "body": (
            "Halo {{customer_name}}\n"
            "Gangguan telah selesai ditangani.\n\n"
            "Nomor Ticket:\n{{ticket_number}}\n\n"
            "Status:\nRESOLVED\n\n"
            "Silakan melakukan pengecekan layanan.\n"
            "Dokumentasi pekerjaan dapat dilihat melalui:\n{{tracking_url}}\n\n"
            "Terima kasih telah menggunakan layanan " + COMPANY + "."
        ),
    },
    {
        "key": "internal_open", "event": "created", "channel": "internal",
        "title": "Internal · Ticket Baru",
        "body": (
            "🔴 OPEN TICKET\n\n"
            "Ticket:\n{{ticket_number}}\n\n"
            "Customer:\n{{customer_name}}\n\n"
            "Service:\n{{service_name}}\n\n"
            "Priority:\n{{priority}}\n\n"
            "Created By:\n{{created_by}}"
        ),
    },
    {
        "key": "internal_assigned", "event": "assigned", "channel": "internal",
        "title": "Internal · Ticket Assigned",
        "body": (
            "🟡 TICKET ASSIGNED\n\n"
            "Ticket:\n{{ticket_number}}\n\n"
            "Customer:\n{{customer_name}}\n\n"
            "Teknisi:\n{{technician_name}}\n\n"
            "Status:\nIN PROGRESS"
        ),
    },
    {
        "key": "internal_progress", "event": "progress", "channel": "internal",
        "title": "Internal · Update Progres",
        "body": (
            "🔵 PROGRESS UPDATE\n\n"
            "Ticket:\n{{ticket_number}}\n\n"
            "Customer:\n{{customer_name}}\n\n"
            "Teknisi:\n{{technician_name}}\n\n"
            "Update:\n{{progress_note}}"
        ),
    },
    {
        "key": "internal_escalated", "event": "escalated", "channel": "internal",
        "title": "Internal · Ticket Eskalasi",
        "body": (
            "🚨 TICKET ESCALATED\n\n"
            "Ticket:\n{{ticket_number}}\n\n"
            "Customer:\n{{customer_name}}\n\n"
            "Priority:\n{{priority}}\n\n"
            "Teknisi:\n{{technician_name}}\n\n"
            "Status:\n{{status}}"
        ),
    },
    {
        "key": "internal_resolved", "event": "resolved", "channel": "internal",
        "title": "Internal · Ticket Selesai",
        "body": (
            "🟢 TICKET CLOSED\n\n"
            "Ticket:\n{{ticket_number}}\n\n"
            "Customer:\n{{customer_name}}\n\n"
            "Teknisi:\n{{technician_name}}\n\n"
            "Durasi Penanganan:\n{{resolution_time}}\n\n"
            "Status:\nRESOLVED"
        ),
    },
    {
        "key": "internal_reassigned", "event": "reassigned", "channel": "internal",
        "title": "Internal · Ticket Dialihkan",
        "body": (
            "🔄 TICKET DIALIHKAN\n\n"
            "Ticket:\n{{ticket_number}}\n\n"
            "Customer:\n{{customer_name}}\n\n"
            "Dari:\n{{from_name}}\n\n"
            "Ke:\n{{to_name}}\n\n"
            "Dialihkan oleh:\n{{by_name}}\n\n"
            "Alasan:\n{{reason}}"
        ),
    },
]

# event -> ordered list of (template_key, channel)
EVENT_MATRIX = {
    "created": [("customer_open", "customer"), ("internal_open", "internal")],
    "assigned": [("customer_in_progress", "customer"), ("internal_assigned", "internal")],
    "progress": [("customer_progress", "customer"), ("internal_progress", "internal")],
    "escalated": [("internal_escalated", "internal")],
    "reassigned": [("internal_reassigned", "internal")],
    "resolved": [("customer_resolved", "customer"), ("internal_resolved", "internal")],
}


async def seed_templates(db) -> None:
    for t in DEFAULT_TEMPLATES:
        existing = await db.notification_templates.find_one({"key": t["key"]})
        if not existing:
            await db.notification_templates.insert_one({
                **t, "id": new_id(), "enabled": True,
                "updated_at": now_iso(), "is_default": True,
            })


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
async def load_settings(db, *, with_token: bool = False) -> Optional[Dict[str, Any]]:
    doc = await db.notification_settings.find_one({"key": SETTINGS_KEY}, {"_id": 0})
    if not doc:
        return None
    if with_token:
        try:
            doc["token"] = _cipher().decrypt(doc.get("token_encrypted", "").encode()).decode()
        except Exception:
            doc["token"] = ""
        try:
            doc["smtp_password"] = _cipher().decrypt(doc.get("smtp_password_encrypted", "").encode()).decode()
        except Exception:
            doc["smtp_password"] = ""
    return doc


def provider_ready(settings: Optional[dict]) -> bool:
    if not settings:
        return False
    if settings.get("provider") == "email":
        return bool(settings.get("smtp_host") and settings.get("smtp_username") and settings.get("smtp_password"))
    return bool(settings.get("token"))


def _public_base_url(settings: Optional[dict]) -> str:
    if settings and settings.get("public_base_url"):
        return settings["public_base_url"].rstrip("/")
    return os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")


def get_provider(settings: Dict[str, Any]) -> Optional[BaseProvider]:
    name = settings.get("provider", "fonnte")
    cls = PROVIDERS.get(name)
    if not cls:
        return None
    if name == "fonnte":
        return FonnteProvider(
            settings.get("api_url", "https://api.fonnte.com"),
            settings.get("token", ""),
            settings.get("country_code", "62"),
        )
    if name == "email":
        return EmailProvider(
            host=settings.get("smtp_host", "smtp.gmail.com"),
            port=settings.get("smtp_port", 587),
            security=settings.get("smtp_security", "tls"),
            username=settings.get("smtp_username", ""),
            password=settings.get("smtp_password", ""),
            from_email=settings.get("from_email", ""),
            from_name=settings.get("from_name", "Artamedia"),
        )
    return cls()


async def _resolve_customer_email(db, ticket: Dict[str, Any]) -> str:
    pc = ticket.get("pic_contact") or ""
    if "@" in pc:
        return pc.strip()
    cid = ticket.get("customer_id")
    if cid:
        c = await db.customers.find_one({"id": cid}, {"_id": 0, "email": 1})
        if c and c.get("email"):
            return c["email"]
    return ""


# ---------------------------------------------------------------------------
# Core dispatch  (reusable by ANY module)
# ---------------------------------------------------------------------------
async def _log(db, entry: Dict[str, Any]) -> None:
    try:
        await db.notification_logs.insert_one({"id": new_id(), "at": now_iso(), **entry})
    except Exception as ex:  # logging must never break the caller
        logger.warning(f"notification log insert failed: {ex}")


async def send_message(
    db,
    *,
    channel: str,
    target: Optional[str],
    message: str,
    subject: Optional[str] = None,
    event: str = "manual",
    module: str = "manual",
    template_key: str = "",
    ref_id: Optional[str] = None,
    ref_number: Optional[str] = None,
) -> Dict[str, Any]:
    """Low-level, best-effort send. NEVER raises. Always writes a log row.

    This is the single choke point every module (CRM, Maintenance, Monitoring,
    SLA, Handover) uses to fire an outgoing notification.
    """
    base = {
        "event": event, "module": module, "channel": channel,
        "template_key": template_key, "target": target,
        "ref_id": ref_id, "ref_number": ref_number,
        "message": message,
    }
    settings = await load_settings(db, with_token=True)
    if not settings or not settings.get("enabled"):
        await _log(db, {**base, "status": "skipped", "detail": "Notifikasi dinonaktifkan", "provider": (settings or {}).get("provider", "-")})
        return {"status": "skipped"}
    if not target:
        await _log(db, {**base, "status": "skipped", "detail": "Target kosong (kontak/email customer atau tujuan internal belum diisi)", "provider": settings.get("provider")})
        return {"status": "skipped"}
    if not provider_ready(settings):
        await _log(db, {**base, "status": "skipped", "detail": "Kredensial provider belum lengkap", "provider": settings.get("provider")})
        return {"status": "skipped"}
    provider = get_provider(settings)
    if provider is None:
        await _log(db, {**base, "status": "failed", "detail": f"Provider '{settings.get('provider')}' belum didukung", "provider": settings.get("provider")})
        return {"status": "failed"}
    try:
        resp = await provider.send(target, message, subject)
        status = "sent" if resp.get("ok") else "failed"
        await _log(db, {**base, "status": status, "detail": "", "provider": settings.get("provider"), "provider_response": resp.get("provider")})
        return {"status": status, "response": resp}
    except Exception as ex:
        await _log(db, {**base, "status": "error", "detail": str(ex)[:400], "provider": settings.get("provider")})
        return {"status": "error", "detail": str(ex)}


# ---------------------------------------------------------------------------
# Tracking token + public payload
# ---------------------------------------------------------------------------
async def ensure_tracking_token(db, ticket: Dict[str, Any]) -> str:
    token = ticket.get("tracking_token")
    if token:
        return token
    token = secrets.token_urlsafe(24)
    await db.helpdesk_tickets.update_one({"id": ticket["id"]}, {"$set": {"tracking_token": token}})
    ticket["tracking_token"] = token
    return token


def _build_context(ticket: Dict[str, Any], tracking_url: str, extra: Optional[dict]) -> Dict[str, Any]:
    extra = extra or {}
    return {
        "ticket_number": ticket.get("ticket_number", ""),
        "customer_name": ticket.get("customer_name") or "Pelanggan",
        "company_name": ticket.get("customer_name") or "",
        "status": STATUS_LABEL.get(ticket.get("status", ""), ticket.get("status", "")),
        "technician_name": ticket.get("troubleshooter_name") or "-",
        "priority": ticket.get("priority", ""),
        "service_name": ticket.get("category_name") or "-",
        "problem": ticket.get("description") or "-",
        "tracking_url": tracking_url or "-",
        "created_at": _fmt_dt(ticket.get("created_at")),
        "created_by": ticket.get("created_by_name") or "-",
        "resolved_at": _fmt_dt(ticket.get("resolved_at")),
        "resolution_time": _human_duration(ticket.get("total_handling_seconds")),
        "progress_note": extra.get("progress_note", ""),
        "from_name": extra.get("from_name", ""),
        "to_name": extra.get("to_name", ""),
        "by_name": extra.get("by_name", ""),
        "reason": extra.get("reason", ""),
    }


async def notify_ticket_event(db, event: str, ticket: Dict[str, Any], extra: Optional[dict] = None) -> None:
    """High-level CRM hook. Best-effort — never raises to the caller."""
    try:
        matrix = EVENT_MATRIX.get(event)
        if not matrix:
            return
        settings = await load_settings(db)
        token = await ensure_tracking_token(db, ticket)
        base_url = _public_base_url(settings)
        tracking_url = f"{base_url}/track/{token}" if base_url else f"/track/{token}"
        ctx = _build_context(ticket, tracking_url, extra)
        provider_name = (settings or {}).get("provider", "fonnte")
        if provider_name == "email":
            customer_target = await _resolve_customer_email(db, ticket)
            internal_target = (settings or {}).get("internal_email") or ""
            prefix = (settings or {}).get("subject_prefix") or "[Artamedia]"
            subject = f"{prefix} {ctx['ticket_number']} — {ctx['status']}"
        else:
            customer_target = ticket.get("pic_contact") or ""
            internal_target = (settings or {}).get("default_group") or ""
            subject = None
        for template_key, channel in matrix:
            tpl = await db.notification_templates.find_one({"key": template_key}, {"_id": 0})
            if not tpl or not tpl.get("enabled", True):
                continue
            message = render_template(tpl.get("body", ""), ctx)
            target = internal_target if channel == "internal" else customer_target
            await send_message(
                db, channel=channel, target=target, message=message, subject=subject,
                event=event, module="crm", template_key=template_key,
                ref_id=ticket.get("id"), ref_number=ticket.get("ticket_number"),
            )
    except Exception as ex:
        logger.warning(f"notify_ticket_event({event}) failed: {ex}")


async def build_public_tracking(db, token: str) -> Dict[str, Any]:
    t = await db.helpdesk_tickets.find_one({"tracking_token": token}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Tracking link tidak valid atau sudah kedaluwarsa")

    # timeline from audit_log (customer-safe labels)
    label_map = {
        "ticket_created": "Ticket dibuat",
        "ticket_processed": "Ticket mulai ditangani teknisi",
        "progress_added": "Update progres pekerjaan",
        "troubleshooter_reassigned": "Teknisi dialihkan",
        "ticket_resolved": "Ticket selesai",
        "ticket_reopened": "Ticket dibuka kembali",
        "files_uploaded": "Dokumentasi ditambahkan",
    }
    timeline = []
    for a in t.get("audit_log", []):
        action = a.get("action", "")
        if action in label_map:
            timeline.append({"at": a.get("at"), "label": label_map[action]})

    files = await db.helpdesk_ticket_files.find(
        {"ticket_id": t["id"]}, {"_id": 0}
    ).sort("uploaded_at", 1).to_list(500)

    def _file_dto(f: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": f["id"],
            "original_file_name": f.get("original_file_name"),
            "file_type": f.get("file_type"),
            "mime_type": f.get("mime_type"),
            "evidence_type": f.get("evidence_type"),
            "description": f.get("description"),
            "uploaded_at": f.get("uploaded_at"),
            "url": f"/api/track/{token}/files/{f['id']}/content",
        }

    # Group technician/NOC photos to their progress entry so each update
    # displays its own documentation inline on the customer tracking page.
    files_by_progress: Dict[str, list] = {}
    for f in files:
        pid = f.get("progress_id")
        if pid:
            files_by_progress.setdefault(pid, []).append(_file_dto(f))

    progress = [
        {
            "at": p.get("at"),
            "work_stage": p.get("work_stage"),
            "note": p.get("note"),
            "action_taken": p.get("action_taken"),
            "condition_after": p.get("condition_after"),
            "technician": p.get("user_name"),
            "files": files_by_progress.get(p.get("id"), []),
        }
        for p in t.get("progress", [])
    ]

    # Documentation gallery = files not tied to a specific progress note
    # (customer initial evidence, completion evidence, general attachments).
    documentation = [_file_dto(f) for f in files if not f.get("progress_id")]

    return {
        "ticket_number": t.get("ticket_number"),
        "status": t.get("status"),
        "status_label": STATUS_LABEL.get(t.get("status", ""), t.get("status")),
        "priority": t.get("priority"),
        "customer_name": t.get("customer_name"),
        "service_name": t.get("category_name") or "-",
        "problem": t.get("description") or "-",
        "location": t.get("location") or "-",
        "technician_name": t.get("troubleshooter_name") or "-",
        "created_at": t.get("created_at"),
        "processed_at": t.get("processed_at"),
        "resolved_at": t.get("resolved_at"),
        "timeline": timeline,
        "progress": progress,
        "documentation": documentation,
        "completion": {
            "root_cause": t.get("root_cause") or "",
            "action_taken": t.get("action_taken") or "",
            "final_solution": t.get("final_solution") or "",
            "service_final_status": t.get("service_final_status") or "",
            "service_restored_at": t.get("service_restored_at"),
            "closing_notes": t.get("closing_notes") or "",
        } if t.get("status") == "SELESAI" else None,
        "company": COMPANY,
    }


# ---------------------------------------------------------------------------
# Closing Resume → Main / Management group (CRM enhancement)
# ---------------------------------------------------------------------------
CLOSING_RESUME_BODY = (
    "✅ RESUME TICKET SELESAI\n"
    "🎫 Ticket: {{ticket_number}}\n"
    "👤 Customer: {{customer_name}}\n"
    "📍 Lokasi: {{location}}\n"
    "⚠️ Gangguan: {{category}}\n"
    "📝 Dibuat oleh: {{created_by}}\n"
    "🛠 Ditangani oleh: {{final_troubleshooter}}\n"
    "🔎 Penyebab:\n{{root_cause}}\n"
    "🔧 Penyelesaian:\n{{resolution}}\n"
    "✅ Status: SELESAI\n"
    "⏱ Total Handling: {{total_handling_time}}\n"
    "🔗 History & Dokumentasi:\n{{ticket_history_url}}"
)


async def notify_closing_resume(db, ticket: Dict[str, Any]) -> None:
    """Send ONE closing resume to the Main/Management group after a ticket is
    successfully CLOSED. Best-effort: never raises, always logged. Gated by the
    `send_closing_resume` toggle AND a configured `main_group` id. Uses existing
    ticket fields only — no new time calculations. Missing fields become '-' and
    must never break the send.
    """
    try:
        settings = await load_settings(db)
        if not settings or not settings.get("send_closing_resume"):
            return
        main_group = (settings.get("main_group") or "").strip()
        base = _public_base_url(settings)
        tid = ticket.get("id")
        # Trace history link MUST be publicly openable (recipients in the WhatsApp
        # Main/Management group are not logged in). Use the public tracking page
        # (/track/{token}) which renders the full timeline, progress, documentation
        # and completion details — NOT the login-protected /crm history route.
        token = await ensure_tracking_token(db, ticket)
        history_url = f"{base}/track/{token}" if base else f"/track/{token}"
        ctx = {
            "ticket_number": ticket.get("ticket_number") or "-",
            "customer_name": ticket.get("customer_name") or "-",
            "location": ticket.get("location") or ticket.get("site") or "-",
            "category": ticket.get("category_name") or ticket.get("category") or "-",
            "created_by": ticket.get("created_by_name") or "-",
            "final_troubleshooter": ticket.get("troubleshooter_name") or "-",
            "root_cause": ticket.get("root_cause") or "-",
            "resolution": ticket.get("final_solution") or ticket.get("action_taken") or "-",
            "total_handling_time": _human_duration(ticket.get("total_handling_seconds")),
            "ticket_history_url": history_url,
        }
        message = render_template(CLOSING_RESUME_BODY, ctx)
        await send_message(
            db, channel="internal", target=main_group, message=message,
            event="closing_resume", module="crm",
            template_key="closing_resume_main",
            ref_id=tid, ref_number=ticket.get("ticket_number"),
        )
    except Exception as ex:  # must never affect the (already successful) close
        logger.warning(f"notify_closing_resume failed: {ex}")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    provider: str = "fonnte"
    api_url: str = "https://api.fonnte.com"
    api_token: Optional[str] = None  # write-only; blank keeps existing
    sender: str = ""
    default_group: str = ""
    main_group: str = ""
    send_closing_resume: bool = False
    country_code: str = "62"
    enabled: bool = False
    public_base_url: Optional[str] = None
    # Email (SMTP) provider
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_security: str = "tls"  # tls | ssl
    smtp_username: str = ""
    smtp_password: Optional[str] = None  # write-only; blank keeps existing
    from_email: str = ""
    from_name: str = "Artamedia"
    internal_email: str = ""
    subject_prefix: str = "[Artamedia]"


class TemplateUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    body: Optional[str] = None
    enabled: Optional[bool] = None
    title: Optional[str] = None


class TestSendIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    target: str
    message: str = "Tes koneksi Notification Center — PT Artamedia."


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
def build_notifications_router(get_current_user, require_roles, get_db):
    router = APIRouter(prefix="/notifications", tags=["notifications"])
    admin_only = require_roles("admin")
    admin_sup = require_roles("admin", "supervisor")

    def _public_settings(doc: Optional[dict]) -> dict:
        if not doc:
            return {
                "provider": "fonnte", "api_url": "https://api.fonnte.com",
                "sender": "", "default_group": "", "country_code": "62",
                "main_group": "", "send_closing_resume": False,
                "enabled": False, "token_configured": False,
                "smtp_host": "smtp.gmail.com", "smtp_port": 587, "smtp_security": "tls",
                "smtp_username": "", "from_email": "", "from_name": "Artamedia",
                "internal_email": "", "subject_prefix": "[Artamedia]",
                "smtp_password_configured": False,
                "public_base_url": os.environ.get("PUBLIC_BASE_URL", ""),
            }
        return {
            "provider": doc.get("provider", "fonnte"),
            "api_url": doc.get("api_url", "https://api.fonnte.com"),
            "sender": doc.get("sender", ""),
            "default_group": doc.get("default_group", ""),
            "main_group": doc.get("main_group", ""),
            "send_closing_resume": bool(doc.get("send_closing_resume")),
            "country_code": doc.get("country_code", "62"),
            "enabled": bool(doc.get("enabled")),
            "token_configured": bool(doc.get("token_encrypted")),
            "token_masked": _mask(_safe_decrypt(doc.get("token_encrypted", ""))),
            "smtp_host": doc.get("smtp_host", "smtp.gmail.com"),
            "smtp_port": doc.get("smtp_port", 587),
            "smtp_security": doc.get("smtp_security", "tls"),
            "smtp_username": doc.get("smtp_username", ""),
            "from_email": doc.get("from_email", ""),
            "from_name": doc.get("from_name", "Artamedia"),
            "internal_email": doc.get("internal_email", ""),
            "subject_prefix": doc.get("subject_prefix", "[Artamedia]"),
            "smtp_password_configured": bool(doc.get("smtp_password_encrypted")),
            "public_base_url": doc.get("public_base_url") or os.environ.get("PUBLIC_BASE_URL", ""),
            "updated_at": doc.get("updated_at"),
        }

    def _safe_decrypt(enc: str) -> str:
        if not enc:
            return ""
        try:
            return _cipher().decrypt(enc.encode()).decode()
        except Exception:
            return ""

    @router.get("/providers")
    async def providers(user: dict = Depends(admin_only)):
        return {"providers": SUPPORTED_PROVIDERS}

    @router.get("/settings")
    async def get_settings(user: dict = Depends(admin_only)):
        db = get_db()
        doc = await db.notification_settings.find_one({"key": SETTINGS_KEY}, {"_id": 0})
        return _public_settings(doc)

    @router.put("/settings")
    async def put_settings(body: SettingsIn, user: dict = Depends(admin_only)):
        db = get_db()
        existing = await db.notification_settings.find_one({"key": SETTINGS_KEY}, {"_id": 0})
        doc = {
            "key": SETTINGS_KEY,
            "provider": body.provider,
            "api_url": (body.api_url or "https://api.fonnte.com").rstrip("/"),
            "sender": body.sender,
            "default_group": body.default_group,
            "main_group": body.main_group,
            "send_closing_resume": bool(body.send_closing_resume),
            "country_code": body.country_code or "62",
            "enabled": body.enabled,
            "public_base_url": (body.public_base_url or "").rstrip("/") or None,
            # email / smtp
            "smtp_host": body.smtp_host or "smtp.gmail.com",
            "smtp_port": int(body.smtp_port or 587),
            "smtp_security": body.smtp_security or "tls",
            "smtp_username": body.smtp_username or "",
            "from_email": body.from_email or "",
            "from_name": body.from_name or "Artamedia",
            "internal_email": body.internal_email or "",
            "subject_prefix": body.subject_prefix or "[Artamedia]",
            "updated_at": now_iso(),
        }
        # keep existing encrypted secrets unless a new one is provided
        if body.api_token:
            doc["token_encrypted"] = _cipher().encrypt(body.api_token.encode()).decode()
        elif existing and existing.get("token_encrypted"):
            doc["token_encrypted"] = existing["token_encrypted"]
        else:
            doc["token_encrypted"] = ""
        if body.smtp_password:
            doc["smtp_password_encrypted"] = _cipher().encrypt(body.smtp_password.encode()).decode()
        elif existing and existing.get("smtp_password_encrypted"):
            doc["smtp_password_encrypted"] = existing["smtp_password_encrypted"]
        else:
            doc["smtp_password_encrypted"] = ""
        await db.notification_settings.update_one(
            {"key": SETTINGS_KEY}, {"$set": doc}, upsert=True
        )
        return _public_settings(doc)

    @router.post("/test")
    async def test_connection(user: dict = Depends(admin_only)):
        db = get_db()
        settings = await load_settings(db, with_token=True)
        if not provider_ready(settings):
            raise HTTPException(status_code=400, detail="Simpan konfigurasi & kredensial provider terlebih dahulu")
        provider = get_provider(settings)
        if provider is None:
            raise HTTPException(status_code=400, detail=f"Provider '{settings.get('provider')}' belum didukung")
        try:
            return await provider.test()
        except Exception as ex:
            raise HTTPException(status_code=502, detail=f"Gagal menghubungi provider: {ex}")

    @router.post("/test-send")
    async def test_send(body: TestSendIn, user: dict = Depends(admin_only)):
        db = get_db()
        res = await send_message(
            db, channel="whatsapp", target=body.target, message=body.message,
            event="test", module="settings", template_key="",
        )
        return res

    # ---- Templates ----
    @router.get("/templates")
    async def list_templates(user: dict = Depends(admin_only)):
        db = get_db()
        await seed_templates(db)
        items = await db.notification_templates.find({}, {"_id": 0}).to_list(100)
        order = {t["key"]: i for i, t in enumerate(DEFAULT_TEMPLATES)}
        items.sort(key=lambda x: order.get(x.get("key"), 999))
        return {"items": items, "placeholders": [
            "ticket_number", "customer_name", "company_name", "status",
            "technician_name", "priority", "service_name", "problem",
            "tracking_url", "created_at", "resolved_at", "progress_note",
            "created_by", "resolution_time",
        ]}

    @router.put("/templates/{key}")
    async def update_template(key: str, body: TemplateUpdate, user: dict = Depends(admin_only)):
        db = get_db()
        patch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        if not patch:
            raise HTTPException(status_code=400, detail="Tidak ada perubahan")
        patch["updated_at"] = now_iso()
        r = await db.notification_templates.update_one({"key": key}, {"$set": patch})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Template tidak ditemukan")
        return await db.notification_templates.find_one({"key": key}, {"_id": 0})

    @router.post("/templates/reset")
    async def reset_templates(user: dict = Depends(admin_only)):
        db = get_db()
        for t in DEFAULT_TEMPLATES:
            await db.notification_templates.update_one(
                {"key": t["key"]},
                {"$set": {**t, "enabled": True, "updated_at": now_iso(), "is_default": True}},
                upsert=True,
            )
        items = await db.notification_templates.find({}, {"_id": 0}).to_list(100)
        return {"items": items, "reset": True}

    # ---- Logs ----
    @router.get("/logs")
    async def list_logs(
        limit: int = 50,
        status: Optional[str] = None,
        module: Optional[str] = None,
        user: dict = Depends(admin_sup),
    ):
        db = get_db()
        q: dict = {}
        if status:
            q["status"] = status
        if module:
            q["module"] = module
        cur = db.notification_logs.find(q, {"_id": 0, "provider_response": 0}).sort("at", -1).limit(min(limit, 200))
        items = await cur.to_list(200)
        return {"items": items}

    return router


def build_public_tracking_router(get_db):
    """Public, unauthenticated ticket tracking (customer-facing)."""
    from fastapi.responses import FileResponse
    from pathlib import Path
    router = APIRouter(prefix="/track", tags=["public-tracking"])

    UPLOAD_DIR = Path(__file__).parent / "uploads" / "crm"

    @router.get("/{token}")
    async def track(token: str):
        db = get_db()
        return await build_public_tracking(db, token)

    @router.get("/{token}/files/{fid}/content")
    async def track_file(token: str, fid: str):
        db = get_db()
        t = await db.helpdesk_tickets.find_one({"tracking_token": token}, {"_id": 0, "id": 1})
        if not t:
            raise HTTPException(status_code=404, detail="Link tidak valid")
        f = await db.helpdesk_ticket_files.find_one({"ticket_id": t["id"], "id": fid}, {"_id": 0})
        if not f:
            raise HTTPException(status_code=404, detail="File tidak ditemukan")
        path = UPLOAD_DIR / f.get("storage_path", "")
        if not path.exists():
            raise HTTPException(status_code=404, detail="File fisik hilang")
        return FileResponse(
            str(path),
            media_type=f.get("mime_type") or "application/octet-stream",
            filename=f.get("original_file_name") or f.get("file_name"),
        )

    return router
