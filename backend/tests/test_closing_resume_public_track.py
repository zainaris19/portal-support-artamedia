"""Iteration 7 tests: closing_resume now embeds PUBLIC /track/{token} link
(previously /crm/ticket/{id}/history). Also verifies public track endpoint
returns full timeline without auth, and standard lifecycle notifications
still fire (created/assigned/resolved).
"""
import os
import re
import time
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@noc.local", "password": "Admin@123"}
MAIN_GROUP = "120363408836731773@g.us"
DEFAULT_GROUP = "120363430088957368@g.us"

created_ticket_ids: list = []


# ---- Auth smoke ------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    assert tok, f"no token in {j}"
    return tok


@pytest.fixture(scope="module")
def H(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def test_auth_me(H):
    r = requests.get(f"{API}/auth/me", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    me = r.json()
    assert me.get("email") == "admin@noc.local"


# ---- Configure notification_settings as required --------------------------
def _configure_settings(H):
    body = {
        "provider": "fonnte",
        "enabled": True,
        # keep any existing token; server preserves when field omitted, but we
        # send a dummy to guarantee token_configured=True
        "api_token": "DUMMYTOKEN",
        "sender": "628",
        "default_group": DEFAULT_GROUP,
        "main_group": MAIN_GROUP,
        "send_closing_resume": True,
    }
    r = requests.put(f"{API}/notifications/settings", json=body, headers=H, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_configure_settings(H):
    data = _configure_settings(H)
    assert data["main_group"] == MAIN_GROUP
    assert data["default_group"] == DEFAULT_GROUP
    assert data["send_closing_resume"] is True
    assert data["enabled"] is True


# ---- Create + process + resolve a ticket ----------------------------------
@pytest.fixture(scope="module")
def resolved_ticket(H):
    _configure_settings(H)
    payload = {
        "customer_name": f"TEST_ClosingPublic_{uuid.uuid4().hex[:6]}",
        "description": "Automated public trace closing_resume test",
        "priority": "High",
        "location": "Jakarta",
        "pic_contact": "+6280000000",
        "category_name": "Internet",
        "outage_started_at": "2026-01-10T00:00:00Z",
    }
    r = requests.post(f"{API}/crm/tickets", json=payload, headers=H, timeout=15)
    assert r.status_code in (200, 201), r.text
    t = r.json()
    tid = t["id"]
    created_ticket_ids.append(tid)

    rp = requests.post(f"{API}/crm/tickets/{tid}/process", headers=H, timeout=15)
    assert rp.status_code == 200, rp.text

    rr = requests.post(
        f"{API}/crm/tickets/{tid}/resolve",
        json={
            "service_restored_at": "2026-01-10T01:00:00Z",
            "root_cause": "cable cut",
            "action_taken": "splice",
            "final_solution": "restored",
            "service_final_status": "Normal",
            "override_reason": "qa test",
        },
        headers=H, timeout=20,
    )
    assert rr.status_code == 200, rr.text
    body = rr.json()
    assert body.get("status") == "SELESAI"
    time.sleep(1.5)
    return {"id": tid, "ticket_number": t.get("ticket_number"), "resolve_body": body}


def _fetch_logs(H, limit=80):
    r = requests.get(f"{API}/notifications/logs?limit={limit}", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["items"]


# ---- Test: closing_resume log row exists w/ correct target ---------------
def test_closing_resume_log_created(H, resolved_ticket):
    tid = resolved_ticket["id"]
    tnum = resolved_ticket["ticket_number"]
    logs = _fetch_logs(H, 120)
    matching = [
        l for l in logs
        if l.get("event") == "closing_resume" and l.get("ref_id") == tid
    ]
    assert matching, f"No closing_resume log for {tid}. Recent events: {[l.get('event') for l in logs[:10]]}"
    log = matching[0]
    assert log.get("channel") == "internal", log
    assert log.get("target") == MAIN_GROUP, f"target={log.get('target')}"
    assert log.get("status") in {"sent", "skipped", "failed"}, log.get("status")
    msg = log.get("message", "")
    assert "RESUME PENYELESAIAN TICKET" in msg
    assert tnum and tnum in msg


# ---- Test: message contains public /track/<token>, NOT /crm/ticket/ ------
TRACK_RE = re.compile(r"(https?://[^\s]+)?/track/([A-Za-z0-9_\-]+)")


def _extract_track_token(msg: str):
    m = TRACK_RE.search(msg)
    assert m, f"No /track/<token> URL found in message:\n{msg}"
    return m.group(2)


def test_message_has_public_track_link_only(H, resolved_ticket):
    tid = resolved_ticket["id"]
    logs = _fetch_logs(H, 120)
    log = next(l for l in logs if l.get("event") == "closing_resume" and l.get("ref_id") == tid)
    msg = log["message"]
    # must include public /track/
    assert "/track/" in msg, f"Missing /track/ link:\n{msg}"
    # must NOT include the old protected route
    assert "/crm/ticket/" not in msg, f"Old protected link still present:\n{msg}"
    token = _extract_track_token(msg)
    assert len(token) >= 8


# ---- Test: public GET /api/track/{token} works WITHOUT auth --------------
def test_public_track_endpoint_no_auth(H, resolved_ticket):
    tid = resolved_ticket["id"]
    logs = _fetch_logs(H, 120)
    log = next(l for l in logs if l.get("event") == "closing_resume" and l.get("ref_id") == tid)
    token = _extract_track_token(log["message"])

    # Explicitly NO auth header
    r = requests.get(f"{API}/track/{token}", timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert data.get("ticket_number") == resolved_ticket["ticket_number"]
    assert data.get("status_label") or data.get("status")
    timeline = data.get("timeline") or []
    assert isinstance(timeline, list) and len(timeline) > 0, "timeline empty"
    # completion should be non-null for a resolved ticket
    assert data.get("completion") is not None, f"completion missing: {list(data.keys())}"


# ---- Regression: standard lifecycle notifications fire -------------------
def test_lifecycle_notifications_fire(H, resolved_ticket):
    tid = resolved_ticket["id"]
    logs = _fetch_logs(H, 200)
    for evt in ("created", "assigned", "resolved"):
        matching = [
            l for l in logs
            if l.get("event") == evt
            and l.get("ref_id") == tid
            and l.get("channel") == "internal"
        ]
        assert matching, f"No {evt} internal log for {tid}"
        # default_group target
        assert matching[0].get("target") == DEFAULT_GROUP, (
            f"{evt} target={matching[0].get('target')} (expected {DEFAULT_GROUP})"
        )


# ---- Cleanup: delete created test tickets & reset settings ---------------
def test_zzz_cleanup(H):
    # Try common delete endpoints; ignore if not permitted
    for tid in created_ticket_ids:
        for url in (f"{API}/crm/tickets/{tid}", f"{API}/crm/tickets/{tid}/delete"):
            try:
                r = requests.delete(url, headers=H, timeout=10)
                if r.status_code in (200, 204):
                    break
            except Exception:
                pass
    # Reset settings to safe defaults so subsequent iterations don't spam
    reset = {
        "provider": "fonnte",
        "enabled": False,
        "api_token": "",
        "sender": "",
        "default_group": DEFAULT_GROUP,
        "main_group": MAIN_GROUP,
        "send_closing_resume": False,
    }
    r = requests.put(f"{API}/notifications/settings", json=reset, headers=H, timeout=15)
    assert r.status_code == 200, r.text
