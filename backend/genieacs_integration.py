"""GenieACS NBI integration for Portal Support.

Portal Support acts ONLY as an integration/viewer layer over an EXISTING
GenieACS server via its Northbound Interface (NBI) REST API. We never install
GenieACS and never touch its MongoDB directly.

Architecture (two-level data fetching)
--------------------------------------
* **Device List / Summary** use a *minimal metadata projection*
  (``_id,_deviceId,_lastInform,_lastBoot,_registered,_tags``) so we never pull
  the multi-megabyte TR-069 parameter tree for a table row. Filtering, search
  and pagination happen in the backend over a short-TTL cached lightweight
  index (metadata only — tiny even for thousands of ONT).
* **Device Detail** is the ONLY endpoint that fetches richer parameters, and
  only for the single device the user opened.
* A vendor-agnostic Parameter Resolver with fallbacks (TR-098 / TR-181 /
  vendor-specific) is used; a missing parameter returns ``None`` / "-" and never
  raises. One oddly-structured device can never break the whole table.
* Credentials are stored encrypted (Fernet, reusing the IPAM key) and never
  returned to the frontend.
* When GenieACS is unreachable the endpoints degrade gracefully
  (``connected: False`` + a clear error) instead of returning a bare HTTP 500.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlparse

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("noc.genieacs")


# ---------------------------------------------------------------------------
# Fernet key (reuse the IPAM key so we don't proliferate secrets)
# ---------------------------------------------------------------------------
async def _get_cipher(db) -> Fernet:
    doc = await db.system_config.find_one({"_id": "ipam_key"})
    if doc and doc.get("key"):
        return Fernet(doc["key"].encode())
    key = Fernet.generate_key().decode()
    await db.system_config.update_one(
        {"_id": "ipam_key"},
        {"$set": {"key": key, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return Fernet(key.encode())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask(v: str) -> str:
    if not v:
        return ""
    if len(v) <= 3:
        return "***"
    return v[:2] + "…" + v[-1:]


DEFAULT_PORT = 7557
DEFAULT_PREFIX = "CLUSTER:"
DEFAULT_ONLINE_MIN = 10
DEFAULT_WARNING_MIN = 30
POOR_OPTICAL_DBM = -27.0
IGD = "InternetGatewayDevice"

# List/summary: METADATA ONLY — never the parameter tree.
LIGHT_PROJECTION = ["_id", "_deviceId", "_lastInform", "_lastBoot", "_registered", "_tags"]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class GenieConfigIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    host: str
    port: int = Field(DEFAULT_PORT, ge=1, le=65535)
    username: Optional[str] = None
    password: Optional[str] = None
    verify_ssl: bool = True
    enabled: bool = True
    timeout: int = Field(15, ge=3, le=120)
    cluster_prefix: str = DEFAULT_PREFIX
    cluster_mode: str = "prefix"            # prefix | manual
    manual_cluster_tags: List[str] = []
    online_max_min: int = Field(DEFAULT_ONLINE_MIN, ge=1, le=1440)
    warning_max_min: int = Field(DEFAULT_WARNING_MIN, ge=1, le=1440)


class WifiChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slot: int = Field(1, ge=1, le=8)
    ssid: str = Field(min_length=1, max_length=64)
    password: Optional[str] = None


class PppoeChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=128)
    password: Optional[str] = None


class MappingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    service_id: Optional[str] = None
    device_id: str
    serial: Optional[str] = None
    pppoe: Optional[str] = None


# ---------------------------------------------------------------------------
# NBI client
# ---------------------------------------------------------------------------
class GenieClient:
    def __init__(self, base_url: str, username: str = "", password: str = "",
                 verify_ssl: bool = True, timeout: int = 15):
        self.base_url = base_url.rstrip("/")
        self.auth = (username, password) if username else None
        self.verify = verify_ssl
        self.timeout = httpx.Timeout(connect=5, read=timeout, write=timeout, pool=5)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, auth=self.auth,
                                 verify=self.verify, timeout=self.timeout)

    async def get_devices(self, query: Optional[dict] = None,
                          projection: Optional[List[str]] = None,
                          skip: int = 0, limit: int = 0) -> List[dict]:
        params: Dict[str, Any] = {}
        if query is not None:
            params["query"] = json.dumps(query, separators=(",", ":"))
        if projection:
            params["projection"] = ",".join(projection)
        if skip:
            params["skip"] = skip
        if limit:
            params["limit"] = limit
        t0 = time.time()
        async with self._client() as c:
            r = await c.get("/devices", params=params)
            dur = int((time.time() - t0) * 1000)
            if r.status_code >= 400:
                logger.warning("GenieACS GET /devices -> HTTP %s (%dms) proj=%s",
                               r.status_code, dur, len(projection or []))
                r.raise_for_status()
            logger.info("GenieACS GET /devices ok status=%s dur=%dms proj_fields=%s",
                        r.status_code, dur, len(projection or []))
            return r.json()

    async def get_faults(self, query: Optional[dict] = None, limit: int = 1000) -> List[dict]:
        params: Dict[str, Any] = {}
        if query is not None:
            params["query"] = json.dumps(query, separators=(",", ":"))
        if limit:
            params["limit"] = limit
        async with self._client() as c:
            r = await c.get("/faults", params=params)
            r.raise_for_status()
            return r.json()

    async def post_task(self, device_id: str, body: dict, connection_request: bool = True) -> dict:
        path = f"/devices/{quote(device_id, safe='')}/tasks"
        params = {"connection_request": ""} if connection_request else None
        async with self._client() as c:
            r = await c.post(path, params=params, json=body)
            if r.status_code >= 400:
                raise RuntimeError(f"GenieACS task error {r.status_code}: {r.text[:300]}")
            queued = r.status_code == 202
            try:
                data = r.json()
            except Exception:
                data = {}
            return {"queued": queued, "status_code": r.status_code, "data": data}

    async def tag(self, device_id: str, tag: str, add: bool) -> None:
        path = f"/devices/{quote(device_id, safe='')}/tags/{quote(tag, safe='')}"
        async with self._client() as c:
            r = await c.request("POST" if add else "DELETE", path)
            if r.status_code >= 400:
                raise RuntimeError(f"GenieACS tag error {r.status_code}: {r.text[:200]}")


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------
async def _load_config(db) -> Optional[Dict[str, Any]]:
    return await db.genieacs_config.find_one({"_id": "singleton"})


def _build_base_url(host: str, port: int) -> str:
    host = (host or "").strip()
    scheme = "http"
    if host.startswith("https://"):
        scheme, host = "https", host[len("https://"):]
    elif host.startswith("http://"):
        scheme, host = "http", host[len("http://"):]
    host = host.strip("/")
    if ":" in host:
        host = host.split(":", 1)[0]
    return f"{scheme}://{host}:{port}"


async def _client_from_db(db) -> GenieClient:
    cfg = await _load_config(db)
    if not cfg or not cfg.get("host"):
        raise HTTPException(400, "GenieACS belum dikonfigurasi. Buka Settings → Integrations → GenieACS.")
    username = cfg.get("username", "")
    password = ""
    if cfg.get("password_enc"):
        cipher = await _get_cipher(db)
        try:
            password = cipher.decrypt(cfg["password_enc"].encode()).decode()
        except InvalidToken:
            raise HTTPException(500, "Gagal decrypt password GenieACS. Simpan ulang credential.")
    return GenieClient(
        base_url=_build_base_url(cfg["host"], cfg.get("port", DEFAULT_PORT)),
        username=username, password=password,
        verify_ssl=cfg.get("verify_ssl", True), timeout=cfg.get("timeout", 15),
    )


# ---------------------------------------------------------------------------
# Parameter resolver (defensive, TR-098 + TR-181 + vendor fallback)
# ---------------------------------------------------------------------------
def _dig(node: Any, path: str) -> Any:
    cur = node
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    if isinstance(cur, dict):
        if "_value" in cur:
            return cur["_value"]
        # Leaf parameter node without a value (e.g. {"_object": false, "_writable": false}).
        # Treat as empty so scalar fields never receive a raw GenieACS node dict.
        if cur.get("_object") is False:
            return None
    return cur


def _first(device: dict, candidates: List[str]) -> Any:
    for c in candidates:
        try:
            v = _dig(device, c)
        except Exception:
            v = None
        # Scalar-only: never leak an object/subtree node dict (or list) into a scalar field.
        if isinstance(v, (dict, list)):
            continue
        if v not in (None, ""):
            return v
    return None


def _indexed_children(node: Any):
    if not isinstance(node, dict):
        return
    for k, v in node.items():
        if k.isdigit() and isinstance(v, dict):
            yield k, v


def _to_float(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# candidate path lists (detail only)
MODEL_PATHS = [f"{IGD}.DeviceInfo.ModelName", "Device.DeviceInfo.ModelName"]
MANUF_PATHS = [f"{IGD}.DeviceInfo.Manufacturer", "Device.DeviceInfo.Manufacturer"]
HW_PATHS = [f"{IGD}.DeviceInfo.HardwareVersion", "Device.DeviceInfo.HardwareVersion"]
SW_PATHS = [f"{IGD}.DeviceInfo.SoftwareVersion", "Device.DeviceInfo.SoftwareVersion"]
SERIAL_PATHS = [f"{IGD}.DeviceInfo.SerialNumber", "Device.DeviceInfo.SerialNumber"]
UPTIME_PATHS = [f"{IGD}.DeviceInfo.UpTime", "Device.DeviceInfo.UpTime",
                "VirtualParameters.uptime", "VirtualParameters.UpTime"]
WANIP_PATHS = [
    f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
    f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
    "Device.IP.Interface.2.IPv4Address.1.IPAddress",
    "VirtualParameters.wanIP", "VirtualParameters.pppoeIP",
]
PPPOE_USER_PATHS = [
    f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
    "Device.PPP.Interface.1.Username", "VirtualParameters.pppoeUsername",
]
MGMT_URL_PATHS = [f"{IGD}.ManagementServer.ConnectionRequestURL", "Device.ManagementServer.ConnectionRequestURL"]
MGMT_ADDR_PATHS = [f"{IGD}.ManagementServer.UDPConnectionRequestAddress", "Device.ManagementServer.UDPConnectionRequestAddress"]
RX_OPTICAL_PATHS = [
    "VirtualParameters.RXPower", "VirtualParameters.rxpower", "VirtualParameters.RxPower",
    f"{IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.Stats.RXPower",
    f"{IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
    f"{IGD}.WANDevice.1.X_CU_GponInterfaceConfig.RXPower",
    f"{IGD}.WANDevice.1.X_GponInterfaceConfig.RXPower",
    f"{IGD}.WANDevice.1.X_HW_GponInterfaceConfig.TransceiverRxPower",
    "Device.Optical.Interface.1.RXPower", "Device.XPON.Interface.1.RxPower",
]
TX_OPTICAL_PATHS = [
    "VirtualParameters.TXPower", "VirtualParameters.txpower",
    f"{IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.Stats.TXPower",
    f"{IGD}.WANDevice.1.X_GponInterfaceConfig.TXPower", "Device.Optical.Interface.1.TXPower",
]
TEMP_PATHS = [
    "VirtualParameters.Temperature", "VirtualParameters.temperature",
    f"{IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.TransceiverTemperature",
    f"{IGD}.WANDevice.1.X_GponInterfaceConfig.TransceiverTemperature", "Device.Optical.Interface.1.Temperature",
]
VOLT_PATHS = ["VirtualParameters.Voltage", f"{IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.TransceiverVoltage",
              "Device.Optical.Interface.1.Voltage"]
PON_MODE_PATHS = ["VirtualParameters.ponMode", f"{IGD}.WANDevice.1.X_GponInterfaceConfig.Mode"]
CONN_TYPE_PATHS = [
    f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionType",
    f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionType",
    "Device.PPP.Interface.1.ConnectionStatus",
]
VLAN_PATHS = [f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_VLANIDMark", "VirtualParameters.vlan"]


# ---------------------------------------------------------------------------
# Status + cluster logic
# ---------------------------------------------------------------------------
def _last_inform_minutes(li: Any) -> Optional[float]:
    if not li:
        return None
    try:
        if isinstance(li, (int, float)):
            dt = datetime.fromtimestamp(li / 1000 if li > 1e12 else li, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(li).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).total_seconds() / 60.0
    except Exception:
        return None


def _status(minutes: Optional[float], online_max: int, warning_max: int) -> str:
    # NOTE: initial rule based on _lastInform. Kept isolated so GenieACS
    # ACS-LOS / custom rules can be layered here later without touching callers.
    if minutes is None:
        return "Unknown"
    if minutes <= online_max:
        return "Online"
    if minutes <= warning_max:
        return "Warning"
    return "Offline"


def _strip_prefix(tag: str, prefix: str) -> str:
    if prefix and tag.lower().startswith(prefix.lower()):
        return tag[len(prefix):].strip() or tag
    return tag


def _cluster_label(tag: str, prefix: str) -> str:
    """Display label for a cluster tag. Tags coming from the CLUSTER: prefix are
    Title-Cased (CLUSTER:PANGKALPINANG -> 'Pangkalpinang'); free-form tags such as
    'Goodnet Deniang', 'VIP', 'OLT-01' are shown exactly as stored."""
    if prefix and tag.lower().startswith(prefix.lower()):
        stripped = tag[len(prefix):].strip() or tag
        return stripped.title()
    return tag


def _device_cluster_tags(tags: List[str], cfg: Dict[str, Any]) -> List[str]:
    """Return the RAW tags of a device that count as clusters.
    - manual mode: only tags configured in manual_cluster_tags.
    - prefix/default mode: ALL existing tags are treated as clusters so
      free-form tags (e.g. "Goodnet Deniang") still appear. CLUSTER: prefix is
      only used for display stripping.
    """
    if cfg.get("cluster_mode") == "manual":
        manual = set(cfg.get("manual_cluster_tags") or [])
        return [t for t in tags if t in manual]
    return list(tags)


def _light_summary(device: dict, cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Metadata-only row. Cannot fail on missing parameter trees."""
    did = device.get("_deviceId") or {}
    tags = device.get("_tags")
    tags = [str(x) for x in tags] if isinstance(tags, list) else []
    li = device.get("_lastInform")
    minutes = _last_inform_minutes(li)
    prefix = cfg.get("cluster_prefix", DEFAULT_PREFIX)
    ctags = _device_cluster_tags(tags, cfg)
    rx = _to_float(_first(device, RX_OPTICAL_PATHS))
    return {
        "id": device.get("_id"),
        "manufacturer": did.get("_Manufacturer"),
        "product_class": did.get("_ProductClass"),
        "model": did.get("_ProductClass"),
        "serial": did.get("_SerialNumber"),
        "serial_number": did.get("_SerialNumber"),
        "oui": did.get("_OUI"),
        "tags": tags,
        "cluster_tags": ctags,
        "cluster": _cluster_label(ctags[0], prefix) if ctags else None,
        "pppoe_username": _first(device, PPPOE_USER_PATHS),
        "rx_optical": rx,
        "poor_optical": bool(rx is not None and rx < POOR_OPTICAL_DBM),
        "last_inform": li,
        "last_inform_minutes": round(minutes, 1) if minutes is not None else None,
        "last_boot": device.get("_lastBoot"),
        "registered": device.get("_registered"),
        "status": _status(minutes, cfg.get("online_max_min", DEFAULT_ONLINE_MIN),
                          cfg.get("warning_max_min", DEFAULT_WARNING_MIN)),
    }


