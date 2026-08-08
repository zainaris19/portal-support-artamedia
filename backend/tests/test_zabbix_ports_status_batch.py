"""Tests for /api/zabbix/device/{device_id}/ports-status (batch) endpoint.

Uses FastAPI TestClient with a real admin JWT login and monkeypatches
zabbix_integration._client_from_db to return canned Zabbix items. No real
Zabbix server is required.
"""
import os
import sys
import time
import uuid
import pytest
import requests
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from fastapi.testclient import TestClient

sys.path.insert(0, "/app/backend")

import server  # noqa: E402
import zabbix_integration  # noqa: E402

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://portal-artamedia-run.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN = ("admin@noc.local", "Admin@123")


# ---------- fixtures ---------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def app_client():
    with TestClient(server.app) as c:
        yield c


@pytest.fixture(scope="module")
def sync_db():
    from pymongo import MongoClient
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture
def seeded_device(sync_db):
    dev_id = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    sync_db.devices.insert_one({
        "id": dev_id,
        "name": "TEST_zabbix_device_batch",
        "hostname": "test-host",
        "zabbix_host": "test-host",
    })
    yield dev_id
    sync_db.devices.delete_one({"id": dev_id})


def _make_items(now_ts: int):
    def mk(itemid, name, key_, lastvalue, lastclock, units=""):
        return {
            "itemid": str(itemid),
            "name": name,
            "key_": key_,
            "value_type": 3,
            "units": units,
            "lastvalue": str(lastvalue),
            "lastclock": str(lastclock),
        }
    fresh = now_ts - 20
    return [
        # 10GE1/0/5
        mk(1001, "Interface 10GE1/0/5(to CoreA): Operational status",
           "net.if.status[ifOperStatus.5]", 1, fresh),
        mk(1002, "Interface 10GE1/0/5(to CoreA): Administrative status",
           "net.if.admin[ifAdminStatus.5]", 1, fresh),
        mk(1003, "Interface 10GE1/0/5(to CoreA): Speed",
           "net.if.speed[ifHighSpeed.5]", 10000, fresh, units="Mbps"),
        mk(1004, "Interface 10GE1/0/5(to CoreA): Bits received",
           "net.if.in[ifHCInOctets.5]", 12345678, fresh, units="bps"),
        mk(1005, "Interface 10GE1/0/5(to CoreA): Bits sent",
           "net.if.out[ifHCOutOctets.5]", 87654321, fresh, units="bps"),
        # 40GE1/0/5 — MUST NOT match 10GE1/0/5
        mk(2001, "Interface 40GE1/0/5(uplink): Operational status",
           "net.if.status[ifOperStatus.500]", 2, fresh),
        mk(2002, "Interface 40GE1/0/5(uplink): Administrative status",
           "net.if.admin[ifAdminStatus.500]", 1, fresh),
        mk(2003, "Interface 40GE1/0/5(uplink): Speed",
           "net.if.speed[ifHighSpeed.500]", 40000, fresh, units="Mbps"),
    ]


class FakeClient:
    def __init__(self, items):
        self._items = items

    async def call(self, method, params=None, *, require_auth=True):
        if method == "host.get":
            return [{"hostid": "10123", "host": "test-host", "name": "test-host"}]
        if method == "item.get":
            return self._items
        return []


def _patch_client(monkeypatch, items):
    fake = FakeClient(items)

    async def _fake_client_from_db(db):
        return fake

    monkeypatch.setattr(zabbix_integration, "_client_from_db", _fake_client_from_db)
    return fake


# ---------- 1) endpoint registered ------------------------------------------
def test_openapi_has_ports_status():
    r = requests.get("http://localhost:8001/openapi.json", timeout=15)
    assert r.status_code == 200
    paths = r.json().get("paths", {})
    assert "/api/zabbix/device/{device_id}/ports-status" in paths


# ---------- 2) auth required -------------------------------------------------
def test_ports_status_requires_auth():
    r = requests.get(f"{API}/zabbix/device/does-not-matter/ports-status",
                     params={"ifnames": "10GE1/0/5"}, timeout=15)
    assert r.status_code == 401


