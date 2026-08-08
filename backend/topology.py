"""
Maps Topology — read-only aggregation of existing collections.

Never mutates or duplicates data. Assembles graph nodes and edges from:
  * racks           — Data Centers (grouped by datacenter field) & racks
  * devices         — device inventory & rack→device parent
  * interconnections — device↔device physical links
  * customers       — customer sites & customer↔provider service links
  * partners        — provider nodes

Also exposes:
  * /geo    — enriches sites with lat/lng from a small Indonesian gazetteer
              so the Geographic Map has coordinates without adding any new
              persistent fields to existing documents.
  * /status — batch Zabbix live status per device (reuses the Zabbix
              integration; NOT a new monitoring stack).
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

logger = logging.getLogger("noc.topology")

# ---------------------------------------------------------------------------
# Simple gazetteer — city / location → (lat, lng). Used ONLY to place existing
# sites on the geographic map when no explicit coordinate is stored anywhere.
# Values are approximate city centroids; do not modify existing data.
# ---------------------------------------------------------------------------
GAZETTEER: Dict[str, tuple] = {
    "jakarta":            (-6.2000, 106.8167),
    "jakarta pusat":      (-6.1751, 106.8272),
    "jakarta selatan":    (-6.2615, 106.8106),
    "jakarta barat":      (-6.1683, 106.7588),
    "jakarta utara":      (-6.1214, 106.8867),
    "jakarta timur":      (-6.2251, 106.9004),
    "bandung":            (-6.9147, 107.6098),
    "surabaya":           (-7.2575, 112.7521),
    "medan":              (3.5952, 98.6722),
    "semarang":           (-6.9667, 110.4167),
    "yogyakarta":         (-7.7956, 110.3695),
    "denpasar":           (-8.6705, 115.2126),
    "makassar":           (-5.1477, 119.4327),
    "palembang":          (-2.9909, 104.7566),
    "batam":              (1.1301, 104.0530),
    "balikpapan":         (-1.2379, 116.8529),
    "manado":             (1.4931, 124.8413),
    "pekanbaru":          (0.5333, 101.4500),
    "bogor":              (-6.5950, 106.8167),
    "bekasi":             (-6.2383, 106.9756),
    "tangerang":          (-6.1783, 106.6319),
    "depok":              (-6.4025, 106.7942),
    "malang":             (-7.9666, 112.6326),
    "solo":               (-7.5666, 110.8167),
    "cikampek":           (-6.4155, 107.4568),
    "serpong":            (-6.3040, 106.6669),
    "kemang":             (-6.2620, 106.8138),
    "scbd":               (-6.2260, 106.8080),
    "puri indah":         (-6.1868, 106.7420),
    "cyber":              (-6.2226, 106.8408),   # DC Cyber Jakarta
    "duren tiga":         (-6.2481, 106.8298),
}


def _lookup_coords(location: Optional[str]) -> Optional[tuple]:
    """Return (lat, lng) for a location string, or None if not recognised."""
    if not location:
        return None
    s = location.lower()
    # Try longest keys first (so "jakarta pusat" wins over "jakarta")
    for key in sorted(GAZETTEER.keys(), key=len, reverse=True):
        if key in s:
            return GAZETTEER[key]
    return None


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[\s_-]+", "-", (s or "").strip().lower())


LINK_STATUS_COLOR = {
    "Active": "healthy",
    "Maintenance": "warning",
    "Planned": "unknown",
    "Retired": "down",
}


def build_topology_router(get_current_user, require_roles) -> APIRouter:
    r = APIRouter(prefix="/topology", tags=["topology"])

    # ---------------------------------------------------------------------
    # /graph — assemble logical topology
    # ---------------------------------------------------------------------
    @r.get("/graph")
    async def graph(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db

        racks = await db.racks.find({}, {"_id": 0}).to_list(2000)
        devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
        interconnects = await db.interconnections.find({}, {"_id": 0}).to_list(5000)
        customers = await db.customers.find({}, {"_id": 0}).to_list(5000)
        partners = await db.partners.find({}, {"_id": 0}).to_list(2000)

        # Lookups
        rack_by_id = {r["id"]: r for r in racks}
        device_by_id = {d["id"]: d for d in devices}
        device_by_norm_name = {_norm(d.get("name")): d for d in devices}
        partner_by_id = {p["id"]: p for p in partners}
        customer_by_id = {c["id"]: c for c in customers}

        nodes: List[Dict[str, Any]] = []
        edges: List[Dict[str, Any]] = []

        # ---------- DC (site) nodes -------------------------------------
        dc_names = sorted({(r.get("datacenter") or "Unknown").strip()
                           for r in racks if r.get("datacenter")})
        dc_id_by_name: Dict[str, str] = {}
        for name in dc_names:
            nid = f"site:dc:{name}"
            dc_id_by_name[name] = nid
            dc_racks = [x for x in racks if (x.get("datacenter") or "").strip() == name]
            dc_rack_ids = {x["id"] for x in dc_racks}
            dc_devices = [x for x in devices if x.get("rack_id") in dc_rack_ids]
            nodes.append({
                "id": nid, "type": "site", "kind": "datacenter",
                "label": name, "sub": f"{len(dc_racks)} rack · {len(dc_devices)} device",
                "location": name,
                "rack_count": len(dc_racks),
                "device_count": len(dc_devices),
            })

        # ---------- Customer site nodes ---------------------------------
        for c in customers:
            nid = f"site:customer:{c['id']}"
            nodes.append({
                "id": nid, "type": "site", "kind": "customer",
                "label": c.get("company_name") or c.get("sid") or "Customer",
                "sub": f"{c.get('category') or ''} · {c.get('sid') or ''}".strip(" ·"),
                "location": c.get("location") or c.get("address") or "",
                "customer_id": c["id"],
                "status": c.get("status") or "Active",
                "sid": c.get("sid"),
                "category": c.get("category"),
            })

        # ---------- Provider nodes (Partners) ---------------------------
        for p in partners:
            nid = f"provider:{p['id']}"
            nodes.append({
                "id": nid, "type": "provider",
                "label": p.get("name") or "Provider",
                "sub": p.get("category") or "",
                "provider_id": p["id"],
                "location": p.get("location") or "",
                "status": p.get("status") or "Active",
            })

        # ---------- Rack nodes (children of DC sites) -------------------
        for rk in racks:
            nid = f"rack:{rk['id']}"
            dc = (rk.get("datacenter") or "").strip()
            nodes.append({
                "id": nid, "type": "rack", "label": rk.get("name") or rk.get("number") or "Rack",
                "sub": f"{rk.get('room') or ''} · {rk.get('capacity_u') or 42}U".strip(" ·"),
                "rack_id": rk["id"],
                "parent": dc_id_by_name.get(dc),
                "status": rk.get("status") or "Active",
            })

        # ---------- Device nodes (children of racks) --------------------
        for d in devices:
            nid = f"device:{d['id']}"
            nodes.append({
                "id": nid, "type": "device",
                "label": d.get("name") or d.get("hostname") or "Device",
                "sub": f"{d.get('brand') or ''} {d.get('model') or ''}".strip(),
                "device_id": d["id"],
                "parent": f"rack:{d['rack_id']}" if d.get("rack_id") else None,
                "customer_id": d.get("customer_id"),
                "partner_id": d.get("partner_id"),
                "status": d.get("status") or "Active",
                "zabbix_host": d.get("zabbix_host") or d.get("hostname") or d.get("name"),
                "ip": d.get("ip_management"),
                "role": d.get("device_role") or "",
            })

        # ---------- Interconnection edges (device ↔ device) -------------
        def _resolve_device_ref(ref_id: Optional[str], ref_name: Optional[str]) -> Optional[str]:
            if ref_id and ref_id in device_by_id:
                return f"device:{ref_id}"
            n = _norm(ref_name)
            if n and n in device_by_norm_name:
                return f"device:{device_by_norm_name[n]['id']}"
            return None

        for ic in interconnects:
            a = _resolve_device_ref(ic.get("source_device_id"), ic.get("source_device"))
            b = _resolve_device_ref(ic.get("dest_device_id"), ic.get("dest_device"))
            # allow provider-side termination if dest is a partner rack
            if not b and ic.get("dest_partner_id"):
                b = f"provider:{ic['dest_partner_id']}"
            if not a or not b:
                continue
            status = ic.get("status") or "Active"
            health = LINK_STATUS_COLOR.get(status, "unknown")
            edges.append({
                "id": f"ic:{ic['id']}",
                "kind": "cable",
                "source": a, "target": b,
                "label": ic.get("cable_label") or ic.get("cable_id") or ic.get("connection_type") or "cable",
                "capacity": ic.get("cable_length") or "",
                "connection_type": ic.get("connection_type") or "",
                "cable_color": ic.get("cable_color") or "",
                "source_port": ic.get("source_port") or ic.get("source_interface") or "",
                "dest_port": ic.get("dest_port") or ic.get("dest_interface") or "",
                "status": status,
                "health": health,
            })

        # ---------- Customer ↔ Provider service edges -------------------
        for c in customers:
            partner_id = c.get("partner_id")
            if partner_id and partner_id in partner_by_id:
                edges.append({
                    "id": f"svc:{c['id']}:{partner_id}",
                    "kind": "service",
                    "source": f"provider:{partner_id}",
                    "target": f"site:customer:{c['id']}",
                    "label": c.get("category") or "service",
                    "capacity": c.get("bandwidth") or "",
                    "connection_type": c.get("category") or "",
                    "status": c.get("status") or "Active",
                    "health": LINK_STATUS_COLOR.get(c.get("status") or "Active", "unknown"),
                })
            # connected_services (multi-provider bundles) — optional
            for cs in (c.get("connected_services") or []):
                pid = cs.get("partner_id")
                if pid and pid in partner_by_id:
                    edges.append({
                        "id": f"svc:{c['id']}:{pid}:{cs.get('id') or cs.get('service_id') or ''}",
                        "kind": "service",
                        "source": f"provider:{pid}",
                        "target": f"site:customer:{c['id']}",
                        "label": cs.get("category") or c.get("category") or "service",
                        "capacity": cs.get("bandwidth") or "",
                        "connection_type": cs.get("category") or "",
                        "status": cs.get("status") or "Active",
                        "health": LINK_STATUS_COLOR.get(cs.get("status") or "Active", "unknown"),
                    })

        # ---------- Device→Customer implicit membership (dashed) --------
        for d in devices:
            if d.get("customer_id") and d["customer_id"] in customer_by_id:
                edges.append({
                    "id": f"member:{d['id']}",
                    "kind": "membership",
                    "source": f"device:{d['id']}",
                    "target": f"site:customer:{d['customer_id']}",
                    "label": "serves",
                    "status": d.get("status") or "Active",
                    "health": LINK_STATUS_COLOR.get(d.get("status") or "Active", "unknown"),
                })

        return {
            "generated_at": int(time.time() * 1000),
            "nodes": nodes,
            "edges": edges,
            "totals": {
                "datacenters": len(dc_names),
                "racks": len(racks),
                "devices": len(devices),
                "customers": len(customers),
                "providers": len(partners),
                "cables": sum(1 for e in edges if e["kind"] == "cable"),
                "services": sum(1 for e in edges if e["kind"] == "service"),
            },
        }

    # ---------------------------------------------------------------------
    # /geo — sites with lat/lng derived from the gazetteer
    # ---------------------------------------------------------------------
    @r.get("/geo")
    async def geo(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        racks = await db.racks.find({}, {"_id": 0}).to_list(2000)
        customers = await db.customers.find({}, {"_id": 0}).to_list(5000)
        partners = await db.partners.find({}, {"_id": 0}).to_list(2000)
        devices = await db.devices.find({}, {"_id": 0}).to_list(5000)

        sites: List[Dict[str, Any]] = []
        unresolved: List[Dict[str, Any]] = []

        # Data Center sites (grouped by rack.datacenter)
        dc_names = sorted({(r.get("datacenter") or "").strip()
                           for r in racks if r.get("datacenter")})
        for name in dc_names:
            coords = _lookup_coords(name)
            dc_racks = [x for x in racks if (x.get("datacenter") or "").strip() == name]
            dc_rack_ids = {x["id"] for x in dc_racks}
            dc_devices = [x for x in devices if x.get("rack_id") in dc_rack_ids]
            site = {
                "id": f"site:dc:{name}", "kind": "datacenter", "label": name,
                "location": name, "rack_count": len(dc_racks),
                "device_count": len(dc_devices),
                "racks": [{"id": x["id"], "name": x.get("name")} for x in dc_racks],
            }
            if coords:
                site["lat"], site["lng"] = coords
                sites.append(site)
            else:
                unresolved.append(site)

        # Customer sites
        for c in customers:
            loc = c.get("location") or c.get("address") or ""
            coords = _lookup_coords(loc)
            site = {
                "id": f"site:customer:{c['id']}", "kind": "customer",
                "label": c.get("company_name") or c.get("sid") or "Customer",
                "location": loc, "sid": c.get("sid"),
                "category": c.get("category") or "",
                "status": c.get("status") or "Active",
            }
            if coords:
                site["lat"], site["lng"] = coords
                sites.append(site)
            else:
                unresolved.append(site)

        # Provider sites
        for p in partners:
            loc = p.get("location") or ""
            coords = _lookup_coords(loc)
            site = {
                "id": f"provider:{p['id']}", "kind": "provider",
                "label": p.get("name") or "Provider",
                "location": loc, "category": p.get("category") or "",
                "status": p.get("status") or "Active",
            }
            if coords:
                site["lat"], site["lng"] = coords
                sites.append(site)
            else:
                unresolved.append(site)

        # Straight geographic links (customer ↔ provider) — only where BOTH resolved
        by_id = {s["id"]: s for s in sites}
        links: List[Dict[str, Any]] = []
        for c in customers:
            pid = c.get("partner_id")
            src = f"provider:{pid}" if pid else None
            dst = f"site:customer:{c['id']}"
            if src in by_id and dst in by_id:
                links.append({
                    "id": f"geo:{c['id']}:{pid}", "source": src, "target": dst,
                    "label": c.get("category") or "service",
                    "status": c.get("status") or "Active",
                    "health": LINK_STATUS_COLOR.get(c.get("status") or "Active", "unknown"),
                })

        return {
            "generated_at": int(time.time() * 1000),
            "sites": sites,
            "links": links,
            "unresolved": unresolved,
            "gazetteer_size": len(GAZETTEER),
        }

    # ---------------------------------------------------------------------
    # /status — batch live status for many devices via Zabbix
    # ---------------------------------------------------------------------
    @r.get("/status")
    async def status(
        request: Request,
        device_ids: str = Query("", description="Comma-separated device IDs"),
        user=Depends(get_current_user),
    ):
        """Return simple live status per device from Zabbix, if configured.

        Never fails hard — when Zabbix is not configured OR a host is missing,
        the entry just carries {configured:false} / {matched:false}. This lets
        the topology page keep rendering even if the monitoring backend is down.
        """
        db = request.app.state.db
        ids = [x.strip() for x in device_ids.split(",") if x.strip()]
        if not ids:
            return {"devices": {}, "generated_at": int(time.time() * 1000)}

        # Import here to avoid circular imports at module load
        try:
            from zabbix_integration import _load_config, _client_from_db  # type: ignore
        except Exception:
            return {"devices": {d: {"configured": False} for d in ids},
                    "generated_at": int(time.time() * 1000)}

        cfg = await _load_config(db)
        if not cfg or not cfg.get("token_enc"):
            return {"devices": {d: {"configured": False} for d in ids},
                    "generated_at": int(time.time() * 1000)}

        try:
            client = await _client_from_db(db)
        except HTTPException:
            return {"devices": {d: {"configured": False} for d in ids},
                    "generated_at": int(time.time() * 1000)}

        devices = await db.devices.find(
            {"id": {"$in": ids}}, {"_id": 0}
        ).to_list(len(ids))

        # Look up all hosts in one go
        hostnames = []
        host_by_devid: Dict[str, str] = {}
        for d in devices:
            hn = d.get("zabbix_host") or d.get("hostname") or d.get("name")
            if hn:
                host_by_devid[d["id"]] = hn
                hostnames.append(hn)
        if not hostnames:
            return {"devices": {d: {"configured": True, "matched": False} for d in ids},
                    "generated_at": int(time.time() * 1000)}
        try:
            hosts = await client.call("host.get", {
                "output": ["hostid", "host", "name", "status", "available"],
                "filter": {"host": hostnames, "name": hostnames},
                "searchByAny": True,
            })
        except Exception as e:
            logger.warning("topology status: host.get failed: %s", e)
            return {"devices": {d: {"configured": True, "error": str(e)[:200]} for d in ids},
                    "generated_at": int(time.time() * 1000)}

        # Zabbix host status: available 1=available 2=unavailable 0=unknown
        AVAIL_MAP = {"1": "healthy", "2": "down", "0": "unknown"}
        host_lookup: Dict[str, Dict[str, Any]] = {}
        for h in hosts:
            host_lookup[(h.get("host") or "").lower()] = h
            host_lookup[(h.get("name") or "").lower()] = h

        result: Dict[str, Any] = {}
        for did in ids:
            hn = host_by_devid.get(did)
            if not hn:
                result[did] = {"configured": True, "matched": False}
                continue
            h = host_lookup.get(hn.lower())
            if not h:
                result[did] = {"configured": True, "matched": False, "host": hn}
                continue
            result[did] = {
                "configured": True, "matched": True,
                "hostid": h.get("hostid"),
                "host": h.get("name") or h.get("host"),
                "available": h.get("available"),
                "health": AVAIL_MAP.get(str(h.get("available") or "0"), "unknown"),
                "enabled": h.get("status") == "0",
            }
        return {"devices": result, "generated_at": int(time.time() * 1000)}

    return r
