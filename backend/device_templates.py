"""
Device Template Engine
======================

Data-driven, DB-backed templates that describe the *physical* front-panel layout
of network devices (PNG image + percentage-based port coordinates).

A template is reusable across many devices of the same model. Adding a new
device model does NOT require code changes:
    1. Admin uploads a front-panel PNG.
    2. Admin uses the Template Mapping Mode UI to click and place each port
       (recorded as percentage coordinates so the overlay stays accurate at any
       display size).
    3. Admin assigns interface name, port type, and optional SNMP ifIndex hint.
    4. Save → template is ready to be used by any device pointing at
       ``device_template_id``.

Storage:
    * template metadata + ports  → MongoDB (``device_templates`` collection)
    * PNG binary                 → filesystem, ``/app/backend/uploads/device_templates/<template_id>.png``
    * static served at           → ``/api/device-templates/<id>/image``

The visualization template is an *enhancement only* — SNMP monitoring, port
status, and Zabbix graphs continue to work normally even for devices that have
no template attached (the frontend falls back to a generic placeholder panel).
"""
from __future__ import annotations

import os
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Literal, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict

logger = logging.getLogger("noc.device_templates")

UPLOAD_DIR = Path(__file__).parent / "uploads" / "device_templates"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# -----------------------------------------------------------------------------
# Pydantic models
# -----------------------------------------------------------------------------
PortType = Literal[
    "RJ45", "SFP", "SFP+", "SFP28", "QSFP", "QSFP+", "QSFP28", "QSFP-DD",
    "10GE", "25GE", "40GE", "100GE", "400GE", "CONSOLE", "MGMT", "USB",
    "POWER", "STACK", "OTHER",
]


class PortMapping(BaseModel):
    """One port on the front panel — coordinates are percentage of image size."""

    model_config = ConfigDict(extra="allow")

    id: str                          # stable interface identifier (e.g. "ether1", "sfp-sfpplus1")
    label: str = ""                  # short label shown on hover (e.g. "1")
    type: PortType = "RJ45"
    number: Optional[int] = None
    x: float = Field(..., ge=0.0, le=100.0)
    y: float = Field(..., ge=0.0, le=100.0)
    width: float = Field(..., gt=0.0, le=100.0)
    height: float = Field(..., gt=0.0, le=100.0)
    if_index: Optional[int] = None            # SNMP ifIndex hint
    if_name_hint: Optional[str] = None        # alternative name for SNMP matching
    description: Optional[str] = None


class DeviceTemplateIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    vendor: str
    model: str
    description: str = ""
    height_u: int = 1
    image_filename: Optional[str] = None       # filled after PNG upload
    ports: List[PortMapping] = Field(default_factory=list)
    # regex / substring patterns used by auto-match resolver (matches device.brand + model)
    match_patterns: List[str] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# Default seed templates (percentage-based, tuned to the 5 uploaded PNGs)
# -----------------------------------------------------------------------------
def _range(a: int, b: int):
    return list(range(a, b + 1))


