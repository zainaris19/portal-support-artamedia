"""
Network / IPAM module — MikroTik RouterOS v7 integration + Public IPv4 Management.

Handles:
  * MikroTik router CRUD (encrypted password via Fernet)
  * REST API sync (GET /rest/ip/route)
  * IPv4 allocation logic (used / available / reserved / pending / conflict / disabled)
  * Manual reservation + Allocate Available Subnet
  * Audit log
  * Background auto-sync loop

Public prefixes owned by Artamedia (hard-coded per spec):
  103.103.144.0/24, 103.103.145.0/24, 103.103.146.0/24, 103.103.147.0/24
"""
from __future__ import annotations

import asyncio
import base64
import ipaddress
import logging
import os
import ssl
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Literal, Tuple

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette import status as http_status
from librouteros import async_connect
from librouteros.exceptions import TrapError, FatalError, ConnectionClosed as ROSConnectionClosed

logger = logging.getLogger("noc.ipam")

ARTAMEDIA_PREFIXES: List[str] = [
    "103.103.144.0/24",
    "103.103.145.0/24",
    "103.103.146.0/24",
    "103.103.147.0/24",
]
ARTAMEDIA_NETS = [ipaddress.IPv4Network(p) for p in ARTAMEDIA_PREFIXES]

ALLOWED_PREFIX_LENGTHS = [25, 26, 27, 28, 29, 30, 31, 32]
SYNC_INTERVAL_CHOICES = {
    "manual": 0,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "6h": 360,
    "daily": 1440,
}

USAGE_TYPES = [
    "Customer Dedicated", "Customer Broadband", "VPS Server", "Internal Server",
    "Network Infrastructure", "Point-to-Point", "Management", "Loopback",
    "Data Center", "Reserved", "Other",
]
ALLOCATION_STATUSES = ["Used", "Available", "Reserved", "Pending", "Conflict", "Disabled"]


# ----------------------------------------------------------------------------
# Utilities
# ----------------------------------------------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def belongs_to_artamedia(cidr: str) -> bool:
    """True if cidr is fully contained within (subnet_of) any Artamedia /24 prefix.
    A larger enclosing route (like 0.0.0.0/0 or a /22) is intentionally NOT
    considered "belonging" — per requirement we ignore unrelated routes."""
    try:
        net = ipaddress.ip_network(cidr, strict=False)
    except (ValueError, TypeError):
        return False
    if isinstance(net, ipaddress.IPv6Network):
        return False
    for parent in ARTAMEDIA_NETS:
        if net.subnet_of(parent):
            return True
    return False


def artamedia_parent(cidr: str) -> Optional[str]:
    """Return the /24 parent Artamedia prefix this cidr belongs to, or None."""
    try:
        net = ipaddress.ip_network(cidr, strict=False)
    except (ValueError, TypeError):
        return None
    for parent in ARTAMEDIA_NETS:
        if net.subnet_of(parent):
            return str(parent)
    return None


def compute_available_within(parent_cidr: str, used_cidrs: List[str]) -> List[str]:
    """Given a parent prefix and a list of used CIDRs (any size, possibly overlapping),
    return the list of remaining free CIDRs (aligned, minimally-fragmented)."""
    parent = ipaddress.ip_network(parent_cidr, strict=False)
    if isinstance(parent, ipaddress.IPv6Network):
        return []
    used_nets: List[ipaddress.IPv4Network] = []
    for c in used_cidrs:
        try:
            n = ipaddress.ip_network(c, strict=False)
        except (ValueError, TypeError):
            continue
        if isinstance(n, ipaddress.IPv6Network):
            continue
        # Clamp to the parent — only keep the portion inside parent
        if n.subnet_of(parent):
            used_nets.append(n)
        elif parent.subnet_of(n):
            # A larger route covers the parent entirely → nothing free.
            return []
    # Collapse overlapping / adjacent used blocks
    if not used_nets:
        return [str(parent)]
    used_merged = list(ipaddress.collapse_addresses(used_nets))
    # Subtract each merged block from the parent progressively
    remaining: List[ipaddress.IPv4Network] = [parent]
    for u in used_merged:
        new_remaining: List[ipaddress.IPv4Network] = []
        for r in remaining:
            if not r.overlaps(u):
                new_remaining.append(r)
            elif u.subnet_of(r):
                new_remaining.extend(r.address_exclude(u))
            elif r.subnet_of(u):
                # entire r consumed
                continue
            else:
                # r overlaps u but neither is a subnet of the other:
                # r overlaps u only if they share addresses; for IPv4 with
                # aligned networks this only happens when one is inside the
                # other, so this branch is theoretically unreachable. Keep r
                # as-is defensively.
                new_remaining.append(r)
        remaining = new_remaining
    return sorted({str(n) for n in remaining}, key=lambda s: ipaddress.ip_network(s).network_address)


def is_overlap(a_cidr: str, b_cidr: str) -> bool:
    try:
        a = ipaddress.ip_network(a_cidr, strict=False)
        b = ipaddress.ip_network(b_cidr, strict=False)
        return a.overlaps(b)
    except Exception:
        return False


def first_available_of_size(parent_cidr: str, used_cidrs: List[str], prefix_len: int, limit: int = 5) -> List[str]:
    """Return up to `limit` aligned free subnets of size /prefix_len within parent."""
    free_blocks = compute_available_within(parent_cidr, used_cidrs)
    result: List[str] = []
    for block in free_blocks:
        b = ipaddress.ip_network(block)
        if b.prefixlen > prefix_len:
            continue
        try:
            for sub in b.subnets(new_prefix=prefix_len):
                result.append(str(sub))
                if len(result) >= limit:
                    return result
        except ValueError:
            continue
    return result


