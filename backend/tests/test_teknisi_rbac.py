"""Backend tests for the new 'teknisi' role RBAC & CRM write access."""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://support-artamedia.preview.emergentagent.com").rstrip("/")

TEKNISI_EMAIL = "teknisi@noc.local"
TEKNISI_PASS = "Teknisi@123"
ADMIN_EMAIL = "admin@noc.local"
ADMIN_PASS = "Admin@123"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def teknisi_token():
    data = _login(TEKNISI_EMAIL, TEKNISI_PASS)
    assert data["user"]["role"] == "teknisi", f"expected role teknisi, got {data['user']['role']}"
    return data["access_token"] if "access_token" in data else data.get("token")


@pytest.fixture(scope="module")
def admin_token():
    data = _login(ADMIN_EMAIL, ADMIN_PASS)
    return data.get("access_token") or data.get("token")


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


class TestTeknisiAuth:
    def test_login_returns_teknisi_role(self):
        data = _login(TEKNISI_EMAIL, TEKNISI_PASS)
        assert data["user"]["role"] == "teknisi"
        assert data["user"]["email"] == TEKNISI_EMAIL

    def test_auth_me_returns_teknisi(self, teknisi_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(teknisi_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "teknisi"
        assert body["email"] == TEKNISI_EMAIL


class TestTeknisiReadAccess:
    def test_crm_tickets_list(self, teknisi_token):
        r = requests.get(f"{BASE_URL}/api/crm/tickets", headers=_h(teknisi_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, (list, dict))
        if isinstance(body, dict):
            assert "items" in body

    def test_crm_stats(self, teknisi_token):
        r = requests.get(f"{BASE_URL}/api/crm/stats", headers=_h(teknisi_token), timeout=30)
        assert r.status_code == 200

    def test_customers_read_allowed(self, teknisi_token):
        r = requests.get(f"{BASE_URL}/api/customers", headers=_h(teknisi_token), timeout=30)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"

    def test_users_admin_only_forbidden(self, teknisi_token):
        r = requests.get(f"{BASE_URL}/api/users", headers=_h(teknisi_token), timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"


class TestTeknisiCRMWrite:
    def test_teknisi_can_write_ticket_flow(self, teknisi_token, admin_token):
        # get a customer id (need one to create a ticket)
        rc = requests.get(f"{BASE_URL}/api/customers", headers=_h(teknisi_token), timeout=30)
        assert rc.status_code == 200
        body = rc.json()
        customers = body["items"] if isinstance(body, dict) and "items" in body else body
        if not customers:
            pytest.skip("no customers seeded, cannot test ticket create flow")
        cust = customers[0]
        cid = cust.get("id") or cust.get("_id")

        payload = {
            "customer_id": cid,
            "customer_name": cust.get("company_name") or cust.get("name") or "TEST Customer",
            "title": "TEST_teknisi_ticket",
            "description": "Created by teknisi test",
            "priority": "Medium",
            "category": "gangguan",
        }
        r = requests.post(f"{BASE_URL}/api/crm/tickets", json=payload, headers=_h(teknisi_token), timeout=30)
        # Accept 200/201 for create
        assert r.status_code in (200, 201), f"teknisi create ticket failed: {r.status_code} {r.text[:300]}"
        ticket = r.json()
        tid = ticket.get("id") or ticket.get("_id")
        assert tid, f"no id in ticket response: {ticket}"

        # process (start)
        rp = requests.post(f"{BASE_URL}/api/crm/tickets/{tid}/process", headers=_h(teknisi_token), timeout=30)
        # progress
        rprog = requests.post(f"{BASE_URL}/api/crm/tickets/{tid}/progress",
                              json={"note": "TEST progress"}, headers=_h(teknisi_token), timeout=30)
        # file upload
        files = {"file": ("evidence.txt", io.BytesIO(b"hello"), "text/plain")}
        rf = requests.post(f"{BASE_URL}/api/crm/tickets/{tid}/files", files=files, headers=_h(teknisi_token), timeout=30)

        results = {
            "process": rp.status_code,
            "progress": rprog.status_code,
            "files": rf.status_code,
        }
        print("teknisi write results:", results)
        # At least one write endpoint must have succeeded
        assert any(200 <= s < 300 for s in results.values()), f"none of the teknisi writes succeeded: {results}"