def _seed_crs354() -> Dict[str, Any]:
    """MikroTik CRS354-48G-4S+2Q+ — 48 RJ45 in 2 rows + 4 SFP+ + 2 QSFP+ + console."""
    ports: List[Dict[str, Any]] = []
    # 48 RJ45 in 2 rows of 24, grouped by 6 with small gap between groups
    # Panel body approximately spans x=4.5% to x=72.5% (ports section only)
    # Row Y positions: top row centred ~34%, bottom row centred ~66%
    row_y = {"top": 30.0, "bottom": 62.0}
    port_w = 1.10
    port_h = 22.0
    # Each group of 6 spans ~8.8%, gap ~0.6%
    group_start_x = [4.7, 13.9, 23.1, 32.3, 41.5, 50.7, 59.9]  # not used directly — use derived layout
    # Simpler: distribute 24 ports across x=4.9%..70.9% for each row, with 4 groups
    def rj_layout(idx: int, row: str):
        # idx 0..23 in row → position
        group = idx // 6
        in_group = idx % 6
        gx_start = 4.9 + group * 9.05  # per-group start
        x = gx_start + in_group * 1.30
        return x
    for i in range(24):
        # Top row labels 2, 4, ..., 48 (even) — MikroTik convention
        top_num = (i + 1) * 2
        ports.append({
            "id": f"ether{top_num}", "label": str(top_num), "type": "RJ45",
            "number": top_num, "if_index": top_num,
            "x": rj_layout(i, "top"), "y": row_y["top"], "width": port_w, "height": port_h,
            "if_name_hint": f"ether{top_num}",
        })
        # Bottom row labels 1, 3, ..., 47 (odd)
        bot_num = (i * 2) + 1
        ports.append({
            "id": f"ether{bot_num}", "label": str(bot_num), "type": "RJ45",
            "number": bot_num, "if_index": bot_num,
            "x": rj_layout(i, "bottom"), "y": row_y["bottom"], "width": port_w, "height": port_h,
            "if_name_hint": f"ether{bot_num}",
        })
    # 4 SFP+ ports (2 top, 2 bottom) at x≈72..82
    sfp_w = 2.2
    sfp_h = 26.0
    for idx in range(2):
        # top row = SFP+1, SFP+2 → labels 2, 4? actually MikroTik: top=2,4 bottom=1,3
        top_lbl = (idx + 1) * 2
        bot_lbl = idx * 2 + 1
        sx = 73.5 + idx * 3.6
        ports.append({
            "id": f"sfp-sfpplus{top_lbl}", "label": str(top_lbl), "type": "SFP+",
            "number": top_lbl, "if_index": 48 + top_lbl,
            "x": sx, "y": 24.0, "width": sfp_w, "height": sfp_h,
            "if_name_hint": f"sfp-sfpplus{top_lbl}",
        })
        ports.append({
            "id": f"sfp-sfpplus{bot_lbl}", "label": str(bot_lbl), "type": "SFP+",
            "number": bot_lbl, "if_index": 48 + bot_lbl,
            "x": sx, "y": 58.0, "width": sfp_w, "height": sfp_h,
            "if_name_hint": f"sfp-sfpplus{bot_lbl}",
        })
    # 2 QSFP+ ports (labels 1, 2), stacked
    ports.append({
        "id": "qsfpplus1", "label": "1", "type": "QSFP+",
        "number": 1, "if_index": 53,
        "x": 84.5, "y": 24.0, "width": 4.5, "height": 26.0,
        "if_name_hint": "qsfpplus1",
    })
    ports.append({
        "id": "qsfpplus2", "label": "2", "type": "QSFP+",
        "number": 2, "if_index": 54,
        "x": 84.5, "y": 58.0, "width": 4.5, "height": 26.0,
        "if_name_hint": "qsfpplus2",
    })
    # Console + MGMT on the right
    ports.append({
        "id": "console", "label": "CON", "type": "CONSOLE",
        "x": 95.5, "y": 30.0, "width": 2.6, "height": 40.0,
        "if_name_hint": "console",
    })
    ports.append({
        "id": "mgmt", "label": "MGMT", "type": "MGMT",
        "if_index": 49, "if_name_hint": "ether-mgmt",
        "x": 91.5, "y": 30.0, "width": 2.8, "height": 40.0,
    })
    return {
        "vendor": "MikroTik",
        "model": "CRS354-48G-4S+2Q+",
        "description": "48x Gigabit RJ45 + 4x SFP+ 10G + 2x QSFP+ 40G",
        "height_u": 1,
        "image_filename": "crs354-48g-4s-2q.png",
        "ports": ports,
        "match_patterns": ["CRS354", "CRS-354", "CRS354-48G"],
    }


def _seed_crs326() -> Dict[str, Any]:
    """MikroTik CRS326-24S+2Q+RM — 24 SFP+ (2 rows) + 2 QSFP+ + console/mgmt."""
    ports: List[Dict[str, Any]] = []
    # 24 SFP+ in 2 rows of 12, grouped by 4 (Rows visible: top=even, bottom=odd)
    row_y = {"top": 20.0, "bottom": 58.0}
    sfp_w = 3.7
    sfp_h = 27.0
    def layout(i: int):
        # 12 slots per row, 4 groups of 4? Actually looks like 3 groups of 4 with slightly wider gap
        group = i // 4
        in_group = i % 4
        gx_start = 3.5 + group * 17.8
        return gx_start + in_group * 4.2
    for i in range(12):
        top_num = (i + 1) * 2  # 2,4,...24
        bot_num = i * 2 + 1    # 1,3,...23
        ports.append({
            "id": f"sfp-sfpplus{top_num}", "label": str(top_num), "type": "SFP+",
            "number": top_num, "if_index": top_num,
            "x": layout(i), "y": row_y["top"], "width": sfp_w, "height": sfp_h,
            "if_name_hint": f"sfp-sfpplus{top_num}",
        })
        ports.append({
            "id": f"sfp-sfpplus{bot_num}", "label": str(bot_num), "type": "SFP+",
            "number": bot_num, "if_index": bot_num,
            "x": layout(i), "y": row_y["bottom"], "width": sfp_w, "height": sfp_h,
            "if_name_hint": f"sfp-sfpplus{bot_num}",
        })
    # 2 QSFP+ ports at the middle-right (~57..64%)
    ports.append({
        "id": "qsfpplus1", "label": "1", "type": "QSFP+",
        "number": 1, "if_index": 25,
        "x": 58.5, "y": 20.0, "width": 5.5, "height": 27.0,
        "if_name_hint": "qsfpplus1",
    })
    ports.append({
        "id": "qsfpplus2", "label": "2", "type": "QSFP+",
        "number": 2, "if_index": 26,
        "x": 58.5, "y": 58.0, "width": 5.5, "height": 27.0,
        "if_name_hint": "qsfpplus2",
    })
    ports.append({
        "id": "console", "label": "CON", "type": "CONSOLE",
        "x": 68.5, "y": 30.0, "width": 3.0, "height": 30.0,
    })
    ports.append({
        "id": "mgmt", "label": "MGMT", "type": "MGMT",
        "if_index": 27, "if_name_hint": "ether1",
        "x": 72.7, "y": 30.0, "width": 3.0, "height": 30.0,
    })
    return {
        "vendor": "MikroTik",
        "model": "CRS326-24S+2Q+RM",
        "description": "24x SFP+ 10G + 2x QSFP+ 40G Cloud Router Switch",
        "height_u": 1,
        "image_filename": "crs326-24s-2q.png",
        "ports": ports,
        "match_patterns": ["CRS326-24S", "CRS326"],
    }


