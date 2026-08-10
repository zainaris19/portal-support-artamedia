"""
Topology Management System — module baru (dipakai bersama /app/backend/topology.py legacy).

Prinsip:
    - Semua data master (Site/Customer/Rack/Device/Partner/Service/Interconnection)
      TIDAK diduplikasi. Kita hanya menyimpan referensi ID.
    - Dependency graph di-compute on-the-fly (bukan collection persist) → satu sumber kebenaran.
    - Sederhana tapi fleksibel; siap untuk RCA, impact, redundancy, tunnel underlay.

Collections baru (semua prefix `topology_*`):
    topology_sites          GPS anchor untuk lokasi. Ref ke customer / rack / partner.
    topology_patch_panels   Patch panel fisik di rack.
    topology_odf            ODF fisik.
    topology_fibers         Segment fiber ODF-A ↔ ODF-B (dengan route peta).
    topology_port_mappings  Chain fisik device_port → patch → ODF → fiber → ... → device_port.
    topology_links          Link topologi (extend interconnection dengan atribut baru + role redundancy).
    topology_tunnels        L2TP/PPTP/EoIP/GRE/IPIP/WireGuard + underlay reference.
    topology_layouts        Persist posisi node per mode + history 10 snapshot terakhir.
    topology_audit          Audit trail semua CRUD.
    uisp_config             Credential UISP terenkripsi.
    uisp_sync_cache         Snapshot entities UISP untuk mapping.
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional, Literal, Any, Dict, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict

logger = logging.getLogger("noc.topology_v2")


def now_utc() -> datetime: return datetime.now(timezone.utc)
def now_iso() -> str: return now_utc().isoformat()
def new_id() -> str: return str(uuid.uuid4())


# ============================================================================
# TYPE ALIASES
# ============================================================================
LinkType = Literal[
    "Fiber Optic Artamedia", "Metro Ethernet Mitra", "Cross Connect",
    "Wireless BTS to BTS", "Dedicated Internet", "Broadband",
    "Tunnel", "Logical VLAN",
]
TunnelType = Literal["L2TP", "PPTP", "EoIP", "GRE", "IPIP", "WireGuard"]
UnderlayType = Literal["Fiber", "Metro Ethernet", "Radio", "Internet", "Starlink"]
LinkRole = Literal["primary", "secondary", "backup"]
NodeStatus = Literal["up", "degraded", "down", "unreachable", "unknown"]

TopologyMode = Literal["service_path", "physical_path", "geographic", "tunnel"]

# ============================================================================
# PYDANTIC MODELS
# ============================================================================
class SiteIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    type: Literal["datacenter", "customer_site", "pop", "outdoor_pole", "tower", "office"] = "customer_site"
    address: str = ""
    city: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    notes: str = ""
    parent_site_id: Optional[str] = None
    ref_customer_id: Optional[str] = None
    ref_rack_id: Optional[str] = None
    ref_partner_id: Optional[str] = None


class PatchPanelIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    code: str = ""
    site_id: Optional[str] = None
    rack_id: Optional[str] = None
    rack_position_u: Optional[int] = None
    port_count: int = 24
    panel_type: Literal["copper", "fiber"] = "fiber"
    port_labels: List[Dict[str, Any]] = Field(default_factory=list)
    notes: str = ""


class OdfIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    code: str = ""
    site_id: Optional[str] = None
    rack_id: Optional[str] = None
    rack_position_u: Optional[int] = None
    connector_type: Literal["SC", "LC", "FC", "ST"] = "LC"
    fiber_type: Literal["SM", "MM"] = "SM"
    port_count: int = 12
    port_labels: List[Dict[str, Any]] = Field(default_factory=list)
    notes: str = ""


class FiberIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: str
    cable_type: Literal["aerial", "underground", "indoor", "submarine"] = "aerial"
    fiber_count: int = 12
    core_count: int = 1
    provider_id: Optional[str] = None
    from_odf_id: Optional[str] = None
    from_port: Optional[int] = None
    to_odf_id: Optional[str] = None
    to_port: Optional[int] = None
    route_geojson: Optional[Dict[str, Any]] = None
    length_meters: Optional[float] = None
    loss_db: Optional[float] = None
    installation_date: Optional[str] = None
    status: Literal["active", "planned", "decommissioned"] = "active"
    notes: str = ""


class PortMappingIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    description: str = ""
    chain: List[Dict[str, Any]] = Field(default_factory=list)


class LinkIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    source_device_id: Optional[str] = None
    source_port: str = ""
    dest_device_id: Optional[str] = None
    dest_port: str = ""
    link_type: LinkType = "Fiber Optic Artamedia"
    media: str = ""
    capacity_mbps: Optional[int] = None
    provider_id: Optional[str] = None
    circuit_id: str = ""
    vlan: Optional[int] = None
    sid: str = ""
    description: str = ""
    port_mapping_id: Optional[str] = None
    tunnel_id: Optional[str] = None
    role: LinkRole = "primary"
    redundancy_group_id: Optional[str] = None
    status_override: Optional[NodeStatus] = None


class TunnelIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    tunnel_type: TunnelType = "EoIP"
    a_device_id: Optional[str] = None
    a_endpoint_ip: str = ""
    b_device_id: Optional[str] = None
    b_endpoint_ip: str = ""
    a_side_underlay_link_id: Optional[str] = None
    b_side_underlay_link_id: Optional[str] = None
    underlay_type: Optional[UnderlayType] = None
    provider_id: Optional[str] = None
    vlan: Optional[int] = None
    mtu: Optional[int] = None
    encryption_key_hint: str = ""
    status: Literal["active", "planned", "down"] = "active"
    description: str = ""


class LayoutSaveIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = "default"
    mode: TopologyMode = "service_path"
    is_default: bool = True
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)
    viewport: Dict[str, Any] = Field(default_factory=dict)


class UispConfigIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str
    token: str
    ssl_verify: bool = True


# ============================================================================
# HELPERS
# ============================================================================
def _actor(user: dict) -> dict:
    return {"id": user.get("id"), "name": user.get("name") or user.get("email"), "role": user.get("role")}


async def _audit(db, user: dict, action: str, entity_type: str, entity_id: Optional[str] = None,
                 before: Any = None, after: Any = None, note: str = ""):
    a = _actor(user)
    await db.topology_audit.insert_one({
        "id": new_id(), "at": now_iso(),
        "actor_id": a["id"], "actor_name": a["name"], "role": a["role"],
        "action": action, "entity_type": entity_type, "entity_id": entity_id,
        "before": before, "after": after, "note": note,
    })


# ============================================================================
# DEPENDENCY / IMPACT ENGINE (on-the-fly, no persistent graph)
# ============================================================================
async def _build_graph(db) -> Dict[str, Any]:
    """Compute dependency graph on-the-fly from existing collections.
    Returns adjacency lists: adj_downstream (node → children) and adj_upstream (node → parents).
    Node IDs are prefixed by type: 'site:xxx', 'rack:xxx', 'device:xxx', 'link:xxx', 'tunnel:xxx'.
    """
    adj_down: Dict[str, List[str]] = {}
    adj_up: Dict[str, List[str]] = {}
    nodes: Dict[str, Dict[str, Any]] = {}

    def add_edge(parent: str, child: str):
        adj_down.setdefault(parent, []).append(child)
        adj_up.setdefault(child, []).append(parent)

    def add_node(nid: str, kind: str, name: str, extra: Optional[dict] = None):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "kind": kind, "name": name, **(extra or {})}

    # Sites
    async for s in db.topology_sites.find({}, {"_id": 0}):
        add_node(f"site:{s['id']}", "site", s.get("name") or "Site", {"lat": s.get("latitude"), "lng": s.get("longitude")})
        if s.get("parent_site_id"):
            add_edge(f"site:{s['parent_site_id']}", f"site:{s['id']}")

    # Racks
    async for r in db.racks.find({}, {"_id": 0}):
        add_node(f"rack:{r['id']}", "rack", r.get("name") or "Rack",
                 {"datacenter": r.get("datacenter"), "location": r.get("location")})
        # Rack lives at a site inferred by datacenter/name match
        site = await db.topology_sites.find_one({"ref_rack_id": r["id"]}, {"_id": 0, "id": 1})
        if site:
            add_edge(f"site:{site['id']}", f"rack:{r['id']}")

    # Devices — child of rack
    async for d in db.devices.find({}, {"_id": 0}):
        add_node(f"device:{d['id']}", "device", d.get("name") or "Device",
                 {"role": d.get("role"), "vendor": d.get("vendor"), "ip": d.get("mgmt_ip")})
        if d.get("rack_id"):
            add_edge(f"rack:{d['rack_id']}", f"device:{d['id']}")

    # Links — device ↔ device
    links = []
    async for lk in db.topology_links.find({}, {"_id": 0}):
        links.append(lk)
        lid = f"link:{lk['id']}"
        add_node(lid, "link", lk.get("description") or f"{lk.get('link_type')} link",
                 {"link_type": lk.get("link_type"), "role": lk.get("role"), "redundancy_group_id": lk.get("redundancy_group_id")})
        # Physical dependency: source device — link — dest device (undirected but we register both parent→link → child)
        if lk.get("source_device_id"):
            add_edge(f"device:{lk['source_device_id']}", lid)
        if lk.get("dest_device_id"):
            add_edge(lid, f"device:{lk['dest_device_id']}")

    # Tunnels — depend on underlay link
    tunnels = []
    async for t in db.topology_tunnels.find({}, {"_id": 0}):
        tunnels.append(t)
        tid = f"tunnel:{t['id']}"
        add_node(tid, "tunnel", t.get("name") or f"{t.get('tunnel_type')} tunnel",
                 {"tunnel_type": t.get("tunnel_type"), "underlay_type": t.get("underlay_type")})
        for side in ("a_side_underlay_link_id", "b_side_underlay_link_id"):
            if t.get(side):
                add_edge(f"link:{t[side]}", tid)
        # Also parent-child from endpoint devices to tunnel
        if t.get("a_device_id"): add_edge(f"device:{t['a_device_id']}", tid)
        if t.get("b_device_id"): add_edge(f"device:{t['b_device_id']}", tid)

    # Customers — child of a device (their CPE) if we can determine; else child of a link
    #   Simple rule: customer node reachable if ANY device with an interconnection SID that
    #   matches customer.sid is UP. For now we register customer against the FIRST link whose
    #   `sid` matches, else against `ref_customer_id` site.
    customers = []
    async for cu in db.customers.find({}, {"_id": 0}):
        customers.append(cu)
        cid = f"customer:{cu['id']}"
        add_node(cid, "customer", cu.get("company_name") or "Customer",
                 {"sid": cu.get("sid"), "category": cu.get("category")})
        # Attach to matching link by SID
        for lk in links:
            if lk.get("sid") and lk["sid"] == cu.get("sid"):
                add_edge(f"link:{lk['id']}", cid)
                break
        # Attach to matching site (customer site)
        site = await db.topology_sites.find_one({"ref_customer_id": cu["id"]}, {"_id": 0, "id": 1})
        if site:
            add_edge(f"site:{site['id']}", cid)

    return {"nodes": nodes, "adj_down": adj_down, "adj_up": adj_up,
            "links": links, "tunnels": tunnels, "customers": customers}


def _propagate_status(graph: Dict[str, Any], down_nodes: List[str]) -> Dict[str, str]:
    """Given nodes that are DOWN, propagate UNREACHABLE / DEGRADED to downstream.
    Redundancy: for nodes reached by MULTIPLE parents where at least one parent is still UP
    → DEGRADED, else UNREACHABLE.
    """
    adj_down = graph["adj_down"]
    adj_up = graph["adj_up"]
    all_nodes = set(graph["nodes"].keys())
    status: Dict[str, str] = {n: "up" for n in all_nodes}
    for n in down_nodes:
        if n in status: status[n] = "down"

    # BFS from down nodes
    visited = set(down_nodes)
    queue = list(down_nodes)
    while queue:
        cur = queue.pop(0)
        for child in adj_down.get(cur, []):
            if child in visited:
                continue
            # Check if child has ALTERNATIVE parents that are still UP
            parents = adj_up.get(child, [])
            alt_up = [p for p in parents if status.get(p) == "up"]
            if alt_up:
                status[child] = "degraded"
            else:
                status[child] = "unreachable"
            visited.add(child)
            queue.append(child)

    return status


async def _compute_impact(db, down_nodes: List[str]) -> Dict[str, Any]:
    graph = await _build_graph(db)
    status = _propagate_status(graph, down_nodes)
    impacted = {"device": [], "link": [], "tunnel": [], "customer": [], "site": []}
    for nid, st in status.items():
        if st not in ("down", "unreachable", "degraded"):
            continue
        kind = graph["nodes"][nid]["kind"]
        if kind in impacted:
            impacted[kind].append({"id": nid.split(":", 1)[1], "name": graph["nodes"][nid]["name"], "status": st})
    return {
        "root_cause_nodes": down_nodes,
        "impacted_status": {k: v for k, v in status.items() if v != "up"},
        "counts": {k: len(v) for k, v in impacted.items()},
        "impacted": impacted,
    }


async def _trace(db, node_id: str, direction: Literal["upstream", "downstream"]) -> Dict[str, Any]:
    graph = await _build_graph(db)
    adj = graph["adj_up"] if direction == "upstream" else graph["adj_down"]
    if node_id not in graph["nodes"]:
        raise HTTPException(status_code=404, detail=f"Node {node_id} tidak ada di graph")
    visited = set()
    path_edges = []
    queue = [(node_id, 0)]
    ordered = []
    while queue:
        cur, depth = queue.pop(0)
        if cur in visited:
            continue
        visited.add(cur)
        ordered.append({"id": cur, "depth": depth, **graph["nodes"][cur]})
        for nxt in adj.get(cur, []):
            path_edges.append({"from": cur, "to": nxt} if direction == "downstream" else {"from": nxt, "to": cur})
            queue.append((nxt, depth + 1))
    return {"start": node_id, "direction": direction, "nodes": ordered, "edges": path_edges}


# ============================================================================
# MIGRATION + SEED
# ============================================================================
async def seed_topology(db) -> Dict[str, Any]:
    """Idempotent seeding: bikin topology_sites untuk setiap rack + customer yang belum punya.
    TIDAK mengubah data existing."""
    created = {"sites_from_racks": 0, "sites_from_customers": 0, "links_from_interconnections": 0}

    # Sites from racks (datacenter type)
    async for r in db.racks.find({}, {"_id": 0}):
        existing = await db.topology_sites.find_one({"ref_rack_id": r["id"]})
        if existing:
            continue
        doc = {
            "id": new_id(),
            "name": f"{r.get('datacenter', 'DC')} · {r.get('name', 'Rack')}",
            "type": "datacenter",
            "address": r.get("location") or r.get("datacenter") or "",
            "city": r.get("datacenter", ""),
            "latitude": None, "longitude": None, "altitude": None,
            "notes": f"Auto-created from rack {r.get('name')}",
            "parent_site_id": None, "ref_rack_id": r["id"],
            "ref_customer_id": None, "ref_partner_id": None,
            "created_at": now_iso(), "created_by": "system",
        }
        await db.topology_sites.insert_one(doc)
        created["sites_from_racks"] += 1

    # Sites from customers
    async for cu in db.customers.find({}, {"_id": 0}):
        existing = await db.topology_sites.find_one({"ref_customer_id": cu["id"]})
        if existing:
            continue
        doc = {
            "id": new_id(),
            "name": cu.get("company_name") or "Customer",
            "type": "customer_site",
            "address": cu.get("location") or "",
            "city": cu.get("location") or "",
            "latitude": None, "longitude": None, "altitude": None,
            "notes": f"Auto-created from customer {cu.get('sid', '')}",
            "parent_site_id": None, "ref_rack_id": None,
            "ref_customer_id": cu["id"], "ref_partner_id": None,
            "created_at": now_iso(), "created_by": "system",
        }
        await db.topology_sites.insert_one(doc)
        created["sites_from_customers"] += 1

    # Links from interconnections (idempotent)
    async for ic in db.interconnections.find({}, {"_id": 0}):
        existing = await db.topology_links.find_one({"legacy_interconnection_id": ic["id"]})
        if existing:
            continue
        # Map connection_type → LinkType
        ct = (ic.get("connection_type") or "").lower()
        if "fiber" in ct or "fo" in ct: link_type = "Fiber Optic Artamedia"
        elif "metro" in ct: link_type = "Metro Ethernet Mitra"
        elif "cross" in ct: link_type = "Cross Connect"
        elif "radio" in ct or "wireless" in ct or "wifi" in ct: link_type = "Wireless BTS to BTS"
        else: link_type = "Fiber Optic Artamedia"
        doc = {
            "id": new_id(),
            "source_device_id": ic.get("source_device_id"),
            "source_port": ic.get("source_port") or "",
            "dest_device_id": ic.get("dest_device_id"),
            "dest_port": ic.get("dest_port") or "",
            "link_type": link_type,
            "media": ic.get("cable_id") or "",
            "capacity_mbps": None,
            "provider_id": ic.get("partner_id"),
            "circuit_id": ic.get("cable_id") or "",
            "vlan": None,
            "sid": ic.get("service_id") or "",
            "description": ic.get("description") or "",
            "port_mapping_id": None,
            "tunnel_id": None,
            "role": "primary",
            "redundancy_group_id": None,
            "status_override": None,
            "legacy_interconnection_id": ic["id"],
            "created_at": now_iso(), "created_by": "system", "updated_at": now_iso(),
        }
        await db.topology_links.insert_one(doc)
        created["links_from_interconnections"] += 1

    logger.info(f"[topology] seed done: {created}")
    return created


# ============================================================================
# ROUTER
# ============================================================================
def build_topology_v2_router(get_current_user, get_db):
    router = APIRouter(prefix="/topology/v2", tags=["topology-v2"])

    ADMIN = {"admin"}
    SUPERVISOR = {"admin", "supervisor"}
    NOC = {"admin", "supervisor", "engineer"}

    def _require(user: dict, roles: set):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    # ---------- Master data references (aggregated for palette) ----------
    @router.get("/references")
    async def references(user: dict = Depends(get_current_user)):
        db = get_db()
        return {
            "sites": await db.topology_sites.find({}, {"_id": 0}).to_list(1000),
            "racks": await db.racks.find({}, {"_id": 0, "id": 1, "name": 1, "datacenter": 1, "location": 1}).to_list(1000),
            "devices": await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "role": 1, "vendor": 1, "mgmt_ip": 1, "rack_id": 1}).to_list(2000),
            "customers": await db.customers.find({}, {"_id": 0, "id": 1, "company_name": 1, "sid": 1, "category": 1, "location": 1}).to_list(2000),
            "partners": await db.partners.find({}, {"_id": 0, "id": 1, "name": 1, "type": 1}).to_list(500),
            "patch_panels": await db.topology_patch_panels.find({}, {"_id": 0}).to_list(500),
            "odf": await db.topology_odf.find({}, {"_id": 0}).to_list(500),
            "fibers": await db.topology_fibers.find({}, {"_id": 0}).to_list(500),
            "links": await db.topology_links.find({}, {"_id": 0}).to_list(2000),
            "tunnels": await db.topology_tunnels.find({}, {"_id": 0}).to_list(1000),
        }

    # ---------- Generic CRUD builder ----------
    def _make_crud(prefix: str, coll: str, Model, entity_type: str, roles=SUPERVISOR):
        @router.get(f"/{prefix}")
        async def _list(user: dict = Depends(get_current_user)):
            return await get_db()[coll].find({}, {"_id": 0}).to_list(2000)

        @router.post(f"/{prefix}")
        async def _create(body: Model, user: dict = Depends(get_current_user)):
            _require(user, roles)
            db = get_db()
            doc = body.model_dump()
            doc["id"] = new_id()
            doc["created_at"] = now_iso()
            doc["created_by"] = user.get("name") or user.get("email")
            doc["updated_at"] = now_iso()
            await db[coll].insert_one(doc)
            doc.pop("_id", None)
            await _audit(db, user, "create", entity_type, doc["id"], None, doc)
            return doc
        # Force annotation to the actual class (bypass PEP 563 string-annotation issue)
        _create.__annotations__["body"] = Model

        @router.put(f"/{prefix}/{{eid}}")
        async def _update(eid: str, body: Model, user: dict = Depends(get_current_user)):
            _require(user, roles)
            db = get_db()
            before = await db[coll].find_one({"id": eid}, {"_id": 0})
            if not before:
                raise HTTPException(status_code=404, detail="Not found")
            patch = body.model_dump()
            patch["updated_at"] = now_iso()
            patch["updated_by"] = user.get("name") or user.get("email")
            await db[coll].update_one({"id": eid}, {"$set": patch})
            after = await db[coll].find_one({"id": eid}, {"_id": 0})
            await _audit(db, user, "update", entity_type, eid, before, after)
            return after
        _update.__annotations__["body"] = Model

        @router.delete(f"/{prefix}/{{eid}}")
        async def _delete(eid: str, user: dict = Depends(get_current_user)):
            _require(user, roles)
            db = get_db()
            before = await db[coll].find_one({"id": eid}, {"_id": 0})
            if not before:
                raise HTTPException(status_code=404, detail="Not found")
            await db[coll].delete_one({"id": eid})
            await _audit(db, user, "delete", entity_type, eid, before, None)
            return {"ok": True}

    _make_crud("sites", "topology_sites", SiteIn, "site")
    _make_crud("patch-panels", "topology_patch_panels", PatchPanelIn, "patch_panel")
    _make_crud("odf", "topology_odf", OdfIn, "odf")
    _make_crud("fibers", "topology_fibers", FiberIn, "fiber")
    _make_crud("port-mappings", "topology_port_mappings", PortMappingIn, "port_mapping")
    _make_crud("links", "topology_links", LinkIn, "link")
    _make_crud("tunnels", "topology_tunnels", TunnelIn, "tunnel")

    # ---------- Graph / impact / trace ----------
    @router.get("/graph")
    async def graph_endpoint(user: dict = Depends(get_current_user)):
        db = get_db()
        return await _build_graph(db)

    @router.post("/impact")
    async def impact_endpoint(payload: Dict[str, List[str]], user: dict = Depends(get_current_user)):
        db = get_db()
        down_nodes = payload.get("down_nodes") or []
        return await _compute_impact(db, down_nodes)

    @router.get("/trace/{direction}/{node_id:path}")
    async def trace_endpoint(direction: str, node_id: str, user: dict = Depends(get_current_user)):
        if direction not in ("upstream", "downstream"):
            raise HTTPException(status_code=400, detail="direction harus upstream|downstream")
        db = get_db()
        return await _trace(db, node_id, direction)  # type: ignore

    # ---------- Layouts ----------
    @router.get("/layouts")
    async def list_layouts(mode: Optional[str] = None, user: dict = Depends(get_current_user)):
        db = get_db()
        q = {"mode": mode} if mode else {}
        return await db.topology_layouts.find(q, {"_id": 0, "history": 0}).to_list(200)

    @router.get("/layouts/default")
    async def default_layout(mode: TopologyMode = "service_path", user: dict = Depends(get_current_user)):
        db = get_db()
        doc = await db.topology_layouts.find_one({"mode": mode, "is_default": True}, {"_id": 0})
        return doc or {"mode": mode, "nodes": [], "edges": [], "viewport": {}, "is_default": True, "version": 0}

    @router.post("/layouts")
    async def save_layout(body: LayoutSaveIn, user: dict = Depends(get_current_user)):
        _require(user, SUPERVISOR)
        db = get_db()
        existing = await db.topology_layouts.find_one({"mode": body.mode, "name": body.name})
        actor = user.get("name") or user.get("email")
        new_snapshot = {
            "version": (existing or {}).get("version", 0) + 1,
            "at": now_iso(), "by": actor,
            "nodes": body.nodes, "edges": body.edges, "viewport": body.viewport,
        }
        if existing:
            history = (existing.get("history") or []) + [new_snapshot]
            history = history[-10:]
            update = {
                "nodes": body.nodes, "edges": body.edges, "viewport": body.viewport,
                "is_default": body.is_default, "version": new_snapshot["version"],
                "updated_at": now_iso(), "updated_by": actor, "history": history,
            }
            await db.topology_layouts.update_one({"id": existing["id"]}, {"$set": update})
            after = await db.topology_layouts.find_one({"id": existing["id"]}, {"_id": 0, "history": 0})
        else:
            doc = {
                "id": new_id(), "name": body.name, "mode": body.mode,
                "is_default": body.is_default, "nodes": body.nodes, "edges": body.edges,
                "viewport": body.viewport, "version": 1,
                "created_at": now_iso(), "created_by": actor,
                "updated_at": now_iso(), "updated_by": actor,
                "history": [new_snapshot],
            }
            await db.topology_layouts.insert_one(doc)
            after = {k: v for k, v in doc.items() if k not in ("history", "_id")}
        await _audit(db, user, "save_layout", "layout", after.get("id"), None, {"version": new_snapshot["version"]})
        return after

    # ---------- Audit ----------
    @router.get("/audit")
    async def audit_list(entity_type: Optional[str] = None, entity_id: Optional[str] = None,
                         limit: int = 100, user: dict = Depends(get_current_user)):
        db = get_db()
        q: dict = {}
        if entity_type: q["entity_type"] = entity_type
        if entity_id: q["entity_id"] = entity_id
        return await db.topology_audit.find(q, {"_id": 0}).sort("at", -1).limit(limit).to_list(limit)

    return router