# ---------------------------------------------------------------------------
# Lightweight cached index (metadata only) — feeds list + summary + faults
# ---------------------------------------------------------------------------
_CACHE: Dict[str, Any] = {"at": 0.0, "sig": None, "devices": None, "faults": [], "connected": False}
_CACHE_TTL = 30.0
_LOCK = asyncio.Lock()


def _cfg_sig(cfg: Dict[str, Any]) -> str:
    return "|".join(str(cfg.get(k)) for k in (
        "host", "port", "cluster_mode", "cluster_prefix", "manual_cluster_tags",
        "online_max_min", "warning_max_min", "updated_at"))


async def _get_index(db, force: bool = False) -> Dict[str, Any]:
    cfg = await _load_config(db)
    if not cfg or not cfg.get("host") or not cfg.get("enabled", True):
        return {"connected": False, "devices": [], "faults": [],
                "error": "GenieACS belum dikonfigurasi / dinonaktifkan", "cfg": cfg or {}}
    sig = _cfg_sig(cfg)
    now = time.time()
    if (not force and _CACHE["sig"] == sig and _CACHE["devices"] is not None
            and now - _CACHE["at"] < _CACHE_TTL and _CACHE.get("connected")):
        return {"connected": True, "devices": _CACHE["devices"], "faults": _CACHE["faults"],
                "error": None, "cfg": cfg}
    async with _LOCK:
        now = time.time()
        if (not force and _CACHE["sig"] == sig and _CACHE["devices"] is not None
                and now - _CACHE["at"] < _CACHE_TTL and _CACHE.get("connected")):
            return {"connected": True, "devices": _CACHE["devices"], "faults": _CACHE["faults"],
                    "error": None, "cfg": cfg}
        try:
            client = await _client_from_db(db)
            # Base metadata + a few scalar params (PPPoE username & RX optical) so the
            # device table can show them without a per-row detail call.
            list_projection = LIGHT_PROJECTION + PPPOE_USER_PATHS + RX_OPTICAL_PATHS
            raw = await client.get_devices(query={}, projection=list_projection)
            devices: List[Dict[str, Any]] = []
            parse_errors = 0
            for d in raw:
                try:
                    devices.append(_light_summary(d, cfg))
                except Exception as e:  # noqa: BLE001 — one bad device never breaks the list
                    parse_errors += 1
                    logger.warning("GENIEACS_DEVICE_PARSE_ERROR id=%s err=%s",
                                   (d or {}).get("_id"), str(e)[:150])
            if parse_errors:
                logger.warning("GenieACS index: %d/%d devices failed light-parse", parse_errors, len(raw))
            try:
                faults = await client.get_faults(query={})
            except Exception as e:  # noqa: BLE001
                logger.info("GenieACS faults fetch failed: %s", str(e)[:150])
                faults = []
            _CACHE.update({"at": now, "sig": sig, "devices": devices, "faults": faults, "connected": True})
            return {"connected": True, "devices": devices, "faults": faults, "error": None, "cfg": cfg}
        except httpx.TimeoutException as e:
            logger.warning("GenieACS index timeout: %s", str(e)[:150])
            return {"connected": False, "devices": [], "faults": [],
                    "error": "GenieACS timeout saat mengambil daftar device (NBI lambat/tidak merespons).", "cfg": cfg}
        except httpx.HTTPStatusError as e:
            logger.warning("GenieACS index HTTP %s", e.response.status_code)
            return {"connected": False, "devices": [], "faults": [],
                    "error": f"GenieACS NBI HTTP {e.response.status_code}", "cfg": cfg}
        except Exception as e:  # noqa: BLE001
            logger.warning("GenieACS index fetch failed: %s", str(e)[:200])
            return {"connected": False, "devices": [], "faults": [], "error": str(e)[:300], "cfg": cfg}


