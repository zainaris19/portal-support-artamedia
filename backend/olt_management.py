"""OLT Management — generic multi-vendor router (READ-ONLY v1).

Frontend talks ONLY to these normalized endpoints; it never sees vendor CLI.
Vendor specifics live entirely in olt/ adapters. Adding a vendor later = new
adapter + registry entry; these endpoints and the frontend stay unchanged.

Security: credentials are Fernet-encrypted (reusing the shared IPAM key) and are
NEVER returned to the frontend. All CLI runs server-side.

Performance: a bounded background poller refreshes light state (version/card/
onu-state/uncfg) per each OLT's poll_interval, with a global concurrency limit,
per-OLT non-overlapping lock, and hard timeouts. Heavy per-ONU detail/optical/
running-config is fetched ON-DEMAND (with a short cache) only.
"""
from __future__ import annotations
import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from cryptography.fernet import Fernet, InvalidToken

from olt.registry import (VENDOR_CATALOG, get_adapter_class, is_implemented, model_meta,
                          supports_provisioning as _supports_prov)
from olt.base import is_unsupported, ONU_ONLINE, ONU_LOS, ONU_DYING_GASP, ONU_OFFLINE
from olt.transport import build_transport, OLTConnectionError

logger = logging.getLogger("noc.olt")

DETAIL_TTL = 300           # seconds — on-demand ONU detail cache
POLL_CONCURRENCY = 2       # max OLTs polled in parallel
SWEEP_BATCH = 8            # ONUs enriched per poll cycle (bounded)
DETAIL_STALE = 6 * 3600    # re-sweep detail after 6h

_POLL_LOCKS: Dict[str, asyncio.Lock] = {}
_POLL_SEM = asyncio.Semaphore(POLL_CONCURRENCY)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask(v: str) -> str:
    if not v:
        return ""
    return "***" if len(v) <= 3 else v[:1] + "\u2026" + v[-1:]


async def _get_cipher(db) -> Fernet:
    doc = await db.system_config.find_one({"_id": "ipam_key"})
    if doc and doc.get("key"):
        return Fernet(doc["key"].encode())
    key = Fernet.generate_key().decode()
    await db.system_config.update_one({"_id": "ipam_key"},
                                      {"$set": {"key": key, "created_at": _now_iso()}}, upsert=True)
    return Fernet(key.encode())


# --- models -------------------------------------------------------------------
class OLTIn(BaseModel):
    name: str
    location_id: Optional[str] = None
    vendor: str
    model: str
    host: str
    protocol: str = "telnet"
    port: int = 23
    username: str = ""
    password: Optional[str] = None
    enable_password: Optional[str] = None
    timeout: int = 15
    poll_interval: int = 300
    enabled: bool = True