# ---------- 3) batch matches 10GE not 40GE, correct speed --------------------
def test_batch_matches_10GE_not_40GE(monkeypatch, app_client, seeded_device, admin_token):
    now_ts = int(time.time())
    _patch_client(monkeypatch, _make_items(now_ts))

    r = app_client.get(
        f"/api/zabbix/device/{seeded_device}/ports-status",
        params={"ifnames": "10GE1/0/5,10GE1/0/6", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "zabbix"
    assert d["configured"] is True
    assert d["hostid"] == "10123"
    ports = d["ports"]
    assert "10GE1/0/5" in ports
    p = ports["10GE1/0/5"]
    assert p["matched"] is True
    # (a) only 10GE items — never 40GE (2001+)
    assert p["item_ids"]["oper"] == "1001"
    assert p["item_ids"]["admin"] == "1002"
    assert p["item_ids"]["speed"] == "1003"
    assert p["item_ids"]["rx"] == "1004"
    assert p["item_ids"]["tx"] == "1005"
    # (b) oper up when lastvalue=1
    assert p["oper_status"]["value"] == "up"
    assert p["oper_status"]["code"] == 1
    assert p["oper_status"]["stale"] is False
    # (c) speed is 10GE (10000) not 40GE (40000)
    assert p["speed"]["value_mbps"] == 10000
    # (d) if_name = 10GE1/0/5 (from name parsing)
    assert p["if_name"].startswith("10GE1/0/5")
    # (e) unmatched ifname
    assert "10GE1/0/6" in ports
    assert ports["10GE1/0/6"] == {"matched": False}


# ---------- 4) numeric/too-short ifnames skipped -----------------------------
def test_short_or_numeric_ifname_skipped(monkeypatch, app_client, seeded_device, admin_token):
    now_ts = int(time.time())
    _patch_client(monkeypatch, _make_items(now_ts))

    r = app_client.get(
        f"/api/zabbix/device/{seeded_device}/ports-status",
        params={"ifnames": "5,ab,10GE1/0/5", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    ports = r.json()["ports"]
    # Skipped names must NOT appear in ports map
    assert "5" not in ports
    assert "ab" not in ports
    assert "10GE1/0/5" in ports
    assert ports["10GE1/0/5"]["matched"] is True


# ---------- 5) stale handling ------------------------------------------------
def test_stale_oper_status_is_unknown(monkeypatch, app_client, seeded_device, admin_token):
    now_ts = int(time.time())
    fresh = now_ts - 5
    stale = now_ts - 600  # 10 min old, polling_interval=60 -> STALE_AFTER=180
    items = [
        {"itemid": "3001", "name": "Interface 10GE1/0/5: Operational status",
         "key_": "net.if.status[ifOperStatus.5]", "value_type": 3, "units": "",
         "lastvalue": "2", "lastclock": str(stale)},
        {"itemid": "3002", "name": "Interface 10GE1/0/5: Administrative status",
         "key_": "net.if.admin[ifAdminStatus.5]", "value_type": 3, "units": "",
         "lastvalue": "1", "lastclock": str(fresh)},
    ]
    _patch_client(monkeypatch, items)
    r = app_client.get(
        f"/api/zabbix/device/{seeded_device}/ports-status",
        params={"ifnames": "10GE1/0/5", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    p = r.json()["ports"]["10GE1/0/5"]
    assert p["oper_status"]["stale"] is True
    # never "down" even though code=2
    assert p["oper_status"]["value"] == "unknown"


# ---------- 6) persistence to devices.zabbix_port_items ---------------------
def test_persistence_zabbix_port_items(monkeypatch, app_client, seeded_device, sync_db, admin_token):
    now_ts = int(time.time())
    _patch_client(monkeypatch, _make_items(now_ts))
    r = app_client.get(
        f"/api/zabbix/device/{seeded_device}/ports-status",
        params={"ifnames": "10GE1/0/5", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    dev = sync_db.devices.find_one({"id": seeded_device}, {"_id": 0})
    zpi = (dev or {}).get("zabbix_port_items", {}).get("10GE1/0/5")
    assert zpi is not None, f"zabbix_port_items missing: {(dev or {}).get('zabbix_port_items')}"
    assert zpi["oper"] == "1001"
    assert zpi["admin"] == "1002"
    assert zpi["speed"] == "1003"
    assert zpi["rx"] == "1004"
    assert zpi["tx"] == "1005"
    assert zpi["hostid"] == "10123"
    assert zpi["if_name"].startswith("10GE1/0/5")
    assert "updated_at" in zpi
