"""VSOL V1600G0-B adapter tests (unit + API lifecycle).

Phase 1 is READ-ONLY. There is NO real OLT hardware; unit tests inject a
FakeTransport implementing the same async contract (run_commands / run_script
/ login / close). API tests only verify graceful behaviour for unreachable
hosts.
"""
from __future__ import annotations
import os
import sys
import pytest
import requests
from typing import Dict, List

# Ensure backend importable
sys.path.insert(0, "/app/backend")

from olt.vendors.vsol.v1600g0b import (  # noqa: E402
    VsolV1600G0BAdapter, parse_state_all, parse_info_all, parse_optical,
    parse_distance, parse_timestamp, parse_deregist_detail, parse_desc,
    parse_eth, parse_running_config_safe,
)
from olt.base import ONU_ONLINE, ONU_DYING_GASP, ONU_OFFLINE, ONU_LOS  # noqa: E402
import asyncio

def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1]
                break
BASE_URL = (BASE_URL or "").rstrip("/")


# --- Fake transport with sample CLI outputs -----------------------------------
SAMPLE = {
    "show onu state": (
        "GPON0/1:1 enable enable working VSOL00b6dffe\n"
        "GPON0/1:4 enable disable dyinggasp VSOL00bd4d65\n"
        "GPON0/1:19 enable disable offline VSOL00b66ed0\n"
        "pon: 1 total: 39 working: 25"
    ),
    "show onu info": (
        "GPON0/1:1\nModel: V711\nProfile: default\nMode: sn\nSN: VSOL00b6dffe"
    ),
    "show onu 1 detail-info": (
        "Vendor ID: VSOL\nVersion: V4.2\nSN: VSOL00b6dffe\n"
        "Equipment ID: VSOLV711\nOperate status: enable\nSysUpTime: 310159 s"
    ),
    "show onu 1 optical_info": (
        "Rx optical level(ONU)      : -23.37\n"
        "Rx optical level(OLT)      : -36.00\n"
        "Tx optical level           : 2.07\n"
        "Power feed voltage         : 3.24(V)\n"
        "Laser bias current         : 12.250(mA)\n"
        "Temperature                : 45.996(C)"
    ),
    "show onu 1 distance": "onu 1 Distance: 6370m",
    "show onu 1 time-stamp": (
        "last regist:\n2026:08:06 8:5:33\n"
        "last deregist:\n2026:08:05 23:30:54\n"
        "reason:\nPower Off\n"
        "alive time:\n3 14:10:06"
    ),
    "show onu 1 time-stamp deregist-detail": (
        "2026:08:05 23:30:54 Power Off\n2026:08:04 10:00:00 Onu Los"
    ),
    "show onu 1 desc": "onu 1 Description:\n109250063_Reza_F_Z",
    "show onu 1 eth 1": (
        "Speed status: full-100\nAdmin status: enable\nLink status: up\n"
        "Speed config: auto\nBridge or IP: l2"
    ),
    "show onu 1 profile": (
        "description 109250063_Reza_F_Z\n"
        "profile default\n"
        "service 1 vlan 100\n"
        "tr069 vlan 90\n"
        "pppoe username reza@isp password secret123\n"
        "wifi ssid MyWifi shared-key MyKey123"
    ),
    "configure terminal": "",
    "interface gpon 0/1": "",
    "end": "",
    "show version": "System Version: V1.4.6R\n",
}


class FakeTransport:
    def __init__(self, mapping: Dict[str, str]):
        self.mapping = mapping
        self.calls: List[str] = []

    async def login(self):
        return None

    async def close(self):
        return None

    async def run_commands(self, cmds: List[str]) -> Dict[str, str]:
        self.calls.extend(cmds)
        return {c: self.mapping.get(c, "") for c in cmds}

    async def run_script(self, cmds: List[str]) -> str:
        self.calls.extend(cmds)
        return "\n".join(self.mapping.get(c, "") for c in cmds)


# --- Adapter unit tests -------------------------------------------------------
def test_get_onu_states_distinct_statuses():
    a = VsolV1600G0BAdapter(FakeTransport(SAMPLE), {"id": "x"})
    rows = _run(a.get_onu_states())
    by_idx = {r["onu_index"]: r for r in rows}
    assert "GPON0/1:1" in by_idx and by_idx["GPON0/1:1"]["status"] == ONU_ONLINE
    assert "GPON0/1:4" in by_idx and by_idx["GPON0/1:4"]["status"] == ONU_DYING_GASP
    assert "GPON0/1:19" in by_idx and by_idx["GPON0/1:19"]["status"] == ONU_OFFLINE
    # merged model/serial from info
    assert by_idx["GPON0/1:1"]["model"] == "V711"
    assert by_idx["GPON0/1:1"]["serial_number"] == "VSOL00b6dffe"


