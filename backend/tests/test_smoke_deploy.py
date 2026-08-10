"""Deployment verification smoke tests for Portal Support Artamedia."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://artamedia-support-2.preview.emergentagent.com"
ADMIN_EMAIL = "admin@noc.local"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and data["user"]["role"] == "admin"
    return data["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_success():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == ADMIN_EMAIL


def test_login_invalid():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
    assert r.status_code in (400, 401, 403)


def test_auth_me(headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d.get("email") == ADMIN_EMAIL


@pytest.mark.parametrize("path", [
    "/api/crm/tickets",
    "/api/crm/categories",
    "/api/crm/technicians",
    "/api/crm/stats",
    "/api/topology/entities",
    "/api/topology/graph",
    "/api/notifications/providers",
])
def test_authenticated_get_endpoints(headers, path):
    r = requests.get(f"{BASE_URL}{path}", headers=headers, timeout=20)
    # Allow 200 (OK) or 404 for unimplemented list-under-prefix; treat 5xx as failure.
    assert r.status_code < 500, f"{path} returned {r.status_code}: {r.text[:200]}"
    assert r.status_code in (200, 204, 404), f"{path} unexpected: {r.status_code}"


def test_no_auth_returns_401(headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code in (401, 403)