def _seed_ccr2004() -> Dict[str, Any]:
    """MikroTik CCR2004-1G-12S+2XS — 12x SFP+ + 2x SFP28 25G + console/mgmt."""
    ports: List[Dict[str, Any]] = []
    # 12 SFP+ 10G ports in single row
    sfp_y = 46.0
    sfp_h = 30.0
    sfp_w = 4.3
    # Spans x ≈ 22..77
    for i in range(12):
        idx = i + 1
        x = 21.5 + i * 4.7
        ports.append({
            "id": f"sfp-sfpplus{idx}", "label": str(idx), "type": "SFP+",
            "number": idx, "if_index": idx + 2,   # +2 because sfp28 typically ifIndex 1,2
            "x": x, "y": sfp_y, "width": sfp_w, "height": sfp_h,
            "if_name_hint": f"sfp-sfpplus{idx}",
        })
    # 2 SFP28 25G ports on the far left
    for i in range(2):
        ports.append({
            "id": f"sfp28-{i+1}", "label": str(i + 1), "type": "SFP28",
            "number": i + 1, "if_index": i + 1,
            "x": 4.5 + i * 5.0, "y": 40.0, "width": 4.5, "height": 35.0,
            "if_name_hint": f"sfp28-{i+1}",
        })
    # Console + MGMT on right
    ports.append({
        "id": "console", "label": "CON", "type": "CONSOLE",
        "x": 79.5, "y": 20.0, "width": 3.0, "height": 30.0,
    })
    ports.append({
        "id": "ether1", "label": "MGMT", "type": "MGMT",
        "if_index": 15, "if_name_hint": "ether1",
        "x": 79.5, "y": 55.0, "width": 3.0, "height": 25.0,
    })
    return {
        "vendor": "MikroTik",
        "model": "CCR2004-1G-12S+2XS",
        "description": "12x SFP+ 10G + 2x SFP28 25G Cloud Core Router",
        "height_u": 1,
        "image_filename": "ccr2004-1g-12s-2xs.png",
        "ports": ports,
        "match_patterns": ["CCR2004", "CCR-2004"],
    }


def _seed_ccr1036() -> Dict[str, Any]:
    """MikroTik CCR1036-8G-2S+ — 8x RJ45 GE + 2x SFP+ + console/mgmt."""
    ports: List[Dict[str, Any]] = []
    # 2 SFP+ on the left
    for i in range(2):
        idx = i + 1
        ports.append({
            "id": f"sfp-sfpplus{idx}", "label": str(idx), "type": "SFP+",
            "number": idx, "if_index": idx,
            "x": 7.5 + i * 5.5, "y": 38.0, "width": 4.7, "height": 34.0,
            "if_name_hint": f"sfp-sfpplus{idx}",
        })
    # 8 RJ45 GE ports centre-right
    for i in range(8):
        idx = i + 1
        x = 39.0 + i * 4.1
        ports.append({
            "id": f"ether{idx}", "label": f"ETH {idx}", "type": "RJ45",
            "number": idx, "if_index": 2 + idx,
            "x": x, "y": 42.0, "width": 3.4, "height": 32.0,
            "if_name_hint": f"ether{idx}",
        })
    ports.append({
        "id": "console", "label": "CON", "type": "CONSOLE",
        "x": 75.5, "y": 42.0, "width": 3.0, "height": 30.0,
    })
    return {
        "vendor": "MikroTik",
        "model": "CCR1036-8G-2S+",
        "description": "8x Gigabit RJ45 + 2x SFP+ 10G Cloud Core Router",
        "height_u": 1,
        "image_filename": "ccr1036-8g-2s.png",
        "ports": ports,
        "match_patterns": ["CCR1036", "CCR-1036"],
    }