# ----------------------------------------------------------------------------
# Password encryption (Fernet)
# ----------------------------------------------------------------------------
class Cipher:
    def __init__(self, key: bytes):
        self._f = Fernet(key)

    def encrypt(self, plain: str) -> str:
        return self._f.encrypt(plain.encode("utf-8")).decode("utf-8")

    def decrypt(self, token: str) -> str:
        try:
            return self._f.decrypt(token.encode("utf-8")).decode("utf-8")
        except InvalidToken:
            raise HTTPException(status_code=500, detail="Encryption key mismatch — cannot decrypt router password. Re-enter router credentials.")


_CIPHER: Optional[Cipher] = None


async def get_or_create_key(db) -> bytes:
    doc = await db.system_config.find_one({"_id": "ipam_key"})
    if doc and doc.get("key"):
        return doc["key"].encode() if isinstance(doc["key"], str) else doc["key"]
    key = Fernet.generate_key()
    await db.system_config.update_one(
        {"_id": "ipam_key"},
        {"$set": {"key": key.decode("utf-8"), "created_at": _now()}},
        upsert=True,
    )
    return key


async def get_cipher(db) -> Cipher:
    global _CIPHER
    if _CIPHER is None:
        key = await get_or_create_key(db)
        _CIPHER = Cipher(key)
    return _CIPHER


# ----------------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------------
class RouterIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    host: str
    api_port: int = 8728
    username: str
    password: Optional[str] = None
    ssl_enabled: bool = False
    verify_ssl: bool = False
    routing_table: str = "main"
    status: Literal["Active", "Inactive"] = "Active"
    description: str = ""
    auto_sync: str = "manual"  # from SYNC_INTERVAL_CHOICES


class RouterOut(BaseModel):
    id: str
    name: str
    host: str
    api_port: int
    username: str
    ssl_enabled: bool
    verify_ssl: bool
    routing_table: str
    status: str
    description: str
    auto_sync: str
    has_password: bool
    connection_status: str = "Unknown"
    router_identity: Optional[str] = None
    routeros_version: Optional[str] = None
    last_success_at: Optional[str] = None
    last_failure_at: Optional[str] = None
    last_error: Optional[str] = None
    routes_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AllocationIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    cidr: str
    status: Literal["Used", "Reserved", "Pending", "Conflict", "Disabled"] = "Reserved"
    allocation_name: str = ""
    customer_id: Optional[str] = None
    sid: str = ""
    usage_type: str = "Other"
    noc_comment: str = ""
    internal_notes: str = ""
    router_source: str = ""
    mikrotik_route_comment: str = ""
    planned_activation_date: Optional[str] = None
    assigned_by: Optional[str] = None
    override_conflict: bool = False


class AllocationUpdateIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    allocation_name: Optional[str] = None
    customer_id: Optional[str] = None
    sid: Optional[str] = None
    usage_type: Optional[str] = None
    noc_comment: Optional[str] = None
    internal_notes: Optional[str] = None
    planned_activation_date: Optional[str] = None
    status: Optional[str] = None


# ----------------------------------------------------------------------------
# MikroTik native RouterOS API client (port 8728 plain / 8729 API-SSL)
# ----------------------------------------------------------------------------
async def _mikrotik_connect(router: dict, cipher: Cipher, timeout: float = 15.0):
    """Establish an async librouteros connection using stored router credentials.
    Raises HTTPException on any failure so callers can surface a clean error."""
    pw_token = router.get("password_enc")
    if not pw_token:
        raise HTTPException(status_code=400, detail="Router has no stored password — save credentials first.")
    try:
        password = cipher.decrypt(pw_token)
    except InvalidToken:
        raise HTTPException(status_code=500, detail="Stored password could not be decrypted (encryption key mismatch). Please re-enter the router password.")

    ssl_wrapper = None
    if router.get("ssl_enabled"):
        ctx = ssl.create_default_context()
        if not router.get("verify_ssl", False):
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        ssl_wrapper = ctx

    try:
        return await asyncio.wait_for(
            async_connect(
                host=str(router["host"]),
                username=str(router["username"]),
                password=password,
                port=int(router.get("api_port") or 8728),
                timeout=timeout,
                ssl_wrapper=ssl_wrapper,
            ),
            timeout=timeout + 2.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"MikroTik connection timed out to {router.get('host')}:{router.get('api_port')} (API port)")
    except TrapError as e:
        # Auth failures come back as TrapError from RouterOS
        raise HTTPException(status_code=401, detail=f"MikroTik login failed: {e}")
    except FatalError as e:
        raise HTTPException(status_code=502, detail=f"MikroTik protocol error: {e}")
    except (ConnectionRefusedError, OSError) as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach MikroTik API at {router.get('host')}:{router.get('api_port')} — {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"MikroTik connection error: {e}")


async def _mikrotik_call(api, cmd: str) -> List[dict]:
    """Execute a print-style command and collect all rows."""
    items: List[dict] = []
    try:
        async for row in api(cmd):
            items.append(dict(row))
    except TrapError as e:
        raise HTTPException(status_code=502, detail=f"MikroTik command '{cmd}' failed: {e}")
    except (FatalError, ROSConnectionClosed) as e:
        raise HTTPException(status_code=502, detail=f"MikroTik connection lost during '{cmd}': {e}")
    return items


