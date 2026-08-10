"""Backend tests for OLT provisioning endpoints (dry-run + gate)."""
import os
import time
import pytest
import requests
from urllib.parse import quote

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fallback: read from frontend/.env directly
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1]
                break
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "admin@noc.local"
ADMIN_PW = "Admin@123"
TEKNISI_EMAIL = "teknisi@noc.local"
TEKNISI_PW = "Teknisi@123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"] if "access_token" in r.json() else r.json().get("token")


@pytest.fixture(scope="module")
def teknisi_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": TEKNISI_EMAIL, "password": TEKNISI_PW}, timeout=15)
    if r.status_code != 200:
        pytest.skip("teknisi account not available")
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def olt_id(admin_headers):
    payload = {
        "name": "TEST_OLT_prov", "vendor": "ZTE", "model": "C320",
        "host": "10.99.99.99", "protocol": "telnet", "port": 23,
        "username": "admin", "password": "x", "timeout": 5, "poll_interval": 3600,
        "enabled": False,  # avoid poller hitting it
    }
    r = requests.post(f"{BASE_URL}/api/olt", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    yield oid
    # cleanup
    requests.delete(f"{BASE_URL}/api/olt/{oid}", headers=admin_headers, timeout=15)


def test_prov_settings_get_default_enabled(admin_headers):
    r = requests.get(f"{BASE_URL}/api/olt/provision/settings", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    assert "enabled" in r.json()


def test_prov_settings_toggle_persists(admin_headers):
    # set false then true
    r = requests.put(f"{BASE_URL}/api/olt/provision/settings",
                     json={"enabled": False}, headers=admin_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["enabled"] is False
    r = requests.get(f"{BASE_URL}/api/olt/provision/settings", headers=admin_headers, timeout=15)
    assert r.json()["enabled"] is False
    # restore
    r = requests.put(f"{BASE_URL}/api/olt/provision/settings",
                     json={"enabled": True}, headers=admin_headers, timeout=15)
    assert r.json()["enabled"] is True


def test_prov_profile_crud(admin_headers):
    body = {
        "name": "TEST_profile_1", "vendor": "ZTE", "model": "C320",
        "onu_type": "ZTE-F660", "vlan": "100",
        "command_template": "onu {onuid} type {onu_type} sn {sn}",
    }
    r = requests.post(f"{BASE_URL}/api/olt/provision/profiles",
                      json=body, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # list
    r = requests.get(f"{BASE_URL}/api/olt/provision/profiles", headers=admin_headers, timeout=15)
    assert any(p["id"] == pid for p in r.json()["items"])
    # update
    body2 = {**body, "name": "TEST_profile_1_upd", "vlan": "200"}
    r = requests.put(f"{BASE_URL}/api/olt/provision/profiles/{pid}",
                     json=body2, headers=admin_headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["vlan"] == "200"
    # delete
    r = requests.delete(f"{BASE_URL}/api/olt/provision/profiles/{pid}",
                        headers=admin_headers, timeout=15)
    assert r.status_code == 200


def test_authorize_dry_run(admin_headers, olt_id):
    body = {"pon": "1/1/1", "onu_id": "5", "sn": "ZTEG12345678",
            "onu_type": "ZTE-F660", "vlan": "100", "dry_run": True}
    r = requests.post(f"{BASE_URL}/api/olt/{olt_id}/provision/authorize",
                      json=body, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert j.get("dry_run") is True
    assert isinstance(j.get("commands"), list) and len(j["commands"]) > 0


def test_reboot_dry_run(admin_headers, olt_id):
    idx = quote("1/1/1:5", safe="")
    r = requests.post(f"{BASE_URL}/api/olt/{olt_id}/onu/{idx}/reboot?dry_run=true",
                      headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert isinstance(j.get("commands"), list) and len(j["commands"]) > 0


def test_rename_dry_run(admin_headers, olt_id):
    idx = quote("1/1/1:5", safe="")
    r = requests.post(f"{BASE_URL}/api/olt/{olt_id}/onu/{idx}/rename",
                      json={"name": "TEST_ONU_RENAMED", "dry_run": True},
                      headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert isinstance(j.get("commands"), list) and len(j["commands"]) > 0


def test_delete_dry_run(admin_headers, olt_id):
    idx = quote("1/1/1:5", safe="")
    r = requests.delete(f"{BASE_URL}/api/olt/{olt_id}/onu/{idx}/provision?dry_run=true",
                        headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert isinstance(j.get("commands"), list) and len(j["commands"]) > 0


def test_gate_returns_403_when_disabled(admin_headers, olt_id):
    # disable
    r = requests.put(f"{BASE_URL}/api/olt/provision/settings",
                     json={"enabled": False}, headers=admin_headers, timeout=15)
    assert r.status_code == 200
    try:
        body = {"pon": "1/1/1", "onu_id": "5", "sn": "ZTEG12345678", "dry_run": False}
        r = requests.post(f"{BASE_URL}/api/olt/{olt_id}/provision/authorize",
                          json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"
        idx = quote("1/1/1:5", safe="")
        r = requests.post(f"{BASE_URL}/api/olt/{olt_id}/onu/{idx}/reboot",
                          headers=admin_headers, timeout=15)
        assert r.status_code == 403
    finally:
        # restore
        requests.put(f"{BASE_URL}/api/olt/provision/settings",
                     json={"enabled": True}, headers=admin_headers, timeout=15)


def test_teknisi_cannot_provision(teknisi_token, olt_id):
    headers = {"Authorization": f"Bearer {teknisi_token}"}
    body = {"pon": "1/1/1", "onu_id": "5", "sn": "ZTEG12345678", "dry_run": True}
    r = requests.post(f"{BASE_URL}/api/olt/{olt_id}/provision/authorize",
                      json=body, headers=headers, timeout=15)
    assert r.status_code in (401, 403), f"teknisi should not access: {r.status_code}"
