"""Iteration 9 — PSB & MULTIGANGGUAN ticket types (additive).

Verifies:
- GANGGUAN regression (default when ticket_type omitted).
- PSB creation + full lifecycle to SELESAI with completion evidence.
- MULTIGANGGUAN creation with affected_customers[] each auto id, status='Down'.
- MULTIGANGGUAN resolve gating: 400 while any Down, 200 after all Restored.
- Add/remove affected customers endpoints work.
- Type filter: GET /api/crm/tickets?ticket_type=PSB|MULTIGANGGUAN|GANGGUAN
  (GANGGUAN also includes legacy tickets w/o field).
- closing_resume message contains '🏷 Jenis:' with type label.
- Public GET /api/track/{token} payload includes 'ticket_type'.

Cleans up all created tickets from Mongo at the end.
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


def _tiny_png_bytes() -> bytes:
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def H():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module", autouse=True)
def _settings(H):
    body = {
        "provider": "fonnte", "enabled": True, "api_token": "DUMMYTOKEN",
        "sender": "628", "default_group": DEFAULT_GROUP, "main_group": MAIN_GROUP,
        "send_closing_resume": True,
    }
    r = requests.put(f"{API}/notifications/settings", json=body, headers=H, timeout=15)
    assert r.status_code == 200, r.text


def _upload_completion(H, tid, name="done.jpg"):
    files = {"files": (name, io.BytesIO(_tiny_png_bytes()), "image/jpeg")}
    data = {"evidence_type": "COMPLETION_EVIDENCE"}
    r = requests.post(f"{API}/crm/tickets/{tid}/files", headers=H,
                      files=files, data=data, timeout=20)
    assert r.status_code in (200, 201), r.text
    j = r.json()
    fs = j.get("files") or j.get("items") or (j if isinstance(j, list) else [])
    assert fs
    return fs[0]


def _fetch_logs(H, limit=200):
    r = requests.get(f"{API}/notifications/logs?limit={limit}", headers=H, timeout=15)
    assert r.status_code == 200
    return r.json()["items"]


# --------------------- (1) GANGGUAN regression ---------------------
def test_gangguan_regression_no_ticket_type(H):
    payload = {
        "customer_name": f"TEST_G_{uuid.uuid4().hex[:6]}",
        "description": "regression",
        "priority": "Medium",
        "location": "Jakarta",
        "category_name": "Internet",
    }
    r = requests.post(f"{API}/crm/tickets", json=payload, headers=H, timeout=20)
    assert r.status_code in (200, 201), r.text
    t = r.json()
    tid = t["id"]
    created_ticket_ids.append(tid)
    # Should default to GANGGUAN
    assert t.get("ticket_type") == "GANGGUAN"
    assert t["status"] == "MASUK"

    # Process
    rp = requests.post(f"{API}/crm/tickets/{tid}/process", headers=H, timeout=15)
    assert rp.status_code == 200, rp.text

    # Complete
    _upload_completion(H, tid)
    rr = requests.post(f"{API}/crm/tickets/{tid}/resolve", headers=H, timeout=20,
                       json={"service_restored_at": "2026-01-10T01:30:00Z",
                             "root_cause": "kabel", "action_taken": "sambung",
                             "final_solution": "normal", "service_final_status": "Normal"})
    assert rr.status_code == 200, rr.text
    assert rr.json()["status"] == "SELESAI"


# --------------------- (2) PSB full lifecycle ---------------------
@pytest.fixture(scope="module")
def psb_ticket(H):
    payload = {
        "ticket_type": "PSB",
        "customer_name": f"TEST_PSB_{uuid.uuid4().hex[:6]}",
        "psb_service_type": "Broadband FTTH",
        "psb_package": "100Mbps Home",
        "psb_install_address": "Jl. Mawar No. 5, Jakarta",
        "priority": "High",
        "description": "aktivasi baru",
    }
    r = requests.post(f"{API}/crm/tickets", json=payload, headers=H, timeout=20)
    assert r.status_code in (200, 201), r.text
    t = r.json()
    created_ticket_ids.append(t["id"])
    return t


def test_psb_create_persists_fields(psb_ticket):
    t = psb_ticket
    assert t["ticket_type"] == "PSB"
    assert t["psb_service_type"] == "Broadband FTTH"
    assert t["psb_package"] == "100Mbps Home"
    assert t["psb_install_address"].startswith("Jl. Mawar")
    assert t["status"] == "MASUK"


def test_psb_full_lifecycle(H, psb_ticket):
    tid = psb_ticket["id"]
    rp = requests.post(f"{API}/crm/tickets/{tid}/process", headers=H, timeout=15)
    assert rp.status_code == 200, rp.text
    _upload_completion(H, tid, "psb_done.jpg")
    rr = requests.post(f"{API}/crm/tickets/{tid}/resolve", headers=H, timeout=20,
                       json={"service_restored_at": "2026-01-10T02:00:00Z",
                             "root_cause": "-", "action_taken": "aktivasi ok",
                             "final_solution": "layanan aktif", "service_final_status": "Normal"})
    assert rr.status_code == 200, rr.text
    body = rr.json()
    assert body["status"] == "SELESAI"
    assert body["ticket_type"] == "PSB"
    time.sleep(2.0)


def test_psb_closing_resume_and_public_track(H, psb_ticket):
    tid = psb_ticket["id"]
    logs = _fetch_logs(H, 300)
    matching = [l for l in logs if l.get("event") == "closing_resume" and l.get("ref_id") == tid]
    assert matching, f"no closing_resume log for PSB {tid}"
    msg = matching[0]["message"]
    assert "🏷 Jenis:" in msg, f"missing Jenis line in PSB resume:\n{msg}"
    # PSB label per _TICKET_TYPE_LABEL
    assert "PSB" in msg.split("🏷 Jenis:", 1)[1].splitlines()[0]

    # public /track/{token}
    m = re.search(r"/track/([A-Za-z0-9_\-]+)", msg)
    assert m
    token = m.group(1)
    r = requests.get(f"{API}/track/{token}", timeout=15)
    assert r.status_code == 200
    assert r.json().get("ticket_type") == "PSB"


# --------------------- (3) MULTIGANGGUAN create + affected list ---------------------
@pytest.fixture(scope="module")
def mg_ticket(H):
    payload = {
        "ticket_type": "MULTIGANGGUAN",
        "customer_name": f"TEST_MG_{uuid.uuid4().hex[:6]}",
        "mg_cause": "Kabel utama putus",
        "description": "multi gangguan sektor 5",
        "priority": "Critical",
        "affected_customers": [
            {"customer_name": "Cust 1"},
            {"customer_name": "Cust 2"},
        ],
    }
    r = requests.post(f"{API}/crm/tickets", json=payload, headers=H, timeout=20)
    assert r.status_code in (200, 201), r.text
    t = r.json()
    created_ticket_ids.append(t["id"])
    return t


def test_mg_create_persists_affected(mg_ticket):
    t = mg_ticket
    assert t["ticket_type"] == "MULTIGANGGUAN"
    assert t["mg_cause"] == "Kabel utama putus"
    ac = t.get("affected_customers") or []
    assert len(ac) == 2
    for c in ac:
        assert c.get("id"), "affected customer missing id"
        assert c.get("status") == "Down"
        assert c.get("restored_at") in (None, "")


def test_mg_resolve_gating_and_endpoints(H, mg_ticket):
    tid = mg_ticket["id"]

    # process
    rp = requests.post(f"{API}/crm/tickets/{tid}/process", headers=H, timeout=15)
    assert rp.status_code == 200, rp.text

    _upload_completion(H, tid, "mg_done.jpg")

    # Attempt resolve with Down customers -> 400
    rr = requests.post(f"{API}/crm/tickets/{tid}/resolve", headers=H, timeout=20,
                       json={"service_restored_at": "2026-01-10T02:00:00Z",
                             "root_cause": "kabel", "action_taken": "sambung",
                             "final_solution": "normal", "service_final_status": "Normal"})
    assert rr.status_code == 400, rr.text
    assert "Restored" in rr.text

    # Add another affected via POST
    r_add = requests.post(f"{API}/crm/tickets/{tid}/affected", headers=H, timeout=15,
                         json={"customer_name": "Cust 3"})
    assert r_add.status_code == 200, r_add.text
    t2 = r_add.json()
    ac2 = t2.get("affected_customers") or []
    assert len(ac2) == 3
    new_ac = next(c for c in ac2 if c["customer_name"] == "Cust 3")
    new_acid = new_ac["id"]

    # DELETE one affected
    r_del = requests.delete(f"{API}/crm/tickets/{tid}/affected/{new_acid}",
                            headers=H, timeout=15)
    assert r_del.status_code == 200, r_del.text
    t3 = r_del.json()
    assert len(t3.get("affected_customers") or []) == 2
    assert all(c["id"] != new_acid for c in t3["affected_customers"])

    # PATCH restore all
    for c in t3["affected_customers"]:
        rp2 = requests.patch(f"{API}/crm/tickets/{tid}/affected/{c['id']}",
                             headers=H, timeout=15, json={"status": "Restored"})
        assert rp2.status_code == 200, rp2.text
        updated = rp2.json()
        found = next(x for x in updated["affected_customers"] if x["id"] == c["id"])
        assert found["status"] == "Restored"
        assert found.get("restored_at")

    # Now resolve -> 200
    rr2 = requests.post(f"{API}/crm/tickets/{tid}/resolve", headers=H, timeout=20,
                        json={"service_restored_at": "2026-01-10T02:30:00Z",
                              "root_cause": "kabel utama", "action_taken": "sambung fiber",
                              "final_solution": "layanan pulih", "service_final_status": "Normal"})
    assert rr2.status_code == 200, rr2.text
    assert rr2.json()["status"] == "SELESAI"
    time.sleep(2.0)


def test_mg_closing_resume_jenis_and_public_track(H, mg_ticket):
    tid = mg_ticket["id"]
    logs = _fetch_logs(H, 400)
    matching = [l for l in logs if l.get("event") == "closing_resume" and l.get("ref_id") == tid]
    assert matching, f"no closing_resume log for MG {tid}"
    msg = matching[0]["message"]
    assert "🏷 Jenis:" in msg
    jenis_line = msg.split("🏷 Jenis:", 1)[1].splitlines()[0]
    assert "Multigangguan" in jenis_line, f"jenis line: {jenis_line!r}"

    m = re.search(r"/track/([A-Za-z0-9_\-]+)", msg)
    assert m
    r = requests.get(f"{API}/track/{m.group(1)}", timeout=15)
    assert r.status_code == 200
    assert r.json().get("ticket_type") == "MULTIGANGGUAN"


# --------------------- (4) Type filter ---------------------
def test_list_filter_by_type(H, psb_ticket, mg_ticket):
    # PSB
    r = requests.get(f"{API}/crm/tickets?ticket_type=PSB&limit=200", headers=H, timeout=15)
    assert r.status_code == 200
    items = r.json().get("items") or r.json()
    if isinstance(items, dict):
        items = items.get("items") or []
    types = {i.get("ticket_type") for i in items}
    assert types == {"PSB"} or types == set() or all(t == "PSB" for t in types), types
    assert any(i["id"] == psb_ticket["id"] for i in items)

    # MULTIGANGGUAN
    r = requests.get(f"{API}/crm/tickets?ticket_type=MULTIGANGGUAN&limit=200", headers=H, timeout=15)
    assert r.status_code == 200
    items = r.json().get("items") or r.json()
    if isinstance(items, dict):
        items = items.get("items") or []
    assert all(i.get("ticket_type") == "MULTIGANGGUAN" for i in items)
    assert any(i["id"] == mg_ticket["id"] for i in items)

    # GANGGUAN — must include legacy (no field) too
    r = requests.get(f"{API}/crm/tickets?ticket_type=GANGGUAN&limit=500", headers=H, timeout=15)
    assert r.status_code == 200
    items = r.json().get("items") or r.json()
    if isinstance(items, dict):
        items = items.get("items") or []
    # No PSB / MG in result
    for i in items:
        tt = i.get("ticket_type")
        assert tt in (None, "GANGGUAN"), f"unexpected ticket_type in GANGGUAN filter: {tt}"


# --------------------- cleanup ---------------------
def test_zzz_cleanup_mongo():
    if not created_ticket_ids:
        return
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
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
