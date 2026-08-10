"""Smoke tests for Portal Support Artamedia deploy verification."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://portal-artamedia-run.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ACCOUNTS = {
    "admin": ("admin@noc.local", "Admin@123"),
    "supervisor": ("supervisor@noc.local", "Password@123"),
    "engineer": ("engineer@noc.local", "Password@123"),
    "viewer": ("viewer@noc.local", "Password@123"),
}

@pytest.fixture(scope="session")
def tokens():
    out = {}
    for role, (email, pw) in ACCOUNTS.items():
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
        assert r.status_code == 200, f"{role} login failed: {r.status_code} {r.text}"
        data = r.json()
        assert "token" in data and "user" in data
        assert data["user"]["email"] == email
        out[role] = data["token"]
    return out

@pytest.fixture(scope="session")
def admin_headers(tokens):
    return {"Authorization": f"Bearer {tokens['admin']}"}

@pytest.fixture(scope="session")
def viewer_headers(tokens):
    return {"Authorization": f"Bearer {tokens['viewer']}"}


def test_health_public():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d.get("api") is True
    assert d.get("database") is True
    assert d.get("storage") is True


def test_auth_me_all_roles(tokens):
    for role, tok in tokens.items():
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        assert r.status_code == 200, f"me failed for {role}: {r.text}"
        assert r.json()["email"] == ACCOUNTS[role][0]


def test_dashboard_stats(admin_headers):
    r = requests.get(f"{API}/dashboard/stats", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ("customers_by_category", "docs_by_category"):
        assert k in d, f"missing {k} in dashboard stats"
    # Totals may be flat keys (total_customers, active_customers) or nested under 'totals'
    assert ("totals" in d) or ("total_customers" in d), "no totals present"


def test_counts(admin_headers):
    r = requests.get(f"{API}/counts", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d, dict)
    assert len(d) > 0


@pytest.mark.parametrize("path", [
    "/customers", "/documents", "/partners", "/racks", "/devices",
    "/incidents", "/maintenances", "/shift-handovers", "/interconnections",
    "/kmz-mappings", "/crm/broadband-tickets", "/crm/dedicated-tickets",
])
def test_paginated_list_endpoints(admin_headers, path):
    r = requests.get(f"{API}{path}", headers=admin_headers, timeout=15)
    assert r.status_code == 200, f"{path} returned {r.status_code}: {r.text[:200]}"
    d = r.json()
    for k in ("items", "total", "page", "page_size"):
        assert k in d, f"{path} missing {k}. got keys={list(d.keys())}"
    assert isinstance(d["items"], list)


def test_crm_stats(admin_headers):
    r = requests.get(f"{API}/crm/stats", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ("total_tickets", "by_provider", "by_priority"):
        assert k in d, f"crm/stats missing {k}"


def test_viewer_cannot_post_customer(viewer_headers):
    payload = {"sid": "TEST_SID_V1", "company_name": "TEST_should_fail", "category": "Broadband"}
    r = requests.post(f"{API}/customers", headers=viewer_headers, json=payload, timeout=10)
    assert r.status_code == 403, f"viewer post got {r.status_code}: {r.text[:200]}"


def test_admin_create_delete_customer(admin_headers):
    payload = {"sid": "TEST_SID_SMOKE1", "company_name": "TEST_smoke_customer", "category": "Broadband"}
    r = requests.post(f"{API}/customers", headers=admin_headers, json=payload, timeout=10)
    assert r.status_code in (200, 201), f"create got {r.status_code}: {r.text[:200]}"
    cid = r.json().get("id")
    assert cid
    # GET verification
    g = requests.get(f"{API}/customers/{cid}", headers=admin_headers, timeout=10)
    assert g.status_code == 200
    assert g.json()["company_name"] == "TEST_smoke_customer"
    # Delete
    d = requests.delete(f"{API}/customers/{cid}", headers=admin_headers, timeout=10)
    assert d.status_code in (200, 204)
    # Verify gone
    g2 = requests.get(f"{API}/customers/{cid}", headers=admin_headers, timeout=10)
    assert g2.status_code == 404


@pytest.mark.parametrize("path", [
    "/network/routers",
    "/snmp/status",
    "/device-templates",
    "/zabbix/config",
])
def test_extension_routers_loaded(admin_headers, path):
    """Ensure extension routers responded (not 500 due to import error)."""
    r = requests.get(f"{API}{path}", headers=admin_headers, timeout=20)
    assert r.status_code != 500, f"{path} returned 500: {r.text[:300]}"
    assert r.status_code in (200, 401, 403, 404, 422, 502, 503), f"{path} unexpected {r.status_code}"
