"""Iteration 8 tests:
1) Closing resume template — new format/labels + placeholders filled.
2) Image classification fix — mobile camera uploads with content-type
   'application/octet-stream' become file_type='image'.
3) Public tracking payload — documentation includes initial+completion evidence
   photos, progress files rendered, all urls served without auth.
4) Regression — created/assigned/resolved logs to default_group; lifecycle
   still returns 200 with proper status transitions.

Cleans up created tickets directly from Mongo at the end. Leaves
notification_settings enabled + send_closing_resume=True (per user request).
"""
import io
import os
import re
import time
import uuid
import struct
import zlib
import pytest
import requests

BASE = ""
try:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().rstrip("/")
                break
except Exception:
    pass
BASE = os.environ.get("REACT_APP_BACKEND_URL", BASE).rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@noc.local", "password": "Admin@123"}
MAIN_GROUP = "120363408836731773@g.us"
DEFAULT_GROUP = "120363430088957368@g.us"

created_ticket_ids: list = []


# ---------- helpers ----------
def _tiny_png_bytes() -> bytes:
    """Return a valid 1x1 red PNG."""
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def H(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _configure_settings(H):
    body = {
        "provider": "fonnte",
        "enabled": True,
        "api_token": "DUMMYTOKEN",
        "sender": "628",
        "default_group": DEFAULT_GROUP,
        "main_group": MAIN_GROUP,
        "send_closing_resume": True,
    }
    r = requests.put(f"{API}/notifications/settings", json=body, headers=H, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _fetch_logs(H, limit=200):
    r = requests.get(f"{API}/notifications/logs?limit={limit}", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _upload_file(H, tid, evidence_type, name="photo.jpg", octet=True):
    files = {
        "files": (name, io.BytesIO(_tiny_png_bytes()),
                  "application/octet-stream" if octet else "image/jpeg"),
    }
    data = {"evidence_type": evidence_type}
    r = requests.post(f"{API}/crm/tickets/{tid}/files", headers=H,
                      files=files, data=data, timeout=20)
    assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
    j = r.json()
    return j


# ---------- auth smoke ----------
def test_auth_me(H):
    r = requests.get(f"{API}/auth/me", headers=H, timeout=15)
    assert r.status_code == 200
    assert r.json().get("email") == "admin@noc.local"


def test_configure_settings(H):
    d = _configure_settings(H)
    assert d["send_closing_resume"] is True
    assert d["enabled"] is True
    assert d["main_group"] == MAIN_GROUP
    assert d["default_group"] == DEFAULT_GROUP


# ---------- full flow: create + upload initial evidence + progress w/ photo + resolve w/ completion ----------
@pytest.fixture(scope="module")
def full_ticket(H):
    _configure_settings(H)
    payload = {
        "customer_name": f"TEST_Iter8_{uuid.uuid4().hex[:6]}",
        "description": "Iteration 8 automated e2e",
        "priority": "High",
        "location": "Jakarta",
        "pic_contact": "+6280000000",
        "category_name": "Internet",
        "outage_started_at": "2026-01-10T00:00:00Z",
    }
    r = requests.post(f"{API}/crm/tickets", json=payload, headers=H, timeout=20)
    assert r.status_code in (200, 201), r.text
    t = r.json()
    tid = t["id"]
    created_ticket_ids.append(tid)

    # 1) initial customer evidence photo (with octet-stream to test mobile fix)
    init = _upload_file(H, tid, "CUSTOMER_INITIAL_EVIDENCE", "initial.jpg", octet=True)
    init_files = init.get("files") or init.get("items") or (init if isinstance(init, list) else [])
    assert init_files, f"initial upload response missing files: {init}"
    init_file = init_files[0]
    assert init_file.get("file_type") == "image", f"initial file_type={init_file.get('file_type')} (expected image)"

    # process
    rp = requests.post(f"{API}/crm/tickets/{tid}/process", headers=H, timeout=15)
    assert rp.status_code == 200, rp.text

    # 2) technician progress photo — upload first as TECHNICIAN_PROGRESS then attach via /progress
    prog_up = _upload_file(H, tid, "TECHNICIAN_PROGRESS", "prog.png", octet=True)
    prog_up_files = prog_up.get("files") or prog_up.get("items") or (prog_up if isinstance(prog_up, list) else [])
    assert prog_up_files
    prog_file = prog_up_files[0]
    assert prog_file.get("file_type") == "image", f"progress file_type={prog_file.get('file_type')}"

    rprog = requests.post(
        f"{API}/crm/tickets/{tid}/progress",
        json={"note": "Sedang perbaikan kabel", "file_ids": [prog_file["id"]]},
        headers=H, timeout=15,
    )
    assert rprog.status_code == 200, rprog.text

    # 3) completion evidence + resolve
    comp = _upload_file(H, tid, "COMPLETION_EVIDENCE", "done.jpg", octet=True)
    comp_files = comp.get("files") or comp.get("items") or (comp if isinstance(comp, list) else [])
    assert comp_files
    comp_file = comp_files[0]
    assert comp_file.get("file_type") == "image"

    rr = requests.post(
        f"{API}/crm/tickets/{tid}/resolve",
        json={
            "service_restored_at": "2026-01-10T01:30:00Z",
            "root_cause": "kabel putus di pole 12",
            "action_taken": "sambung ulang fiber",
            "final_solution": "layanan pulih normal 100Mbps",
            "service_final_status": "Normal",
        },
        headers=H, timeout=25,
    )
    assert rr.status_code == 200, rr.text
    body = rr.json()
    assert body.get("status") == "SELESAI"
    time.sleep(2.0)
    return {
        "id": tid,
        "ticket_number": t.get("ticket_number"),
        "initial_file_id": init_file["id"],
        "progress_file_id": prog_file["id"],
        "completion_file_id": comp_file["id"],
        "resolve_body": body,
    }


# ---------- (1) closing_resume template ----------
def test_closing_resume_message_new_format(H, full_ticket):
    tid = full_ticket["id"]
    tnum = full_ticket["ticket_number"]
    logs = _fetch_logs(H, 200)
    matching = [l for l in logs if l.get("event") == "closing_resume" and l.get("ref_id") == tid]
    assert matching, f"No closing_resume log for {tid}"
    log = matching[0]
    assert log.get("channel") == "internal"
    assert log.get("target") == MAIN_GROUP
    assert log.get("status") in {"sent", "skipped", "failed"}

    msg = log["message"]
    print("\n--- closing_resume message ---\n" + msg + "\n---")

    # First line
    first_line = msg.splitlines()[0].strip()
    assert first_line == "✅ RESUME TICKET SELESAI", f"first_line={first_line!r}"

    # Required labels
    required_labels = [
        "🎫 Ticket:", "👤 Customer:", "📍 Lokasi:", "⚠️ Gangguan:",
        "📝 Dibuat oleh:", "🛠 Ditangani oleh:",
        "🔎 Penyebab:", "🔧 Penyelesaian:",
        "✅ Status: SELESAI", "⏱ Total Handling:",
        "🔗 History & Dokumentasi:",
    ]
    for lbl in required_labels:
        assert lbl in msg, f"missing label {lbl!r} in message"

    # Old labels must NOT be present
    for old in ("RESUME PENYELESAIAN TICKET", "Response Time", "Execution Time",
                "Downtime", "/crm/ticket/"):
        assert old not in msg, f"old label/path {old!r} still present"

    # Placeholders filled
    assert "{" not in msg and "}" not in msg, f"unfilled braces in message: {msg}"

    # ticket number appears
    assert tnum and tnum in msg

    # root_cause value must appear on line after '🔎 Penyebab:'
    lines = msg.splitlines()
    idx = next(i for i, l in enumerate(lines) if l.startswith("🔎 Penyebab:"))
    assert "kabel putus di pole 12" in lines[idx + 1], f"root_cause not next line: {lines[idx:idx+3]}"

    idx2 = next(i for i, l in enumerate(lines) if l.startswith("🔧 Penyelesaian:"))
    assert "layanan pulih normal" in lines[idx2 + 1], f"final_solution not next line: {lines[idx2:idx2+3]}"

    # /track/<token> URL
    m = re.search(r"(https?://[^\s]+)/track/([A-Za-z0-9_\-]+)", msg)
    assert m, f"no /track/<token> absolute URL in message"


# ---------- (2) image classification handled by upload assertions above ----------
def test_image_classification_ok(full_ticket):
    # Already asserted file_type='image' during fixture uploads (octet-stream).
    assert full_ticket["initial_file_id"]
    assert full_ticket["progress_file_id"]
    assert full_ticket["completion_file_id"]


# ---------- (3) public tracking payload ----------
def test_public_tracking_payload(H, full_ticket):
    tid = full_ticket["id"]
    logs = _fetch_logs(H, 200)
    log = next(l for l in logs if l.get("event") == "closing_resume" and l.get("ref_id") == tid)
    m = re.search(r"/track/([A-Za-z0-9_\-]+)", log["message"])
    assert m, "no token in message"
    token = m.group(1)

    # NO auth
    r = requests.get(f"{API}/track/{token}", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()

    # completion present
    assert data.get("completion") is not None, "completion missing"

    # documentation must contain BOTH initial + completion image entries
    docs = data.get("documentation") or []
    assert isinstance(docs, list) and len(docs) >= 2, f"docs len={len(docs)}: {docs}"
    types = {d.get("evidence_type") for d in docs}
    assert "CUSTOMER_INITIAL_EVIDENCE" in types, f"missing initial: {types}"
    assert "COMPLETION_EVIDENCE" in types, f"missing completion: {types}"
    for d in docs:
        assert d.get("file_type") == "image", f"doc file_type={d.get('file_type')}"
        u = d.get("url", "")
        assert re.match(rf"/api/track/{token}/files/[^/]+/content$", u), f"bad url: {u}"

    # progress files
    progress = data.get("progress") or []
    assert progress, "no progress entries"
    found_prog_photo = False
    for p in progress:
        for f in (p.get("files") or []):
            if f.get("file_type") == "image":
                found_prog_photo = True
                u = f.get("url", "")
                assert re.match(rf"/api/track/{token}/files/[^/]+/content$", u), f"bad prog url: {u}"
    assert found_prog_photo, "no image in any progress entry"

    # fetch a file WITHOUT auth
    initial_doc = next(d for d in docs if d.get("evidence_type") == "CUSTOMER_INITIAL_EVIDENCE")
    file_url = f"{BASE}{initial_doc['url']}"
    r2 = requests.get(file_url, timeout=15)
    assert r2.status_code == 200, f"{r2.status_code} {r2.text[:200]}"
    ct = r2.headers.get("content-type", "")
    assert ct.startswith("image/"), f"content-type={ct}"


# ---------- (4) regression lifecycle ----------
def test_lifecycle_default_group_logs(H, full_ticket):
    tid = full_ticket["id"]
    logs = _fetch_logs(H, 300)
    for evt in ("created", "assigned", "resolved"):
        matching = [l for l in logs
                    if l.get("event") == evt and l.get("ref_id") == tid
                    and l.get("channel") == "internal"]
        assert matching, f"no {evt} log for {tid}"
        assert matching[0].get("target") == DEFAULT_GROUP, (
            f"{evt} target={matching[0].get('target')}"
        )


# ---------- cleanup — delete from Mongo directly (no admin delete endpoint) ----------
def test_zzz_cleanup_mongo():
    if not created_ticket_ids:
        return
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore
        import asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            # read backend/.env
            with open("/app/backend/.env") as f:
                for line in f:
                    if line.startswith("MONGO_URL="):
                        mongo_url = line.split("=", 1)[1].strip().strip('"')
                    if line.startswith("DB_NAME="):
                        db_name = line.split("=", 1)[1].strip().strip('"')
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]

        async def _rm():
            for tid in created_ticket_ids:
                await db.helpdesk_tickets.delete_many({"id": tid})
                await db.helpdesk_ticket_files.delete_many({"ticket_id": tid})
                await db.notification_logs.delete_many({"ref_id": tid})
                await db.helpdesk_ticket_progress.delete_many({"ticket_id": tid})
                await db.helpdesk_ticket_tokens.delete_many({"ticket_id": tid})

        asyncio.get_event_loop().run_until_complete(_rm())
        client.close()
    except Exception as ex:
        print(f"cleanup skipped: {ex}")
    # DO NOT flip notification_settings off — leave enabled per user request.