async def mikrotik_probe(router: dict, cipher: Cipher) -> dict:
    """Fetch router identity + system resource to prove connection."""
    ident = {"identity": None, "version": None}
    api = await _mikrotik_connect(router, cipher, timeout=10.0)
    try:
        id_rows = await _mikrotik_call(api, "/system/identity/print")
        if id_rows:
            ident["identity"] = id_rows[0].get("name")
        try:
            res_rows = await _mikrotik_call(api, "/system/resource/print")
            if res_rows:
                ident["version"] = res_rows[0].get("version")
        except HTTPException:
            # Version is optional; keep identity if we got it
            pass
    finally:
        try:
            api.close()
        except Exception:
            pass
    return ident


async def mikrotik_fetch_routes(router: dict, cipher: Cipher) -> List[dict]:
    """Retrieve routes filtered to the configured routing table (Artamedia prefixes only)."""
    api = await _mikrotik_connect(router, cipher, timeout=30.0)
    try:
        data = await _mikrotik_call(api, "/ip/route/print")
    finally:
        try:
            api.close()
        except Exception:
            pass

    table = (router.get("routing_table") or "main").lower()
    normalized: List[dict] = []
    for r in data:
        dst = r.get("dst-address") or r.get("dst_address")
        if not dst:
            continue
        rt = (r.get("routing-mark") or r.get("routing_mark") or "main").lower()
        # RouterOS uses empty routing-mark for main
        if rt in ("", "main") and table == "main":
            pass
        elif rt == table:
            pass
        else:
            continue
        # Only IPv4 that belongs to Artamedia
        try:
            net = ipaddress.ip_network(dst, strict=False)
        except Exception:
            continue
        if not isinstance(net, ipaddress.IPv4Network):
            continue
        if not belongs_to_artamedia(str(net)):
            continue
        # Skip default / non-artamedia
        if net.prefixlen == 0:
            continue
        normalized.append({
            "cidr": str(net),
            "gateway": r.get("gateway") or "",
            "distance": _to_int(r.get("distance")),
            "scope": _to_int(r.get("scope")),
            "target_scope": _to_int(r.get("target-scope") or r.get("target_scope")),
            "comment": r.get("comment") or "",
            "active": _to_bool(r.get("active")),
            "disabled": _to_bool(r.get("disabled")),
            "dynamic": _to_bool(r.get("dynamic")),
            "static": _to_bool(r.get("static")),
            "protocol": _protocol_from(r),
            "immediate_gateway": r.get("immediate-gw") or r.get("immediate_gw") or "",
            "routing_table": rt or "main",
            "mikrotik_id": r.get(".id") or r.get("id"),
        })
    return normalized


def _to_int(v):
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _to_bool(v):
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    return str(v).lower() in ("true", "yes", "1")


def _protocol_from(r: dict) -> str:
    for k in ("bgp", "ospf", "connect", "static", "rip", "dhcp"):
        if _to_bool(r.get(k)):
            return k.upper()
    return "OTHER"


# ----------------------------------------------------------------------------
# Sync logic
# ----------------------------------------------------------------------------
async def run_sync(db, cipher: Cipher, router: dict, actor: str = "system") -> dict:
    """Return a summary dict. Never raise unless config-level error."""
    result = {"router_id": router["id"], "router_name": router["name"], "started_at": _now()}
    identity = None
    version = None
    try:
        probe = await mikrotik_probe(router, cipher)
        identity = probe.get("identity")
        version = probe.get("version")
        routes = await mikrotik_fetch_routes(router, cipher)
    except HTTPException as e:
        err_msg = e.detail if isinstance(e.detail, str) else str(e.detail)
        await db.mikrotik_routers.update_one(
            {"id": router["id"]},
            {"$set": {"last_failure_at": _now(), "last_error": err_msg, "router_identity": identity, "routeros_version": version, "updated_at": _now()}},
        )
        result.update({"ok": False, "error": err_msg, "routes_processed": 0})
        await db.ipam_sync_logs.insert_one({
            "id": _new_id(), "router_id": router["id"], "router_name": router["name"],
            "at": _now(), "ok": False, "error": err_msg, "actor": actor, "routes_count": 0,
        })
        return result

    now = _now()
    added = 0
    updated = 0
    # Upsert routes into ipam_routes collection
    seen_cidrs = set()
    for rt in routes:
        cidr = rt["cidr"]
        seen_cidrs.add((router["id"], cidr))
        existing = await db.ipam_routes.find_one({"router_id": router["id"], "cidr": cidr})
        doc = {
            "router_id": router["id"], "router_name": router["name"], "cidr": cidr,
            "gateway": rt["gateway"], "distance": rt["distance"], "scope": rt["scope"],
            "target_scope": rt["target_scope"], "comment": rt["comment"],
            "active": rt["active"], "disabled": rt["disabled"], "dynamic": rt["dynamic"],
            "static": rt["static"], "protocol": rt["protocol"],
            "immediate_gateway": rt["immediate_gateway"], "routing_table": rt["routing_table"],
            "mikrotik_id": rt.get("mikrotik_id"), "last_detected_at": now, "missing_since": None,
        }
        if existing:
            doc["first_detected_at"] = existing.get("first_detected_at") or now
            await db.ipam_routes.update_one({"_id": existing["_id"]}, {"$set": doc})
            updated += 1
        else:
            doc["_id"] = _new_id()
            doc["first_detected_at"] = now
            await db.ipam_routes.insert_one(doc)
            added += 1

    # Mark routes previously seen from this router but not in current fetch as missing
    marked_missing = 0
    async for r in db.ipam_routes.find({"router_id": router["id"], "missing_since": None}, {"_id": 1, "cidr": 1}):
        if (router["id"], r["cidr"]) not in seen_cidrs:
            await db.ipam_routes.update_one({"_id": r["_id"]}, {"$set": {"missing_since": now}})
            marked_missing += 1

    # Update router status
    await db.mikrotik_routers.update_one(
        {"id": router["id"]},
        {"$set": {
            "last_success_at": now, "last_error": None,
            "router_identity": identity, "routeros_version": version,
            "routes_count": len(routes), "updated_at": now,
        }},
    )
    await db.ipam_sync_logs.insert_one({
        "id": _new_id(), "router_id": router["id"], "router_name": router["name"],
        "at": now, "ok": True, "actor": actor,
        "routes_count": len(routes), "added": added, "updated": updated, "marked_missing": marked_missing,
    })
    result.update({"ok": True, "routes_processed": len(routes), "added": added, "updated": updated, "marked_missing": marked_missing, "identity": identity, "version": version})
    return result


