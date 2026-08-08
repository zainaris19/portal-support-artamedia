"""
SNMP Device Discovery module
============================

Responsibilities
----------------
1. Store SNMP credentials per device (encrypted with same Fernet cipher used by
   network_ipam.py — reuses `db.system_config.ipam_key`).
2. Poll live operational telemetry (interfaces, CPU, memory, temperature, PSU)
   using pysnmp async v3-architecture APIs.
3. Persist telemetry into `device_telemetry` (one document per device_id).
4. **Never** overwrite manually-managed device fields; only *enrich* with an
   optional `snmp_*` block on the device document.
5. Background auto-poll loop.

Graceful degradation: any polling failure is captured, sync_ok=False, last_error
is stored — the frontend Explorer keeps rendering manual/interconnection data.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any, Literal, Tuple

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("noc.snmp")

# ----------------------------------------------------------------------------
# OIDs (SNMPv2-MIB / IF-MIB / vendor extensions)
# ----------------------------------------------------------------------------
OID_SYS_DESCR = '1.3.6.1.2.1.1.1.0'
OID_SYS_NAME = '1.3.6.1.2.1.1.5.0'
OID_SYS_UPTIME = '1.3.6.1.2.1.1.3.0'
OID_SYS_LOCATION = '1.3.6.1.2.1.1.6.0'
OID_SYS_CONTACT = '1.3.6.1.2.1.1.4.0'
OID_SYS_OID = '1.3.6.1.2.1.1.2.0'

OID_ENT_SERIAL = '1.3.6.1.2.1.47.1.1.1.1.11'   # entPhysicalSerialNum
OID_ENT_MODEL = '1.3.6.1.2.1.47.1.1.1.1.13'    # entPhysicalModelName
OID_ENT_HW_REV = '1.3.6.1.2.1.47.1.1.1.1.8'    # entPhysicalHardwareRev
OID_ENT_FW_REV = '1.3.6.1.2.1.47.1.1.1.1.9'    # entPhysicalFirmwareRev
OID_ENT_SW_REV = '1.3.6.1.2.1.47.1.1.1.1.10'   # entPhysicalSoftwareRev
OID_ENT_NAME = '1.3.6.1.2.1.47.1.1.1.1.7'      # entPhysicalName

# IF-MIB
OID_IF_INDEX = '1.3.6.1.2.1.2.2.1.1'
OID_IF_DESCR = '1.3.6.1.2.1.2.2.1.2'
OID_IF_TYPE = '1.3.6.1.2.1.2.2.1.3'
OID_IF_MTU = '1.3.6.1.2.1.2.2.1.4'
OID_IF_SPEED = '1.3.6.1.2.1.2.2.1.5'
OID_IF_PHYS_ADDR = '1.3.6.1.2.1.2.2.1.6'
OID_IF_ADMIN = '1.3.6.1.2.1.2.2.1.7'
OID_IF_OPER = '1.3.6.1.2.1.2.2.1.8'
OID_IF_IN_OCTETS = '1.3.6.1.2.1.2.2.1.10'
OID_IF_OUT_OCTETS = '1.3.6.1.2.1.2.2.1.16'
OID_IF_NAME = '1.3.6.1.2.1.31.1.1.1.1'          # ifName (ifXTable)
OID_IF_ALIAS = '1.3.6.1.2.1.31.1.1.1.18'        # ifAlias
OID_IF_HIGH_SPEED = '1.3.6.1.2.1.31.1.1.1.15'   # ifHighSpeed (Mbps)
OID_IF_HC_IN = '1.3.6.1.2.1.31.1.1.1.6'         # ifHCInOctets
OID_IF_HC_OUT = '1.3.6.1.2.1.31.1.1.1.10'       # ifHCOutOctets

# Common vendor MIB roots — polled with graceful failure
OID_MIKROTIK_CPU = '1.3.6.1.2.1.25.3.3.1.2'     # hrProcessorLoad
OID_HOST_MEM_TOTAL = '1.3.6.1.2.1.25.2.3.1.5'   # hrStorageSize
OID_HOST_MEM_USED = '1.3.6.1.2.1.25.2.3.1.6'    # hrStorageUsed
OID_HOST_STORAGE_TYPE = '1.3.6.1.2.1.25.2.3.1.2'
OID_HOST_STORAGE_DESCR = '1.3.6.1.2.1.25.2.3.1.3'

# Cisco entity sensor
OID_ENTITY_SENSOR_VALUE = '1.3.6.1.4.1.9.9.91.1.1.1.1.4'
# Standard entity sensor (ENTITY-SENSOR-MIB)
OID_ENT_SENSOR_TYPE = '1.3.6.1.2.1.99.1.1.1.1'
OID_ENT_SENSOR_VALUE = '1.3.6.1.2.1.99.1.1.1.4'
OID_ENT_SENSOR_UNITS = '1.3.6.1.2.1.99.1.1.1.2'
# UCD-SNMP-MIB (CPU / memory)
OID_UCD_CPU_IDLE = '1.3.6.1.4.1.2021.11.11.0'
OID_UCD_MEM_TOTAL = '1.3.6.1.4.1.2021.4.5.0'
OID_UCD_MEM_AVAIL = '1.3.6.1.4.1.2021.4.6.0'

IF_ADMIN_STATUS = {1: 'up', 2: 'down', 3: 'testing'}
IF_OPER_STATUS = {1: 'up', 2: 'down', 3: 'testing', 4: 'unknown', 5: 'dormant', 6: 'notPresent', 7: 'lowerLayerDown'}


# ----------------------------------------------------------------------------
# Fernet cipher — reuses the same key as IPAM so we don't proliferate secrets
# ----------------------------------------------------------------------------
_CIPHER: Optional[Fernet] = None


async def _get_cipher(db) -> Fernet:
    global _CIPHER
    if _CIPHER is not None:
        return _CIPHER
    doc = await db.system_config.find_one({"_id": "ipam_key"})
    if doc and doc.get("key"):
        key = doc["key"].encode() if isinstance(doc["key"], str) else doc["key"]
    else:
        key = Fernet.generate_key()
        await db.system_config.update_one(
            {"_id": "ipam_key"},
            {"$set": {"key": key.decode("utf-8"), "created_at": _now()}},
            upsert=True,
        )
    _CIPHER = Fernet(key)
    return _CIPHER


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


# ----------------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------------
class SNMPConfigIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    host: str
    port: int = 161
    version: Literal['v1', 'v2c', 'v3'] = 'v2c'
    community: Optional[str] = None      # v1/v2c
    v3_username: Optional[str] = None
    v3_auth_protocol: Optional[Literal['MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512', 'noAuth']] = None
    v3_auth_password: Optional[str] = None
    v3_priv_protocol: Optional[Literal['DES', 'AES', 'AES192', 'AES256', 'noPriv']] = None
    v3_priv_password: Optional[str] = None
    poll_interval_minutes: int = 5       # 0 = manual only
    enabled: bool = True
    timeout_seconds: int = 5


class SNMPConfigOut(BaseModel):
    device_id: str
    host: str
    port: int
    version: str
    poll_interval_minutes: int
    enabled: bool
    timeout_seconds: int
    has_credentials: bool
    v3_username: Optional[str] = None
    v3_auth_protocol: Optional[str] = None
    v3_priv_protocol: Optional[str] = None
    last_sync_at: Optional[str] = None
    last_sync_ok: Optional[bool] = None
    last_error: Optional[str] = None


# ----------------------------------------------------------------------------
# pysnmp async helpers — wrapped so import failures never break the app
# ----------------------------------------------------------------------------
_SNMP_AVAILABLE = True
try:
    from pysnmp.hlapi.v3arch.asyncio import (  # type: ignore
        SnmpEngine, CommunityData, UsmUserData, UdpTransportTarget, ContextData,
        ObjectType, ObjectIdentity, get_cmd, next_cmd, walk_cmd,
        usmHMACMD5AuthProtocol, usmHMACSHAAuthProtocol,
        usmHMAC128SHA224AuthProtocol, usmHMAC192SHA256AuthProtocol,
        usmHMAC256SHA384AuthProtocol, usmHMAC384SHA512AuthProtocol,
        usmNoAuthProtocol,
        usmDESPrivProtocol, usmAesCfb128Protocol, usmAesCfb192Protocol,
        usmAesCfb256Protocol, usmNoPrivProtocol,
    )
except Exception as e:  # pragma: no cover
    logger.exception("pysnmp unavailable — SNMP polling disabled: %s", e)
    _SNMP_AVAILABLE = False


AUTH_PROTO = {
    'MD5': 'usmHMACMD5AuthProtocol', 'SHA': 'usmHMACSHAAuthProtocol',
    'SHA224': 'usmHMAC128SHA224AuthProtocol', 'SHA256': 'usmHMAC192SHA256AuthProtocol',
    'SHA384': 'usmHMAC256SHA384AuthProtocol', 'SHA512': 'usmHMAC384SHA512AuthProtocol',
    'noAuth': 'usmNoAuthProtocol',
}
PRIV_PROTO = {
    'DES': 'usmDESPrivProtocol', 'AES': 'usmAesCfb128Protocol',
    'AES192': 'usmAesCfb192Protocol', 'AES256': 'usmAesCfb256Protocol',
    'noPriv': 'usmNoPrivProtocol',
}


def _auth_data(cfg: dict):
    """Build pysnmp auth data (CommunityData or UsmUserData)."""
    if not _SNMP_AVAILABLE:
        raise RuntimeError("pysnmp not installed")
    version = cfg.get("version", "v2c")
    if version in ("v1", "v2c"):
        return CommunityData(cfg.get("community") or "public", mpModel=0 if version == "v1" else 1)
    # v3
    auth_key = cfg.get("v3_auth_password_plain")
    priv_key = cfg.get("v3_priv_password_plain")
    auth_p = globals().get(AUTH_PROTO.get(cfg.get("v3_auth_protocol") or "noAuth", "usmNoAuthProtocol"))
    priv_p = globals().get(PRIV_PROTO.get(cfg.get("v3_priv_protocol") or "noPriv", "usmNoPrivProtocol"))
    return UsmUserData(
        userName=cfg.get("v3_username") or "",
        authKey=auth_key, privKey=priv_key,
        authProtocol=auth_p, privProtocol=priv_p,
    )


async def _snmp_walk(cfg: dict, oid: str, timeout: float = 5.0) -> List[Tuple[str, Any]]:
    """Async SNMP walk. Returns [(oid_string, value), ...]. Empty on failure."""
    if not _SNMP_AVAILABLE:
        return []
    engine = SnmpEngine()
    transport = await UdpTransportTarget.create((cfg["host"], cfg.get("port", 161)), timeout=timeout, retries=1)
    result: List[Tuple[str, Any]] = []
    try:
        auth = _auth_data(cfg)
        async for errIndication, errStatus, errIndex, varBinds in walk_cmd(
            engine, auth, transport, ContextData(),
            ObjectType(ObjectIdentity(oid)),
            lexicographicMode=False, lookupMib=False,
        ):
            if errIndication or errStatus:
                logger.debug("SNMP walk error on %s: %s / %s", oid, errIndication, errStatus)
                break
            for vb in varBinds:
                result.append((str(vb[0]), vb[1]))
    except Exception as e:
        logger.debug("SNMP walk exception %s@%s: %s", oid, cfg.get("host"), e)
    finally:
        try:
            engine.close_dispatcher()
        except Exception:
            pass
    return result


async def _snmp_get(cfg: dict, *oids: str, timeout: float = 5.0) -> Dict[str, Any]:
    """Async SNMP get for one or more OIDs. Returns {oid_str: value}."""
    if not _SNMP_AVAILABLE:
        return {}
    engine = SnmpEngine()
    transport = await UdpTransportTarget.create((cfg["host"], cfg.get("port", 161)), timeout=timeout, retries=1)
    out: Dict[str, Any] = {}
    try:
        auth = _auth_data(cfg)
        objects = [ObjectType(ObjectIdentity(o)) for o in oids]
        errIndication, errStatus, errIndex, varBinds = await get_cmd(
            engine, auth, transport, ContextData(), *objects, lookupMib=False,
        )
        if errIndication or errStatus:
            logger.debug("SNMP get error: %s / %s", errIndication, errStatus)
        else:
            for vb in varBinds:
                out[str(vb[0])] = vb[1]
    except Exception as e:
        logger.debug("SNMP get exception %s@%s: %s", oids, cfg.get("host"), e)
    finally:
        try:
            engine.close_dispatcher()
        except Exception:
            pass
    return out


def _to_str(v):
    if v is None:
        return None
    try:
        s = v.prettyPrint() if hasattr(v, 'prettyPrint') else str(v)
        return s
    except Exception:
        return str(v)


def _to_int(v):
    try:
        return int(v)
    except Exception:
        return None


# ----------------------------------------------------------------------------
# Poll a device — returns telemetry dict, never raises
# ----------------------------------------------------------------------------
async def poll_device(cfg: dict, timeout: float = 5.0) -> dict:
    result: dict = {
        "sync_ok": False,
        "last_error": None,
        "polled_at": _now(),
        "system": {},
        "interfaces": [],
        "cpu_percent": None,
        "memory_percent": None,
        "memory_total": None,
        "memory_used": None,
        "temperature_c": None,
        "psu_status": [],
    }
    if not _SNMP_AVAILABLE:
        result["last_error"] = "pysnmp not installed on server"
        return result
    try:
        # -- System info (single GET) --------------------------------------
        sys_data = await _snmp_get(
            cfg,
            OID_SYS_NAME, OID_SYS_DESCR, OID_SYS_UPTIME, OID_SYS_LOCATION, OID_SYS_OID,
            timeout=timeout,
        )
        if not sys_data:
            result["last_error"] = "no response from device"
            return result
        sys_name = _to_str(sys_data.get(OID_SYS_NAME))
        sys_descr = _to_str(sys_data.get(OID_SYS_DESCR))
        uptime = _to_int(sys_data.get(OID_SYS_UPTIME))
        # -- Entity (serial + model + fw) ---------------------------------
        serials = await _snmp_walk(cfg, OID_ENT_SERIAL, timeout=timeout)
        models = await _snmp_walk(cfg, OID_ENT_MODEL, timeout=timeout)
        fw_revs = await _snmp_walk(cfg, OID_ENT_SW_REV, timeout=timeout)
        serial = next((_to_str(v) for _, v in serials if _to_str(v)), None)
        model = next((_to_str(v) for _, v in models if _to_str(v)), None)
        firmware = next((_to_str(v) for _, v in fw_revs if _to_str(v)), None)
        # infer vendor from sysDescr
        vendor = None
        if sys_descr:
            low = sys_descr.lower()
            if 'mikrotik' in low or 'routeros' in low: vendor = 'MikroTik'
            elif 'huawei' in low: vendor = 'Huawei'
            elif 'cisco' in low: vendor = 'Cisco'
            elif 'juniper' in low: vendor = 'Juniper'
            elif 'arista' in low: vendor = 'Arista'
        result["system"] = {
            "hostname": sys_name, "sys_descr": sys_descr,
            "uptime_ticks": uptime, "vendor": vendor,
            "model": model, "serial": serial, "firmware": firmware,
        }
        # -- Interfaces (index / descr / speed / admin / oper) ------------
        descrs = dict((k.rsplit('.', 1)[1], _to_str(v)) for k, v in await _snmp_walk(cfg, OID_IF_DESCR, timeout=timeout))
        names = dict((k.rsplit('.', 1)[1], _to_str(v)) for k, v in await _snmp_walk(cfg, OID_IF_NAME, timeout=timeout))
        aliases = dict((k.rsplit('.', 1)[1], _to_str(v)) for k, v in await _snmp_walk(cfg, OID_IF_ALIAS, timeout=timeout))
        speeds = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_IF_SPEED, timeout=timeout))
        hspeeds = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_IF_HIGH_SPEED, timeout=timeout))
        admin = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_IF_ADMIN, timeout=timeout))
        oper = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_IF_OPER, timeout=timeout))
        in_oct = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_IF_HC_IN, timeout=timeout))
        out_oct = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_IF_HC_OUT, timeout=timeout))
        macs = dict((k.rsplit('.', 1)[1], _to_str(v)) for k, v in await _snmp_walk(cfg, OID_IF_PHYS_ADDR, timeout=timeout))

        all_idx = set().union(descrs, names, aliases, speeds, hspeeds, admin, oper, in_oct, out_oct, macs)
        interfaces = []
        for idx in sorted(all_idx, key=lambda x: (int(x) if x.isdigit() else 0)):
            speed_mbps = hspeeds.get(idx) or (int((speeds.get(idx) or 0) / 1_000_000) if speeds.get(idx) else None)
            interfaces.append({
                "if_index": _to_int(idx),
                "if_descr": descrs.get(idx),
                "if_name": names.get(idx) or descrs.get(idx),
                "alias": aliases.get(idx),
                "mac": macs.get(idx),
                "speed_mbps": speed_mbps,
                "admin_status": IF_ADMIN_STATUS.get(admin.get(idx)),
                "oper_status": IF_OPER_STATUS.get(oper.get(idx)),
                "in_octets": in_oct.get(idx),
                "out_octets": out_oct.get(idx),
            })
        result["interfaces"] = interfaces

        # -- CPU / memory (best-effort from hostResources or vendor OIDs) --
        try:
            cpu_rows = await _snmp_walk(cfg, OID_MIKROTIK_CPU, timeout=timeout)
            if cpu_rows:
                vals = [_to_int(v) for _, v in cpu_rows if _to_int(v) is not None]
                if vals:
                    result["cpu_percent"] = sum(vals) / len(vals)
        except Exception:
            pass
        try:
            descr_map = dict((k.rsplit('.', 1)[1], _to_str(v)) for k, v in await _snmp_walk(cfg, OID_HOST_STORAGE_DESCR, timeout=timeout))
            total_map = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_HOST_MEM_TOTAL, timeout=timeout))
            used_map = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_HOST_MEM_USED, timeout=timeout))
            for idx, desc in descr_map.items():
                if desc and ('memory' in desc.lower() or 'ram' in desc.lower() or 'physical' in desc.lower()):
                    total = total_map.get(idx)
                    used = used_map.get(idx)
                    if total and used and total > 0:
                        result["memory_total"] = total * 1024
                        result["memory_used"] = used * 1024
                        result["memory_percent"] = round(used / total * 100, 1)
                        break
        except Exception:
            pass

        # -- Temperature / PSU (best-effort ENTITY-SENSOR-MIB) -------------
        try:
            types = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_ENT_SENSOR_TYPE, timeout=timeout))
            vals = dict((k.rsplit('.', 1)[1], _to_int(v)) for k, v in await _snmp_walk(cfg, OID_ENT_SENSOR_VALUE, timeout=timeout))
            names_ent = dict((k.rsplit('.', 1)[1], _to_str(v)) for k, v in await _snmp_walk(cfg, OID_ENT_NAME, timeout=timeout))
            for idx, t in types.items():
                if t == 8:  # celsius
                    v = vals.get(idx)
                    if v is not None:
                        result["temperature_c"] = v
                        break
            # PSU status heuristic — read entPhysicalName for anything with "psu"/"power"
            for idx, nm in names_ent.items():
                if nm and ('psu' in nm.lower() or 'power' in nm.lower()):
                    result["psu_status"].append({"name": nm, "status": "unknown"})
        except Exception:
            pass

        result["sync_ok"] = True
        return result
    except Exception as e:
        result["last_error"] = str(e)
        return result


# ----------------------------------------------------------------------------
# Storage helpers
# ----------------------------------------------------------------------------
async def _save_config(db, device_id: str, cfg_in: SNMPConfigIn, cipher: Fernet) -> dict:
    doc = await db.snmp_configs.find_one({"device_id": device_id}) or {}
    payload = {
        "device_id": device_id,
        "host": cfg_in.host,
        "port": cfg_in.port,
        "version": cfg_in.version,
        "poll_interval_minutes": cfg_in.poll_interval_minutes,
        "enabled": cfg_in.enabled,
        "timeout_seconds": cfg_in.timeout_seconds,
        "v3_username": cfg_in.v3_username or None,
        "v3_auth_protocol": cfg_in.v3_auth_protocol or None,
        "v3_priv_protocol": cfg_in.v3_priv_protocol or None,
        "updated_at": _now(),
    }
    if cfg_in.community:
        payload["community_enc"] = cipher.encrypt(cfg_in.community.encode()).decode()
    elif "community_enc" not in doc:
        payload["community_enc"] = None
    if cfg_in.v3_auth_password:
        payload["v3_auth_enc"] = cipher.encrypt(cfg_in.v3_auth_password.encode()).decode()
    if cfg_in.v3_priv_password:
        payload["v3_priv_enc"] = cipher.encrypt(cfg_in.v3_priv_password.encode()).decode()
    if not doc:
        payload["id"] = _new_id()
        payload["created_at"] = _now()
        await db.snmp_configs.insert_one(payload)
    else:
        await db.snmp_configs.update_one({"device_id": device_id}, {"$set": payload})
    return await db.snmp_configs.find_one({"device_id": device_id}, {"_id": 0})


def _config_to_out(doc: dict) -> dict:
    if not doc:
        return None
    return {
        "device_id": doc["device_id"],
        "host": doc.get("host", ""),
        "port": doc.get("port", 161),
        "version": doc.get("version", "v2c"),
        "poll_interval_minutes": doc.get("poll_interval_minutes", 5),
        "enabled": bool(doc.get("enabled", True)),
        "timeout_seconds": doc.get("timeout_seconds", 5),
        "has_credentials": bool(doc.get("community_enc") or doc.get("v3_auth_enc")),
        "v3_username": doc.get("v3_username"),
        "v3_auth_protocol": doc.get("v3_auth_protocol"),
        "v3_priv_protocol": doc.get("v3_priv_protocol"),
        "last_sync_at": doc.get("last_sync_at"),
        "last_sync_ok": doc.get("last_sync_ok"),
        "last_error": doc.get("last_error"),
    }


async def _load_and_decrypt(db, device_id: str, cipher: Fernet) -> Optional[dict]:
    doc = await db.snmp_configs.find_one({"device_id": device_id})
    if not doc or not doc.get("enabled"):
        return None
    cfg = dict(doc)
    if cfg.get("community_enc"):
        try:
            cfg["community"] = cipher.decrypt(cfg["community_enc"].encode()).decode()
        except InvalidToken:
            cfg["community"] = None
    if cfg.get("v3_auth_enc"):
        try:
            cfg["v3_auth_password_plain"] = cipher.decrypt(cfg["v3_auth_enc"].encode()).decode()
        except InvalidToken:
            cfg["v3_auth_password_plain"] = None
    if cfg.get("v3_priv_enc"):
        try:
            cfg["v3_priv_password_plain"] = cipher.decrypt(cfg["v3_priv_enc"].encode()).decode()
        except InvalidToken:
            cfg["v3_priv_password_plain"] = None
    return cfg


async def _run_sync(db, cipher: Fernet, device_id: str) -> dict:
    cfg = await _load_and_decrypt(db, device_id, cipher)
    if not cfg:
        return {"ok": False, "error": "SNMP not configured or disabled"}
    telemetry = await poll_device(cfg, timeout=float(cfg.get("timeout_seconds", 5)))
    # Persist telemetry
    telemetry["device_id"] = device_id
    await db.device_telemetry.update_one(
        {"device_id": device_id},
        {"$set": telemetry},
        upsert=True,
    )
    # Update config's last sync status
    await db.snmp_configs.update_one(
        {"device_id": device_id},
        {"$set": {
            "last_sync_at": telemetry["polled_at"],
            "last_sync_ok": telemetry["sync_ok"],
            "last_error": telemetry.get("last_error"),
        }},
    )
    return {"ok": telemetry["sync_ok"], "telemetry": telemetry}


# ----------------------------------------------------------------------------
# FastAPI router
# ----------------------------------------------------------------------------
def build_snmp_router(get_current_user, require_roles) -> APIRouter:
    r = APIRouter(prefix="/snmp", tags=["snmp"])

    @r.get("/status")
    async def snmp_status(request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        total = await db.snmp_configs.count_documents({})
        enabled = await db.snmp_configs.count_documents({"enabled": True})
        ok = await db.snmp_configs.count_documents({"last_sync_ok": True})
        return {
            "snmp_available": _SNMP_AVAILABLE,
            "configured_devices": total,
            "enabled_devices": enabled,
            "successful_last_syncs": ok,
        }

    @r.get("/devices/{device_id}/config")
    async def get_config(device_id: str, request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        doc = await db.snmp_configs.find_one({"device_id": device_id}, {"_id": 0})
        return _config_to_out(doc) or {"device_id": device_id, "has_credentials": False, "enabled": False}

    @r.put("/devices/{device_id}/config")
    async def put_config(device_id: str, body: SNMPConfigIn, request: Request, user: dict = Depends(require_roles("admin", "supervisor"))):
        db = request.app.state.db
        # verify device exists
        dev = await db.devices.find_one({"id": device_id})
        if not dev:
            raise HTTPException(404, "Device not found")
        cipher = await _get_cipher(db)
        saved = await _save_config(db, device_id, body, cipher)
        return _config_to_out(saved)

    @r.delete("/devices/{device_id}/config")
    async def delete_config(device_id: str, request: Request, user: dict = Depends(require_roles("admin", "supervisor"))):
        db = request.app.state.db
        await db.snmp_configs.delete_one({"device_id": device_id})
        await db.device_telemetry.delete_one({"device_id": device_id})
        return {"ok": True}

    @r.post("/devices/{device_id}/discover")
    async def discover_now(device_id: str, request: Request, user: dict = Depends(require_roles("admin", "supervisor", "engineer"))):
        db = request.app.state.db
        cipher = await _get_cipher(db)
        return await _run_sync(db, cipher, device_id)

    @r.post("/devices/{device_id}/sync")
    async def sync_now(device_id: str, request: Request, user: dict = Depends(require_roles("admin", "supervisor", "engineer"))):
        db = request.app.state.db
        cipher = await _get_cipher(db)
        return await _run_sync(db, cipher, device_id)

    @r.get("/devices/{device_id}/telemetry")
    async def get_telemetry(device_id: str, request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        doc = await db.device_telemetry.find_one({"device_id": device_id}, {"_id": 0})
        # Always return a shape — even if never synced (graceful fallback).
        if not doc:
            return {
                "device_id": device_id,
                "sync_ok": None,
                "last_error": None,
                "polled_at": None,
                "system": None,
                "interfaces": [],
                "cpu_percent": None,
                "memory_percent": None,
                "temperature_c": None,
                "psu_status": [],
                "configured": False,
            }
        cfg = await db.snmp_configs.find_one({"device_id": device_id}, {"_id": 0})
        doc["configured"] = bool(cfg)
        doc["config"] = _config_to_out(cfg) if cfg else None
        return doc

    return r


# ----------------------------------------------------------------------------
# Background auto-sync loop — non-blocking, resilient
# ----------------------------------------------------------------------------
async def auto_sync_loop(app):
    logger.info("SNMP auto-sync loop started (available=%s)", _SNMP_AVAILABLE)
    last_run: Dict[str, datetime] = {}
    while True:
        try:
            await asyncio.sleep(30)  # tick every 30s
            if not _SNMP_AVAILABLE:
                await asyncio.sleep(300)  # nothing to do
                continue
            db = app.state.db
            cipher = await _get_cipher(db)
            now = datetime.now(timezone.utc)
            async for cfg_doc in db.snmp_configs.find({"enabled": True}, {"_id": 0}):
                interval = int(cfg_doc.get("poll_interval_minutes", 5) or 0)
                if interval <= 0:
                    continue
                did = cfg_doc["device_id"]
                last = last_run.get(did)
                if last is None or (now - last).total_seconds() >= interval * 60:
                    try:
                        await _run_sync(db, cipher, did)
                    except Exception as e:  # pragma: no cover
                        logger.exception("SNMP auto-sync failed for device %s: %s", did, e)
                    last_run[did] = now
        except asyncio.CancelledError:
            logger.info("SNMP auto-sync loop cancelled")
            return
        except Exception as e:  # pragma: no cover
            logger.exception("SNMP auto-sync loop error: %s", e)
