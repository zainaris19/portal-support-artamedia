"""GenieACS lightweight list + rich detail integration tests.

Iteration 2: verifies the projection-based list/summary path never returns HTTP 500
even for a device with no parameter tree, pagination + search work, cluster
derivation includes free-form tags (e.g. 'Goodnet Deniang'), and rich detail is
fetched only per-device.
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@noc.local"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


# ---- Summary ---------------------------------------------------------------
def test_summary_connected_and_total(client):
    r = client.get(f"{API}/genieacs/summary", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["connected"] is True, j
    s = j["summary"]
    assert s["total"] == 9, s
    # heavy metrics not computed in lightweight path
    assert s.get("poor_optical") is None
    assert s.get("total_wifi_client") is None
    # clusters include free-form 'Goodnet Deniang'
    labels = {c["label"] for c in j["clusters"]}
    assert "Goodnet Deniang" in labels, labels


# ---- Device list -----------------------------------------------------------
def test_device_list_default_page(client):
    r = client.get(f"{API}/genieacs/devices", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["connected"] is True
    assert j["total"] == 9
    assert j["limit"] == 20
    assert isinstance(j["items"], list) and len(j["items"]) == 9
    for d in j["items"]:
        assert "id" in d and "serial" in d and "status" in d
        # metadata rows never contain the massive parameter tree
        assert "wlan" not in d and "lan_clients" not in d


def test_device_list_pagination_limit(client):
    r = client.get(f"{API}/genieacs/devices", params={"limit": 5, "page": 1}, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j["limit"] == 5 and j["page"] == 1
    assert len(j["items"]) == 5
    r2 = client.get(f"{API}/genieacs/devices", params={"limit": 5, "page": 2}, timeout=30)
    j2 = r2.json()
    assert len(j2["items"]) == 4
    # different items across pages
    ids1 = {d["id"] for d in j["items"]}
    ids2 = {d["id"] for d in j2["items"]}
    assert ids1.isdisjoint(ids2)


def test_device_list_search_by_serial(client):
    r = client.get(f"{API}/genieacs/devices", params={"q": "HWTC0001"}, timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    assert any((d.get("serial") or "").upper() == "HWTC0001" for d in items)


def test_device_list_search_by_manufacturer(client):
    r = client.get(f"{API}/genieacs/devices", params={"q": "vsol"}, timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    assert any("vsol" in (d.get("manufacturer") or "").lower() for d in items)


def test_device_list_status_filter(client):
    r = client.get(f"{API}/genieacs/devices", params={"status": "Offline"}, timeout=30)
    assert r.status_code == 200
    j = r.json()
    for d in j["items"]:
        assert d["status"] == "Offline"


# ---- Detail: rich, per-device, never 500 -----------------------------------
def test_device_detail_bare_device_no_500(client):
    """Device with NO parameter tree must not cause 500."""
    r = client.get(f"{API}/genieacs/devices/BARE-DEVICE-0001", timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    j = r.json()
    assert j.get("serial") == "BARE0001" or j.get("id") == "BARE-DEVICE-0001"
    # missing rich fields degrade to None/empty, not error
    assert j.get("ssid") in (None, "")
    assert j.get("rx_optical") in (None,)


def test_device_detail_normal_device_rich(client):
    # find a device with serial HWTC0001
    lst = client.get(f"{API}/genieacs/devices", params={"q": "HWTC0001"}, timeout=30).json()
    assert lst["items"], "HWTC0001 not found in list"
    device_id = lst["items"][0]["id"]
    r = client.get(f"{API}/genieacs/devices/{device_id}", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    # rich sections should be present as keys (may be empty depending on tree)
    for k in ("wlan", "lan_clients", "wan_ip", "rx_optical", "ssid", "wifi_clients", "mode"):
        assert k in j, f"missing key {k}"


def test_device_detail_unknown_404(client):
    r = client.get(f"{API}/genieacs/devices/DOES-NOT-EXIST-XYZ", timeout=30)
    assert r.status_code == 404


# ---- Cluster filter (free-form tag) ----------------------------------------
def test_cluster_filter_goodnet_deniang(client):
    r = client.get(f"{API}/genieacs/devices", params={"cluster": "Goodnet Deniang"}, timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) >= 1
    for d in items:
        assert "Goodnet Deniang" in (d.get("cluster_tags") or []) or "Goodnet Deniang" in (d.get("tags") or [])


# ---- Faults ----------------------------------------------------------------
def test_faults_endpoint(client):
    r = client.get(f"{API}/genieacs/faults", timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "items" in j and "total" in j