def _public_cfg(cfg: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    cfg = cfg or {}
    return {
        "host": cfg.get("host", ""), "port": cfg.get("port", DEFAULT_PORT),
        "username": cfg.get("username", ""), "password_masked": cfg.get("password_masked", ""),
        "password_set": bool(cfg.get("password_enc")), "verify_ssl": cfg.get("verify_ssl", True),
        "enabled": cfg.get("enabled", True), "timeout": cfg.get("timeout", 15),
        "configured": bool(cfg.get("host")),
        "cluster_prefix": cfg.get("cluster_prefix", DEFAULT_PREFIX),
        "cluster_mode": cfg.get("cluster_mode", "prefix"),
        "manual_cluster_tags": cfg.get("manual_cluster_tags", []),
        "online_max_min": cfg.get("online_max_min", DEFAULT_ONLINE_MIN),
        "warning_max_min": cfg.get("warning_max_min", DEFAULT_WARNING_MIN),
        "updated_at": cfg.get("updated_at"), "last_test_at": cfg.get("last_test_at"),
        "last_test_ok": cfg.get("last_test_ok"), "last_test_message": cfg.get("last_test_message"),
        "last_success_at": cfg.get("last_success_at"),
    }


async def _audit(db, user: dict, action: str, device_id: str = "", result: str = "ok",
                 extra: Optional[dict] = None) -> None:
    try:
        await db.genieacs_audit.insert_one({
            "at": _now_iso(), "user_id": user.get("id"),
            "user_name": user.get("name") or user.get("email"), "role": user.get("role"),
            "action": action, "device_id": device_id, "result": result, "extra": extra or {},
        })
    except Exception:
        pass


def _fault_device_ids(faults: List[dict]) -> set:
    ids = set()
    for f in faults:
        did = f.get("device") or (f.get("_id", "") or "").split(":")[0]
        if did:
            ids.add(did)
    return ids


# ---------------------------------------------------------------------------
# Detail (single device, richer but BOUNDED projection — on demand only)
# ---------------------------------------------------------------------------
DETAIL_PROJECTION = [
    "_tags", "_lastInform", "_lastBoot", "_registered", "_deviceId",
    f"{IGD}.DeviceInfo", "Device.DeviceInfo", "VirtualParameters",
    f"{IGD}.WANDevice", "Device.IP", "Device.PPP", "Device.Optical", "Device.XPON",
    f"{IGD}.LANDevice.1.WLANConfiguration", "Device.WiFi",
    f"{IGD}.LANDevice.1.Hosts", "Device.Hosts",
    f"{IGD}.ManagementServer.ConnectionRequestURL",
    f"{IGD}.ManagementServer.UDPConnectionRequestAddress",
    "Device.ManagementServer.ConnectionRequestURL", "Device.ManagementServer.UDPConnectionRequestAddress",
]


def _mode(device: dict) -> str:
    if IGD in device:
        return "TR-098"
    if "Device" in device:
        return "TR-181"
    return "Unknown"


def _primary_ssid(device: dict) -> Optional[str]:
    return _first(device, [f"{IGD}.LANDevice.1.WLANConfiguration.1.SSID",
                           "Device.WiFi.SSID.1.SSID", "VirtualParameters.ssid"])


def _wifi_clients(device: dict) -> int:
    total = 0
    root = _dig(device, f"{IGD}.LANDevice.1.WLANConfiguration")
    if isinstance(root, dict):
        for _, wl in _indexed_children(root):
            n = _to_float(_dig(wl, "TotalAssociations"))
            if n is not None:
                total += int(n)
        if total:
            return total
    ap = _dig(device, "Device.WiFi.AccessPoint")
    if isinstance(ap, dict):
        for _, a in _indexed_children(ap):
            n = _to_float(_dig(a, "AssociatedDeviceNumberOfEntries"))
            if n is not None:
                total += int(n)
    vp = _to_float(_first(device, ["VirtualParameters.wifiClients", "VirtualParameters.assocDevices"]))
    if not total and vp is not None:
        total = int(vp)
    return total


def _lan_clients(device: dict) -> List[dict]:
    out: List[dict] = []
    hosts = _dig(device, f"{IGD}.LANDevice.1.Hosts.Host") or _dig(device, "Device.Hosts.Host")
    if isinstance(hosts, dict):
        for _, h in _indexed_children(hosts):
            active = _dig(h, "Active")
            out.append({
                "hostname": _dig(h, "HostName"), "ip": _dig(h, "IPAddress"),
                "mac": _dig(h, "MACAddress"),
                "interface": _dig(h, "InterfaceType") or _dig(h, "Layer2Interface"),
                "active": bool(active) if active is not None else None,
            })
    return out


def _wlan_list(device: dict) -> List[dict]:
    out: List[dict] = []
    root = _dig(device, f"{IGD}.LANDevice.1.WLANConfiguration")
    if isinstance(root, dict):
        for idx, wl in _indexed_children(root):
            en = _dig(wl, "Enable")
            out.append({"slot": idx, "ssid": _dig(wl, "SSID"), "channel": _dig(wl, "Channel"),
                        "enabled": bool(en) if en is not None else None,
                        "clients": _to_float(_dig(wl, "TotalAssociations")) or 0})
        return out
    ssids = _dig(device, "Device.WiFi.SSID")
    if isinstance(ssids, dict):
        for idx, s in _indexed_children(ssids):
            en = _dig(s, "Enable")
            out.append({"slot": idx, "ssid": _dig(s, "SSID"), "channel": None,
                        "enabled": bool(en) if en is not None else None, "clients": 0})
    return out


def _detail(device: dict, cfg: Dict[str, Any]) -> Dict[str, Any]:
    base = _light_summary(device, cfg)
    did = device.get("_deviceId") or {}
    mgmt_url = _first(device, MGMT_URL_PATHS)
    mgmt_ip = _first(device, MGMT_ADDR_PATHS)
    if not mgmt_ip and mgmt_url:
        try:
            mgmt_ip = urlparse(mgmt_url).hostname
        except Exception:
            mgmt_ip = None
    rx = _to_float(_first(device, RX_OPTICAL_PATHS))
    base.update({
        "mode": _mode(device),
        "manufacturer": did.get("_Manufacturer") or _first(device, MANUF_PATHS),
        "model": _first(device, MODEL_PATHS) or did.get("_ProductClass"),
        "product_class": did.get("_ProductClass"),
        "serial": did.get("_SerialNumber") or _first(device, SERIAL_PATHS),
        "hardware_version": _first(device, HW_PATHS),
        "software_version": _first(device, SW_PATHS),
        "uptime": _to_float(_first(device, UPTIME_PATHS)),
        "wan_ip": _first(device, WANIP_PATHS),
        "mgmt_ip": mgmt_ip,
        "pppoe_username": _first(device, PPPOE_USER_PATHS),
        "connection_type": _first(device, CONN_TYPE_PATHS),
        "vlan": _first(device, VLAN_PATHS),
        "pon_mode": _first(device, PON_MODE_PATHS),
        "rx_optical": rx,
        "tx_optical": _to_float(_first(device, TX_OPTICAL_PATHS)),
        "temperature": _to_float(_first(device, TEMP_PATHS)),
        "voltage": _to_float(_first(device, VOLT_PATHS)),
        "poor_optical": bool(rx is not None and rx < POOR_OPTICAL_DBM),
        "ssid": _primary_ssid(device),
        "wifi_clients": _wifi_clients(device),
        "wlan": _wlan_list(device),
        "lan_clients": _lan_clients(device),
    })
    return base


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
def build_genieacs_router(get_current_user, require_roles) -> APIRouter:
    r = APIRouter(prefix="/genieacs", tags=["genieacs"])
    ACTION_ROLES = ("admin", "supervisor", "engineer")

    # ---------------- Config ----------------
    @r.get("/config")
    async def get_config(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        return _public_cfg(await _load_config(db))

    @r.put("/config")
    async def put_config(body: GenieConfigIn, request: Request, user=Depends(require_roles("admin"))):
        db = request.app.state.db
        existing = await _load_config(db) or {}
        payload: Dict[str, Any] = {
            "host": body.host.strip(), "port": body.port, "username": (body.username or "").strip(),
            "verify_ssl": body.verify_ssl, "enabled": body.enabled, "timeout": body.timeout,
            "cluster_prefix": body.cluster_prefix or DEFAULT_PREFIX,
            "cluster_mode": body.cluster_mode if body.cluster_mode in ("prefix", "manual") else "prefix",
            "manual_cluster_tags": body.manual_cluster_tags or [],
            "online_max_min": body.online_max_min, "warning_max_min": body.warning_max_min,
            "updated_at": _now_iso(),
        }
        if body.password:
            cipher = await _get_cipher(db)
            payload["password_enc"] = cipher.encrypt(body.password.encode()).decode()
            payload["password_masked"] = _mask(body.password)
        elif "password_enc" in existing:
            payload["password_enc"] = existing["password_enc"]
            payload["password_masked"] = existing.get("password_masked", "")
        await db.genieacs_config.update_one({"_id": "singleton"}, {"$set": payload}, upsert=True)
        _CACHE["sig"] = None
        await _audit(db, user, "config_update")
        return _public_cfg(await _load_config(db))

    @r.post("/test-connection")
    async def test_connection(request: Request, user=Depends(require_roles("admin"))):
        db = request.app.state.db
        cfg = await _load_config(db)
        if not cfg or not cfg.get("host"):
            raise HTTPException(400, "Konfigurasi belum lengkap")
        try:
            client = await _client_from_db(db)
            devices = await client.get_devices(query={}, projection=["_id"], limit=1)
            ok, msg = True, f"OK — NBI reachable, {len(devices)} device sample"
        except httpx.ConnectError as e:
            ok, msg = False, f"Tidak dapat terhubung ke NBI: {str(e)[:200]}"
        except httpx.HTTPStatusError as e:
            ok, msg = False, f"HTTP {e.response.status_code}: {e.response.text[:150]}"
        except Exception as e:  # noqa: BLE001
            ok, msg = False, str(e)[:300]
        upd = {"last_test_at": _now_iso(), "last_test_ok": ok, "last_test_message": msg}
        if ok:
            upd["last_success_at"] = _now_iso()
        await db.genieacs_config.update_one({"_id": "singleton"}, {"$set": upd})
        _CACHE["sig"] = None
        await _audit(db, user, "test_connection", result="ok" if ok else "fail", extra={"message": msg})
        return {"ok": ok, "message": msg}

    # ---------------- Summary + clusters ----------------
    @r.get("/summary")
    async def summary(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        idx = await _get_index(db)
        devices = idx["devices"]; cfg = idx["cfg"]
        prefix = cfg.get("cluster_prefix", DEFAULT_PREFIX)
        online = sum(1 for d in devices if d["status"] == "Online")
        warning = sum(1 for d in devices if d["status"] == "Warning")
        offline = sum(1 for d in devices if d["status"] == "Offline")
        unknown = sum(1 for d in devices if d["status"] == "Unknown")
        fault_ids = _fault_device_ids(idx["faults"])
        clusters: Dict[str, Dict[str, Any]] = {}
        for d in devices:
            for raw in d["cluster_tags"]:
                c = clusters.setdefault(raw, {"name": raw, "label": _cluster_label(raw, prefix),
                                              "total": 0, "online": 0, "warning": 0, "offline": 0, "fault": 0})
                c["total"] += 1
                key = d["status"].lower()
                if key in c:
                    c[key] += 1
                if d["id"] in fault_ids:
                    c["fault"] += 1
        return {
            "connected": idx["connected"], "error": idx["error"],
            "summary": {
                "total": len(devices), "online": online, "warning": warning, "offline": offline,
                "unknown": unknown, "fault": len(idx["faults"]),
                # heavy metrics are NOT computed in the lightweight list path
                "poor_optical": None, "total_wifi_client": None,
            },
            "clusters": sorted(clusters.values(), key=lambda x: x["label"].lower()),
        }

    # ---------------- Device table (lightweight, server-side paginated) ------
    @r.get("/devices")
    async def list_devices(
        request: Request, user=Depends(get_current_user),
        cluster: str = "", status: str = "", model: str = "", tag: str = "",
        q: str = "", fault: bool = False,
        page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
        page_size: Optional[int] = None,
    ):
        db = request.app.state.db
        idx = await _get_index(db)
        devices = idx["devices"]
        fault_ids = _fault_device_ids(idx["faults"])
        ql = q.strip().lower()
        eff_limit = page_size or limit

        def match(d: Dict[str, Any]) -> bool:
            if cluster and cluster != "__all__" and cluster not in (d["cluster_tags"] or []):
                return False
            if status and status != "all" and d["status"] != status:
                return False
            if model and model != "all" and (model.lower() not in (d["product_class"] or "").lower()):
                return False
            if tag and tag not in (d["tags"] or []):
                return False
            if fault and d["id"] not in fault_ids:
                return False
            if ql:
                hay = " ".join(str(x or "") for x in [
                    d["id"], d["serial"], d["manufacturer"], d["product_class"],
                    d.get("pppoe_username"), " ".join(d["tags"] or [])]).lower()
                if ql not in hay:
                    return False
            return True

        filtered = [d for d in devices if match(d)]
        for d in filtered:
            d["has_fault"] = d["id"] in fault_ids
        total = len(filtered)
        start = (page - 1) * eff_limit
        items = filtered[start:start + eff_limit]
        models = sorted({d["product_class"] for d in devices if d["product_class"]})
        return {"connected": idx["connected"], "error": idx["error"], "items": items,
                "total": total, "page": page, "limit": eff_limit, "page_size": eff_limit,
                "models": models}

    # ---------------- Device detail (rich, single device on demand) ----------
    @r.get("/devices/{device_id}")
    async def device_detail(device_id: str, request: Request, refresh: bool = False,
                            user=Depends(get_current_user)):
        db = request.app.state.db
        cfg = await _load_config(db)
        if not cfg or not cfg.get("host"):
            raise HTTPException(400, "GenieACS belum dikonfigurasi")
        try:
            client = await _client_from_db(db)
            if refresh:
                try:
                    await client.post_task(device_id, {"name": "refreshObject", "objectName": ""}, True)
                    await _audit(db, user, "refresh_from_device", device_id)
                except Exception as e:  # noqa: BLE001
                    logger.info("refreshObject failed: %s", str(e)[:120])
            raw = await client.get_devices(query={"_id": device_id}, projection=DETAIL_PROJECTION, limit=1)
        except httpx.TimeoutException:
            raise HTTPException(504, "GenieACS timeout saat mengambil detail device")
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, f"GenieACS tidak dapat dihubungi: {str(e)[:200]}")
        if not raw:
            raise HTTPException(404, "Device tidak ditemukan")
        try:
            detail = _detail(raw[0], cfg)
        except Exception as e:  # noqa: BLE001
            logger.warning("GENIEACS_DEVICE_PARSE_ERROR (detail) id=%s err=%s", device_id, str(e)[:200])
            raise HTTPException(422, f"Gagal membaca detail device dari GenieACS: {str(e)[:200]}")
        try:
            faults = await client.get_faults(query={"device": device_id})
        except Exception:
            faults = []
        detail["faults"] = [{"code": f.get("code"), "message": f.get("message"),
                             "timestamp": f.get("timestamp"), "retries": f.get("retries"),
                             "channel": f.get("channel")} for f in faults]
        return detail

    # ---------------- Faults ----------------
    @r.get("/faults")
    async def faults(request: Request, cluster: str = "", user=Depends(get_current_user)):
        db = request.app.state.db
        idx = await _get_index(db); cfg = idx["cfg"]
        prefix = cfg.get("cluster_prefix", DEFAULT_PREFIX)
        by_id = {d["id"]: d for d in idx["devices"]}
        out = []
        for f in idx["faults"]:
            did = f.get("device") or (f.get("_id", "") or "").split(":")[0]
            dev = by_id.get(did)
            ctags = dev["cluster_tags"] if dev else []
            label = _cluster_label(ctags[0], prefix) if ctags else None
            if cluster and cluster != "__all__" and cluster not in ctags:
                continue
            out.append({"device": did, "serial": dev["serial"] if dev else None,
                        "cluster": label, "cluster_tags": ctags,
                        "code": f.get("code"), "message": f.get("message"),
                        "timestamp": f.get("timestamp"), "retries": f.get("retries"),
                        "channel": f.get("channel")})
        return {"connected": idx["connected"], "error": idx["error"], "items": out, "total": len(out)}

    # ---------------- Actions ----------------
    @r.post("/devices/{device_id}/refresh")
    async def refresh_from_device(device_id: str, request: Request, user=Depends(require_roles(*ACTION_ROLES))):
        db = request.app.state.db
        client = await _client_from_db(db)
        try:
            res = await client.post_task(device_id, {"name": "refreshObject", "objectName": ""}, True)
        except Exception as e:  # noqa: BLE001
            await _audit(db, user, "refresh_from_device", device_id, "fail", {"error": str(e)[:200]})
            raise HTTPException(502, str(e)[:200])
        await _audit(db, user, "refresh_from_device", device_id)
        return {"ok": True, "queued": res["queued"]}

    @r.post("/devices/{device_id}/reboot")
    async def reboot(device_id: str, request: Request, user=Depends(require_roles(*ACTION_ROLES))):
        db = request.app.state.db
        client = await _client_from_db(db)
        try:
            res = await client.post_task(device_id, {"name": "reboot"}, True)
        except Exception as e:  # noqa: BLE001
            await _audit(db, user, "reboot", device_id, "fail", {"error": str(e)[:200]})
            raise HTTPException(502, str(e)[:200])
        await _audit(db, user, "reboot", device_id)
        return {"ok": True, "queued": res["queued"]}

    async def _detect_mode(client: GenieClient, device_id: str) -> str:
        try:
            raw = await client.get_devices(query={"_id": device_id},
                                           projection=[f"{IGD}.DeviceInfo", "Device.DeviceInfo"], limit=1)
            return _mode(raw[0]) if raw else "TR-098"
        except Exception:
            return "TR-098"

    @r.post("/devices/{device_id}/wifi")
    async def change_wifi(device_id: str, body: WifiChangeIn, request: Request,
                          user=Depends(require_roles(*ACTION_ROLES))):
        db = request.app.state.db
        client = await _client_from_db(db)
        mode = await _detect_mode(client, device_id)
        slot = body.slot
        values: List[list] = []
        if mode == "TR-181":
            values.append([f"Device.WiFi.SSID.{slot}.SSID", body.ssid, "xsd:string"])
            if body.password:
                values.append([f"Device.WiFi.AccessPoint.{slot}.Security.KeyPassphrase", body.password, "xsd:string"])
        else:
            values.append([f"{IGD}.LANDevice.1.WLANConfiguration.{slot}.SSID", body.ssid, "xsd:string"])
            if body.password:
                values.append([f"{IGD}.LANDevice.1.WLANConfiguration.{slot}.PreSharedKey.1.PreSharedKey", body.password, "xsd:string"])
                values.append([f"{IGD}.LANDevice.1.WLANConfiguration.{slot}.KeyPassphrase", body.password, "xsd:string"])
        try:
            res = await client.post_task(device_id, {"name": "setParameterValues", "parameterValues": values}, True)
        except Exception as e:  # noqa: BLE001
            await _audit(db, user, "change_wifi", device_id, "fail", {"slot": slot, "error": str(e)[:200]})
            raise HTTPException(502, str(e)[:200])
        await _audit(db, user, "change_wifi", device_id, "ok",
                     {"slot": slot, "ssid": body.ssid, "password_changed": bool(body.password)})
        return {"ok": True, "queued": res["queued"]}

    @r.post("/devices/{device_id}/pppoe")
    async def change_pppoe(device_id: str, body: PppoeChangeIn, request: Request,
                           user=Depends(require_roles(*ACTION_ROLES))):
        db = request.app.state.db
        client = await _client_from_db(db)
        mode = await _detect_mode(client, device_id)
        values: List[list] = []
        if mode == "TR-181":
            values.append(["Device.PPP.Interface.1.Username", body.username, "xsd:string"])
            if body.password:
                values.append(["Device.PPP.Interface.1.Password", body.password, "xsd:string"])
        else:
            base = f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1"
            values.append([f"{base}.Username", body.username, "xsd:string"])
            if body.password:
                values.append([f"{base}.Password", body.password, "xsd:string"])
        try:
            res = await client.post_task(device_id, {"name": "setParameterValues", "parameterValues": values}, True)
        except Exception as e:  # noqa: BLE001
            await _audit(db, user, "change_pppoe", device_id, "fail", {"error": str(e)[:200]})
            raise HTTPException(502, str(e)[:200])
        await _audit(db, user, "change_pppoe", device_id, "ok",
                     {"username": body.username, "password_changed": bool(body.password)})
        return {"ok": True, "queued": res["queued"]}

    @r.post("/devices/{device_id}/tags/{tag}")
    async def add_tag(device_id: str, tag: str, request: Request, user=Depends(require_roles(*ACTION_ROLES))):
        db = request.app.state.db
        client = await _client_from_db(db)
        try:
            await client.tag(device_id, tag, True)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, str(e)[:200])
        _CACHE["sig"] = None
        await _audit(db, user, "add_tag", device_id, "ok", {"tag": tag})
        return {"ok": True}

    @r.delete("/devices/{device_id}/tags/{tag}")
    async def remove_tag(device_id: str, tag: str, request: Request, user=Depends(require_roles(*ACTION_ROLES))):
        db = request.app.state.db
        client = await _client_from_db(db)
        try:
            await client.tag(device_id, tag, False)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, str(e)[:200])
        _CACHE["sig"] = None
        await _audit(db, user, "remove_tag", device_id, "ok", {"tag": tag})
        return {"ok": True}

    @r.get("/audit")
    async def audit_log(request: Request, limit: int = Query(100, ge=1, le=500), user=Depends(get_current_user)):
        db = request.app.state.db
        cur = db.genieacs_audit.find({}, {"_id": 0}).sort("at", -1).limit(limit)
        return {"items": await cur.to_list(limit)}

    # ---------------- Customer mapping + snapshot ----------------
    @r.get("/mappings")
    async def list_mappings(request: Request, customer_id: str = "", user=Depends(get_current_user)):
        db = request.app.state.db
        qry: Dict[str, Any] = {}
        if customer_id:
            qry["customer_id"] = customer_id
        cur = db.genieacs_mappings.find(qry, {"_id": 0}).sort("at", -1).limit(500)
        return {"items": await cur.to_list(500)}

    @r.post("/mappings")
    async def create_mapping(body: MappingIn, request: Request, user=Depends(require_roles(*ACTION_ROLES))):
        db = request.app.state.db
        import uuid
        doc = body.model_dump(); doc["id"] = str(uuid.uuid4()); doc["at"] = _now_iso()
        doc["by"] = user.get("name") or user.get("email")
        await db.genieacs_mappings.update_one(
            {"device_id": doc["device_id"], "customer_id": doc.get("customer_id")}, {"$set": doc}, upsert=True)
        await _audit(db, user, "map_customer", doc["device_id"], "ok", {"customer_id": doc.get("customer_id")})
        return {"ok": True, "id": doc["id"]}

    @r.delete("/mappings/{mapping_id}")
    async def delete_mapping(mapping_id: str, request: Request, user=Depends(require_roles(*ACTION_ROLES))):
        db = request.app.state.db
        await db.genieacs_mappings.delete_one({"id": mapping_id})
        return {"ok": True}

    @r.get("/snapshot")
    async def snapshot(request: Request, customer_id: str = "", serial: str = "", pppoe: str = "",
                       device_id: str = "", user=Depends(get_current_user)):
        db = request.app.state.db
        idx = await _get_index(db)
        if not idx["connected"]:
            return {"matched": False, "connected": False, "error": idx["error"]}
        devices = idx["devices"]
        target_id = device_id or None
        if not target_id and customer_id:
            m = await db.genieacs_mappings.find_one({"customer_id": customer_id})
            if m:
                target_id = m.get("device_id"); serial = serial or m.get("serial") or ""
        light = None
        if target_id:
            light = next((d for d in devices if d["id"] == target_id), None)
        if not light and serial:
            light = next((d for d in devices if (d["serial"] or "").lower() == serial.lower()), None)
        if not light:
            return {"matched": False, "connected": True}
        fault_ids = _fault_device_ids(idx["faults"])
        # fetch rich detail for the ONE matched device
        try:
            client = await _client_from_db(db)
            raw = await client.get_devices(query={"_id": light["id"]}, projection=DETAIL_PROJECTION, limit=1)
            det = _detail(raw[0], idx["cfg"]) if raw else light
        except Exception:
            det = light
        return {
            "matched": True, "connected": True, "device_id": light["id"],
            "cluster": light["cluster"], "status": light["status"], "model": det.get("model"),
            "serial": det.get("serial"), "last_inform": light["last_inform"],
            "wan_ip": det.get("wan_ip"), "rx_optical": det.get("rx_optical"),
            "uptime": det.get("uptime"), "wifi_clients": det.get("wifi_clients"),
            "active_fault": light["id"] in fault_ids,
        }

    return r