def _seed_ce6870() -> Dict[str, Any]:
    """Huawei CE6870-24S6CQ-EI — 24x SFP+ 10G + 6x QSFP28 100G in blocks."""
    ports: List[Dict[str, Any]] = []
    # 24 SFP+ in 2 rows of 12 (rows visible), each row split into 2 groups of 6
    # Top row labels: 1,3,5,7,9,11 and 13,15,17,19,21,23
    # Bottom row labels: 2,4,6,8,10,12 and 14,16,18,20,22,24
    def sfp_layout(i: int, block: int):
        # block 0 = ports 1-12, block 1 = ports 13-24
        # in block: i is 0..5
        base_x = 3.5 if block == 0 else 41.0
        return base_x + i * 3.05
    for block in range(2):
        for i in range(6):
            top = block * 12 + i * 2 + 1        # 1,3,5,7,9,11 or 13,15,...23
            bot = block * 12 + (i + 1) * 2      # 2,4,6,8,10,12 or 14,...24
            ports.append({
                "id": f"10GE1/0/{top}", "label": str(top), "type": "SFP+",
                "number": top, "if_index": top,
                "x": sfp_layout(i, block), "y": 22.0, "width": 2.8, "height": 25.0,
                "if_name_hint": f"10GE1/0/{top}",
            })
            ports.append({
                "id": f"10GE1/0/{bot}", "label": str(bot), "type": "SFP+",
                "number": bot, "if_index": bot,
                "x": sfp_layout(i, block), "y": 55.0, "width": 2.8, "height": 25.0,
                "if_name_hint": f"10GE1/0/{bot}",
            })
    # 6 QSFP28 100G ports (labels 1..6, arranged as 3 pairs of top/bottom based on panel)
    # Panel shows 3 stacks with 2 cages each — cages numbered 1,2 (top), 3,4 (mid), 5,6 (bot) alternating
    for i in range(6):
        # Arrange in 3 columns (visually) × 2 rows (top/bottom)
        col = i // 2                # 0,0,1,1,2,2
        row = i % 2                 # 0,1,0,1,0,1
        x = 78.5 + col * 5.5
        y = 25.0 if row == 0 else 55.0
        ports.append({
            "id": f"100GE1/0/{i + 1}", "label": str(i + 1), "type": "QSFP28",
            "number": i + 1, "if_index": 24 + i + 1,
            "x": x, "y": y, "width": 4.8, "height": 25.0,
            "if_name_hint": f"100GE1/0/{i + 1}",
        })
    return {
        "vendor": "Huawei",
        "model": "CE6870-24S6CQ-EI",
        "description": "24x SFP+ 10GE + 6x QSFP28 100GE — CloudEngine",
        "height_u": 1,
        "image_filename": "huawei-ce6870-24s6cq.png",
        "ports": ports,
        "match_patterns": ["CE6870", "CE-6870"],
    }


def default_seeds() -> List[Dict[str, Any]]:
    return [
        _seed_crs354(),
        _seed_crs326(),
        _seed_ccr2004(),
        _seed_ccr1036(),
        _seed_ce6870(),
    ]


# -----------------------------------------------------------------------------
# Seed on startup (idempotent — only insert missing)
# -----------------------------------------------------------------------------
async def seed_default_templates(db) -> int:
    """Insert default templates only when the collection has no matching model."""
    inserted = 0
    for seed in default_seeds():
        existing = await db.device_templates.find_one({
            "vendor": seed["vendor"],
            "model": seed["model"],
        })
        if existing:
            continue
        payload = {
            "id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "is_default": True,
            **seed,
        }
        await db.device_templates.insert_one(payload)
        inserted += 1
    if inserted:
        logger.info("Seeded %d default device templates", inserted)
    # Ensure index
    await db.device_templates.create_index([("vendor", 1), ("model", 1)])
    return inserted


# -----------------------------------------------------------------------------
# Resolver — match a device to a template using vendor/model or match_patterns
# -----------------------------------------------------------------------------
def _norm(s: Any) -> str:
    return "".join(ch for ch in str(s or "").upper() if ch.isalnum())