# ----------------------------------------------------------------------------
# Audit log
# ----------------------------------------------------------------------------
async def audit(db, user: dict, action: str, cidr: str = "", *, old=None, new=None, router: str = "", description: str = "", request: Request = None):
    doc = {
        "id": _new_id(),
        "at": _now(),
        "user": user.get("email") if user else "system",
        "action": action,
        "cidr": cidr,
        "old_value": old,
        "new_value": new,
        "router": router,
        "source_ip": (request.client.host if request and request.client else None),
        "description": description,
    }
    await db.ipam_audit_logs.insert_one(doc)


# ----------------------------------------------------------------------------
# IPAM aggregation helpers
# ----------------------------------------------------------------------------
async def collect_used_and_reserved(db) -> Tuple[List[dict], List[dict]]:
    """Return (routes, allocations) — full docs, cleaned of _id."""
    routes: List[dict] = []
    async for r in db.ipam_routes.find({"missing_since": None}, {"_id": 0}):
        routes.append(r)
    allocations: List[dict] = []
    async for a in db.ipam_allocations.find({}, {"_id": 0}):
        allocations.append(a)
    return routes, allocations


def cidrs_from_routes(routes: List[dict]) -> List[str]:
    return [r["cidr"] for r in routes if r.get("cidr") and not r.get("disabled")]


def cidrs_from_allocations(allocs: List[dict], statuses: Tuple[str, ...] = ("Used", "Reserved", "Pending")) -> List[str]:
    return [a["cidr"] for a in allocs if a.get("cidr") and a.get("status") in statuses]


async def compute_prefix_summary(db, prefix: str) -> dict:
    routes, allocs = await collect_used_and_reserved(db)
    parent = ipaddress.ip_network(prefix)
    total = parent.num_addresses

    # Filter items relevant to this parent
    route_cidrs = [c for c in cidrs_from_routes(routes) if ipaddress.ip_network(c).subnet_of(parent)]
    active_alloc_cidrs = [c for c in cidrs_from_allocations(allocs, ("Used", "Pending")) if ipaddress.ip_network(c).subnet_of(parent)]
    reserved_cidrs = [c for c in cidrs_from_allocations(allocs, ("Reserved",)) if ipaddress.ip_network(c).subnet_of(parent)]

    used_all = list({*route_cidrs, *active_alloc_cidrs})
    used_addr = _sum_addresses(used_all, parent)
    reserved_addr = _sum_addresses(reserved_cidrs, parent, exclude=used_all)
    available = compute_available_within(prefix, [*used_all, *reserved_cidrs])
    available_addr = sum(ipaddress.ip_network(c).num_addresses for c in available)

    conflicts = _detect_conflicts_for_parent(routes, allocs, parent)

    # Last sync = min of relevant last_detected_at from filtered routes
    last_sync = None
    for r in routes:
        try:
            if ipaddress.ip_network(r["cidr"]).subnet_of(parent):
                ts = r.get("last_detected_at")
                if ts and (last_sync is None or ts > last_sync):
                    last_sync = ts
        except Exception:
            pass

    return {
        "prefix": prefix,
        "total": total,
        "used": used_addr,
        "reserved": reserved_addr,
        "available": available_addr,
        "utilization": round((used_addr + reserved_addr) / total * 100, 2) if total else 0,
        "conflicts": len(conflicts),
        "last_sync": last_sync,
    }


def _sum_addresses(cidrs: List[str], parent: ipaddress.IPv4Network, exclude: Optional[List[str]] = None) -> int:
    if not cidrs:
        return 0
    nets = []
    for c in cidrs:
        try:
            n = ipaddress.ip_network(c, strict=False)
            if n.subnet_of(parent):
                nets.append(n)
        except Exception:
            continue
    merged = list(ipaddress.collapse_addresses(nets))
    if exclude:
        excl_nets = []
        for c in exclude:
            try:
                n = ipaddress.ip_network(c, strict=False)
                excl_nets.append(n)
            except Exception:
                continue
        excl_merged = list(ipaddress.collapse_addresses(excl_nets)) if excl_nets else []
        # Subtract excl from merged
        remaining = list(merged)
        for e in excl_merged:
            new_remaining = []
            for r in remaining:
                if not r.overlaps(e):
                    new_remaining.append(r)
                elif e.subnet_of(r):
                    new_remaining.extend(r.address_exclude(e))
                elif r.subnet_of(e):
                    continue
                else:
                    new_remaining.append(r)
            remaining = new_remaining
        merged = remaining
    return sum(n.num_addresses for n in merged)


