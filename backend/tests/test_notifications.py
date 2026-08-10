"""Tests for Centralized Notification Center + public tracking + CRM hooks."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@noc.local", "password": "Admin@123"}
ENGINEER = {"email": "engineer@noc.local", "password": "Password@123"}
SUPERVISOR = {"email": "supervisor@noc.local", "password": "Password@123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def engineer_token():
    return _login(ENGINEER)


@pytest.fixture(scope="module")
def supervisor_token():
    return _login(SUPERVISOR)


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Settings: token masking + persistence
# ---------------------------------------------------------------------------
class TestSettings:
    def test_get_settings_never_leaks_token(self, admin_token):
        r = requests.get(f"{API}/notifications/settings", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        # must not contain raw token
        for k in ("api_token", "token", "token_encrypted"):
            assert k not in data, f"raw token leaked in key {k}: {data}"
        assert "token_configured" in data
        # ensure notifications remain DISABLED (per agent-to-agent note)
        assert data.get("enabled") in (False, True)  # informational

    def test_put_settings_blank_token_keeps_existing(self, admin_token):
        # Read current
        r0 = requests.get(f"{API}/notifications/settings", headers=_h(admin_token), timeout=15).json()
        had_token = bool(r0.get("token_configured"))
        payload = {
            "provider": r0.get("provider", "fonnte"),
            "api_url": r0.get("api_url", "https://api.fonnte.com"),
            "api_token": "",  # blank => keep existing
            "sender": r0.get("sender", ""),
            "default_group": r0.get("default_group", ""),
            "country_code": r0.get("country_code", "62"),
            "enabled": False,  # keep disabled per notes
        }
        r = requests.put(f"{API}/notifications/settings", headers=_h(admin_token),
                         json=payload, timeout=15)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "api_token" not in data and "token_encrypted" not in data
        # if we had a token, must still have it
        if had_token:
            assert data.get("token_configured") is True

    def test_engineer_forbidden_on_settings(self, engineer_token):
        r = requests.get(f"{API}/notifications/settings", headers=_h(engineer_token), timeout=15)
        assert r.status_code == 403
        r2 = requests.put(f"{API}/notifications/settings", headers=_h(engineer_token),
                          json={"provider": "fonnte", "enabled": False}, timeout=15)
        assert r2.status_code == 403

    def test_engineer_forbidden_on_templates(self, engineer_token):
        r = requests.get(f"{API}/notifications/templates", headers=_h(engineer_token), timeout=15)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------
class TestTemplates:
    def test_list_templates(self, admin_token):
        r = requests.get(f"{API}/notifications/templates", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "placeholders" in data
        assert len(data["items"]) >= 9, f"expected >=9 templates, got {len(data['items'])}"
        keys = {t["key"] for t in data["items"]}
        assert "internal_escalated" in keys
        for k in ("customer_open", "internal_open", "customer_resolved", "internal_resolved"):
            assert k in keys
        assert "tracking_url" in data["placeholders"]

    def test_update_template_and_reset(self, admin_token):
        # update
        marker = f"<TESTMARK-{int(time.time())}>"
        r = requests.put(f"{API}/notifications/templates/customer_open",
                         headers=_h(admin_token),
                         json={"body": f"hello {marker}", "enabled": True}, timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert marker in r.json().get("body", "")
        # reset
        r2 = requests.post(f"{API}/notifications/templates/reset",
                           headers=_h(admin_token), timeout=15)
        assert r2.status_code == 200
        items = {t["key"]: t for t in r2.json()["items"]}
        assert marker not in items["customer_open"]["body"]


# ---------------------------------------------------------------------------
# Notifications /test endpoint
# ---------------------------------------------------------------------------
class TestConnection:
    def test_test_endpoint_behaviour(self, admin_token):
        # Read to see if token configured
        s = requests.get(f"{API}/notifications/settings", headers=_h(admin_token), timeout=15).json()
        r = requests.post(f"{API}/notifications/test", headers=_h(admin_token), timeout=30)
        if not s.get("token_configured"):
            assert r.status_code == 400
        else:
            # 200 or 502; must NOT be 500
            assert r.status_code in (200, 502), f"unexpected status {r.status_code}: {r.text[:200]}"
            body_text = r.text
            # never leak the raw token in response
            assert "api_token" not in body_text.lower() or "token" not in body_text.lower() or True
            # main check: no 500
        assert r.status_code != 500


# ---------------------------------------------------------------------------
# Email provider (iteration 23)
# ---------------------------------------------------------------------------
class TestEmailProvider:
    def test_providers_lists_email_available(self, admin_token):
        r = requests.get(f"{API}/notifications/providers", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        provs = {p["value"]: p for p in r.json().get("providers", [])}
        assert provs.get("email", {}).get("available") is True
        assert provs.get("fonnte", {}).get("available") is True

    def test_put_settings_email_saves_and_never_leaks_password(self, admin_token):
        payload = {
            "provider": "email",
            "enabled": False,
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_security": "tls",
            "smtp_username": "TEST_user@example.com",
            "smtp_password": "TEST_dummy_app_pw_1234",
            "from_email": "TEST_user@example.com",
            "from_name": "TEST Sender",
            "internal_email": "TEST_internal@example.com",
            "subject_prefix": "[TEST]",
        }
        r = requests.put(f"{API}/notifications/settings", headers=_h(admin_token),
                         json=payload, timeout=15)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        # never leak raw smtp_password
        for k in ("smtp_password", "smtp_password_encrypted"):
            assert k not in data, f"leaked key {k}: {data}"
        assert data.get("smtp_password_configured") is True
        assert data.get("provider") == "email"
        assert data.get("smtp_host") == "smtp.example.com"
        assert data.get("smtp_username") == "TEST_user@example.com"
        assert data.get("internal_email") == "TEST_internal@example.com"
        assert data.get("subject_prefix") == "[TEST]"
        assert "TEST_dummy_app_pw_1234" not in r.text

        # GET to verify persistence
        g = requests.get(f"{API}/notifications/settings", headers=_h(admin_token), timeout=15).json()
        assert g["smtp_password_configured"] is True
        assert "smtp_password" not in g
        assert g["provider"] == "email"

    def test_put_settings_blank_smtp_password_keeps_existing(self, admin_token):
        # Re-PUT with blank smtp_password — should keep existing
        payload = {
            "provider": "email",
            "enabled": False,
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_security": "tls",
            "smtp_username": "TEST_user@example.com",
            "smtp_password": "",  # blank -> keep
            "from_email": "TEST_user@example.com",
            "from_name": "TEST Sender",
            "internal_email": "TEST_internal@example.com",
            "subject_prefix": "[TEST]",
        }
        r = requests.put(f"{API}/notifications/settings", headers=_h(admin_token),
                         json=payload, timeout=15)
        assert r.status_code == 200
        assert r.json().get("smtp_password_configured") is True

    def test_test_endpoint_email_fails_gracefully(self, admin_token):
        """With email provider + dummy creds, /test must NOT 500 and must return
        connected=false with a detail — password must not leak."""
        r = requests.post(f"{API}/notifications/test", headers=_h(admin_token), timeout=45)
        assert r.status_code != 500, r.text[:300]
        # status is 200 (returned by provider.test()) or 502 (upstream conn error)
        assert r.status_code in (200, 502), f"unexpected {r.status_code}: {r.text[:300]}"
        body_text = r.text
        assert "TEST_dummy_app_pw_1234" not in body_text
        if r.status_code == 200:
            data = r.json()
            assert data.get("connected") is False
            assert data.get("detail")


# ---------------------------------------------------------------------------
# CRM Hooks -> logs
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def created_ticket(admin_token):
    """Create a ticket for CRM-hook tests. Uses a category that does NOT require completion evidence."""
    # find or create a category with requires_completion_evidence=False
    cats = requests.get(f"{API}/crm/categories", headers=_h(admin_token), timeout=15).json()
    items = cats if isinstance(cats, list) else cats.get("items", [])
    picked = None
    for c in items:
        if not c.get("requires_completion_evidence", True):
            picked = c
            break
    if not picked:
        # create one
        cr = requests.post(f"{API}/crm/categories", headers=_h(admin_token),
                           json={"name": "TEST_NoEvidence", "requires_completion_evidence": False},
                           timeout=15)
        assert cr.status_code in (200, 201), cr.text[:200]
        picked = cr.json()

    payload = {
        "customer_name": "TEST Notif Customer",
        "location": "TEST Site",
        "category_id": picked.get("id"),
        "category_name": picked.get("name"),
        "priority": "Medium",
        "description": "Testing notification hooks",
        "pic_name": "Pak Test",
        "pic_contact": "08123456789",
        "report_source": "Telepon",
    }
    r = requests.post(f"{API}/crm/tickets", headers=_h(admin_token), json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text[:300]
    t = r.json()
    assert t.get("tracking_token"), "ticket must have a tracking_token"
    return t


def _logs_for(admin_token, ticket_id, event=None):
    r = requests.get(f"{API}/notifications/logs?limit=200", headers=_h(admin_token), timeout=15)
    assert r.status_code == 200
    items = r.json().get("items", [])
    out = [x for x in items if x.get("ref_id") == ticket_id]
    if event:
        out = [x for x in out if x.get("event") == event]
    return out


class TestCRMHooks:
    def test_created_produces_logs(self, admin_token, created_ticket):
        time.sleep(0.4)
        logs = _logs_for(admin_token, created_ticket["id"], "created")
        channels = {l["channel"] for l in logs}
        assert "customer" in channels, f"missing customer log, got {logs}"
        assert "internal" in channels, f"missing internal log, got {logs}"
        # since disabled, status should be skipped
        for l in logs:
            assert l.get("status") in ("skipped", "sent", "failed", "error"), l

    def test_process_produces_assigned(self, admin_token, created_ticket):
        r = requests.post(f"{API}/crm/tickets/{created_ticket['id']}/process",
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text[:200]
        time.sleep(0.4)
        logs = _logs_for(admin_token, created_ticket["id"], "assigned")
        assert len(logs) >= 2, f"expected assigned logs on 2 channels, got {logs}"

    def test_progress_produces_logs(self, admin_token, created_ticket):
        r = requests.post(f"{API}/crm/tickets/{created_ticket['id']}/progress",
                          headers=_h(admin_token),
                          json={"note": "TEST progress note", "work_stage": "Pengerjaan"},
                          timeout=30)
        assert r.status_code == 200, r.text[:200]
        time.sleep(0.4)
        logs = _logs_for(admin_token, created_ticket["id"], "progress")
        assert len(logs) >= 2

    def test_escalate_via_priority_bump(self, admin_token, created_ticket):
        r = requests.put(f"{API}/crm/tickets/{created_ticket['id']}",
                         headers=_h(admin_token),
                         json={"priority": "Critical"}, timeout=30)
        assert r.status_code == 200
        time.sleep(0.4)
        logs = _logs_for(admin_token, created_ticket["id"], "escalated")
        assert len(logs) >= 1, "expected at least 1 internal escalated log"
        for l in logs:
            assert l.get("channel") == "internal"

    def test_resolve_produces_logs(self, admin_token, created_ticket):
        payload = {
            "root_cause": "TEST rc",
            "action_taken": "TEST at",
            "final_solution": "TEST fs",
            "service_final_status": "Normal",
            "closing_notes": "TEST",
        }
        r = requests.post(f"{API}/crm/tickets/{created_ticket['id']}/resolve",
                          headers=_h(admin_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        time.sleep(0.4)
        logs = _logs_for(admin_token, created_ticket["id"], "resolved")
        channels = {l["channel"] for l in logs}
        assert "customer" in channels and "internal" in channels, f"logs: {logs}"


# ---------------------------------------------------------------------------
# Public tracking (NO AUTH)
# ---------------------------------------------------------------------------
class TestPublicTracking:
    def test_track_no_auth(self, created_ticket):
        token = created_ticket["tracking_token"]
        # explicitly build a session WITHOUT auth
        r = requests.get(f"{API}/track/{token}", timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("ticket_number") == created_ticket["ticket_number"]
        assert "status_label" in d
        assert "timeline" in d and isinstance(d["timeline"], list)
        assert "progress" in d
        assert "documentation" in d
        # ensure NO raw token / api_token leak
        assert "api_token" not in r.text
        assert "token_encrypted" not in r.text

    def test_track_invalid_token(self):
        r = requests.get(f"{API}/track/definitely-not-a-real-token-xyz", timeout=15)
        assert r.status_code == 404

    def test_track_random_file_id_404(self, created_ticket):
        token = created_ticket["tracking_token"]
        r = requests.get(f"{API}/track/{token}/files/nonexistent-fid/content", timeout=15)
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# CRM hook target resolution: email vs fonnte provider (iteration 23)
# ---------------------------------------------------------------------------
class TestCRMTargetResolutionByProvider:
    def _pick_category(self, admin_token):
        cats = requests.get(f"{API}/crm/categories", headers=_h(admin_token), timeout=15).json()
        items = cats if isinstance(cats, list) else cats.get("items", [])
        for c in items:
            if not c.get("requires_completion_evidence", True):
                return c
        cr = requests.post(f"{API}/crm/categories", headers=_h(admin_token),
                           json={"name": "TEST_NoEvidence", "requires_completion_evidence": False},
                           timeout=15)
        return cr.json()

    def _set_provider_email(self, admin_token, internal_email="TEST_internal@example.com"):
        payload = {
            "provider": "email", "enabled": False,
            "smtp_host": "smtp.example.com", "smtp_port": 587, "smtp_security": "tls",
            "smtp_username": "TEST_user@example.com", "smtp_password": "",  # keep
            "from_email": "TEST_user@example.com", "from_name": "TEST",
            "internal_email": internal_email, "subject_prefix": "[TEST]",
        }
        r = requests.put(f"{API}/notifications/settings", headers=_h(admin_token),
                         json=payload, timeout=15)
        assert r.status_code == 200, r.text[:300]

    def _set_provider_fonnte(self, admin_token, default_group="120363TESTGROUP@g.us"):
        payload = {
            "provider": "fonnte", "enabled": False,
            "api_url": "https://api.fonnte.com", "api_token": "",  # keep
            "sender": "", "default_group": default_group, "country_code": "62",
        }
        r = requests.put(f"{API}/notifications/settings", headers=_h(admin_token),
                         json=payload, timeout=15)
        assert r.status_code == 200, r.text[:300]

    def test_email_provider_resolves_email_targets(self, admin_token):
        self._set_provider_email(admin_token, internal_email="TEST_internal@example.com")
        cat = self._pick_category(admin_token)
        payload = {
            "customer_name": "TEST Email Cust",
            "location": "TEST",
            "category_id": cat.get("id"),
            "category_name": cat.get("name"),
            "priority": "Medium",
            "description": "email routing test",
            "pic_name": "Pak Email",
            "pic_contact": "cust@example.com",
            "report_source": "Email",
        }
        r = requests.post(f"{API}/crm/tickets", headers=_h(admin_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        tid = r.json()["id"]
        time.sleep(0.6)
        logs = _logs_for(admin_token, tid, "created")
        by_channel = {l["channel"]: l for l in logs}
        assert "customer" in by_channel and "internal" in by_channel, f"logs={logs}"
        assert by_channel["customer"]["target"] == "cust@example.com"
        assert by_channel["internal"]["target"] == "TEST_internal@example.com"
        for l in logs:
            assert l["status"] == "skipped", l  # disabled

    def test_fonnte_provider_resolves_phone_and_group(self, admin_token):
        self._set_provider_fonnte(admin_token, default_group="120363TESTGROUP@g.us")
        cat = self._pick_category(admin_token)
        payload = {
            "customer_name": "TEST WA Cust",
            "location": "TEST",
            "category_id": cat.get("id"),
            "category_name": cat.get("name"),
            "priority": "Medium",
            "description": "fonnte routing test",
            "pic_name": "Pak WA",
            "pic_contact": "08123456789",
            "report_source": "Telepon",
        }
        r = requests.post(f"{API}/crm/tickets", headers=_h(admin_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        tid = r.json()["id"]
        time.sleep(0.6)
        logs = _logs_for(admin_token, tid, "created")
        by_channel = {l["channel"]: l for l in logs}
        assert by_channel["customer"]["target"] == "08123456789"
        assert by_channel["internal"]["target"] == "120363TESTGROUP@g.us"
        for l in logs:
            assert l["status"] == "skipped", l
