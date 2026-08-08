"""
UISP integration — mengikuti pola `zabbix_integration.py`:
    - Config URL + API token + ssl_verify disimpan encrypted di collection `uisp_config`.
    - Fernet key: dari env `NOC_ENC_KEY` (fallback ke JWT secret hashed).
    - Endpoint:
        POST /api/uisp/config      simpan config baru (admin only)
        GET  /api/uisp/config      lihat config (token dimasking)
        POST /api/uisp/test        connection test — hit `/api/v2.1/nms/system`
        GET  /api/uisp/status      status koneksi + last sync
        POST /api/uisp/sync        pull sites + devices + links
        GET  /api/uisp/entities?kind=site|device|link  list dari cache
        POST /api/uisp/map         manual mapping UISP entity ↔ topology entity
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger("noc.uisp")


def now_utc() -> datetime: return datetime.now(timezone.utc)
def now_iso() -> str: return now_utc().isoformat()
def new_id() -> str: return str(uuid.uuid4())


def _cipher() -> Fernet:
    """Same pattern as zabbix_integration: derive Fernet key from env or JWT secret."""
    key = os.environ.get("NOC_ENC_KEY")
    if not key:
        secret = os.environ.get("JWT_SECRET", "artamedia-default-secret")
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()).decode()
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def _mask(token: str) -> str:
    if not token: return ""
    if len(token) <= 8: return "*" * len(token)
    return token[:4] + "*" * (len(token) - 8) + token[-4:]


class UispConfigIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str
    token: str
    ssl_verify: bool = True


async def _load_config(db) -> Optional[Dict[str, Any]]:
    doc = await db.uisp_config.find_one({}, {"_id": 0})
    if not doc:
        return None
    try:
        doc["token"] = _cipher().decrypt(doc["token_encrypted"].encode()).decode()
    except Exception:
        doc["token"] = None
    return doc


class UispClient:
    def __init__(self, url: str, token: str, ssl_verify: bool = True):
        self.url = url.rstrip("/")
        self.token = token
        self.ssl_verify = ssl_verify

    async def _get(self, path: str, params: Optional[dict] = None) -> Any:
        headers = {"x-auth-token": self.token, "Content-Type": "application/json"}
        url = f"{self.url}{path}"
        async with httpx.AsyncClient(verify=self.ssl_verify, timeout=15.0) as client:
            r = await client.get(url, headers=headers, params=params)
            r.raise_for_status()
            return r.json()

    async def system(self) -> Any:
        return await self._get("/api/v2.1/nms/system")

    async def sites(self) -> List[Any]:
        return await self._get("/api/v2.1/sites")

    async def devices(self) -> List[Any]:
        return await self._get("/api/v2.1/devices")

    async def links(self) -> List[Any]:
        # UISP has /api/v2.1/data-links for link records (radio + wired connections between devices)
        try:
            return await self._get("/api/v2.1/data-links")
        except Exception:
            return []


def build_uisp_router(get_current_user, get_db):
    router = APIRouter(prefix="/uisp", tags=["uisp"])
    ADMIN = {"admin"}
    SUPERVISOR = {"admin", "supervisor"}

    def _require(user: dict, roles: set):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    @router.get("/config")
    async def get_config(user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        c = await _load_config(db)
        if not c:
            return {"connected": False, "configured": False}
        return {
            "configured": True,
            "connected": c.get("connected", False),
            "url": c.get("url"),
            "ssl_verify": c.get("ssl_verify", True),
            "token_masked": _mask(c.get("token") or ""),
            "last_ok_at": c.get("last_ok_at"),
            "last_error": c.get("last_error"),
            "last_synced_at": c.get("last_synced_at"),
        }

    @router.post("/config")
    async def save_config(body: UispConfigIn, user: dict = Depends(get_current_user)):
        _require(user, ADMIN)
        db = get_db()
        enc = _cipher().encrypt(body.token.encode()).decode()
        doc = {
            "url": body.url.rstrip("/"),
            "ssl_verify": body.ssl_verify,
            "token_encrypted": enc,
            "updated_at": now_iso(),
            "updated_by": user.get("name") or user.get("email"),
        }
        existing = await db.uisp_config.find_one({}, {"_id": 0, "id": 1})
        if existing:
            await db.uisp_config.update_one({"id": existing["id"]}, {"$set": doc})
            return {"ok": True, "id": existing["id"]}
        doc["id"] = new_id()
        doc["created_at"] = now_iso()
        await db.uisp_config.insert_one(doc)
        return {"ok": True, "id": doc["id"]}

    @router.post("/test")
    async def test_connection(user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        c = await _load_config(db)
        if not c or not c.get("token"):
            raise HTTPException(status_code=400, detail="UISP belum dikonfigurasi")
        client = UispClient(c["url"], c["token"], c.get("ssl_verify", True))
        try:
            sysinfo = await client.system()
            sites = await client.sites()
            devices = await client.devices()
            links = await client.links()
            patch = {
                "connected": True, "last_ok_at": now_iso(),
                "last_error": None,
                "last_counts": {"sites": len(sites), "devices": len(devices), "links": len(links)},
            }
            await db.uisp_config.update_one({}, {"$set": patch})
            return {"ok": True, "system": sysinfo, "counts": patch["last_counts"]}
        except Exception as ex:
            await db.uisp_config.update_one({}, {"$set": {"connected": False, "last_error": str(ex)}})
            raise HTTPException(status_code=502, detail=f"UISP connection failed: {ex}")

    @router.get("/status")
    async def status(user: dict = Depends(get_current_user)):
        db = get_db()
        c = await db.uisp_config.find_one({}, {"_id": 0, "token_encrypted": 0})
        if not c:
            return {"configured": False, "connected": False, "message": "UISP Not Connected"}
        return {
            "configured": True,
            "connected": c.get("connected", False),
            "url": c.get("url"),
            "last_ok_at": c.get("last_ok_at"),
            "last_synced_at": c.get("last_synced_at"),
            "last_counts": c.get("last_counts"),
            "message": "UISP Connected" if c.get("connected") else "UISP Not Connected",
        }

    @router.post("/sync")
    async def sync(user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        c = await _load_config(db)
        if not c or not c.get("token"):
            raise HTTPException(status_code=400, detail="UISP belum dikonfigurasi")
        client = UispClient(c["url"], c["token"], c.get("ssl_verify", True))
        totals = {"site": 0, "device": 0, "link": 0}
        try:
            for kind, fetcher in (("site", client.sites), ("device", client.devices), ("link", client.links)):
                items = await fetcher()
                for it in (items or []):
                    uid = str(it.get("id") or it.get("identification", {}).get("id") or new_id())
                    await db.uisp_sync_cache.update_one(
                        {"uisp_id": uid, "kind": kind},
                        {"$set": {"uisp_id": uid, "kind": kind, "data": it, "last_seen_at": now_iso()}},
                        upsert=True,
                    )
                    totals[kind] += 1
            await db.uisp_config.update_one({}, {"$set": {"last_synced_at": now_iso(), "last_counts": totals, "connected": True, "last_error": None}})
            return {"ok": True, "totals": totals}
        except Exception as ex:
            raise HTTPException(status_code=502, detail=f"UISP sync failed: {ex}")

    @router.get("/entities")
    async def list_entities(kind: str, mapped: Optional[bool] = None, user: dict = Depends(get_current_user)):
        db = get_db()
        q: dict = {"kind": kind}
        if mapped is True: q["mapped_topology_id"] = {"$ne": None}
        elif mapped is False: q["mapped_topology_id"] = None
        return await db.uisp_sync_cache.find(q, {"_id": 0}).limit(2000).to_list(2000)

    @router.post("/map")
    async def map_entity(payload: Dict[str, Any], user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        uisp_id = payload.get("uisp_id")
        kind = payload.get("kind")
        topology_id = payload.get("topology_id")
        if not (uisp_id and kind):
            raise HTTPException(status_code=400, detail="uisp_id + kind wajib")
        await db.uisp_sync_cache.update_one(
            {"uisp_id": uisp_id, "kind": kind},
            {"$set": {"mapped_topology_id": topology_id, "mapped_at": now_iso(), "mapped_by": user.get("name")}},
        )
        return {"ok": True}

    return router