async def resolve_template_for_device(db, device: dict) -> Optional[dict]:
    """Find the best-fitting template for a device (or None)."""
    tid = device.get("device_template_id")
    if tid:
        tpl = await db.device_templates.find_one({"id": tid}, {"_id": 0})
        if tpl:
            return tpl
    brand_model = _norm(f"{device.get('brand', '')}{device.get('model', '')}")
    if not brand_model:
        return None
    cursor = db.device_templates.find({}, {"_id": 0})
    async for tpl in cursor:
        for pat in tpl.get("match_patterns") or []:
            if _norm(pat) and _norm(pat) in brand_model:
                return tpl
        # fallback exact vendor+model match
        if _norm(tpl.get("vendor")) + _norm(tpl.get("model")) in brand_model:
            return tpl
    return None


# -----------------------------------------------------------------------------
# Router builder
# -----------------------------------------------------------------------------
def build_device_templates_router(get_current_user, require_roles) -> APIRouter:
    r = APIRouter(prefix="/device-templates", tags=["device-templates"])

    @r.get("")
    async def list_templates(request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        cursor = db.device_templates.find({}, {"_id": 0}).sort("vendor", 1)
        items = [t async for t in cursor]
        return {"items": items, "total": len(items)}

    @r.get("/{tid}")
    async def get_template(tid: str, request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        t = await db.device_templates.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(404, "Template not found")
        return t

    @r.get("/{tid}/image")
    async def get_image(tid: str, request: Request):
        # image is public within the portal (no user dep) so <img src> works
        db = request.app.state.db
        t = await db.device_templates.find_one({"id": tid}, {"image_filename": 1})
        if not t or not t.get("image_filename"):
            raise HTTPException(404, "Image not found")
        path = UPLOAD_DIR / t["image_filename"]
        if not path.exists():
            raise HTTPException(404, "Image file missing on server")
        return FileResponse(path, media_type="image/png")

    @r.post("")
    async def create_template(body: DeviceTemplateIn, request: Request,
                              user=Depends(require_roles("admin"))):
        db = request.app.state.db
        tid = str(uuid.uuid4())
        payload = {
            "id": tid,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "is_default": False,
            **body.model_dump(),
        }
        await db.device_templates.insert_one(payload)
        payload.pop("_id", None)
        return payload

    @r.put("/{tid}")
    async def update_template(tid: str, body: DeviceTemplateIn, request: Request,
                              user=Depends(require_roles("admin"))):
        db = request.app.state.db
        existing = await db.device_templates.find_one({"id": tid})
        if not existing:
            raise HTTPException(404, "Template not found")
        update = body.model_dump()
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.device_templates.update_one({"id": tid}, {"$set": update})
        doc = await db.device_templates.find_one({"id": tid}, {"_id": 0})
        return doc

    @r.delete("/{tid}")
    async def delete_template(tid: str, request: Request,
                              user=Depends(require_roles("admin"))):
        db = request.app.state.db
        existing = await db.device_templates.find_one({"id": tid})
        if not existing:
            raise HTTPException(404, "Template not found")
        # remove file
        if existing.get("image_filename"):
            fp = UPLOAD_DIR / existing["image_filename"]
            try:
                if fp.exists():
                    fp.unlink()
            except OSError:
                logger.exception("Failed to remove PNG %s", fp)
        await db.device_templates.delete_one({"id": tid})
        return {"ok": True}

    @r.post("/{tid}/image")
    async def upload_image(tid: str, request: Request, file: UploadFile = File(...),
                           user=Depends(require_roles("admin"))):
        db = request.app.state.db
        t = await db.device_templates.find_one({"id": tid})
        if not t:
            raise HTTPException(404, "Template not found")
        if file.content_type not in {"image/png", "image/x-png"}:
            raise HTTPException(400, "Only PNG is allowed")
        filename = f"{tid}.png"
        target = UPLOAD_DIR / filename
        content = await file.read()
        if len(content) > 8 * 1024 * 1024:  # 8 MB safety cap
            raise HTTPException(400, "Image too large (max 8MB)")
        target.write_bytes(content)
        await db.device_templates.update_one(
            {"id": tid},
            {"$set": {"image_filename": filename,
                      "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return {"ok": True, "image_filename": filename, "bytes": len(content)}

    @r.get("/resolve/{device_id}")
    async def resolve(device_id: str, request: Request, user=Depends(get_current_user)):
        db = request.app.state.db
        dev = await db.devices.find_one({"id": device_id}, {"_id": 0})
        if not dev:
            raise HTTPException(404, "Device not found")
        tpl = await resolve_template_for_device(db, dev)
        return {"device_id": device_id, "template": tpl}

    return r
