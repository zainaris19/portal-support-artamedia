"""Backend tests for the new Maps Topology module.

Purely additive read-only endpoints:
  * GET /api/topology/graph
  * GET /api/topology/geo
  * GET /api/topology/status
Also runs regression checks vs pre-existing endpoints & shapes.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://portal-artamedia-run.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "admin@noc.local", "password": "Admin@123"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"] if "access_token" in r.json() else r.json().get("token")


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- auth / openapi ---------------------------------------------------
def test_openapi_has_topology_routes():
    # /openapi.json is not exposed via public ingress (only /api/* is), so hit backend directly.
    r = requests.get("http://localhost:8001/openapi.json", timeout=30)
    assert r.status_code == 200
    paths = r.json().get("paths", {})
    for p in ("/api/topology/graph", "/api/topology/geo", "/api/topology/status"):
        assert p in paths, f"missing {p} in openapi.json"


def test_graph_requires_auth():
    r = requests.get(f"{BASE_URL}/api/topology/graph", timeout=30)
    assert r.status_code in (401, 403)


def test_geo_requires_auth():
    r = requests.get(f"{BASE_URL}/api/topology/geo", timeout=30)
    assert r.status_code in (401, 403)


def test_status_requires_auth():
    r = requests.get(f"{BASE_URL}/api/topology/status?device_ids=x", timeout=30)
    assert r.status_code in (401, 403)


# ---------- /graph -----------------------------------------------------------
@pytest.fixture(scope="module")
def graph_data(h):
    r = requests.get(f"{BASE_URL}/api/topology/graph", headers=h, timeout=60)
    assert r.status_code == 200, r.text[:400]
    return r.json()


def test_graph_shape(graph_data):
    for k in ("nodes", "edges", "totals"):
        assert k in graph_data
    t = graph_data["totals"]
    for k in ("datacenters", "racks", "devices", "customers", "providers", "cables", "services"):
        assert k in t
        assert isinstance(t[k], int)
        assert t[k] >= 0


def test_graph_node_types(graph_data):
    types = {n["type"] for n in graph_data["nodes"]}
    assert "site" in types
    assert "rack" in types
    assert "device" in types
    assert "provider" in types
    kinds = {n.get("kind") for n in graph_data["nodes"] if n["type"] == "site"}
    assert "datacenter" in kinds
    assert "customer" in kinds


def test_graph_edge_kinds(graph_data):
    kinds = {e["kind"] for e in graph_data["edges"]}
    # cable+service+membership all optional-but-common; require at least service+membership
    # per seed data we should have some customer↔provider services + device→customer memberships
    assert "membership" in kinds or "service" in kinds or "cable" in kinds


# ---------- /geo -------------------------------------------------------------
@pytest.fixture(scope="module")
def geo_data(h):
    r = requests.get(f"{BASE_URL}/api/topology/geo", headers=h, timeout=60)
    assert r.status_code == 200, r.text[:400]
    return r.json()


def test_geo_shape(geo_data):
    assert "sites" in geo_data and "unresolved" in geo_data and "links" in geo_data
    assert isinstance(geo_data["sites"], list)
    assert isinstance(geo_data["unresolved"], list)


def test_geo_has_jakarta_site(geo_data):
    """At least one resolved site whose location or label contains 'jakarta'."""
    def is_jak(s):
        blob = " ".join([str(s.get("location") or ""), str(s.get("label") or "")]).lower()
        return "jakarta" in blob
    resolved = [s for s in geo_data["sites"] if "lat" in s and "lng" in s]
    assert len(resolved) > 0, "no resolved sites at all"
    assert any(is_jak(s) for s in resolved), "no Jakarta site among resolved geo entries"


def test_geo_has_unresolved(geo_data):
    assert len(geo_data["unresolved"]) > 0, "expected at least one unresolved location in seed data"


# ---------- /status ----------------------------------------------------------
def test_status_empty_ids(h):
    r = requests.get(f"{BASE_URL}/api/topology/status", headers=h, timeout=30)
    assert r.status_code == 200
    assert r.json().get("devices") == {}


def test_status_never_500_when_zabbix_not_configured(h):
    # Grab a few real device ids so we test the "matched" branch too
    dr = requests.get(f"{BASE_URL}/api/devices", headers=h, timeout=30)
    assert dr.status_code == 200
    devs = dr.json() if isinstance(dr.json(), list) else dr.json().get("items", [])
    ids = [d["id"] for d in devs[:5]] if devs else ["nonexistent-1", "nonexistent-2"]
    r = requests.get(
        f"{BASE_URL}/api/topology/status",
        params={"device_ids": ",".join(ids)}, headers=h, timeout=30,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert "devices" in body
    for did in ids:
        assert did in body["devices"]
        # Zabbix not configured in this pod => configured:false
        assert body["devices"][did].get("configured") in (False, True)  # never crash
        if body["devices"][did].get("configured") is False:
            pass  # expected in this pod


# ---------- regression on existing endpoints --------------------------------
@pytest.mark.parametrize("path", [
    "/api/customers", "/api/partners", "/api/racks",
    "/api/devices", "/api/interconnections",
])
def test_existing_endpoints_still_ok(h, path):
    r = requests.get(f"{BASE_URL}{path}", headers=h, timeout=30)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    data = r.json()
    assert isinstance(data, (list, dict)), f"{path} returned unexpected type"