class CustomerMapIn(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    match_by: str = "manual"   # manual | serial | name


class ProvisionSettingsIn(BaseModel):
    enabled: bool


class ProvisionProfileIn(BaseModel):
    name: str
    vendor: str = "ZTE"
    model: str = "C320"
    description: Optional[str] = None
    onu_type: Optional[str] = None
    vlan: Optional[str] = None
    tcont_profile: Optional[str] = None
    service_profile: Optional[str] = None
    command_template: Optional[str] = None   # placeholders: {pon} {onuid} {sn} {name} {vlan} {onu_type} ...


class AuthorizeIn(BaseModel):
    profile_id: Optional[str] = None
    pon: str
    onu_id: str
    sn: str
    name: Optional[str] = None
    onu_type: Optional[str] = None
    vlan: Optional[str] = None
    tcont_profile: Optional[str] = None
    service_profile: Optional[str] = None
    command_template: Optional[str] = None
    extra_vars: Optional[Dict[str, Any]] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    dry_run: bool = False


class RenameIn(BaseModel):
    name: str
    dry_run: bool = False


# --- helpers ------------------------------------------------------------------
def _public(doc: Dict[str, Any]) -> Dict[str, Any]:
    meta = model_meta(doc.get("vendor"), doc.get("model")) or {}
    return {
        "id": doc.get("id"), "name": doc.get("name"), "vendor": doc.get("vendor"),
        "model": doc.get("model"), "location_id": doc.get("location_id"),
        "host": doc.get("host"), "protocol": doc.get("protocol"), "port": doc.get("port"),
        "username": doc.get("username", ""), "password_masked": doc.get("password_masked", ""),
        "password_set": bool(doc.get("password_enc")),
        "enable_password_set": bool(doc.get("enable_password_enc")),
        "timeout": doc.get("timeout", 15), "poll_interval": doc.get("poll_interval", 300),
        "enabled": doc.get("enabled", True),
        "implemented": is_implemented(doc.get("vendor"), doc.get("model")),
        "supports_provisioning": _supports_prov(doc.get("vendor"), doc.get("model")),
        "needs_enable": meta.get("needs_enable", False),
        "updated_at": doc.get("updated_at"),
    }


def _summary_from_states(states: List[dict]) -> Dict[str, Any]:
    def c(st):
        return sum(1 for o in states if o.get("status") == st)
    pons = {o.get("pon") for o in states if o.get("pon")}
    return {"total_onu": len(states), "online_onu": c(ONU_ONLINE), "los_onu": c(ONU_LOS),
            "dying_gasp_onu": c(ONU_DYING_GASP), "offline_onu": c(ONU_OFFLINE),
            "total_pon": len(pons)}


def _card(doc: Dict[str, Any], cache: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    cache = cache or {}
    summ = cache.get("summary") or {}
    return {
        "id": doc.get("id"), "name": doc.get("name"), "vendor": doc.get("vendor"),
        "model": doc.get("model"), "location_id": doc.get("location_id"),
        "host": doc.get("host"), "protocol": doc.get("protocol"),
        "implemented": is_implemented(doc.get("vendor"), doc.get("model")),
        "enabled": doc.get("enabled", True),
        "status": cache.get("connected") and "ONLINE" or ("UNREACHABLE" if cache.get("last_poll") else "UNKNOWN"),
        "connected": bool(cache.get("connected")),
        "error": cache.get("error"),
        "software_version": cache.get("software_version"),
        "total_pon": summ.get("total_pon"), "total_onu": summ.get("total_onu"),
        "online_onu": summ.get("online_onu"), "los_onu": summ.get("los_onu"),
        "dying_gasp_onu": summ.get("dying_gasp_onu"), "offline_onu": summ.get("offline_onu"),
        "unconfigured_onu": cache.get("unconfigured_count"),
        "last_poll": cache.get("last_poll"),
    }


async def _decrypt(db, doc) -> tuple[str, Optional[str]]:
    cipher = await _get_cipher(db)
    pw = ""
    en = None
    try:
        if doc.get("password_enc"):
            pw = cipher.decrypt(doc["password_enc"].encode()).decode()
        if doc.get("enable_password_enc"):
            en = cipher.decrypt(doc["enable_password_enc"].encode()).decode()
    except InvalidToken:
        raise HTTPException(500, "Gagal decrypt credential OLT. Simpan ulang credential.")
    return pw, en


async def _open_adapter(db, doc):
    """Returns (transport, adapter) with an open session. Caller must close transport."""
    cls = get_adapter_class(doc.get("vendor"), doc.get("model"))
    if cls is None:
        raise HTTPException(400, f"Adapter untuk {doc.get('vendor')} {doc.get('model')} belum tersedia")
    pw, en = await _decrypt(db, doc)
    meta = model_meta(doc.get("vendor"), doc.get("model")) or {}
    transport = build_transport(doc, pw, en, meta.get("needs_enable", False))
    await transport.login()
    return transport, cls(transport, doc)


async def _light_poll(db, doc) -> Dict[str, Any]:
    """Run the lightweight command set and persist a cache row."""
    olt_id = doc["id"]
    cache: Dict[str, Any] = {"olt_id": olt_id, "last_poll": _now_iso()}
    transport = None
    try:
        transport, adapter = await _open_adapter(db, doc)
        sysinfo = await adapter.get_system_info()
        states = await adapter.get_onu_states()
        uncfg = await adapter.get_unconfigured_onu()
        cards = await adapter.get_cards()
        states = [] if is_unsupported(states) else states
        uncfg = [] if is_unsupported(uncfg) else uncfg
        cards = [] if is_unsupported(cards) else cards
        cache.update({
            "connected": True, "error": None,
            "software_version": (sysinfo or {}).get("software_version") if not is_unsupported(sysinfo) else None,
            "summary": _summary_from_states(states),
            "onu_states": states, "cards": cards,
            "unconfigured": uncfg, "unconfigured_count": len(uncfg),
        })
    except (OLTConnectionError, asyncio.TimeoutError) as e:
        cache.update({"connected": False, "error": str(e)[:300]})
    except Exception as e:  # noqa: BLE001
        cache.update({"connected": False, "error": str(e)[:300]})
        logger.warning("OLT poll error id=%s: %s", olt_id, str(e)[:200])
    finally:
        if transport is not None:
            try:
                await transport.close()
            except Exception:
                pass
    await db.olt_poll_cache.update_one({"_id": olt_id}, {"$set": cache}, upsert=True)
    # bounded detail sweep (best-effort, same connection avoided to keep it simple)
    if cache.get("connected"):
        try:
            await _detail_sweep(db, doc, cache.get("onu_states") or [])
        except Exception as e:  # noqa: BLE001
            logger.info("OLT sweep skipped id=%s: %s", olt_id, str(e)[:150])
    return cache


async def _detail_sweep(db, doc, states: List[dict]):
    """Enrich a small batch of ONUs' detail cache so the ONU table populates
    over time without heavy per-refresh load."""
    olt_id = doc["id"]
    now = time.time()
    have = {}
    async for r in db.olt_onu_detail_cache.find({"olt_id": olt_id}):
        have[r.get("onu_index")] = r.get("fetched_at", 0)
    todo = [o["onu_index"] for o in states if o.get("onu_index")
            and (o["onu_index"] not in have or now - have[o["onu_index"]] > DETAIL_STALE)]
    todo = todo[:SWEEP_BATCH]
    if not todo:
        return
    transport = None
    try:
        transport, adapter = await _open_adapter(db, doc)
        for idx in todo:
            try:
                det = await adapter.get_onu_detail(idx)
                if not is_unsupported(det):
                    await db.olt_onu_detail_cache.update_one(
                        {"olt_id": olt_id, "onu_index": idx},
                        {"$set": {"olt_id": olt_id, "onu_index": idx, "detail": det,
                                  "fetched_at": time.time(), "fetched_iso": _now_iso()}},
                        upsert=True)
            except Exception:  # noqa: BLE001
                continue
    finally:
        if transport is not None:
            try:
                await transport.close()
            except Exception:
                pass


async def _poll_one(db, doc):
    olt_id = doc["id"]
    lock = _POLL_LOCKS.setdefault(olt_id, asyncio.Lock())
    if lock.locked():
        return  # non-overlapping: previous poll still running
    async with lock:
        async with _POLL_SEM:
            await _light_poll(db, doc)


async def olt_poller_loop(app):
    await asyncio.sleep(5)
    logger.info("OLT poller loop started")
    while True:
        try:
            db = app.state.db
            now = time.time()
            async for doc in db.olt_devices.find({"enabled": True}):
                if not is_implemented(doc.get("vendor"), doc.get("model")):
                    continue
                cache = await db.olt_poll_cache.find_one({"_id": doc["id"]})
                interval = int(doc.get("poll_interval") or 300)
                last = 0.0
                if cache and cache.get("last_poll"):
                    try:
                        last = datetime.fromisoformat(cache["last_poll"]).timestamp()
                    except Exception:
                        last = 0.0
                if now - last >= interval:
                    asyncio.create_task(_poll_one(db, doc))
        except Exception as e:  # noqa: BLE001
            logger.warning("OLT poller loop error: %s", str(e)[:200])
        await asyncio.sleep(15)


def start_olt_poller(app):
    return asyncio.create_task(olt_poller_loop(app))


# --- router -------------------------------------------------------------------
def build_olt_router(get_current_user, require_roles) -> APIRouter:
    r = APIRouter(prefix="/olt", tags=["olt"])
    ADMIN = require_roles("admin")

    async def _get_doc(db, olt_id: str) -> Dict[str, Any]:
        doc = await db.olt_devices.find_one({"id": olt_id})
        if not doc:
            raise HTTPException(404, "OLT tidak ditemukan")
        return doc

    async def _get_adapter_impl(db, doc):
        if not is_implemented(doc.get("vendor"), doc.get("model")):
            raise HTTPException(400, f"Adapter {doc.get('vendor')} {doc.get('model')} belum tersedia (Coming Soon)")

    # ---------- catalog ----------
    @r.get("/catalog")
    async def catalog(user=Depends(get_current_user)):
        return {"vendors": VENDOR_CATALOG}

    # ---------- settings CRUD ----------
    @r.get("")
    async def list_olts(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        out = []
        async for doc in db.olt_devices.find().sort("name", 1):
            cache = await db.olt_poll_cache.find_one({"_id": doc["id"]})
            out.append({**_public(doc), **{"summary_card": _card(doc, cache)}})
        return {"items": out}

    @r.post("")
    async def create_olt(body: OLTIn, request: Request, user=Depends(ADMIN)):
        db = request.app.state.db
        cipher = await _get_cipher(db)
        oid = str(uuid.uuid4())
        doc: Dict[str, Any] = {
            "id": oid, "name": body.name.strip(), "location_id": body.location_id,
            "vendor": body.vendor.strip(), "model": body.model.strip(),
            "host": body.host.strip(), "protocol": (body.protocol or "telnet").lower(),
            "port": body.port, "username": (body.username or "").strip(),
            "timeout": body.timeout, "poll_interval": body.poll_interval,
            "enabled": body.enabled, "updated_at": _now_iso(), "created_at": _now_iso(),
        }
        if body.password:
            doc["password_enc"] = cipher.encrypt(body.password.encode()).decode()
            doc["password_masked"] = _mask(body.password)
        if body.enable_password:
            doc["enable_password_enc"] = cipher.encrypt(body.enable_password.encode()).decode()
        await db.olt_devices.insert_one(doc)
        return _public(doc)

    @r.get("/{olt_id}")
    async def get_olt(olt_id: str, request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        doc = await _get_doc(db, olt_id)
        cache = await db.olt_poll_cache.find_one({"_id": olt_id})
        return {**_public(doc), "summary_card": _card(doc, cache)}

    @r.put("/{olt_id}")
    async def update_olt(olt_id: str, body: OLTIn, request: Request, user=Depends(ADMIN)):
        db = request.app.state.db
        existing = await _get_doc(db, olt_id)
        cipher = await _get_cipher(db)
        upd: Dict[str, Any] = {
            "name": body.name.strip(), "location_id": body.location_id,
            "vendor": body.vendor.strip(), "model": body.model.strip(),
            "host": body.host.strip(), "protocol": (body.protocol or "telnet").lower(),
            "port": body.port, "username": (body.username or "").strip(),
            "timeout": body.timeout, "poll_interval": body.poll_interval,
            "enabled": body.enabled, "updated_at": _now_iso(),
        }
        if body.password:
            upd["password_enc"] = cipher.encrypt(body.password.encode()).decode()
            upd["password_masked"] = _mask(body.password)
        if body.enable_password:
            upd["enable_password_enc"] = cipher.encrypt(body.enable_password.encode()).decode()
        await db.olt_devices.update_one({"id": olt_id}, {"$set": upd})
        return _public({**existing, **upd})

    @r.delete("/{olt_id}")
    async def delete_olt(olt_id: str, request: Request, user=Depends(ADMIN)):
        db = request.app.state.db
        await db.olt_devices.delete_one({"id": olt_id})
        await db.olt_poll_cache.delete_one({"_id": olt_id})
        await db.olt_onu_detail_cache.delete_many({"olt_id": olt_id})
        return {"ok": True}

    @r.post("/{olt_id}/test-connection")
    async def test_connection(olt_id: str, request: Request, user=Depends(ADMIN)):
        db = request.app.state.db
        doc = await _get_doc(db, olt_id)
        await _get_adapter_impl(db, doc)
        transport = None
        try:
            transport, adapter = await _open_adapter(db, doc)
            res = await adapter.test_connection()
            return {"ok": True, **res}
        except (OLTConnectionError, asyncio.TimeoutError) as e:
            return {"ok": False, "message": str(e)[:300]}
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "message": str(e)[:300]}
        finally:
            if transport is not None:
                try:
                    await transport.close()
                except Exception:
                    pass

    # ---------- management (read) ----------
    @r.post("/{olt_id}/poll")
    async def manual_poll(olt_id: str, request: Request, user=Depends(require_roles("admin", "supervisor", "engineer"))):
        db = request.app.state.db
        doc = await _get_doc(db, olt_id)
        await _get_adapter_impl(db, doc)
        cache = await _light_poll(db, doc)
        return {"ok": cache.get("connected", False), "error": cache.get("error"),
                "last_poll": cache.get("last_poll"), "summary": cache.get("summary")}

    @r.get("/{olt_id}/summary")
    async def summary(olt_id: str, request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        doc = await _get_doc(db, olt_id)
        cache = await db.olt_poll_cache.find_one({"_id": olt_id}) or {}
        return {"olt": _public(doc), "card": _card(doc, cache),
                "connected": bool(cache.get("connected")), "error": cache.get("error"),
                "last_poll": cache.get("last_poll")}

    @r.get("/{olt_id}/cards")
    async def cards(olt_id: str, request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        await _get_doc(db, olt_id)
        cache = await db.olt_poll_cache.find_one({"_id": olt_id}) or {}
        return {"items": cache.get("cards") or [], "last_poll": cache.get("last_poll")}

    @r.get("/{olt_id}/pon")
    async def pon_view(olt_id: str, request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        await _get_doc(db, olt_id)
        cache = await db.olt_poll_cache.find_one({"_id": olt_id}) or {}
        states = cache.get("onu_states") or []
        pons: Dict[str, Dict[str, Any]] = {}
        for o in states:
            p = o.get("pon")
            if not p:
                continue
            g = pons.setdefault(p, {"pon": p, "total_onu": 0, "online": 0, "los": 0,
                                    "dying_gasp": 0, "offline": 0})
            g["total_onu"] += 1
            st = o.get("status")
            key = {ONU_ONLINE: "online", ONU_LOS: "los", ONU_DYING_GASP: "dying_gasp",
                   ONU_OFFLINE: "offline"}.get(st)
            if key:
                g[key] += 1
        return {"items": sorted(pons.values(), key=lambda x: x["pon"]),
                "last_poll": cache.get("last_poll")}

    @r.get("/{olt_id}/unconfigured")
    async def unconfigured(olt_id: str, request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        await _get_doc(db, olt_id)
        cache = await db.olt_poll_cache.find_one({"_id": olt_id}) or {}
        return {"items": cache.get("unconfigured") or [], "last_poll": cache.get("last_poll")}

    @r.get("/{olt_id}/alarms")
    async def alarms(olt_id: str, request: Request, user=Depends(get_current_user)):
        # Not part of the proven ZTE C320 read-only set yet.
        return {"supported": False, "items": [],
                "message": "Not Supported by This Adapter"}

    @r.get("/{olt_id}/onus")
    async def onus(olt_id: str, request: Request, user=Depends(get_current_user),
                   q: str = "", pon: str = "", status: str = "", model: str = "",
                   vlan: str = "", page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=500)):
        db = request.app.state.db
        await _get_doc(db, olt_id)
        cache = await db.olt_poll_cache.find_one({"_id": olt_id}) or {}
        states = cache.get("onu_states") or []
        details: Dict[str, dict] = {}
        async for d in db.olt_onu_detail_cache.find({"olt_id": olt_id}):
            details[d.get("onu_index")] = d.get("detail") or {}
        maps: Dict[str, dict] = {}
        async for m in db.olt_customer_map.find({"olt_id": olt_id}):
            maps[m.get("onu_index")] = {"customer_id": m.get("customer_id"),
                                        "customer_name": m.get("customer_name")}
        rows: List[Dict[str, Any]] = []
        for o in states:
            idx = o.get("onu_index")
            det = details.get(idx, {})
            rows.append({
                "olt_id": olt_id, "pon": o.get("pon"), "onu_id": o.get("onu_id"),
                "onu_index": idx, "status": o.get("status"),
                "name": det.get("name"), "model": det.get("model") or o.get("model"),
                "serial_number": det.get("serial_number") or o.get("serial_number"),
                "rx_power": det.get("rx_power"), "tx_power": det.get("tx_power"),
                "profile": det.get("profile"),
                "upstream_limit": det.get("upstream_limit"),
                "downstream_limit": det.get("downstream_limit"),
                "internet_vlan": det.get("internet_vlan"), "tr069_vlan": det.get("tr069_vlan"),
                "customer": maps.get(idx),
                "last_update": cache.get("last_poll"),
            })
        # filters
        def match(row):
            if pon and row.get("pon") != pon:
                return False
            if status and status != "all" and row.get("status") != status:
                return False
            if model and model != "all" and (model.lower() not in (row.get("model") or "").lower()):
                return False
            if vlan and str(vlan) not in (str(row.get("internet_vlan")), str(row.get("tr069_vlan"))):
                return False
            if q:
                hay = " ".join(str(x or "") for x in [row.get("name"), row.get("serial_number"),
                                                      row.get("onu_index"), row.get("model"),
                                                      row.get("internet_vlan"), row.get("tr069_vlan")]).lower()
                if q.lower() not in hay:
                    return False
            return True
        filtered = [r_ for r_ in rows if match(r_)]
        total = len(filtered)
        start = (page - 1) * limit
        models = sorted({r_["model"] for r_ in rows if r_.get("model")})
        return {"items": filtered[start:start + limit], "total": total, "page": page,
                "limit": limit, "models": models, "last_poll": cache.get("last_poll")}

    @r.get("/{olt_id}/onu/{onu_index:path}")
    async def onu_detail(olt_id: str, onu_index: str, request: Request,
                         refresh: bool = False, user=Depends(get_current_user)):
        db = request.app.state.db
        doc = await _get_doc(db, olt_id)
        await _get_adapter_impl(db, doc)
        cached = await db.olt_onu_detail_cache.find_one({"olt_id": olt_id, "onu_index": onu_index})
        fresh = cached and (time.time() - cached.get("fetched_at", 0) < DETAIL_TTL)
        if fresh and not refresh:
            detail = cached["detail"]
        else:
            transport = None
            try:
                transport, adapter = await _open_adapter(db, doc)
                det = await adapter.get_onu_detail(onu_index)
                if is_unsupported(det):
                    raise HTTPException(400, "Adapter tidak mendukung detail ONU")
                detail = det
                await db.olt_onu_detail_cache.update_one(
                    {"olt_id": olt_id, "onu_index": onu_index},
                    {"$set": {"olt_id": olt_id, "onu_index": onu_index, "detail": detail,
                              "fetched_at": time.time(), "fetched_iso": _now_iso()}}, upsert=True)
            except (OLTConnectionError, asyncio.TimeoutError) as e:
                if cached:
                    detail = cached["detail"]
                else:
                    raise HTTPException(502, f"Tidak dapat mengambil detail ONU: {str(e)[:200]}")
            finally:
                if transport is not None:
                    try:
                        await transport.close()
                    except Exception:
                        pass
        # live status from poll cache
        cache = await db.olt_poll_cache.find_one({"_id": olt_id}) or {}
        st = next((o for o in (cache.get("onu_states") or []) if o.get("onu_index") == onu_index), {})
        mp = await db.olt_customer_map.find_one({"olt_id": olt_id, "onu_index": onu_index})
        return {**detail, "status": st.get("status"), "channel": st.get("channel"),
                "admin_state": st.get("admin_state"), "omcc_state": st.get("omcc_state"),
                "phase_state": st.get("phase_state"),
                "customer": ({"customer_id": mp.get("customer_id"),
                              "customer_name": mp.get("customer_name")} if mp else None),
                "genieacs_serial": detail.get("serial_number"),
                "last_poll": cache.get("last_poll")}

    # ---------- customer mapping ----------
    @r.post("/{olt_id}/onu/{onu_index:path}/customer")
    async def map_customer(olt_id: str, onu_index: str, body: CustomerMapIn, request: Request,
                           user=Depends(require_roles("admin", "supervisor", "engineer"))):
        db = request.app.state.db
        await _get_doc(db, olt_id)
        await db.olt_customer_map.update_one(
            {"olt_id": olt_id, "onu_index": onu_index},
            {"$set": {"olt_id": olt_id, "onu_index": onu_index,
                      "customer_id": body.customer_id, "customer_name": body.customer_name,
                      "match_by": body.match_by, "updated_at": _now_iso()}}, upsert=True)
        return {"ok": True}

    @r.delete("/{olt_id}/onu/{onu_index:path}/customer")
    async def unmap_customer(olt_id: str, onu_index: str, request: Request,
                             user=Depends(require_roles("admin", "supervisor", "engineer"))):
        db = request.app.state.db
        await db.olt_customer_map.delete_one({"olt_id": olt_id, "onu_index": onu_index})
        return {"ok": True}

    # ---------- CRM snapshot (read-only) ----------
    @r.get("/customer-snapshot/{customer_id}")
    async def customer_snapshot(customer_id: str, request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        mp = await db.olt_customer_map.find_one({"customer_id": customer_id})
        if not mp:
            return {"mapped": False}
        doc = await db.olt_devices.find_one({"id": mp["olt_id"]})
        if not doc:
            return {"mapped": False}
        cache = await db.olt_poll_cache.find_one({"_id": mp["olt_id"]}) or {}
        st = next((o for o in (cache.get("onu_states") or []) if o.get("onu_index") == mp["onu_index"]), {})
        det = await db.olt_onu_detail_cache.find_one({"olt_id": mp["olt_id"], "onu_index": mp["onu_index"]})
        d = (det or {}).get("detail", {})
        return {"mapped": True, "olt_id": doc["id"], "olt_name": doc.get("name"),
                "location_id": doc.get("location_id"), "vendor": doc.get("vendor"),
                "model": doc.get("model"), "pon": st.get("pon") or d.get("pon"),
                "onu_index": mp["onu_index"], "status": st.get("status"),
                "rx_power": d.get("rx_power"), "onu_model": d.get("model"),
                "serial_number": d.get("serial_number"), "last_poll": cache.get("last_poll")}

    # ---------- provisioning (write) ----------
    PROV_WRITE = require_roles("admin", "supervisor", "engineer")
    PROV_DELETE = require_roles("admin", "supervisor")

    async def _prov_enabled(db) -> bool:
        doc = await db.system_config.find_one({"_id": "olt_provisioning"})
        # Default = enabled (feature activated). Admin can turn it off.
        return True if doc is None else bool(doc.get("enabled", True))

    async def _ensure_prov(db):
        if not await _prov_enabled(db):
            raise HTTPException(403, "Provisioning OLT sedang dinonaktifkan. Aktifkan di Settings → Integrations → OLT.")

    async def _audit(db, user, action, olt_id, onu_index, result, extra=None):
        await db.olt_provision_audit.insert_one({
            "id": str(uuid.uuid4()), "ts": _now_iso(),
            "user_id": (user or {}).get("id"), "user_name": (user or {}).get("name"),
            "user_email": (user or {}).get("email"), "role": (user or {}).get("role"),
            "action": action, "olt_id": olt_id, "onu_index": onu_index,
            "ok": bool((result or {}).get("ok")), "dry_run": bool((result or {}).get("dry_run")),
            "error": (result or {}).get("error"),
            "commands": (result or {}).get("commands"),
            "output": ((result or {}).get("output") or "")[:4000],
            **(extra or {}),
        })

    def _prov_result(res, action: str):
        if is_unsupported(res):
            raise HTTPException(400, "Adapter ini belum mendukung provisioning")
        return {"action": action, **res}

    @r.get("/provision/settings")
    async def prov_get_settings(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        return {"enabled": await _prov_enabled(db)}

    @r.put("/provision/settings")
    async def prov_set_settings(body: ProvisionSettingsIn, request: Request, user=Depends(ADMIN)):
        db = request.app.state.db
        await db.system_config.update_one({"_id": "olt_provisioning"},
                                          {"$set": {"enabled": body.enabled, "updated_at": _now_iso(),
                                                    "updated_by": user.get("email")}}, upsert=True)
        return {"enabled": body.enabled}

    @r.get("/provision/profiles")
    async def prov_list_profiles(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        out = []
        async for d in db.olt_provision_profiles.find().sort("name", 1):
            d.pop("_id", None)
            out.append(d)
        return {"items": out}

    @r.post("/provision/profiles")
    async def prov_create_profile(body: ProvisionProfileIn, request: Request, user=Depends(ADMIN)):
        db = request.app.state.db
        doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": _now_iso(), "updated_at": _now_iso()}
        await db.olt_provision_profiles.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.put("/provision/profiles/{profile_id}")
    async def prov_update_profile(profile_id: str, body: ProvisionProfileIn, request: Request, user=Depends(ADMIN)):
        db = request.app.state.db
        await db.olt_provision_profiles.update_one({"id": profile_id},
                                                   {"$set": {**body.model_dump(), "updated_at": _now_iso()}})
        d = await db.olt_provision_profiles.find_one({"id": profile_id})
        if not d:
            raise HTTPException(404, "Profile tidak ditemukan")
        d.pop("_id", None)
        return d

    @r.delete("/provision/profiles/{profile_id}")
    async def prov_delete_profile(profile_id: str, request: Request, user=Depends(ADMIN)):
        db = request.app.state.db
        await db.olt_provision_profiles.delete_one({"id": profile_id})
        return {"ok": True}

    @r.get("/provision/audit")
    async def prov_audit(request: Request, user=Depends(get_current_user),
                         olt_id: str = "", limit: int = Query(100, ge=1, le=500)):
        db = request.app.state.db
        query = {"olt_id": olt_id} if olt_id else {}
        out = []
        async for d in db.olt_provision_audit.find(query).sort("ts", -1).limit(limit):
            d.pop("_id", None)
            out.append(d)
        return {"items": out}

    async def _open_for_write(db, olt_id):
        doc = await _get_doc(db, olt_id)
        await _get_adapter_impl(db, doc)
        return doc

    def _offline_adapter(doc):
        cls = get_adapter_class(doc.get("vendor"), doc.get("model"))
        return cls(None, doc)

    @r.post("/{olt_id}/provision/authorize")
    async def provision_authorize(olt_id: str, body: AuthorizeIn, request: Request, user=Depends(PROV_WRITE)):
        db = request.app.state.db
        await _ensure_prov(db)
        doc = await _open_for_write(db, olt_id)
        params = body.model_dump()
        # merge profile defaults (body overrides profile)
        if body.profile_id:
            prof = await db.olt_provision_profiles.find_one({"id": body.profile_id})
            if prof:
                for k in ("onu_type", "vlan", "tcont_profile", "service_profile", "command_template"):
                    if not params.get(k):
                        params[k] = prof.get(k)
        transport = None
        try:
            if body.dry_run:
                # render commands without opening a device session
                cls = get_adapter_class(doc.get("vendor"), doc.get("model"))
                adapter = cls(None, doc)
                res = await adapter.provision_authorize({**params, "dry_run": True})
            else:
                transport, adapter = await _open_adapter(db, doc)
                res = await adapter.provision_authorize({**params, "dry_run": False})
            result = _prov_result(res, "authorize")
        except HTTPException:
            raise
        except (OLTConnectionError, asyncio.TimeoutError) as e:
            result = {"action": "authorize", "ok": False, "error": str(e)[:300], "commands": [], "output": ""}
        finally:
            if transport is not None:
                try:
                    await transport.close()
                except Exception:
                    pass
        await _audit(db, user, "authorize", olt_id, f"{body.pon}:{body.onu_id}", result,
                     extra={"sn": body.sn, "customer_name": body.customer_name})
        # auto-map customer on a successful (non dry-run) authorize
        if result.get("ok") and not result.get("dry_run") and (body.customer_id or body.customer_name):
            await db.olt_customer_map.update_one(
                {"olt_id": olt_id, "onu_index": f"{body.pon}:{body.onu_id}"},
                {"$set": {"olt_id": olt_id, "onu_index": f"{body.pon}:{body.onu_id}",
                          "customer_id": body.customer_id, "customer_name": body.customer_name,
                          "match_by": "provision", "updated_at": _now_iso()}}, upsert=True)
        return result

    @r.post("/{olt_id}/onu/{onu_index:path}/reboot")
    async def provision_reboot(olt_id: str, onu_index: str, request: Request,
                               dry_run: bool = False, user=Depends(PROV_WRITE)):
        db = request.app.state.db
        await _ensure_prov(db)
        doc = await _open_for_write(db, olt_id)
        transport = None
        try:
            if dry_run:
                res = await _offline_adapter(doc).provision_reboot_onu(onu_index, dry_run=True)
            else:
                transport, adapter = await _open_adapter(db, doc)
                res = await adapter.provision_reboot_onu(onu_index, dry_run=False)
            result = _prov_result(res, "reboot")
        except HTTPException:
            raise
        except (OLTConnectionError, asyncio.TimeoutError) as e:
            result = {"action": "reboot", "ok": False, "error": str(e)[:300], "commands": [], "output": ""}
        finally:
            if transport is not None:
                try:
                    await transport.close()
                except Exception:
                    pass
        await _audit(db, user, "reboot", olt_id, onu_index, result)
        return result

    @r.post("/{olt_id}/onu/{onu_index:path}/rename")
    async def provision_rename(olt_id: str, onu_index: str, body: RenameIn, request: Request, user=Depends(PROV_WRITE)):
        db = request.app.state.db
        await _ensure_prov(db)
        doc = await _open_for_write(db, olt_id)
        transport = None
        try:
            if body.dry_run:
                res = await _offline_adapter(doc).provision_set_name(onu_index, body.name, dry_run=True)
            else:
                transport, adapter = await _open_adapter(db, doc)
                res = await adapter.provision_set_name(onu_index, body.name, dry_run=False)
            result = _prov_result(res, "rename")
        except HTTPException:
            raise
        except (OLTConnectionError, asyncio.TimeoutError) as e:
            result = {"action": "rename", "ok": False, "error": str(e)[:300], "commands": [], "output": ""}
        finally:
            if transport is not None:
                try:
                    await transport.close()
                except Exception:
                    pass
        await _audit(db, user, "rename", olt_id, onu_index, result, extra={"name": body.name})
        return result

    @r.delete("/{olt_id}/onu/{onu_index:path}/provision")
    async def provision_delete(olt_id: str, onu_index: str, request: Request,
                               dry_run: bool = False, user=Depends(PROV_DELETE)):
        db = request.app.state.db
        await _ensure_prov(db)
        doc = await _open_for_write(db, olt_id)
        transport = None
        try:
            if dry_run:
                res = await _offline_adapter(doc).provision_delete_onu(onu_index, dry_run=True)
            else:
                transport, adapter = await _open_adapter(db, doc)
                res = await adapter.provision_delete_onu(onu_index, dry_run=False)
            result = _prov_result(res, "delete")
        except HTTPException:
            raise
        except (OLTConnectionError, asyncio.TimeoutError) as e:
            result = {"action": "delete", "ok": False, "error": str(e)[:300], "commands": [], "output": ""}
        finally:
            if transport is not None:
                try:
                    await transport.close()
                except Exception:
                    pass
        await _audit(db, user, "delete", olt_id, onu_index, result)
        if result.get("ok") and not result.get("dry_run"):
            await db.olt_customer_map.delete_one({"olt_id": olt_id, "onu_index": onu_index})
        return result

    return r
