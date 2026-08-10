"""Backend tests for Closing Resume enhancement (Feature 1)."""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    # fallback read from frontend env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@noc.local", "password": "Admin@123"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def H(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _set_settings(H, *, enabled=True, send_closing_resume=True, main_group="12036399@g.us"):
    body = {
        "provider": "fonnte",
        "enabled": enabled,
        "api_token": "DUMMYTOKEN",
        "sender": "628",
        "default_group": "12036300@g.us",
        "main_group": main_group,
        "send_closing_resume": send_closing_resume,
    }
    r = requests.put(f"{API}/notifications/settings", json=body, headers=H, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _create_and_process_ticket(H):
    payload = {
        "customer_name": f"TEST_CustClose_{uuid.uuid4().hex[:6]}",
        "description": "Automated closing resume test ticket",
        "priority": "High",
        "location": "Jakarta",
        "category_name": "Internet",
        "outage_started_at": "2026-01-10T00:00:00Z",
    }
    r = requests.post(f"{API}/crm/tickets", json=payload, headers=H, timeout=15)
    assert r.status_code in (200, 201), r.text
    tid = r.json()["id"]
    r2 = requests.post(f"{API}/crm/tickets/{tid}/process", headers=H, timeout=15)
    assert r2.status_code == 200, r2.text
    return tid, r.json().get("ticket_number")


def _resolve(H, tid):
    body = {
        "service_restored_at": "2026-01-10T01:00:00Z",
        "root_cause": "cable cut",
        "action_taken": "splice",
        "final_solution": "restored",
        "override_reason": "test - no evidence file",
    }
    r = requests.post(f"{API}/crm/tickets/{tid}/resolve", json=body, headers=H, timeout=20)
    return r


# ---- Test 1: settings persist new fields ----
def test_settings_persist_new_fields(H):
    _set_settings(H, enabled=True, send_closing_resume=True, main_group="12036399@g.us")
    r = requests.get(f"{API}/notifications/settings", headers=H, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["main_group"] == "12036399@g.us"
    assert data["send_closing_resume"] is True
    assert data["token_configured"] is True


# ---- Test 2: closing resume fires on close (toggle ON) ----
def test_closing_resume_fires_on_close(H):
    _set_settings(H, enabled=True, send_closing_resume=True, main_group="12036399@g.us")
    tid, tnum = _create_and_process_ticket(H)
    r = _resolve(H, tid)
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "SELESAI"
    # Give background/log write a moment
    time.sleep(1)
    logs = requests.get(f"{API}/notifications/logs?limit=25", headers=H, timeout=15).json()["items"]
    matching = [
        l for l in logs
        if l.get("event") == "closing_resume" and l.get("ref_id") == tid
    ]
    assert matching, f"No closing_resume log for ticket {tid}. Logs: {logs[:3]}"
    log = matching[0]
    assert log.get("template_key") == "closing_resume_main"
    assert log.get("target") == "12036399@g.us"
    msg = log.get("message", "")
    assert "✅ RESUME PENYELESAIAN TICKET" in msg
    assert tnum in msg
    assert f"/crm/ticket/{tid}/history" in msg


# ---- Test 3: closing resume does NOT fire when toggle OFF ----
def test_closing_resume_not_fired_when_off(H):
    _set_settings(H, enabled=True, send_closing_resume=False, main_group="12036399@g.us")
    tid, _ = _create_and_process_ticket(H)
    r = _resolve(H, tid)
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "SELESAI"
    time.sleep(1)
    logs = requests.get(f"{API}/notifications/logs?limit=30", headers=H, timeout=15).json()["items"]
    matching = [
        l for l in logs
        if l.get("event") == "closing_resume" and l.get("ref_id") == tid
    ]
    assert not matching, f"closing_resume unexpectedly fired for ticket {tid}"


# ---- Test 4: failure/empty main_group still returns 200 SELESAI ----
def test_close_still_succeeds_when_main_group_empty(H):
    _set_settings(H, enabled=True, send_closing_resume=True, main_group="")
    tid, _ = _create_and_process_ticket(H)
    r = _resolve(H, tid)
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "SELESAI"


# ---- Test 5: resolve still requires mandatory fields (regression) ----
def test_resolve_requires_final_solution(H):
    _set_settings(H, enabled=False, send_closing_resume=False, main_group="")
    tid, _ = _create_and_process_ticket(H)
    r = requests.post(
        f"{API}/crm/tickets/{tid}/resolve",
        json={"service_restored_at": "2026-01-10T01:00:00Z"},
        headers=H, timeout=15,
    )
    assert r.status_code in (400, 422), f"expected validation error, got {r.status_code}: {r.text}"


# ---- cleanup: restore safe defaults ----
def test_zzz_reset_settings(H):
    _set_settings(H, enabled=False, send_closing_resume=False, main_group="")
    r = requests.get(f"{API}/notifications/settings", headers=H, timeout=15).json()
    assert r["send_closing_resume"] is False
    assert r["main_group"] == ""
    assert r["enabled"] is False
