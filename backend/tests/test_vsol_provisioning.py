"""VSOL OLT provisioning (write) tests + ZTE regression.

Tests VSOL adapter now supports_provisioning=True and all Preview/dry_run paths
return proper VSOL-style CLI while ZTE remains unchanged.
"""
import os
import pytest
import requests
from urllib.parse import quote

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1]
                break
BASE_URL = BASE_URL.rstrip("/")

ADMIN = ("admin@noc.local", "Admin@123")
TEKNISI = ("teknisi@noc.local", "Teknisi@123")


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(*ADMIN)}"}


@pytest.fixture(scope="module")
def teknisi_headers():
    try:
        return {"Authorization": f"Bearer {_login(*TEKNISI)}"}
    except AssertionError:
        pytest.skip("teknisi unavailable")


@pytest.fixture(scope="module")
def olts(admin_headers):
    """Ensure OLT-VSOL-Test and OLT-ZTE-Test exist; return their ids."""
    r = requests.get(f"{BASE_URL}/api/olt", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    items = r.json().get("items") if isinstance(r.json(), dict) else r.json()
    # Some APIs return list directly, some dict with items
    if isinstance(r.json(), list):
        items = r.json()
    by_name = {o["name"]: o for o in items}
    created = []

    def ensure(name, vendor, model, host, protocol, port):
        if name in by_name:
            return by_name[name]["id"], by_name[name]
        body = {
            "name": name, "vendor": vendor, "model": model,
            "host": host, "protocol": protocol, "port": port,
            "username": "admin", "password": "x", "timeout": 5,
            "poll_interval": 3600, "enabled": False,
        }
        rr = requests.post(f"{BASE_URL}/api/olt", json=body,
                           headers=admin_headers, timeout=15)
        assert rr.status_code == 200, rr.text
        created.append(rr.json()["id"])
        return rr.json()["id"], rr.json()

    vsol_id, vsol_obj = ensure("OLT-VSOL-Test", "VSOL", "V1600G0-B",
                               "10.10.10.9", "ssh", 22)
    zte_id, zte_obj = ensure("OLT-ZTE-Test", "ZTE", "C320",
                             "10.10.10.8", "telnet", 23)
    yield {"vsol": vsol_id, "zte": zte_id,
           "vsol_obj": vsol_obj, "zte_obj": zte_obj}
    # only cleanup what we created
    for oid in created:
        requests.delete(f"{BASE_URL}/api/olt/{oid}",
                        headers=admin_headers, timeout=15)


# ---------------- supports_provisioning flag ----------------

def test_vsol_supports_provisioning_in_list(admin_headers, olts):
    r = requests.get(f"{BASE_URL}/api/olt", headers=admin_headers, timeout=15)
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    match = next((o for o in items if o["id"] == olts["vsol"]), None)
    assert match, "VSOL OLT not in list"
    assert match.get("supports_provisioning") is True, match


def test_vsol_supports_provisioning_in_summary(admin_headers, olts):
    r = requests.get(f"{BASE_URL}/api/olt/{olts['vsol']}/summary",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    olt = j.get("olt") or j
    assert olt.get("supports_provisioning") is True, j


def test_zte_supports_provisioning_still_true(admin_headers, olts):
    r = requests.get(f"{BASE_URL}/api/olt/{olts['zte']}/summary",
                     headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    olt = (r.json().get("olt") or r.json())
    assert olt.get("supports_provisioning") is True


# ---------------- VSOL Preview endpoints ----------------

def test_vsol_authorize_preview(admin_headers, olts):
    body = {"pon": "0/1", "onu_id": "4", "sn": "VSOL12345678",
            "onu_type": "gpononu", "name": "CUST", "dry_run": True}
    r = requests.post(f"{BASE_URL}/api/olt/{olts['vsol']}/provision/authorize",
                      json=body, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    assert j["dry_run"] is True
    cmds = j.get("commands") or []
    assert isinstance(cmds, list) and cmds, j
    joined = "\n".join(cmds)
    assert "interface gpon 0/1" in joined, joined
    assert any(c.startswith("onu add 4") and "sn VSOL" in c for c in cmds), cmds


def test_vsol_reboot_preview(admin_headers, olts):
    idx = quote("GPON0/1:4", safe="")
    r = requests.post(
        f"{BASE_URL}/api/olt/{olts['vsol']}/onu/{idx}/reboot?dry_run=true",
        headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    cmds = j.get("commands") or []
    assert "onu reset 4" in "\n".join(cmds), cmds


def test_vsol_rename_preview(admin_headers, olts):
    idx = quote("GPON0/1:4", safe="")
    r = requests.post(
        f"{BASE_URL}/api/olt/{olts['vsol']}/onu/{idx}/rename",
        json={"name": "X", "dry_run": True},
        headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    cmds = j.get("commands") or []
    assert "onu 4 description X" in "\n".join(cmds), cmds


def test_vsol_delete_preview(admin_headers, olts):
    idx = quote("GPON0/1:4", safe="")
    r = requests.delete(
        f"{BASE_URL}/api/olt/{olts['vsol']}/onu/{idx}/provision?dry_run=true",
        headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    cmds = j.get("commands") or []
    assert "onu del 4" in "\n".join(cmds), cmds


# ---------------- RBAC ----------------

def test_teknisi_blocked_on_vsol_authorize(teknisi_headers, olts):
    body = {"pon": "0/1", "onu_id": "4", "sn": "VSOL12345678", "dry_run": True}
    r = requests.post(f"{BASE_URL}/api/olt/{olts['vsol']}/provision/authorize",
                      json=body, headers=teknisi_headers, timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}: {r.text}"


# ---------------- ZTE regression ----------------

def test_zte_authorize_preview_style(admin_headers, olts):
    body = {"pon": "1/1/1", "onu_id": "5", "sn": "ZTEGC1234567",
            "onu_type": "ZTE-F660", "vlan": "100", "dry_run": True}
    r = requests.post(f"{BASE_URL}/api/olt/{olts['zte']}/provision/authorize",
                      json=body, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    cmds = j.get("commands") or []
    joined = "\n".join(cmds)
    # ZTE-style must remain: gpon-olt_ style, NOT VSOL 'interface gpon 0/1'
    assert "gpon-olt_1/1/1" in joined, joined
    assert "onu 5 " in joined and "sn " in joined.lower(), joined
    assert "interface gpon 0/1" not in joined, "ZTE leaked VSOL style!"
    assert "interface gpon 1/1/1" not in joined  # bare 'interface gpon' is VSOL