def test_get_onu_detail_normalized_fields():
    a = VsolV1600G0BAdapter(FakeTransport(SAMPLE), {"id": "x"})
    d = _run(a.get_onu_detail("GPON0/1:1"))
    assert d["rx_power"] == -23.37
    assert d["olt_rx_power"] == -36.0
    assert d["tx_power"] == 2.07
    assert d["temperature"] is not None and abs(d["temperature"] - 45.996) < 1e-3
    assert d["distance"] == 6370 or d.get("distance_m") == 6370
    assert d["name"] == "109250063_Reza_F_Z"
    assert d["serial_number"] == "VSOL00b6dffe"
    assert d.get("online_time") and "2026:08:06" in str(d["online_time"])
    assert d.get("offline_time") and "2026:08:05" in str(d["offline_time"])
    assert d.get("offline_cause") and "Power Off" in str(d["offline_cause"])
    # deregist history normalized
    hist = d.get("deregist_history") or []
    assert len(hist) >= 2
    reasons = {h.get("reason") for h in hist}
    assert "LOS" in reasons and "POWER_OFF" in reasons
    # eth block
    assert isinstance(d.get("eth"), dict) and d["eth"].get("link_status") == "up"
    # profile / vlan safely parsed
    assert d.get("profile") == "default"
    assert d.get("internet_vlan") == 100
    assert d.get("tr069_vlan") == 90


def test_no_credentials_leak_in_detail_or_running_config():
    a = VsolV1600G0BAdapter(FakeTransport(SAMPLE), {"id": "x"})
    d = _run(a.get_onu_detail("GPON0/1:1"))
    rc = _run(a.get_onu_running_config("GPON0/1:1"))

    import json
    hay = (json.dumps(d, default=str) + "\n" + json.dumps(rc, default=str)).lower()
    for secret in ("secret123", "mykey123", "shared-key", "password", "pppoe"):
        assert secret.lower() not in hay, f"credential/secret leaked: {secret}"


def test_parse_running_config_safe_drops_secrets():
    text = (
        "profile default\nservice 1 vlan 100\ntr069 vlan 90\n"
        "pppoe password secret123\nwifi shared-key MyKey123"
    )
    cfg = parse_running_config_safe(text)
    dump = str(cfg).lower()
    assert "secret123" not in dump
    assert "mykey123" not in dump
    assert cfg["profile"] == "default"
    assert cfg["tr069_vlan"] == 90


# --- API lifecycle tests ------------------------------------------------------
ADMIN_EMAIL = "admin@noc.local"
ADMIN_PW = "Admin@123"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    return {"Authorization": f"Bearer {tok}"}


