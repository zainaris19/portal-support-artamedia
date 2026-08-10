"""
Zabbix 7.0 Monitoring Integration
=================================

Provides read-only access to a Zabbix server as the historical monitoring
source for the Portal Support device detail page.

  * Config (URL + encrypted API token + verify_ssl + timeout) is stored in
    MongoDB collection ``zabbix_config`` (single document, singleton).
  * Token is encrypted with the same Fernet key used by network_ipam.py
    (``db.system_config.ipam_key``) so we reuse the existing secret.
  * Frontend never receives the token — it can only see status flags.
  * Endpoints proxy Zabbix JSON-RPC calls (host.get, item.get, history.get,
    trend.get) and normalise responses to plain series arrays consumable by
    Recharts.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

logger = logging.getLogger("noc.zabbix")


# -----------------------------------------------------------------------------
# Fernet key (reuse from IPAM)
# -----------------------------------------------------------------------------
async def _get_cipher(db) -> Fernet:
    """Return the Fernet cipher — creates the persistent key if missing."""
    doc = await db.system_config.find_one({"_id": "ipam_key"})
    if doc and doc.get("key"):
        return Fernet(doc["key"].encode())
    # generate new
    key = Fernet.generate_key().decode()
    await db.system_config.update_one(
        {"_id": "ipam_key"},
        {"$set": {"key": key, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    logger.info("Generated new Fernet key")
    return Fernet(key.encode())


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class ZabbixConfigIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str
    api_token: Optional[str] = None   # write-only; None = keep existing
    verify_ssl: bool = True
    timeout: int = Field(15, ge=3, le=120)


class ZabbixConfigOut(BaseModel):
    url: str = ""
    verify_ssl: bool = True
    timeout: int = 15
    configured: bool = False
    token_masked: str = ""
    updated_at: Optional[str] = None
    last_test_at: Optional[str] = None
    last_test_ok: Optional[bool] = None
    last_test_message: Optional[str] = None
    last_test_version: Optional[str] = None


# -----------------------------------------------------------------------------
# Zabbix client
# -----------------------------------------------------------------------------
class ZabbixClient:
    def __init__(self, url: str, token: str, verify_ssl: bool = True, timeout: int = 15):
        base = url.rstrip("/")
        # Accept either "https://host" or "https://host/api_jsonrpc.php"
        if not base.endswith("/api_jsonrpc.php"):
            base = base + "/api_jsonrpc.php"
        self.endpoint = base
        self._token = token
        self._verify = verify_ssl
        self._timeout = timeout

    async def call(self, method: str, params: Any = None, *, require_auth: bool = True) -> Any:
        headers = {"Content-Type": "application/json-rpc"}
        if require_auth:
            headers["Authorization"] = f"Bearer {self._token}"
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params if params is not None else {},
            "id": 1,
        }
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5, read=self._timeout, write=self._timeout, pool=5),
            verify=self._verify,
        ) as client:
            r = await client.post(self.endpoint, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                err = data["error"]
                raise RuntimeError(
                    f"Zabbix API error {err.get('code')}: {err.get('message')} — {err.get('data')}"
                )
            return data["result"]


# -----------------------------------------------------------------------------
# Persistent config helpers
# -----------------------------------------------------------------------------
async def _load_config(db) -> Optional[Dict[str, Any]]:
    return await db.zabbix_config.find_one({"_id": "singleton"})


async def _client_from_db(db) -> ZabbixClient:
    cfg = await _load_config(db)
    if not cfg or not cfg.get("url") or not cfg.get("token_enc"):
        raise HTTPException(400, "Zabbix belum di-konfigurasi. Buka Settings → Monitoring Integration → Zabbix.")
    cipher = await _get_cipher(db)
    try:
        token = cipher.decrypt(cfg["token_enc"].encode()).decode()
    except InvalidToken as e:
        raise HTTPException(500, "Gagal decrypt Zabbix token. Silakan simpan ulang token.") from e
    return ZabbixClient(
        url=cfg["url"],
        token=token,
        verify_ssl=cfg.get("verify_ssl", True),
        timeout=cfg.get("timeout", 15),
    )


def _mask(token: str) -> str:
    if not token or len(token) < 8:
        return "****"
    return token[:4] + "…" + token[-4:]


# -----------------------------------------------------------------------------
# Time range helpers
# -----------------------------------------------------------------------------
RANGE_SECONDS = {
    "1h": 3600,
    "6h": 3600 * 6,
    "24h": 3600 * 24,
    "7d": 86400 * 7,
    "30d": 86400 * 30,
}

def _use_trend(range_key: str) -> bool:
    return range_key in {"7d", "30d"}


# -----------------------------------------------------------------------------
# Router
# -----------------------------------------------------------------------------
def build_zabbix_router(get_current_user, require_roles) -> APIRouter:
    r = APIRouter(prefix="/zabbix", tags=["zabbix"])

    # ---------- Config CRUD ------------------------------------------------
    @r.get("/config", response_model=ZabbixConfigOut)
    async def get_config(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        cfg = await _load_config(db)
        if not cfg:
            return ZabbixConfigOut()
        # do not return the encrypted token or plain token
        return ZabbixConfigOut(
            url=cfg.get("url", ""),
            verify_ssl=cfg.get("verify_ssl", True),
            timeout=cfg.get("timeout", 15),
            configured=bool(cfg.get("token_enc")),
            token_masked=cfg.get("token_masked", ""),
            updated_at=cfg.get("updated_at"),
            last_test_at=cfg.get("last_test_at"),
            last_test_ok=cfg.get("last_test_ok"),
            last_test_message=cfg.get("last_test_message"),
            last_test_version=cfg.get("last_test_version"),
        )

    @r.put("/config", response_model=ZabbixConfigOut)
    async def upsert_config(body: ZabbixConfigIn, request: Request,
                            user=Depends(require_roles("admin"))):
        db = request.app.state.db
        cipher = await _get_cipher(db)
        existing = await _load_config(db) or {}
        payload = {
            "url": body.url.strip(),
            "verify_ssl": body.verify_ssl,
            "timeout": body.timeout,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if body.api_token:
            payload["token_enc"] = cipher.encrypt(body.api_token.encode()).decode()
            payload["token_masked"] = _mask(body.api_token)
        elif "token_enc" in existing:
            payload["token_enc"] = existing["token_enc"]
            payload["token_masked"] = existing.get("token_masked", "")
        await db.zabbix_config.update_one(
            {"_id": "singleton"}, {"$set": payload}, upsert=True,
        )
        return await get_config(request, user=user)  # type: ignore

    @r.post("/test-connection")
    async def test_connection(request: Request, user=Depends(require_roles("admin"))):
        db = request.app.state.db
        cfg = await _load_config(db)
        if not cfg or not cfg.get("token_enc"):
            raise HTTPException(400, "Config belum lengkap")
        try:
            client = await _client_from_db(db)
            # apiinfo.version MUST be called without auth header per Zabbix 7 docs
            client_no_auth = ZabbixClient(
                url=cfg["url"], token="", verify_ssl=cfg.get("verify_ssl", True),
                timeout=cfg.get("timeout", 15),
            )
            version = await client_no_auth.call("apiinfo.version", {}, require_auth=False)
            # host.get with limit=1 as a real auth test
            hosts = await client.call(
                "host.get",
                {"output": ["hostid", "host"], "limit": 1},
            )
            ok = True
            msg = f"OK — Zabbix {version} — {len(hosts)} hosts accessible"
        except Exception as e:
            ok = False
            version = None
            msg = str(e)[:400]
        await db.zabbix_config.update_one(
            {"_id": "singleton"},
            {"$set": {
                "last_test_at": datetime.now(timezone.utc).isoformat(),
                "last_test_ok": ok,
                "last_test_message": msg,
                "last_test_version": version,
            }},
        )
        return {"ok": ok, "message": msg, "version": version}

    # ---------- Zabbix data proxy -----------------------------------------
    @r.get("/hosts")
    async def list_hosts(request: Request, search: str = "",
                         user=Depends(get_current_user)):
        db = request.app.state.db
        client = await _client_from_db(db)
        params: Dict[str, Any] = {
            "output": ["hostid", "host", "name", "status", "available"],
            "sortfield": "name",
            "sortorder": "ASC",
        }
        if search:
            params["search"] = {"name": search, "host": search}
            params["searchByAny"] = True
            # Only enable wildcard semantics when the caller uses '*'
            if "*" in search:
                params["searchWildcardsEnabled"] = True
        try:
            hosts = await client.call("host.get", params)
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        return {"items": hosts, "total": len(hosts)}

    @r.get("/items")
    async def list_items(request: Request, hostid: str, search: str = "",
                         user=Depends(get_current_user)):
        db = request.app.state.db
        client = await _client_from_db(db)
        params: Dict[str, Any] = {
            "output": ["itemid", "hostid", "name", "key_", "value_type",
                       "history", "trends", "units", "lastvalue", "state"],
            "hostids": [hostid],
        }
        if search:
            params["search"] = {"name": search, "key_": search}
            params["searchByAny"] = True
            params["searchWildcardsEnabled"] = True
        try:
            items = await client.call("item.get", params)
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        return {"items": items, "total": len(items)}

    @r.get("/series")
    async def get_series(
        request: Request,
        itemids: str = Query(..., description="Comma-separated Zabbix itemids"),
        range: str = Query("24h", pattern="^(1h|6h|24h|7d|30d)$"),
        value_type: int = Query(0, ge=0, le=4),
        user=Depends(get_current_user),
    ):
        db = request.app.state.db
        client = await _client_from_db(db)
        ids = [i.strip() for i in itemids.split(",") if i.strip()]
        if not ids:
            raise HTTPException(400, "itemids required")
        now = int(time.time())
        time_from = now - RANGE_SECONDS[range]
        use_trend = _use_trend(range)
        result: Dict[str, List[Dict[str, Any]]] = {}
        try:
            if use_trend:
                rows = await client.call("trend.get", {
                    "output": ["itemid", "clock", "num", "value_min", "value_avg", "value_max"],
                    "itemids": ids,
                    "time_from": time_from,
                    "time_till": now,
                })
                for row in rows:
                    key = str(row["itemid"])
                    result.setdefault(key, []).append({
                        "t": int(row["clock"]) * 1000,
                        "avg": float(row["value_avg"]),
                        "min": float(row["value_min"]),
                        "max": float(row["value_max"]),
                    })
            else:
                rows = await client.call("history.get", {
                    "output": "extend",
                    "history": value_type,
                    "itemids": ids,
                    "time_from": time_from,
                    "time_till": now,
                    "sortfield": "clock",
                    "sortorder": "ASC",
                })
                for row in rows:
                    key = str(row["itemid"])
                    result.setdefault(key, []).append({
                        "t": int(row["clock"]) * 1000,
                        "v": float(row["value"]),
                    })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        # Sort each series ascending
        for k, v in result.items():
            v.sort(key=lambda p: p["t"])
        return {"range": range, "source": "trend" if use_trend else "history", "series": result}

    # ---------- Device-focused convenience --------------------------------
    @r.get("/device/{device_id}/graphs")
    async def device_graphs(
        request: Request,
        device_id: str,
        range: str = Query("24h", pattern="^(1h|6h|24h|7d|30d)$"),
        user=Depends(get_current_user),
    ):
        """Resolve a device's Zabbix host and return grouped graph series.

        Returns categorised metrics (cpu, memory, temperature, availability,
        packet_loss, ping, and per-interface RX/TX) so the frontend can render
        them as separate charts without knowing Zabbix internals.
        """
        db = request.app.state.db
        dev = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not dev:
            raise HTTPException(404, "Device not found")
        zhost_name = dev.get("zabbix_host") or dev.get("hostname") or dev.get("name")
        if not zhost_name:
            return {"configured": False, "reason": "Device tidak punya zabbix_host"}
        client = await _client_from_db(db)
        try:
            hosts = await client.call(
                "host.get",
                {"output": ["hostid", "host", "name"],
                 "filter": {"host": [zhost_name], "name": [zhost_name]},
                 "searchByAny": True,
                 "limit": 1},
            )
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        if not hosts:
            # fallback fuzzy search
            try:
                hosts = await client.call("host.get", {
                    "output": ["hostid", "host", "name"],
                    "search": {"name": zhost_name, "host": zhost_name},
                    "searchByAny": True,
                    "searchWildcardsEnabled": True,
                    "limit": 1,
                })
            except Exception:
                hosts = []
        if not hosts:
            return {"configured": True, "matched": False, "reason": f"Host '{zhost_name}' tidak ditemukan di Zabbix"}
        hostid = hosts[0]["hostid"]
        # Fetch items and categorise by key pattern
        try:
            items = await client.call("item.get", {
                "output": ["itemid", "name", "key_", "value_type", "units", "lastvalue"],
                "hostids": [hostid],
            })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e

        def _categorise(it: dict) -> Optional[str]:
            k = (it.get("key_") or "").lower()
            n = (it.get("name") or "").lower()
            if "system.cpu.util" in k or "cpu utilization" in n or "cpu load" in n:
                return "cpu"
            if "vm.memory.util" in k or "memory utilization" in n or "vm.memory.size" in k:
                return "memory"
            if "sensor" in k and "temp" in k: return "temperature"
            if "temperature" in n: return "temperature"
            if "agent.ping" in k or "icmpping" in k and "loss" not in k: return "availability"
            if "icmppingloss" in k or "packet loss" in n: return "packet_loss"
            if "icmppingsec" in k or "ping response" in n: return "ping"
            if "ifhcinoctets" in k or "ifinoctets" in k or "bits received" in n or "traffic in" in n: return "rx"
            if "ifhcoutoctets" in k or "ifoutoctets" in k or "bits sent" in n or "traffic out" in n: return "tx"
            return None

        categorised: Dict[str, List[dict]] = {
            "cpu": [], "memory": [], "temperature": [], "availability": [],
            "packet_loss": [], "ping": [], "rx": [], "tx": [],
        }
        for it in items:
            cat = _categorise(it)
            if cat:
                categorised[cat].append(it)

        # Fetch history for each interesting item (cap at 6 items per category)
        now = int(time.time())
        time_from = now - RANGE_SECONDS[range]
        use_trend = _use_trend(range)

        async def fetch_series(item_ids: List[str], value_type: int) -> Dict[str, List[dict]]:
            if not item_ids:
                return {}
            if use_trend:
                rows = await client.call("trend.get", {
                    "output": ["itemid", "clock", "value_avg", "value_min", "value_max"],
                    "itemids": item_ids,
                    "time_from": time_from,
                    "time_till": now,
                })
                out: Dict[str, List[dict]] = {}
                for row in rows:
                    key = str(row["itemid"])
                    out.setdefault(key, []).append({
                        "t": int(row["clock"]) * 1000,
                        "v": float(row["value_avg"]),
                    })
                return out
            else:
                rows = await client.call("history.get", {
                    "output": "extend",
                    "history": value_type,
                    "itemids": item_ids,
                    "time_from": time_from,
                    "time_till": now,
                    "sortfield": "clock",
                    "sortorder": "ASC",
                })
                out = {}
                for row in rows:
                    key = str(row["itemid"])
                    out.setdefault(key, []).append({
                        "t": int(row["clock"]) * 1000,
                        "v": float(row["value"]),
                    })
                return out

        # Execute up to N parallel fetches
        result: Dict[str, Any] = {"configured": True, "matched": True,
                                  "hostid": hostid, "host": hosts[0].get("name"),
                                  "range": range,
                                  "source": "trend" if use_trend else "history",
                                  "categories": {}}
        for cat, its in categorised.items():
            slice_ = its[:6]
            if not slice_:
                continue
            # split by value_type for history call
            by_vt: Dict[int, List[dict]] = {}
            for it in slice_:
                vt = int(it.get("value_type", 0))
                by_vt.setdefault(vt, []).append(it)
            aggregated: Dict[str, List[dict]] = {}
            for vt, its_ in by_vt.items():
                try:
                    partial = await fetch_series([i["itemid"] for i in its_], vt)
                except Exception as e:
                    logger.exception("Zabbix series fetch failed: %s", e)
                    partial = {}
                aggregated.update(partial)
            result["categories"][cat] = [
                {
                    "itemid": it["itemid"],
                    "name": it.get("name"),
                    "key": it.get("key_"),
                    "units": it.get("units", ""),
                    "lastvalue": it.get("lastvalue"),
                    "points": aggregated.get(str(it["itemid"]), []),
                }
                for it in slice_
            ]
        return result

    # ---------- Per-port traffic (used by Port Detail Sheet) --------------
    @r.get("/device/{device_id}/port-traffic")
    async def port_traffic(
        request: Request,
        device_id: str,
        ifname: str = Query(..., description="Interface name (e.g. ether1, sfp-sfpplus1, 10GE1/0/1)"),
        alt: str = Query("", description="Comma-separated alternative names to try (if_name_hint, label, id)"),
        range: str = Query("24h", pattern="^(1h|6h|24h|7d|30d)$"),
        rx_itemid: str = Query("", description="Manual override: Zabbix itemid for RX"),
        tx_itemid: str = Query("", description="Manual override: Zabbix itemid for TX"),
        user=Depends(get_current_user),
    ):
        """Return RX/TX traffic history for a single port on a device (via Zabbix).

        Match strategy: locate items on the device's Zabbix host whose ``name``
        or ``key_`` contains the interface name (case-insensitive). Then pick
        items whose name/key indicates *ifHCInOctets/received/traffic in* for
        RX and *ifHCOutOctets/sent/traffic out* for TX.
        """
        db = request.app.state.db
        dev = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not dev:
            raise HTTPException(404, "Device not found")
        zhost_name = dev.get("zabbix_host") or dev.get("hostname") or dev.get("name")
        if not zhost_name:
            return {"configured": False, "reason": "Device tidak punya zabbix_host"}
        client = await _client_from_db(db)
        try:
            hosts = await client.call(
                "host.get",
                {"output": ["hostid", "host", "name"],
                 "filter": {"host": [zhost_name], "name": [zhost_name]},
                 "searchByAny": True,
                 "limit": 1},
            )
            if not hosts:
                hosts = await client.call("host.get", {
                    "output": ["hostid", "host", "name"],
                    "search": {"name": zhost_name, "host": zhost_name},
                    "searchByAny": True,
                    "searchWildcardsEnabled": True,
                    "limit": 1,
                })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        if not hosts:
            return {"configured": True, "matched": False, "reason": f"Host '{zhost_name}' tidak ditemukan"}
        hostid = hosts[0]["hostid"]

        # Fetch items and filter locally — Zabbix search is prefix-only for keys
        try:
            items = await client.call("item.get", {
                "output": ["itemid", "name", "key_", "value_type", "units", "lastvalue"],
                "hostids": [hostid],
            })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e

        # Build candidate names to match with word-boundary logic.
        # Skip very short (< 3 chars) or pure-numeric candidates to avoid
        # accidental cross-matching (e.g. label "1" matching "kantor-1").
        raw_candidates = {c.strip().lower() for c in [ifname, *alt.split(",")] if c and c.strip()}
        candidates = {c for c in raw_candidates if len(c) >= 3 and not c.isdigit()}
        import re
        # Precompile boundary regex — matches only when the interface name is not
        # part of a longer name (e.g. "ether1" must not match "ether11").
        # Boundary = start/end of string OR a non-alphanumeric character.
        patterns = [
            re.compile(rf'(?<![a-z0-9]){re.escape(c)}(?![a-z0-9])')
            for c in candidates if c
        ]

        def _matches_iface(item: dict) -> bool:
            if not patterns:
                return False
            hay = f"{item.get('name','')} {item.get('key_','')}".lower()
            return any(p.search(hay) for p in patterns)

        def _direction(item: dict) -> Optional[str]:
            n = (item.get("name") or "").lower()
            k = (item.get("key_") or "").lower()
            if "ifhcinoctets" in k or "ifinoctets" in k or "bits received" in n or "traffic in" in n or "received" in n:
                return "rx"
            if "ifhcoutoctets" in k or "ifoutoctets" in k or "bits sent" in n or "traffic out" in n or "sent" in n:
                return "tx"
            return None

        matched: Dict[str, List[dict]] = {"rx": [], "tx": []}
        for it in items:
            if not _matches_iface(it):
                continue
            d = _direction(it)
            if d:
                matched[d].append(it)

        # Pick the best candidate (prefer ifHC over if / more specific name length)
        def _rank(it: dict) -> int:
            k = (it.get("key_") or "").lower()
            score = 0
            if "ifhc" in k: score += 10
            # Penalise items that look like discards/errors
            if "discard" in k or "errors" in k: score -= 100
            score += min(len(it.get("name") or ""), 200) // 20
            return -score  # ascending sort by -score
        candidates_by_dir: Dict[str, List[dict]] = {"rx": [], "tx": []}
        for k in ("rx", "tx"):
            matched[k].sort(key=_rank)
            candidates_by_dir[k] = matched[k][:8]     # up to 8 candidates for admin UI
            matched[k] = matched[k][:1]                # keep only the best one

        # Manual overrides (rx_itemid / tx_itemid) — resolve from full item list
        override_map = {"rx": rx_itemid.strip(), "tx": tx_itemid.strip()}
        for d, oid in override_map.items():
            if not oid:
                continue
            it = next((x for x in items if str(x.get("itemid")) == oid), None)
            if it:
                matched[d] = [it]
                # Ensure override is included in candidates list
                if not any(str(c.get("itemid")) == oid for c in candidates_by_dir[d]):
                    candidates_by_dir[d].insert(0, it)

        # Fetch history
        now = int(time.time())
        time_from = now - RANGE_SECONDS[range]
        use_trend = _use_trend(range)

        async def fetch(item_ids: List[str], value_type: int) -> Dict[str, List[dict]]:
            if not item_ids:
                return {}
            if use_trend:
                rows = await client.call("trend.get", {
                    "output": ["itemid", "clock", "value_avg"],
                    "itemids": item_ids,
                    "time_from": time_from,
                    "time_till": now,
                })
                out: Dict[str, List[dict]] = {}
                for row in rows:
                    key = str(row["itemid"])
                    out.setdefault(key, []).append({
                        "t": int(row["clock"]) * 1000,
                        "v": float(row["value_avg"]),
                    })
                return out
            rows = await client.call("history.get", {
                "output": "extend",
                "history": value_type,
                "itemids": item_ids,
                "time_from": time_from,
                "time_till": now,
                "sortfield": "clock",
                "sortorder": "ASC",
            })
            out = {}
            for row in rows:
                key = str(row["itemid"])
                out.setdefault(key, []).append({
                    "t": int(row["clock"]) * 1000,
                    "v": float(row["value"]),
                })
            return out

        result_series: Dict[str, dict] = {}
        for direction, its in matched.items():
            if not its:
                result_series[direction] = None
                continue
            it = its[0]
            points_map = await fetch([it["itemid"]], int(it.get("value_type", 3)))
            result_series[direction] = {
                "itemid": it["itemid"],
                "name": it.get("name"),
                "key": it.get("key_"),
                "units": it.get("units", ""),
                "lastvalue": it.get("lastvalue"),
                "points": points_map.get(str(it["itemid"]), []),
            }

        return {
            "configured": True,
            "matched": True,
            "hostid": hostid,
            "host": hosts[0].get("name"),
            "range": range,
            "source": "trend" if use_trend else "history",
            "ifname": ifname,
            "rx": result_series.get("rx"),
            "tx": result_series.get("tx"),
            "candidates": {
                "rx": [
                    {"itemid": c["itemid"], "name": c.get("name"), "key": c.get("key_"),
                     "units": c.get("units", ""), "lastvalue": c.get("lastvalue")}
                    for c in candidates_by_dir.get("rx", [])
                ],
                "tx": [
                    {"itemid": c["itemid"], "name": c.get("name"), "key": c.get("key_"),
                     "units": c.get("units", ""), "lastvalue": c.get("lastvalue")}
                    for c in candidates_by_dir.get("tx", [])
                ],
            },
        }

    # ---------- Per-port LIVE status (oper/admin/speed/rx/tx from Zabbix) --------
    @r.get("/device/{device_id}/port-status")
    async def port_status(
        request: Request,
        device_id: str,
        ifname: str = Query(..., description="Full interface name (e.g. 10GE1/0/5, ether1)"),
        alt: str = Query("", description="Comma-separated alternative names"),
        polling_interval: int = Query(60, ge=10, le=3600, description="Zabbix update interval in seconds (default 60)"),
        user=Depends(get_current_user),
    ):
        """Live per-port telemetry sourced ENTIRELY from Zabbix.

        Retrieves ``oper_status``, ``admin_status``, ``speed``, ``rx``, ``tx``
        and interface name from the same Zabbix host used by the traffic graph,
        so both panels always reflect the same interface. Interfaces are matched
        by **normalized full interface name** with a word-boundary check, so
        "10GE1/0/5" will not match "40GE1/0/5".

        Response shape (single payload — Requirement 7):
            {
                configured, matched, host, hostid,
                if_name, ifname, polling_interval,
                oper_status: {value, code, itemid, name, key, lastclock, stale},
                admin_status: {value, code, itemid, name, key, lastclock, stale},
                speed: {value_mbps, itemid, name, key, lastclock, stale},
                rx: {value_bps, itemid, name, key, lastclock, stale},
                tx: {value_bps, itemid, name, key, lastclock, stale},
                last_update, source: "zabbix",
                item_ids: {oper, admin, speed, rx, tx},
            }
        """
        db = request.app.state.db
        dev = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not dev:
            raise HTTPException(404, "Device not found")
        zhost_name = dev.get("zabbix_host") or dev.get("hostname") or dev.get("name")
        if not zhost_name:
            return {"configured": False, "reason": "Device tidak punya zabbix_host", "source": "zabbix"}
        client = await _client_from_db(db)
        try:
            hosts = await client.call(
                "host.get",
                {"output": ["hostid", "host", "name"],
                 "filter": {"host": [zhost_name], "name": [zhost_name]},
                 "searchByAny": True,
                 "limit": 1},
            )
            if not hosts:
                hosts = await client.call("host.get", {
                    "output": ["hostid", "host", "name"],
                    "search": {"name": zhost_name, "host": zhost_name},
                    "searchByAny": True,
                    "searchWildcardsEnabled": True,
                    "limit": 1,
                })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        if not hosts:
            return {"configured": True, "matched": False,
                    "reason": f"Host '{zhost_name}' tidak ditemukan",
                    "source": "zabbix"}
        hostid = hosts[0]["hostid"]

        # Zabbix item.get — include lastvalue, lastclock, itemid, name, key_ (Requirement 3)
        try:
            items = await client.call("item.get", {
                "output": ["itemid", "name", "key_", "value_type", "units",
                           "lastvalue", "lastclock"],
                "hostids": [hostid],
            })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e

        # --- Match interfaces by NORMALIZED FULL name (Requirement 4) ---------
        # Normalization: lowercase, collapse [space _] to [-], keep slashes.
        import re as _re

        def _norm(s: str) -> str:
            return _re.sub(r"[\s_]+", "-", (s or "").strip().lower())

        raw_candidates = [ifname, *[a.strip() for a in alt.split(",") if a.strip()]]
        # Only use "full" candidates (>= 3 chars, not pure digit). Rejects "5",
        # "05" etc. so we never fall back to matching only the trailing port
        # number (Requirement 4 explicitly forbids this).
        candidates = []
        seen = set()
        for c in raw_candidates:
            c = _norm(c)
            if not c or len(c) < 3 or c.isdigit():
                continue
            if c in seen:
                continue
            seen.add(c)
            candidates.append(c)
        # Word-boundary regex so "10ge1/0/5" cannot match "40ge1/0/5" and
        # "10ge1/0/5" cannot match "10ge1/0/50".
        patterns = [
            _re.compile(rf"(?<![a-z0-9/]){_re.escape(c)}(?![a-z0-9/])")
            for c in candidates
        ]

        def _iface_matches(item: dict) -> bool:
            if not patterns:
                return False
            hay = _norm(f"{item.get('name','')} {item.get('key_','')}")
            return any(p.search(hay) for p in patterns)

        # --- Classify item by direction / metric ------------------------------
        def _classify(item: dict) -> Optional[str]:
            n = (item.get("name") or "").lower()
            k = (item.get("key_") or "").lower()
            hay = f"{n} {k}"
            # oper / admin come first — some templates use the same "status"
            # word so we must disambiguate on "operational" vs "administrative".
            if "ifoperstatus" in k or "operational status" in n or "oper status" in n:
                return "oper"
            if "ifadminstatus" in k or "administrative status" in n or "admin status" in n:
                return "admin"
            if "ifhighspeed" in k or ("speed" in n and "traffic" not in n and "bits" not in n):
                return "speed"
            if "discard" in hay or "errors" in hay:
                return None
            if "ifhcinoctets" in k or "ifinoctets" in k or "bits received" in n or "traffic in" in n or " in" in n and "octets" in n:
                return "rx"
            if "ifhcoutoctets" in k or "ifoutoctets" in k or "bits sent" in n or "traffic out" in n or " out" in n and "octets" in n:
                return "tx"
            return None

        # Rank so we prefer high-counter ifHC over 32-bit ifIn/ifOut, and
        # prefer more-specific names when both templates present multiple.
        def _rank(item: dict) -> int:
            k = (item.get("key_") or "").lower()
            score = 0
            if "ifhc" in k: score += 10
            if "ifhighspeed" in k: score += 10
            if "ifoperstatus" in k: score += 10
            if "ifadminstatus" in k: score += 10
            score += min(len(item.get("name") or ""), 200) // 20
            return -score

        buckets: Dict[str, List[dict]] = {"oper": [], "admin": [], "speed": [], "rx": [], "tx": []}
        for it in items:
            if not _iface_matches(it):
                continue
            c = _classify(it)
            if c:
                buckets[c].append(it)
        for k in list(buckets.keys()):
            buckets[k].sort(key=_rank)

        # --- ifOperStatus / ifAdminStatus mapping (Requirement 5) -------------
        OPER_MAP = {
            1: "up", 2: "down", 3: "testing", 4: "unknown",
            5: "dormant", 6: "notPresent", 7: "lowerLayerDown",
        }
        ADMIN_MAP = {1: "up", 2: "down", 3: "testing"}
        STALE_AFTER = polling_interval * 3  # Requirement 9

        now_ts = int(time.time())

        def _extract_ts(it: Optional[dict]) -> int:
            try:
                return int((it or {}).get("lastclock") or 0)
            except (TypeError, ValueError):
                return 0

        def _is_stale(ts: int) -> bool:
            return ts > 0 and (now_ts - ts) > STALE_AFTER

        def _status_val(it: Optional[dict], mapping: Dict[int, str]) -> Dict[str, Any]:
            if not it:
                return {"value": "unknown", "code": None, "itemid": None,
                        "name": None, "key": None, "lastclock": None, "stale": False}
            ts = _extract_ts(it)
            stale = _is_stale(ts) or not ts
            try:
                code = int(float(it.get("lastvalue") or 0))
            except (TypeError, ValueError):
                code = None
            # If stale, do NOT report "down" — show "unknown" per Requirement 9
            if stale:
                mapped = "unknown"
            else:
                mapped = mapping.get(code, "unknown") if code is not None else "unknown"
            return {
                "value": mapped, "code": code,
                "itemid": it.get("itemid"), "name": it.get("name"), "key": it.get("key_"),
                "lastclock": ts or None, "stale": stale,
            }

        def _num_val(it: Optional[dict], units_hint: str = "") -> Dict[str, Any]:
            if not it:
                return {"value": None, "itemid": None, "name": None, "key": None,
                        "lastclock": None, "stale": False, "units": ""}
            ts = _extract_ts(it)
            stale = _is_stale(ts) or not ts
            try:
                v = float(it.get("lastvalue") or 0)
            except (TypeError, ValueError):
                v = None
            return {
                "value": v, "itemid": it.get("itemid"), "name": it.get("name"),
                "key": it.get("key_"), "lastclock": ts or None, "stale": stale,
                "units": it.get("units") or units_hint,
            }

        oper_it  = buckets["oper"][0]  if buckets["oper"]  else None
        admin_it = buckets["admin"][0] if buckets["admin"] else None
        speed_it = buckets["speed"][0] if buckets["speed"] else None
        rx_it    = buckets["rx"][0]    if buckets["rx"]    else None
        tx_it    = buckets["tx"][0]    if buckets["tx"]    else None

        oper  = _status_val(oper_it, OPER_MAP)
        admin = _status_val(admin_it, ADMIN_MAP)
        speed = _num_val(speed_it, units_hint="Mbps")
        rx    = _num_val(rx_it, units_hint="bps")
        tx    = _num_val(tx_it, units_hint="bps")

        # ifHighSpeed is already in Mbps; some templates use bps or units="".
        speed_mbps: Optional[float] = None
        if speed["value"] is not None:
            u = (speed.get("units") or "").lower()
            v = speed["value"]
            if "bps" in u and "mbps" not in u and "gbps" not in u:
                speed_mbps = v / 1_000_000
            else:
                speed_mbps = v

        # Interface name — prefer the matched item's name (strip common prefix)
        matched_name = None
        for it in (oper_it, admin_it, speed_it, rx_it, tx_it):
            if it and it.get("name"):
                # Zabbix names commonly like "Interface 10GE1/0/5(to rajegnet): ..."
                m = _re.search(r"[Ii]nterface\s+([^:]+?)(?:\s*:\s*|\s*\()", it["name"])
                if m:
                    matched_name = m.group(1).strip()
                    break

        # newest lastclock as last_update
        last_update_ts = max(
            _extract_ts(oper_it), _extract_ts(admin_it),
            _extract_ts(speed_it), _extract_ts(rx_it), _extract_ts(tx_it),
        ) or None

        item_ids = {
            "oper":  oper_it["itemid"]  if oper_it  else None,
            "admin": admin_it["itemid"] if admin_it else None,
            "speed": speed_it["itemid"] if speed_it else None,
            "rx":    rx_it["itemid"]    if rx_it    else None,
            "tx":    tx_it["itemid"]    if tx_it    else None,
        }

        # --- Persist matched item IDs onto the device (Requirement 6) --------
        if any(item_ids.values()):
            try:
                await db.devices.update_one(
                    {"id": device_id},
                    {"$set": {
                        f"zabbix_port_items.{ifname}": {
                            **item_ids,
                            "if_name": matched_name or ifname,
                            "hostid": hostid,
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }
                    }},
                )
            except Exception as e:
                logger.warning("Failed to persist zabbix_port_items for %s/%s: %s",
                               device_id, ifname, e)

        return {
            "configured": True,
            "matched": bool(oper_it or admin_it or speed_it or rx_it or tx_it),
            "host": hosts[0].get("name"),
            "hostid": hostid,
            "ifname": ifname,
            "if_name": matched_name or ifname,
            "polling_interval": polling_interval,
            "oper_status": oper,
            "admin_status": admin,
            "speed": {**speed, "value_mbps": speed_mbps},
            "rx": rx,
            "tx": tx,
            "last_update": (last_update_ts * 1000) if last_update_ts else None,
            "source": "zabbix",
            "item_ids": item_ids,
        }

    # ---------- Interface candidates (browse ALL interface items on the host) -----
    @r.get("/device/{device_id}/ports-status")
    async def ports_status(
        request: Request,
        device_id: str,
        ifnames: str = Query(..., description="Comma-separated full interface names (e.g. '10GE1/0/5,10GE1/0/6,MEth0/0/1')"),
        polling_interval: int = Query(60, ge=10, le=3600),
        user=Depends(get_current_user),
    ):
        """Batch version of port-status: return live Zabbix telemetry for
        many interfaces on the same device in ONE call. Used by the front
        panel visualization / mapping tooltip so status coloring, tooltip,
        and detail panel all reflect the same Zabbix interface.
        """
        db = request.app.state.db
        dev = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not dev:
            raise HTTPException(404, "Device not found")
        zhost_name = dev.get("zabbix_host") or dev.get("hostname") or dev.get("name")
        if not zhost_name:
            return {"configured": False, "reason": "Device tidak punya zabbix_host", "source": "zabbix", "ports": {}}
        client = await _client_from_db(db)
        try:
            hosts = await client.call(
                "host.get",
                {"output": ["hostid", "host", "name"],
                 "filter": {"host": [zhost_name], "name": [zhost_name]},
                 "searchByAny": True,
                 "limit": 1},
            )
            if not hosts:
                hosts = await client.call("host.get", {
                    "output": ["hostid", "host", "name"],
                    "search": {"name": zhost_name, "host": zhost_name},
                    "searchByAny": True,
                    "searchWildcardsEnabled": True,
                    "limit": 1,
                })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        if not hosts:
            return {"configured": True, "matched": False,
                    "reason": f"Host '{zhost_name}' tidak ditemukan",
                    "source": "zabbix", "ports": {}}
        hostid = hosts[0]["hostid"]

        try:
            items = await client.call("item.get", {
                "output": ["itemid", "name", "key_", "value_type", "units",
                           "lastvalue", "lastclock"],
                "hostids": [hostid],
            })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e

        import re as _re

        def _norm(s: str) -> str:
            return _re.sub(r"[\s_]+", "-", (s or "").strip().lower())

        def _classify(item: dict) -> Optional[str]:
            n = (item.get("name") or "").lower()
            k = (item.get("key_") or "").lower()
            if "ifoperstatus" in k or "operational status" in n or "oper status" in n:
                return "oper"
            if "ifadminstatus" in k or "administrative status" in n or "admin status" in n:
                return "admin"
            if "ifhighspeed" in k or ("speed" in n and "traffic" not in n and "bits" not in n):
                return "speed"
            if "discard" in n or "discard" in k or "errors" in n or "errors" in k:
                return None
            if "ifhcinoctets" in k or "ifinoctets" in k or "bits received" in n or "traffic in" in n:
                return "rx"
            if "ifhcoutoctets" in k or "ifoutoctets" in k or "bits sent" in n or "traffic out" in n:
                return "tx"
            return None

        def _rank(item: dict) -> int:
            k = (item.get("key_") or "").lower()
            score = 0
            if "ifhc" in k: score += 10
            if "ifhighspeed" in k: score += 10
            if "ifoperstatus" in k: score += 10
            if "ifadminstatus" in k: score += 10
            score += min(len(item.get("name") or ""), 200) // 20
            return -score

        # Pre-classify all items once
        classified: List[tuple] = []  # (kind, item, name_norm)
        for it in items:
            c = _classify(it)
            if not c:
                continue
            hay = _norm(f"{it.get('name','')} {it.get('key_','')}")
            classified.append((c, it, hay))

        OPER_MAP = {1: "up", 2: "down", 3: "testing", 4: "unknown",
                    5: "dormant", 6: "notPresent", 7: "lowerLayerDown"}
        ADMIN_MAP = {1: "up", 2: "down", 3: "testing"}
        STALE_AFTER = polling_interval * 3
        now_ts = int(time.time())

        def _extract_ts(it: Optional[dict]) -> int:
            try:
                return int((it or {}).get("lastclock") or 0)
            except (TypeError, ValueError):
                return 0

        def _is_stale(ts: int) -> bool:
            return ts > 0 and (now_ts - ts) > STALE_AFTER

        def _status_val(it: Optional[dict], mapping):
            if not it:
                return {"value": "unknown", "code": None, "itemid": None,
                        "name": None, "key": None, "lastclock": None, "stale": False}
            ts = _extract_ts(it)
            stale = _is_stale(ts) or not ts
            try:
                code = int(float(it.get("lastvalue") or 0))
            except (TypeError, ValueError):
                code = None
            if stale:
                mapped = "unknown"
            else:
                mapped = mapping.get(code, "unknown") if code is not None else "unknown"
            return {"value": mapped, "code": code, "itemid": it.get("itemid"),
                    "name": it.get("name"), "key": it.get("key_"),
                    "lastclock": ts or None, "stale": stale}

        def _num_val(it: Optional[dict], units_hint: str = ""):
            if not it:
                return {"value": None, "itemid": None, "name": None, "key": None,
                        "lastclock": None, "stale": False, "units": ""}
            ts = _extract_ts(it)
            stale = _is_stale(ts) or not ts
            try:
                v = float(it.get("lastvalue") or 0)
            except (TypeError, ValueError):
                v = None
            return {"value": v, "itemid": it.get("itemid"), "name": it.get("name"),
                    "key": it.get("key_"), "lastclock": ts or None, "stale": stale,
                    "units": it.get("units") or units_hint}

        ifname_list = [x.strip() for x in ifnames.split(",") if x.strip()]
        result_ports: Dict[str, Any] = {}
        persist_updates: Dict[str, Any] = {}
        for ifname in ifname_list:
            candidate = _norm(ifname)
            if not candidate or len(candidate) < 3 or candidate.isdigit():
                # skip (rejects trailing-number-only matches)
                continue
            pattern = _re.compile(rf"(?<![a-z0-9/]){_re.escape(candidate)}(?![a-z0-9/])")
            buckets: Dict[str, List[dict]] = {"oper": [], "admin": [], "speed": [], "rx": [], "tx": []}
            for kind, it, hay in classified:
                if pattern.search(hay):
                    buckets[kind].append(it)
            for k in list(buckets.keys()):
                buckets[k].sort(key=_rank)
            oper_it  = buckets["oper"][0]  if buckets["oper"]  else None
            admin_it = buckets["admin"][0] if buckets["admin"] else None
            speed_it = buckets["speed"][0] if buckets["speed"] else None
            rx_it    = buckets["rx"][0]    if buckets["rx"]    else None
            tx_it    = buckets["tx"][0]    if buckets["tx"]    else None

            if not any([oper_it, admin_it, speed_it, rx_it, tx_it]):
                # unmatched
                result_ports[ifname] = {"matched": False}
                continue

            speed = _num_val(speed_it, units_hint="Mbps")
            speed_mbps: Optional[float] = None
            if speed["value"] is not None:
                u = (speed.get("units") or "").lower()
                v = speed["value"]
                speed_mbps = v / 1_000_000 if ("bps" in u and "mbps" not in u and "gbps" not in u) else v

            # Prefer matched interface name extracted from any matched item
            matched_name = None
            for it in (oper_it, admin_it, speed_it, rx_it, tx_it):
                if it and it.get("name"):
                    m = _re.search(r"[Ii]nterface\s+([^:]+?)(?:\s*:\s*|\s*\()", it["name"])
                    if m:
                        matched_name = m.group(1).strip()
                        break

            item_ids = {
                "oper":  oper_it["itemid"]  if oper_it  else None,
                "admin": admin_it["itemid"] if admin_it else None,
                "speed": speed_it["itemid"] if speed_it else None,
                "rx":    rx_it["itemid"]    if rx_it    else None,
                "tx":    tx_it["itemid"]    if tx_it    else None,
            }
            last_update_ts = max(
                _extract_ts(oper_it), _extract_ts(admin_it),
                _extract_ts(speed_it), _extract_ts(rx_it), _extract_ts(tx_it),
            ) or None

            result_ports[ifname] = {
                "matched": True,
                "if_name": matched_name or ifname,
                "oper_status": _status_val(oper_it, OPER_MAP),
                "admin_status": _status_val(admin_it, ADMIN_MAP),
                "speed": {**speed, "value_mbps": speed_mbps},
                "rx": _num_val(rx_it, units_hint="bps"),
                "tx": _num_val(tx_it, units_hint="bps"),
                "last_update": (last_update_ts * 1000) if last_update_ts else None,
                "item_ids": item_ids,
            }
            persist_updates[f"zabbix_port_items.{ifname}"] = {
                **item_ids,
                "if_name": matched_name or ifname,
                "hostid": hostid,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

        if persist_updates:
            try:
                await db.devices.update_one({"id": device_id}, {"$set": persist_updates})
            except Exception as e:
                logger.warning("Failed to persist zabbix_port_items (batch) for %s: %s", device_id, e)

        return {
            "configured": True,
            "matched": bool(result_ports),
            "host": hosts[0].get("name"),
            "hostid": hostid,
            "polling_interval": polling_interval,
            "ports": result_ports,
            "last_update": int(time.time() * 1000),
            "source": "zabbix",
        }

    @r.get("/device/{device_id}/interface-items")
    async def interface_items(
        request: Request,
        device_id: str,
        user=Depends(get_current_user),
    ):
        """List every traffic-related item on the device's Zabbix host so admin
        can pick manually (fallback when auto-match fails)."""
        db = request.app.state.db
        dev = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not dev:
            raise HTTPException(404, "Device not found")
        zhost_name = dev.get("zabbix_host") or dev.get("hostname") or dev.get("name")
        if not zhost_name:
            return {"configured": False, "reason": "Device tidak punya zabbix_host"}
        client = await _client_from_db(db)
        try:
            hosts = await client.call("host.get", {
                "output": ["hostid", "host", "name"],
                "filter": {"host": [zhost_name], "name": [zhost_name]},
                "searchByAny": True,
                "limit": 1,
            })
            if not hosts:
                hosts = await client.call("host.get", {
                    "output": ["hostid", "host", "name"],
                    "search": {"name": zhost_name, "host": zhost_name},
                    "searchByAny": True,
                    "searchWildcardsEnabled": True,
                    "limit": 1,
                })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        if not hosts:
            return {"configured": True, "matched": False, "reason": f"Host '{zhost_name}' tidak ditemukan"}
        hostid = hosts[0]["hostid"]
        try:
            items = await client.call("item.get", {
                "output": ["itemid", "name", "key_", "value_type", "units", "lastvalue"],
                "hostids": [hostid],
            })
        except Exception as e:
            raise HTTPException(502, f"Zabbix error: {e}") from e
        # Keep only traffic-related items
        def _kind(it: dict) -> Optional[str]:
            n = (it.get("name") or "").lower()
            k = (it.get("key_") or "").lower()
            if "ifhcinoctets" in k or "ifinoctets" in k or "bits received" in n or "received" in n:
                return "rx"
            if "ifhcoutoctets" in k or "ifoutoctets" in k or "bits sent" in n or "sent" in n:
                return "tx"
            return None
        filtered = []
        for it in items:
            d = _kind(it)
            if d and "discard" not in (it.get("key_") or "").lower() and "errors" not in (it.get("key_") or "").lower():
                filtered.append({
                    "itemid": it["itemid"],
                    "name": it.get("name"),
                    "key": it.get("key_"),
                    "units": it.get("units", ""),
                    "lastvalue": it.get("lastvalue"),
                    "direction": d,
                })
        filtered.sort(key=lambda x: x.get("name") or "")
        return {
            "configured": True,
            "matched": True,
            "hostid": hostid,
            "host": hosts[0].get("name"),
            "items": filtered,
            "total": len(filtered),
        }

    return r
