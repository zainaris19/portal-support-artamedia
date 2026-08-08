"""Tests for /api/zabbix/device/{device_id}/port-status endpoint.

Uses FastAPI TestClient with a real admin JWT login and monkeypatches
ZabbixClient.call to return canned Zabbix items. No real Zabbix server.
"""
import os
import sys
import time
import uuid
import asyncio
import pytest
import requests
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from fastapi.testclient import TestClient

# Ensure backend on path
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
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- 1) Endpoint registered in OpenAPI --------------------------------
def test_openapi_has_port_status():
    # openapi is served at backend root (port 8001), not through ingress prefix
    r = requests.get("http://localhost:8001/openapi.json", timeout=15)
    assert r.status_code == 200
    paths = r.json().get("paths", {})
    assert "/api/zabbix/device/{device_id}/port-status" in paths


# ---------- 2) Unauthenticated returns 401 -----------------------------------
def test_port_status_requires_auth():
    r = requests.get(f"{API}/zabbix/device/does-not-matter/port-status",
                     params={"ifname": "10GE1/0/5"}, timeout=15)
    assert r.status_code == 401


# ---------- 3) Zabbix not configured returns 400 -----------------------------
def test_port_status_zabbix_not_configured(admin_headers):
    # ensure zabbix config is not set (fresh deploy) — try any device id
    # find any existing device
    dr = requests.get(f"{API}/devices", headers=admin_headers, timeout=15).json()
    items = dr.get("items") or []
    if not items:
        pytest.skip("no devices to test against")
    dev_id = items[0]["id"]
    r = requests.get(f"{API}/zabbix/device/{dev_id}/port-status",
                     params={"ifname": "10GE1/0/5"}, headers=admin_headers, timeout=15)
    # In current pod Zabbix is not configured => 400
    if r.status_code == 400:
        assert "Zabbix belum di-konfigurasi" in r.text
    else:
        # If someone configured Zabbix, it's ok — just make sure not 500
        assert r.status_code != 500, r.text


# ---------- Direct in-process tests with monkeypatched ZabbixClient ----------

def _make_items(now_ts: int):
    """Two candidate interfaces (10GE1/0/5 and 40GE1/0/5) with full metric set."""
    def mk(itemid, name, key_, lastvalue, lastclock, value_type=3, units="bps"):
        return {
            "itemid": str(itemid),
            "name": name,
            "key_": key_,
            "value_type": value_type,
            "units": units,
            "lastvalue": str(lastvalue),
            "lastclock": str(lastclock),
        }

    fresh = now_ts - 30  # within polling window (30s < 60*3)
    stale = now_ts - 600  # 10 min old => stale
    return [
        # 10GE1/0/5 — the target interface
        mk(1001, "Interface 10GE1/0/5(to CoreA): Operational status",
           "net.if.status[ifOperStatus.5]", 1, fresh, value_type=3, units=""),
        mk(1002, "Interface 10GE1/0/5(to CoreA): Administrative status",
           "net.if.admin[ifAdminStatus.5]", 1, fresh, value_type=3, units=""),
        mk(1003, "Interface 10GE1/0/5(to CoreA): Speed",
           "net.if.speed[ifHighSpeed.5]", 10000, fresh, value_type=3, units="Mbps"),
        mk(1004, "Interface 10GE1/0/5(to CoreA): Bits received",
           "net.if.in[ifHCInOctets.5]", 12345678, fresh, value_type=3, units="bps"),
        mk(1005, "Interface 10GE1/0/5(to CoreA): Bits sent",
           "net.if.out[ifHCOutOctets.5]", 87654321, fresh, value_type=3, units="bps"),
        # 40GE1/0/5 — MUST NOT match a 10GE1/0/5 request
        mk(2001, "Interface 40GE1/0/5(uplink): Operational status",
           "net.if.status[ifOperStatus.500]", 2, fresh, value_type=3, units=""),
        mk(2002, "Interface 40GE1/0/5(uplink): Administrative status",
           "net.if.admin[ifAdminStatus.500]", 1, fresh, value_type=3, units=""),
        mk(2003, "Interface 40GE1/0/5(uplink): Bits received",
           "net.if.in[ifHCInOctets.500]", 11, fresh, value_type=3, units="bps"),
    ], fresh, stale


class FakeClient:
    def __init__(self, items):
        self._items = items
        self.calls = []

    async def call(self, method, params=None, *, require_auth=True):
        self.calls.append((method, params))
        if method == "host.get":
            return [{"hostid": "10123", "host": "test-host", "name": "test-host"}]
        if method == "item.get":
            return self._items
        return []


@pytest.fixture(scope="module")
def app_client():
    # Context manager triggers @app.on_event("startup") which sets app.state.db
    with TestClient(server.app) as c:
        yield c


@pytest.fixture(scope="module")
def sync_db():
    from pymongo import MongoClient
    mongo_url = os.environ.get("MONGO_URL") or os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME") or os.environ["DB_NAME"]
    return MongoClient(mongo_url)[db_name]


@pytest.fixture
def seeded_device(app_client, sync_db):
    """Insert a synthetic device with zabbix_host and return id. Cleanup after."""
    dev_id = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    sync_db.devices.insert_one({
        "id": dev_id,
        "name": "TEST_zabbix_device",
        "hostname": "test-host",
        "zabbix_host": "test-host",
    })
    yield dev_id
    sync_db.devices.delete_one({"id": dev_id})


def _patch_client(monkeypatch, items):
    fake = FakeClient(items)

    async def _fake_client_from_db(db):
        return fake

    monkeypatch.setattr(zabbix_integration, "_client_from_db", _fake_client_from_db)
    return fake