def _detect_conflicts_for_parent(routes: List[dict], allocs: List[dict], parent: ipaddress.IPv4Network) -> List[dict]:
    """Return list of conflict records — different customers using overlapping ranges,
    or manual allocation overlapping different route."""
    conflicts: List[dict] = []
    items = []
    for r in routes:
        try:
            n = ipaddress.ip_network(r["cidr"])
            if n.subnet_of(parent):
                items.append({"src": "route", "cidr": r["cidr"], "router": r.get("router_name"), "owner": r.get("comment") or ""})
        except Exception:
            continue
    for a in allocs:
        if a.get("status") not in ("Used", "Reserved", "Pending"):
            continue
        try:
            n = ipaddress.ip_network(a["cidr"])
            if n.subnet_of(parent):
                items.append({"src": "alloc", "cidr": a["cidr"], "owner": a.get("customer_id") or a.get("allocation_name") or ""})
        except Exception:
            continue
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a = items[i]; b = items[j]
            if a["cidr"] == b["cidr"]:
                continue
            if is_overlap(a["cidr"], b["cidr"]):
                # Skip if a subnet of the same route
                conflicts.append({"a": a, "b": b})
    return conflicts


# ----------------------------------------------------------------------------
# Router serialization
# ----------------------------------------------------------------------------
def router_to_out(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "host": doc["host"],
        "api_port": doc.get("api_port", 8728),
        "username": doc.get("username", ""),
        "ssl_enabled": bool(doc.get("ssl_enabled", False)),
        "verify_ssl": bool(doc.get("verify_ssl", False)),
        "routing_table": doc.get("routing_table", "main"),
        "status": doc.get("status", "Active"),
        "description": doc.get("description", ""),
        "auto_sync": doc.get("auto_sync", "manual"),
        "has_password": bool(doc.get("password_enc")),
        "connection_status": _conn_status(doc),
        "router_identity": doc.get("router_identity"),
        "routeros_version": doc.get("routeros_version"),
        "last_success_at": doc.get("last_success_at"),
        "last_failure_at": doc.get("last_failure_at"),
        "last_error": doc.get("last_error"),
        "routes_count": doc.get("routes_count", 0),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


def _conn_status(doc: dict) -> str:
    if not doc.get("password_enc"):
        return "Not Configured"
    if doc.get("last_error"):
        succ = doc.get("last_success_at")
        fail = doc.get("last_failure_at")
        if succ and fail and succ > fail:
            return "Connected"
        return "Error"
    if doc.get("last_success_at"):
        return "Connected"
    return "Untested"


# ----------------------------------------------------------------------------
# FastAPI router
# ----------------------------------------------------------------------------
def build_network_router(get_current_user, require_roles) -> APIRouter:
    r = APIRouter(prefix="/network", tags=["network"])

    # -- Routers CRUD --------------------------------------------------------
    @r.get("/routers")
    async def list_routers(request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        docs = []
        async for d in db.mikrotik_routers.find({}, {"_id": 0}):
            docs.append(router_to_out(d))
        return docs

    @r.post("/routers")
    async def create_router(body: RouterIn, request: Request, user: dict = Depends(require_roles("admin", "supervisor"))):
        if not body.password:
            raise HTTPException(status_code=400, detail="Password is required on creation")
        db = request.app.state.db
        cipher = await get_cipher(db)
        doc = {
            "id": _new_id(),
            "name": body.name, "host": body.host, "api_port": body.api_port,
            "username": body.username, "password_enc": cipher.encrypt(body.password),
            "ssl_enabled": body.ssl_enabled, "verify_ssl": body.verify_ssl,
            "routing_table": body.routing_table or "main",
            "status": body.status, "description": body.description,
            "auto_sync": body.auto_sync if body.auto_sync in SYNC_INTERVAL_CHOICES else "manual",
            "created_at": _now(), "updated_at": _now(),
            "created_by": user.get("email"),
        }
        await db.mikrotik_routers.insert_one(doc)
        await audit(db, user, "Router Setup Changed", router=body.name, description="Router created", request=request)
        clean = await db.mikrotik_routers.find_one({"id": doc["id"]}, {"_id": 0})
        return router_to_out(clean)

    @r.put("/routers/{rid}")
    async def update_router(rid: str, body: RouterIn, request: Request, user: dict = Depends(require_roles("admin", "supervisor"))):
        db = request.app.state.db
        cipher = await get_cipher(db)
        existing = await db.mikrotik_routers.find_one({"id": rid})
        if not existing:
            raise HTTPException(status_code=404, detail="Router not found")
        upd = {
            "name": body.name, "host": body.host, "api_port": body.api_port,
            "username": body.username,
            "ssl_enabled": body.ssl_enabled, "verify_ssl": body.verify_ssl,
            "routing_table": body.routing_table or "main",
            "status": body.status, "description": body.description,
            "auto_sync": body.auto_sync if body.auto_sync in SYNC_INTERVAL_CHOICES else "manual",
            "updated_at": _now(),
        }
        if body.password:
            upd["password_enc"] = cipher.encrypt(body.password)
        await db.mikrotik_routers.update_one({"id": rid}, {"$set": upd})
        await audit(db, user, "Router Setup Changed", router=body.name, description="Router updated", request=request)
        after = await db.mikrotik_routers.find_one({"id": rid}, {"_id": 0})
        return router_to_out(after)

    @r.delete("/routers/{rid}")
    async def delete_router(rid: str, request: Request, user: dict = Depends(require_roles("admin"))):
        db = request.app.state.db
        doc = await db.mikrotik_routers.find_one({"id": rid})
        if not doc:
            raise HTTPException(status_code=404, detail="Router not found")
        await db.mikrotik_routers.delete_one({"id": rid})
        await db.ipam_routes.delete_many({"router_id": rid})
        await audit(db, user, "Router Setup Changed", router=doc.get("name", ""), description="Router deleted", request=request)
        return {"ok": True}

    @r.post("/routers/{rid}/test")
    async def test_connection(rid: str, request: Request, user: dict = Depends(require_roles("admin", "supervisor"))):
        db = request.app.state.db
        cipher = await get_cipher(db)
        doc = await db.mikrotik_routers.find_one({"id": rid})
        if not doc:
            raise HTTPException(status_code=404, detail="Router not found")
        try:
            probe = await mikrotik_probe(doc, cipher)
            await db.mikrotik_routers.update_one(
                {"id": rid},
                {"$set": {
                    "router_identity": probe.get("identity"),
                    "routeros_version": probe.get("version"),
                    "last_success_at": _now(), "last_error": None, "updated_at": _now(),
                }},
            )
            return {"ok": True, "identity": probe.get("identity"), "version": probe.get("version")}
        except HTTPException as e:
            err = e.detail if isinstance(e.detail, str) else str(e.detail)
            await db.mikrotik_routers.update_one(
                {"id": rid},
                {"$set": {"last_failure_at": _now(), "last_error": err, "updated_at": _now()}},
            )
            return {"ok": False, "error": err}

    @r.post("/routers/{rid}/sync")
    async def sync_now(rid: str, request: Request, user: dict = Depends(require_roles("admin", "supervisor"))):
        db = request.app.state.db
        cipher = await get_cipher(db)
        doc = await db.mikrotik_routers.find_one({"id": rid})
        if not doc:
            raise HTTPException(status_code=404, detail="Router not found")
        summary = await run_sync(db, cipher, doc, actor=user.get("email", "user"))
        await audit(db, user, "MikroTik Synchronization", router=doc.get("name", ""), description=f"Sync ok={summary.get('ok')} routes={summary.get('routes_processed', 0)}", request=request)
        return summary

    @r.get("/routers/{rid}/routes")
    async def router_routes(rid: str, request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        out = []
        async for d in db.ipam_routes.find({"router_id": rid}, {"_id": 0}):
            out.append(d)
        return out

    # -- IPAM ---------------------------------------------------------------
    @r.get("/ipam/prefixes")
    async def list_prefixes(request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        return [await compute_prefix_summary(db, p) for p in ARTAMEDIA_PREFIXES]

    @r.get("/ipam/summary")
    async def ipam_summary(request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        parts = [await compute_prefix_summary(db, p) for p in ARTAMEDIA_PREFIXES]
        total = sum(p["total"] for p in parts)
        used = sum(p["used"] for p in parts)
        reserved = sum(p["reserved"] for p in parts)
        available = sum(p["available"] for p in parts)
        conflicts = sum(p["conflicts"] for p in parts)
        last_sync = max((p["last_sync"] for p in parts if p["last_sync"]), default=None)
        return {
            "total": total, "used": used, "reserved": reserved, "available": available,
            "conflicts": conflicts,
            "utilization": round((used + reserved) / total * 100, 2) if total else 0,
            "available_pct": round(available / total * 100, 2) if total else 0,
            "last_sync": last_sync,
        }

    @r.get("/ipam/prefix/{a}/{b}/{c}/{d}/{plen}/subnets")
    async def prefix_subnets(a: int, b: int, c: int, d: int, plen: int, request: Request, user: dict = Depends(get_current_user)):
        cidr = f"{a}.{b}.{c}.{d}/{plen}"
        try:
            parent = ipaddress.ip_network(cidr)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid prefix")
        if str(parent) not in ARTAMEDIA_PREFIXES:
            raise HTTPException(status_code=400, detail="Prefix is not owned by Artamedia")
        db = request.app.state.db
        routes, allocs = await collect_used_and_reserved(db)
        # Build subnet blocks: routes + allocations + available
        blocks: List[dict] = []
        # Routes (deduplicated with allocations later)
        route_by_cidr: dict = {}
        for r_ in routes:
            try:
                n = ipaddress.ip_network(r_["cidr"])
            except Exception:
                continue
            if not n.subnet_of(parent):
                continue
            key = str(n)
            entry = route_by_cidr.setdefault(key, {
                "cidr": key, "kind": "route", "status": ("Disabled" if r_.get("disabled") else "Used"),
                "num_addresses": n.num_addresses, "routers": [], "route_comments": [], "protocols": set(),
                "first_detected_at": r_.get("first_detected_at"), "last_detected_at": r_.get("last_detected_at"),
                "gateway": r_.get("gateway"), "distance": r_.get("distance"),
                "scope": r_.get("scope"), "target_scope": r_.get("target_scope"),
                "dynamic": r_.get("dynamic"), "static": r_.get("static"),
                "active": r_.get("active"), "disabled": r_.get("disabled"),
                "routing_table": r_.get("routing_table"),
            })
            if r_.get("router_name") and r_["router_name"] not in entry["routers"]:
                entry["routers"].append(r_["router_name"])
            if r_.get("comment"):
                entry["route_comments"].append({"router": r_.get("router_name"), "comment": r_["comment"]})
            entry["protocols"].add(r_.get("protocol", "OTHER"))
        # Allocations
        alloc_by_cidr: dict = {}
        for a_ in allocs:
            try:
                n = ipaddress.ip_network(a_["cidr"])
            except Exception:
                continue
            if not n.subnet_of(parent):
                continue
            alloc_by_cidr[str(n)] = a_

        # Combine: create records — route or alloc or both
        seen_cidrs = set()
        for cidr_key, r_entry in route_by_cidr.items():
            r_entry["protocols"] = sorted(list(r_entry["protocols"]))
            alloc = alloc_by_cidr.get(cidr_key)
            if alloc:
                r_entry["allocation"] = alloc
                # If allocation has a stronger status, prefer it
                if alloc.get("status") in ("Reserved", "Pending", "Conflict"):
                    r_entry["status"] = alloc["status"]
            seen_cidrs.add(cidr_key)
            blocks.append(r_entry)
        for cidr_key, a_ in alloc_by_cidr.items():
            if cidr_key in seen_cidrs:
                continue
            n = ipaddress.ip_network(cidr_key)
            blocks.append({
                "cidr": cidr_key, "kind": "allocation", "status": a_.get("status", "Reserved"),
                "num_addresses": n.num_addresses, "routers": [], "route_comments": [], "protocols": [],
                "allocation": a_,
            })
            seen_cidrs.add(cidr_key)

        # Free blocks
        used_for_free = [b["cidr"] for b in blocks if b["status"] in ("Used", "Reserved", "Pending", "Disabled")]
        available_blocks = compute_available_within(cidr, used_for_free)
        for c in available_blocks:
            n = ipaddress.ip_network(c)
            blocks.append({"cidr": c, "kind": "free", "status": "Available", "num_addresses": n.num_addresses, "routers": [], "route_comments": [], "protocols": []})

        # Conflict detection: any two blocks whose CIDRs overlap but are different
        conflict_cidrs = set()
        for i in range(len(blocks)):
            for j in range(i + 1, len(blocks)):
                if blocks[i]["cidr"] == blocks[j]["cidr"]:
                    continue
                if is_overlap(blocks[i]["cidr"], blocks[j]["cidr"]):
                    conflict_cidrs.add(blocks[i]["cidr"])
                    conflict_cidrs.add(blocks[j]["cidr"])
        for b in blocks:
            if b["cidr"] in conflict_cidrs and b["status"] != "Available":
                b["conflict"] = True

        blocks.sort(key=lambda x: ipaddress.ip_network(x["cidr"]).network_address)
        return {"prefix": cidr, "blocks": blocks}

    @r.get("/ipam/prefix/{a}/{b}/{c}/{d}/{plen}/addresses")
    async def prefix_addresses(a: int, b: int, c: int, d: int, plen: int, request: Request, user: dict = Depends(get_current_user)):
        cidr = f"{a}.{b}.{c}.{d}/{plen}"
        try:
            parent = ipaddress.ip_network(cidr)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid prefix")
        if str(parent) not in ARTAMEDIA_PREFIXES:
            raise HTTPException(status_code=400, detail="Prefix is not owned by Artamedia")
        db = request.app.state.db
        # Reuse subnets endpoint logic
        payload = await prefix_subnets(a, b, c, d, plen, request, user)
        # Build ip → status mapping
        blocks = payload["blocks"]
        by_ip: dict = {}
        for b_ in blocks:
            try:
                n = ipaddress.ip_network(b_["cidr"])
            except Exception:
                continue
            for ip in n.hosts() if n.prefixlen < 31 else n:
                key = str(ip)
                if b_["status"] == "Available":
                    # Only set if not yet claimed
                    by_ip.setdefault(key, {"ip": key, "status": "Available", "cidr": b_["cidr"]})
                else:
                    by_ip[key] = {
                        "ip": key, "status": b_["status"], "cidr": b_["cidr"],
                        "routers": b_.get("routers"),
                        "allocation_name": (b_.get("allocation") or {}).get("allocation_name"),
                        "customer_id": (b_.get("allocation") or {}).get("customer_id"),
                        "sid": (b_.get("allocation") or {}).get("sid"),
                        "usage_type": (b_.get("allocation") or {}).get("usage_type"),
                        "noc_comment": (b_.get("allocation") or {}).get("noc_comment"),
                        "conflict": b_.get("conflict", False),
                    }
        addresses = [by_ip[str(ip)] for ip in parent if str(ip) in by_ip]
        return {"prefix": cidr, "addresses": addresses}

    # -- Allocations -------------------------------------------------------
    @r.get("/ipam/allocations")
    async def list_allocations(request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        out = []
        async for a in db.ipam_allocations.find({}, {"_id": 0}):
            out.append(a)
        return out

    @r.post("/ipam/allocations")
    async def create_allocation(body: AllocationIn, request: Request, user: dict = Depends(require_roles("admin", "supervisor", "engineer"))):
        db = request.app.state.db
        # Validate
        parent = artamedia_parent(body.cidr)
        if not parent:
            raise HTTPException(status_code=400, detail=f"CIDR {body.cidr} is not inside any Artamedia /24 prefix")
        try:
            net = ipaddress.ip_network(body.cidr, strict=False)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid CIDR: {body.cidr}")
        # Check overlap
        conflicts = await _find_conflicts(db, body.cidr)
        if conflicts and not body.override_conflict:
            raise HTTPException(status_code=409, detail={
                "message": "CIDR overlaps with existing route/reservation/allocation",
                "conflicts": conflicts,
            })
        if body.override_conflict and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Only administrator may override conflicts")

        doc = {
            "id": _new_id(),
            "cidr": str(net),
            "status": body.status,
            "allocation_name": body.allocation_name or "",
            "customer_id": body.customer_id,
            "sid": body.sid or "",
            "usage_type": body.usage_type or "Other",
            "noc_comment": body.noc_comment or "",
            "internal_notes": body.internal_notes or "",
            "router_source": body.router_source or "",
            "mikrotik_route_comment": body.mikrotik_route_comment or "",
            "planned_activation_date": body.planned_activation_date,
            "assigned_by": user.get("email"),
            "assigned_at": _now(),
            "created_at": _now(), "updated_at": _now(),
        }
        if conflicts and body.override_conflict:
            doc["conflict_override_by"] = user.get("email")
            doc["conflict_override_at"] = _now()
        await db.ipam_allocations.insert_one(doc)
        await audit(db, user, "Manual Reservation Created" if body.status == "Reserved" else "Allocation Updated",
                    cidr=str(net), new={"status": body.status, "customer": body.customer_id, "name": body.allocation_name},
                    description=f"{body.status} — {body.allocation_name or ''}", request=request)
        if conflicts and body.override_conflict:
            await audit(db, user, "Conflict Override", cidr=str(net), new={"conflicts": conflicts}, description="Admin override", request=request)
        return await db.ipam_allocations.find_one({"id": doc["id"]}, {"_id": 0})

    @r.patch("/ipam/allocations/{aid}")
    async def update_allocation(aid: str, body: AllocationUpdateIn, request: Request, user: dict = Depends(require_roles("admin", "supervisor", "engineer"))):
        db = request.app.state.db
        doc = await db.ipam_allocations.find_one({"id": aid})
        if not doc:
            raise HTTPException(status_code=404, detail="Allocation not found")
        upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
        upd["updated_at"] = _now()
        await db.ipam_allocations.update_one({"id": aid}, {"$set": upd})
        await audit(db, user, "Allocation Updated" if "status" not in upd else "Comment Updated", cidr=doc["cidr"],
                    old={k: doc.get(k) for k in upd.keys() if k != "updated_at"}, new=upd, request=request)
        after = await db.ipam_allocations.find_one({"id": aid}, {"_id": 0})
        return after

    @r.delete("/ipam/allocations/{aid}")
    async def delete_allocation(aid: str, request: Request, user: dict = Depends(require_roles("admin", "supervisor"))):
        db = request.app.state.db
        doc = await db.ipam_allocations.find_one({"id": aid})
        if not doc:
            raise HTTPException(status_code=404, detail="Allocation not found")
        await db.ipam_allocations.delete_one({"id": aid})
        await audit(db, user, "Allocation Released", cidr=doc.get("cidr", ""), old=doc, description="Allocation deleted", request=request)
        return {"ok": True}

    @r.post("/ipam/allocate-available")
    async def find_available(payload: dict, request: Request, user: dict = Depends(get_current_user)):
        prefix_len = int(payload.get("prefix_length", 30))
        if prefix_len not in ALLOWED_PREFIX_LENGTHS:
            raise HTTPException(status_code=400, detail=f"Prefix length must be one of {ALLOWED_PREFIX_LENGTHS}")
        db = request.app.state.db
        routes, allocs = await collect_used_and_reserved(db)
        used = list({*cidrs_from_routes(routes), *cidrs_from_allocations(allocs)})
        suggestions = []
        for parent in ARTAMEDIA_PREFIXES:
            for c in first_available_of_size(parent, used, prefix_len, limit=3):
                suggestions.append({"parent": parent, "cidr": c})
        return {"prefix_length": prefix_len, "suggestions": suggestions[:9]}

    # -- Audit log ----------------------------------------------------------
    @r.get("/ipam/audit-log")
    async def audit_log(request: Request, user: dict = Depends(require_roles("admin", "supervisor"))):
        db = request.app.state.db
        out = []
        async for a in db.ipam_audit_logs.find({}, {"_id": 0}).sort("at", -1).limit(500):
            out.append(a)
        return out

    @r.get("/ipam/sync-log")
    async def sync_log(request: Request, user: dict = Depends(get_current_user)):
        db = request.app.state.db
        out = []
        async for a in db.ipam_sync_logs.find({}, {"_id": 0}).sort("at", -1).limit(200):
            out.append(a)
        return out

    return r


async def _find_conflicts(db, cidr: str) -> List[dict]:
    """Return list of overlapping records (routes + allocations)."""
    conflicts: List[dict] = []
    async for r_ in db.ipam_routes.find({"missing_since": None}, {"_id": 0}):
        if is_overlap(cidr, r_["cidr"]) and cidr != r_["cidr"]:
            conflicts.append({"src": "route", "cidr": r_["cidr"], "router": r_.get("router_name"), "comment": r_.get("comment")})
    async for a_ in db.ipam_allocations.find({}, {"_id": 0}):
        if is_overlap(cidr, a_["cidr"]) and cidr != a_["cidr"]:
            conflicts.append({"src": "allocation", "cidr": a_["cidr"], "status": a_.get("status"), "name": a_.get("allocation_name")})
    return conflicts


# ----------------------------------------------------------------------------
# Auto-sync background task
# ----------------------------------------------------------------------------
async def auto_sync_loop(app):
    """Background task: every minute, check each router's auto_sync interval
    and trigger sync if due."""
    logger.info("Auto-sync loop started")
    last_run: dict = {}
    while True:
        try:
            await asyncio.sleep(60)  # tick every minute
            db = app.state.db
            cipher = await get_cipher(db)
            now = datetime.now(timezone.utc)
            async for router in db.mikrotik_routers.find({"status": "Active"}, {"_id": 0}):
                interval_key = router.get("auto_sync", "manual")
                minutes = SYNC_INTERVAL_CHOICES.get(interval_key, 0)
                if minutes <= 0:
                    continue
                last = last_run.get(router["id"])
                if last is None or (now - last).total_seconds() >= minutes * 60:
                    try:
                        await run_sync(db, cipher, router, actor="auto-sync")
                    except Exception as e:
                        logger.exception("Auto-sync failed for router %s: %s", router.get("name"), e)
                    last_run[router["id"]] = now
        except asyncio.CancelledError:
            logger.info("Auto-sync loop cancelled")
            return
        except Exception as e:
            logger.exception("Auto-sync loop error: %s", e)