def test_catalog_contains_vsol_and_zte(admin_headers):
    r = requests.get(f"{BASE_URL}/api/olt/catalog", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    # payload may be either list of vendors or {"vendors":[...]}
    vendors = j if isinstance(j, list) else (j.get("vendors") or j.get("items") or [])
    by = {v["vendor"].upper(): v for v in vendors}
    assert "VSOL" in by and "ZTE" in by
    vsol_models = {m["model"]: m for m in by["VSOL"]["models"]}
    assert "V1600G0-B" in vsol_models
    m = vsol_models["V1600G0-B"]
    assert m.get("implemented") is True
    assert "ssh" in [p.lower() for p in m.get("protocols", [])]
    assert m.get("software_tested") == "V1.4.6R"
    assert (m.get("tech") or "").upper() == "GPON"
    # ZTE still implemented + telnet
    zte_c320 = next(m for m in by["ZTE"]["models"] if m["model"] == "C320")
    assert zte_c320.get("implemented") is True
    assert "telnet" in [p.lower() for p in zte_c320.get("protocols", [])]
    # HIOSO / BDCOM still not implemented
    if "HIOSO" in by:
        assert all(not m.get("implemented") for m in by["HIOSO"]["models"])
    if "BDCOM" in by:
        assert all(not m.get("implemented") for m in by["BDCOM"]["models"])


@pytest.fixture()
def vsol_olt_id(admin_headers):
    payload = {
        "name": "TEST_OLT_VSOL", "vendor": "VSOL", "model": "V1600G0-B",
        "host": "10.88.88.88", "protocol": "ssh", "port": 22,
        "username": "admin", "password": "x", "enable_password": "y",
        "timeout": 6, "poll_interval": 3600, "enabled": False,
    }
    r = requests.post(f"{BASE_URL}/api/olt", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    yield oid
    requests.delete(f"{BASE_URL}/api/olt/{oid}", headers=admin_headers, timeout=15)


def test_vsol_summary_flags_provisioning_enabled(admin_headers, vsol_olt_id):
    r = requests.get(f"{BASE_URL}/api/olt/{vsol_olt_id}/summary",
                     headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    olt = j.get("olt") or {}
    # phase 2: VSOL provisioning is now enabled
    assert olt.get("supports_provisioning") is True
    # connected should be false since host unreachable
    assert olt.get("connected") in (False, None)


def test_vsol_poll_graceful_no_500(admin_headers, vsol_olt_id):
    r = requests.post(f"{BASE_URL}/api/olt/{vsol_olt_id}/poll",
                      headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is False
    assert j.get("error") or j.get("message")


def test_vsol_provision_authorize_preview(admin_headers, vsol_olt_id):
    body = {"pon": "0/1", "onu_id": "1", "sn": "VSOL00b6dffe", "onu_type": "gpononu", "dry_run": True}
    r = requests.post(f"{BASE_URL}/api/olt/{vsol_olt_id}/provision/authorize",
                      json=body, headers=admin_headers, timeout=20)
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
    j = r.json()
    assert j.get("ok") is True and j.get("dry_run") is True
    cmds = "\n".join(j.get("commands") or [])
    assert "interface gpon 0/1" in cmds
    assert "onu add 1" in cmds and "sn VSOL00b6dffe" in cmds


def test_vsol_reboot_preview(admin_headers, vsol_olt_id):
    from urllib.parse import quote
    idx = quote("GPON0/1:1", safe="")
    r = requests.post(f"{BASE_URL}/api/olt/{vsol_olt_id}/onu/{idx}/reboot?dry_run=true",
                      headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert "onu reset 1" in "\n".join(j.get("commands") or [])


def test_vsol_rename_preview(admin_headers, vsol_olt_id):
    from urllib.parse import quote
    idx = quote("GPON0/1:1", safe="")
    r = requests.post(f"{BASE_URL}/api/olt/{vsol_olt_id}/onu/{idx}/rename",
                      json={"name": "TEST", "dry_run": True},
                      headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert "onu 1 description TEST" in "\n".join(j.get("commands") or [])


def test_vsol_delete_provision_preview(admin_headers, vsol_olt_id):
    from urllib.parse import quote
    idx = quote("GPON0/1:1", safe="")
    r = requests.delete(f"{BASE_URL}/api/olt/{vsol_olt_id}/onu/{idx}/provision?dry_run=true",
                        headers=admin_headers, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert "onu del 1" in "\n".join(j.get("commands") or [])


# --- ZTE regression -----------------------------------------------------------
def test_zte_c320_provisioning_still_works(admin_headers):
    payload = {
        "name": "TEST_OLT_ZTE_reg", "vendor": "ZTE", "model": "C320",
        "host": "10.99.99.99", "protocol": "telnet", "port": 23,
        "username": "admin", "password": "x", "timeout": 5,
        "poll_interval": 3600, "enabled": False,
    }
    r = requests.post(f"{BASE_URL}/api/olt", json=payload, headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    try:
        # ensure provisioning enabled globally
        requests.put(f"{BASE_URL}/api/olt/provision/settings",
                     json={"enabled": True}, headers=admin_headers, timeout=15)
        body = {"pon": "1/1/1", "onu_id": "5", "sn": "ZTEG12345678",
                "onu_type": "ZTE-F660", "vlan": "100", "dry_run": True}
        r = requests.post(f"{BASE_URL}/api/olt/{oid}/provision/authorize",
                          json=body, headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("dry_run") is True
        assert isinstance(j.get("commands"), list) and len(j["commands"]) > 0
        # ZTE summary should indicate supports_provisioning True
        s = requests.get(f"{BASE_URL}/api/olt/{oid}/summary",
                         headers=admin_headers, timeout=15).json()
        assert (s.get("olt") or {}).get("supports_provisioning") is True
    finally:
        requests.delete(f"{BASE_URL}/api/olt/{oid}", headers=admin_headers, timeout=15)