def test_matches_10GE_not_40GE(monkeypatch, app_client, seeded_device, admin_token):
    now_ts = int(time.time())
    items, fresh, _ = _make_items(now_ts)
    _patch_client(monkeypatch, items)

    r = app_client.get(
        f"/api/zabbix/device/{seeded_device}/port-status",
        params={"ifname": "10GE1/0/5", "alt": "10GE1/0/5", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "zabbix"
    assert d["configured"] is True
    assert d["matched"] is True
    assert d["hostid"] == "10123"
    # Correct item selected — 10GE (1001) not 40GE (2001)
    assert d["item_ids"]["oper"] == "1001", f"expected 1001 got {d['item_ids']}"
    assert d["item_ids"]["admin"] == "1002"
    assert d["item_ids"]["speed"] == "1003"
    assert d["item_ids"]["rx"] == "1004"
    assert d["item_ids"]["tx"] == "1005"
    # oper_status.value should be "up" (code 1) — fresh, so not stale
    assert d["oper_status"]["value"] == "up"
    assert d["oper_status"]["code"] == 1
    assert d["oper_status"]["stale"] is False
    assert d["admin_status"]["value"] == "up"
    # Speed in Mbps
    assert d["speed"]["value_mbps"] == 10000
    # last_update present
    assert d["last_update"] is not None


def test_numeric_ifname_rejected(monkeypatch, app_client, seeded_device, admin_token):
    now_ts = int(time.time())
    items, _, _ = _make_items(now_ts)
    _patch_client(monkeypatch, items)

    r = app_client.get(
        f"/api/zabbix/device/{seeded_device}/port-status",
        params={"ifname": "5", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    # Purely numeric candidate must not match anything
    assert d["matched"] is False, f"numeric '5' should not match, got {d.get('item_ids')}"
    assert all(v is None for v in d["item_ids"].values())


def test_stale_oper_status_is_unknown(monkeypatch, app_client, seeded_device, admin_token):
    now_ts = int(time.time())
    # Build items where oper is very old (stale), others fresh
    fresh = now_ts - 10
    stale = now_ts - 600
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
        f"/api/zabbix/device/{seeded_device}/port-status",
        params={"ifname": "10GE1/0/5", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    # oper code=2 would map to "down" if fresh; stale => "unknown"
    assert d["oper_status"]["stale"] is True
    assert d["oper_status"]["value"] == "unknown", f"stale should be unknown, got {d['oper_status']}"
    # admin is fresh
    assert d["admin_status"]["value"] == "up"
    assert d["admin_status"]["stale"] is False


def test_ifoperstatus_mapping(monkeypatch, app_client, seeded_device, admin_token):
    """Verify 1..7 mapping — up/down/testing/unknown/dormant/notPresent/lowerLayerDown"""
    now_ts = int(time.time())
    expected = {1: "up", 2: "down", 3: "testing", 4: "unknown",
                5: "dormant", 6: "notPresent", 7: "lowerLayerDown"}
    for code, name in expected.items():
        items = [
            {"itemid": f"90{code}", "name": "Interface 10GE1/0/9: Operational status",
             "key_": f"net.if.status[ifOperStatus.9]", "value_type": 3, "units": "",
             "lastvalue": str(code), "lastclock": str(now_ts - 5)},
        ]
        _patch_client(monkeypatch, items)
        r = app_client.get(
            f"/api/zabbix/device/{seeded_device}/port-status",
            params={"ifname": "10GE1/0/9", "polling_interval": 60},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 200
        assert r.json()["oper_status"]["value"] == name, f"code {code} => {name}"


def test_persistence_to_device_document(monkeypatch, app_client, seeded_device, sync_db, admin_token):
    now_ts = int(time.time())
    items, _, _ = _make_items(now_ts)
    _patch_client(monkeypatch, items)

    r = app_client.get(
        f"/api/zabbix/device/{seeded_device}/port-status",
        params={"ifname": "10GE1/0/5", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text

    dev = sync_db.devices.find_one({"id": seeded_device}, {"_id": 0})

    zpi = (dev or {}).get("zabbix_port_items", {}).get("10GE1/0/5")
    assert zpi is not None, f"zabbix_port_items missing: {dev.get('zabbix_port_items')}"
    assert zpi["oper"] == "1001"
    assert zpi["admin"] == "1002"
    assert zpi["speed"] == "1003"
    assert zpi["rx"] == "1004"
    assert zpi["tx"] == "1005"
    assert zpi["hostid"] == "10123"
    assert "updated_at" in zpi


def test_response_shape(monkeypatch, app_client, seeded_device, admin_token):
    now_ts = int(time.time())
    items, _, _ = _make_items(now_ts)
    _patch_client(monkeypatch, items)
    r = app_client.get(
        f"/api/zabbix/device/{seeded_device}/port-status",
        params={"ifname": "10GE1/0/5", "polling_interval": 60},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    d = r.json()
    for k in ("configured", "matched", "host", "hostid", "ifname", "if_name",
              "polling_interval", "oper_status", "admin_status", "speed",
              "rx", "tx", "last_update", "source", "item_ids"):
        assert k in d, f"missing {k}"
    assert d["source"] == "zabbix"
    for sub in ("value", "code", "itemid", "lastclock", "stale"):
        assert sub in d["oper_status"]
        assert sub in d["admin_status"]
    assert "value_mbps" in d["speed"]
    for direction in ("rx", "tx"):
        for sub in ("value", "itemid", "lastclock", "stale"):
            assert sub in d[direction]
    for k in ("oper", "admin", "speed", "rx", "tx"):
        assert k in d["item_ids"]
