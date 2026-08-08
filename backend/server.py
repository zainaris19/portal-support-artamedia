from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import uuid
import re
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict


# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-change-me')
JWT_ALG = 'HS256'
ACCESS_TTL_HOURS = 24

ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@noc.local')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Admin@123')

Role = Literal['admin', 'supervisor', 'engineer', 'viewer', 'admin_router', 'operational', 'teknisi']

# -----------------------------------------------------------------------------
# App
# -----------------------------------------------------------------------------
app = FastAPI(title="NOC Support System API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("noc")


# -----------------------------------------------------------------------------
# Utils
# -----------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id() -> str:
    return str(uuid.uuid4())

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TTL_HOURS),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_roles(*roles: str):
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dep


# admin/supervisor can do full CRUD; engineer can create/edit; viewer read only
ROLE_CAN_WRITE = {"admin", "supervisor", "engineer"}
ROLE_CAN_DELETE = {"admin", "supervisor"}


def can_write(user: dict):
    if user["role"] not in ROLE_CAN_WRITE:
        raise HTTPException(status_code=403, detail="You do not have write permission")

def can_delete(user: dict):
    if user["role"] not in ROLE_CAN_DELETE:
        raise HTTPException(status_code=403, detail="You do not have delete permission")


# -----------------------------------------------------------------------------
# Pydantic Models
# -----------------------------------------------------------------------------
class LoginIn(BaseModel):
    email: str
    password: str

class LoginOut(BaseModel):
    token: str
    user: dict

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: Role = 'viewer'

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Role] = None
    password: Optional[str] = None
    active: Optional[bool] = None

CustomerCategory = Literal['Broadband', 'Dedicated Internet', 'Cross Connect', 'Dark Fiber', 'Metro Ethernet']
ServiceStatus = Literal['Active', 'Suspended', 'Terminated', 'Pending']

class CustomerIn(BaseModel):
    # Accept category-specific extra fields; different UIs send different fields
    model_config = ConfigDict(extra="allow")
    sid: str
    company_name: str
    category: CustomerCategory
    status: ServiceStatus = 'Active'
    activation_date: Optional[str] = None
    pic_name: str = ""
    phone: str = ""
    email: str = ""
    notes: str = ""
    partner_id: Optional[str] = None
    # connected services for enterprise customers (multi-provider bundles)
    connected_services: List[dict] = []
    # legacy/common (kept optional so existing seed still validates)
    service_name: str = ""
    location: str = ""
    address: str = ""
    bandwidth: str = ""
    ip_address: str = ""
    vlan: str = ""
    provider: str = ""

DocumentCategory = Literal['BA', 'SLA', 'Kontrak', 'PO', 'SO', 'Teknis', 'Topologi', 'Lainnya']
DocumentScope = Literal['customer', 'provider']

class DocumentIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    title: str
    category: DocumentCategory
    scope: DocumentScope = 'customer'
    doc_number: str = ""
    doc_date: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    customer_id: Optional[str] = None
    partner_id: Optional[str] = None
    status: str = "Active"
    description: str = ""
    file_name: Optional[str] = None
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    file_base64: Optional[str] = None  # data URL or raw base64


# --- KMZ Mapping (Data Mapping repository) ---
class KMZFileIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    size: int = 0
    type: Optional[str] = None
    base64: str  # data URL or raw base64
    notes: str = ""


class KMZMappingIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    description: str = ""
    region: str = ""
    version: str = ""
    notes: str = ""
    upload_date: Optional[str] = None
    files: List[dict] = []  # each: {id, name, size, type, base64, uploaded_at, uploaded_by, notes}


LogStatus = Literal['Open', 'Monitoring', 'Pending', 'Resolved']
LogPriority = Literal['Low', 'Medium', 'High', 'Critical']

# ShiftHandoverIn (legacy single-record schema) removed — replaced by shift_handover module.
# Legacy `shift_handovers` documents are migrated to new schema on startup.

class IncidentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    customer_id: Optional[str] = None
    site: str = ""
    started_at: str
    resolved_at: Optional[str] = None
    description: str = ""
    root_cause: str = ""
    action_taken: str = ""
    status: LogStatus = 'Open'
    priority: LogPriority = 'Medium'

class MaintenanceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    customer_id: Optional[str] = None
    site: str = ""
    scheduled_start: str
    scheduled_end: Optional[str] = None
    type: Literal['Planned', 'Emergency'] = 'Planned'
    description: str = ""
    status: LogStatus = 'Open'
    priority: LogPriority = 'Medium'


class PartnerIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str
    category: Optional[CustomerCategory] = None  # Broadband / Dedicated Internet / Metro Ethernet / Dark Fiber / Cross Connect
    cid: str = ""                                  # CID / Circuit ID from provider
    service_type: str = ""
    service_name: str = ""
    capacity: str = ""
    location: str = ""
    provider_sid: str = ""                         # legacy
    install_address: str = ""
    atas_nama: str = ""
    pic_name: str = ""
    phone: str = ""
    helpdesk: str = ""
    email_support: str = ""
    ticket_noc: str = ""
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    contract_period: str = ""
    status: ServiceStatus = 'Active'
    notes: str = ""


class RackIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    datacenter: str
    room: str = ""
    name: str
    number: str = ""
    capacity_u: int = 42
    position: str = ""
    photo_base64: Optional[str] = None
    status: Literal['Active', 'Maintenance', 'Retired'] = 'Active'
    notes: str = ""


class DeviceIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    rack_id: str
    name: str
    hostname: str = ""
    brand: str = ""
    model: str = ""
    serial_number: str = ""
    position_u: int = 1           # starting U (1 = bottom)
    height_u: int = 1
    ip_management: str = ""
    power_ports: str = ""
    power_source_a: str = ""
    power_source_b: str = ""
    status: Literal['Active', 'Maintenance', 'Offline', 'Retired'] = 'Active'
    install_date: Optional[str] = None
    photo_front_base64: Optional[str] = None
    photo_back_base64: Optional[str] = None
    customer_id: Optional[str] = None
    partner_id: Optional[str] = None
    service: str = ""
    notes: str = ""
    # --- Monitoring & visualization (added by Device Template Engine + Zabbix)
    device_template_id: Optional[str] = None      # link to device_templates.id
    monitoring_source: Literal['snmp', 'zabbix', 'both', 'none'] = 'snmp'
    snmp_version: Literal['v1', 'v2c', 'v3', ''] = ''
    snmp_port: Optional[int] = None
    zabbix_host: str = ""                          # Zabbix host.name to correlate
    device_role: str = ""                          # e.g. "Core", "Aggregation", "Access"
    ru_position: Optional[int] = None              # aliases position_u for clarity


class InterconnectionIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    # --- Source endpoint --------------------------------------------------
    source_type: Literal['device', 'patch_panel', 'odf', 'cross_connect', 'partner_rack'] = 'device'
    source_rack_id: Optional[str] = None
    source_device: str = ""
    source_device_id: Optional[str] = None      # link to devices.id when known
    source_port: str = ""
    source_interface: str = ""                  # richer identifier (alias of port)
    # --- Destination endpoint --------------------------------------------
    dest_type: Literal['device', 'patch_panel', 'odf', 'cross_connect', 'partner_rack'] = 'device'
    # Destination side is free-text (manual entry) — not linked to master rack DB.
    dest_rack: str = ""
    dest_rack_id: Optional[str] = None          # backward compatibility
    dest_device: str = ""
    dest_device_id: Optional[str] = None        # link to devices.id when internal
    dest_port: str = ""
    dest_interface: str = ""
    dest_partner_id: Optional[str] = None       # link to partners.id (Partner Rack / provider)
    # --- Cable metadata ---------------------------------------------------
    connection_type: str = ""                   # e.g. Copper / Fiber-SM / Fiber-MM / DAC
    cable_id: str = ""                          # legacy identifier
    cable_label: str = ""                       # human-friendly label ("A12-01")
    cable_color: str = ""                       # yellow / orange / blue / red / gray / black / green / white
    cable_length: str = ""                      # "3m", "150 cm" etc.
    install_date: Optional[str] = None          # ISO date "YYYY-MM-DD"
    status: Literal['Active', 'Maintenance', 'Retired', 'Planned'] = 'Active'
    description: str = ""


TicketPriority = Literal['Low', 'Medium', 'High', 'Critical']


# -----------------------------------------------------------------------------
# Helper: strip mongo _id, generic list w/ query
# -----------------------------------------------------------------------------
def clean(doc):
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc


# -----------------------------------------------------------------------------
# Auth Endpoints
# -----------------------------------------------------------------------------
@api.post("/auth/login", response_model=LoginOut)
async def login(body: LoginIn):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Account is disabled")
    token = create_token(user["id"], user["email"], user["role"])
    safe = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    return {"token": token, "user": safe}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


class AvatarIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    avatar_base64: Optional[str] = None  # data URL. Pass None/empty to remove.


@api.post("/auth/me/avatar")
async def update_avatar(body: AvatarIn, user: dict = Depends(get_current_user)):
    avatar = (body.avatar_base64 or "").strip() or None
    if avatar and len(avatar) > 2_500_000:  # ~1.8MB decoded, hard cap on payload
        raise HTTPException(status_code=413, detail="Avatar terlalu besar. Maksimum ~1.5MB")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"avatar_base64": avatar, "updated_at": now_iso()}},
    )
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return fresh


@api.get("/health")
async def health():
    """Public unauthenticated health check for the login system status widget."""
    db_ok = False
    try:
        await db.command("ping")
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "api": True,
        "database": db_ok,
        "storage": db_ok,  # base64-in-mongo, so tied to database
        "version": "1.3.0",
        "app": "Portal Support Artamedia",
    }


@api.post("/auth/logout")
async def logout(user: dict = Depends(get_current_user)):
    return {"ok": True}


# -----------------------------------------------------------------------------
# Users (admin only)
# -----------------------------------------------------------------------------
@api.get("/users")
async def list_users(user: dict = Depends(require_roles('admin'))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return docs

@api.post("/users")
async def create_user(body: UserCreate, user: dict = Depends(require_roles('admin'))):
    email = body.email.lower().strip()
    exists = await db.users.find_one({"email": email})
    if exists:
        raise HTTPException(status_code=400, detail="Email already exists")
    doc = {
        "id": new_id(),
        "email": email,
        "name": body.name,
        "role": body.role,
        "password_hash": hash_password(body.password),
        "active": True,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    doc.pop("password_hash", None)
    return clean(doc)

@api.patch("/users/{uid}")
async def update_user(uid: str, body: UserUpdate, user: dict = Depends(require_roles('admin'))):
    upd = {}
    if body.name is not None: upd["name"] = body.name
    if body.role is not None: upd["role"] = body.role
    if body.active is not None: upd["active"] = body.active
    if body.password: upd["password_hash"] = hash_password(body.password)
    if not upd:
        raise HTTPException(status_code=400, detail="No fields to update")
    r = await db.users.update_one({"id": uid}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    doc = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return doc

@api.delete("/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_roles('admin'))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    r = await db.users.delete_one({"id": uid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


# -----------------------------------------------------------------------------
# Generic Collection CRUD builder
# -----------------------------------------------------------------------------
def build_crud(path: str, collection: str, model_cls, search_fields: List[str]):
    @api.get(f"/{path}")
    async def _list(
        q: Optional[str] = None,
        category: Optional[str] = None,
        scope: Optional[str] = None,
        status_: Optional[str] = Query(None, alias="status"),
        customer_id: Optional[str] = None,
        partner_id: Optional[str] = None,
        rack_id: Optional[str] = None,
        source_rack_id: Optional[str] = None,
        dest_rack_id: Optional[str] = None,
        sort_by: str = "created_at",
        sort_dir: Literal["asc", "desc"] = "desc",
        page: int = 1,
        page_size: int = 20,
        user: dict = Depends(get_current_user),
    ):
        query = {}
        if category:
            query["category"] = category
        if scope:
            query["scope"] = scope
        if status_:
            query["status"] = status_
        if customer_id:
            query["customer_id"] = customer_id
        if partner_id:
            query["partner_id"] = partner_id
        if rack_id:
            query["rack_id"] = rack_id
        if source_rack_id:
            query["source_rack_id"] = source_rack_id
        if dest_rack_id:
            query["dest_rack_id"] = dest_rack_id
        if q:
            regex = {"$regex": re.escape(q), "$options": "i"}
            query["$or"] = [{f: regex} for f in search_fields]
        total = await db[collection].count_documents(query)
        skip = max(0, (page - 1) * page_size)
        cursor = (
            db[collection]
            .find(query, {"_id": 0})
            .sort(sort_by, 1 if sort_dir == "asc" else -1)
            .skip(skip)
            .limit(page_size)
        )
        items = await cursor.to_list(page_size)
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    @api.get(f"/{path}/{{item_id}}")
    async def _get(item_id: str, user: dict = Depends(get_current_user)):
        doc = await db[collection].find_one({"id": item_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Not found")
        return doc

    @api.post(f"/{path}")
    async def _create(body: model_cls, user: dict = Depends(get_current_user)):
        can_write(user)
        doc = body.model_dump()
        doc["id"] = new_id()
        doc["created_at"] = now_iso()
        doc["updated_at"] = now_iso()
        doc["created_by"] = user["email"]
        await db[collection].insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.put(f"/{path}/{{item_id}}")
    async def _update(item_id: str, body: model_cls, user: dict = Depends(get_current_user)):
        can_write(user)
        doc = body.model_dump()
        doc["updated_at"] = now_iso()
        doc["updated_by"] = user["email"]
        r = await db[collection].update_one({"id": item_id}, {"$set": doc})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        out = await db[collection].find_one({"id": item_id}, {"_id": 0})
        return out

    @api.delete(f"/{path}/{{item_id}}")
    async def _delete(item_id: str, user: dict = Depends(get_current_user)):
        can_delete(user)
        r = await db[collection].delete_one({"id": item_id})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"ok": True}


build_crud("customers", "customers", CustomerIn, ["sid", "company_name", "service_name", "location", "pic_name", "email", "ip_address", "site_a", "site_b", "datacenter"])
build_crud("documents", "documents", DocumentIn, ["title", "doc_number", "description"])
# Legacy build_crud("shift-handovers", ...) removed — replaced by shift_handover module (see api.include_router below).
build_crud("incidents", "incidents", IncidentIn, ["title", "site", "description"])
build_crud("maintenances", "maintenances", MaintenanceIn, ["title", "site", "description"])
build_crud("partners", "partners", PartnerIn, ["name", "service_type", "service_name", "location", "provider_sid", "cid", "pic_name", "email_support"])
build_crud("racks", "racks", RackIn, ["name", "number", "datacenter", "room"])
build_crud("devices", "devices", DeviceIn, ["name", "hostname", "brand", "model", "serial_number", "ip_management"])
build_crud("interconnections", "interconnections", InterconnectionIn, ["source_device", "source_port", "dest_device", "dest_port", "connection_type", "cable_id", "description"])
# Legacy CRM (broadband_tickets, dedicated_tickets) is DEPRECATED — replaced by CRM Ticket Helpdesk (helpdesk_tickets).
# Data migrated on startup; legacy collections retained as backup only.
build_crud("kmz-mappings", "kmz_mappings", KMZMappingIn, ["name", "description", "region", "version", "notes"])


# -----------------------------------------------------------------------------
# KMZ Mapping — multi-file endpoints
# -----------------------------------------------------------------------------
@api.post("/kmz-mappings/{mid}/files")
async def kmz_add_file(mid: str, body: KMZFileIn, user: dict = Depends(get_current_user)):
    can_write(user)
    doc = await db.kmz_mappings.find_one({"id": mid})
    if not doc:
        raise HTTPException(status_code=404, detail="Mapping not found")
    file_entry = {
        "id": new_id(),
        "name": body.name,
        "size": body.size,
        "type": body.type or "application/vnd.google-earth.kmz",
        "base64": body.base64,
        "notes": body.notes or "",
        "uploaded_at": now_iso(),
        "uploaded_by": user.get("email"),
    }
    await db.kmz_mappings.update_one(
        {"id": mid},
        {"$push": {"files": file_entry}, "$set": {"updated_at": now_iso(), "updated_by": user.get("email")}},
    )
    out = await db.kmz_mappings.find_one({"id": mid}, {"_id": 0})
    return out


@api.delete("/kmz-mappings/{mid}/files/{fid}")
async def kmz_delete_file(mid: str, fid: str, user: dict = Depends(get_current_user)):
    can_write(user)
    doc = await db.kmz_mappings.find_one({"id": mid})
    if not doc:
        raise HTTPException(status_code=404, detail="Mapping not found")
    await db.kmz_mappings.update_one(
        {"id": mid},
        {"$pull": {"files": {"id": fid}}, "$set": {"updated_at": now_iso(), "updated_by": user.get("email")}},
    )
    out = await db.kmz_mappings.find_one({"id": mid}, {"_id": 0})
    return out


# -----------------------------------------------------------------------------
# Dashboard Aggregations
# -----------------------------------------------------------------------------
@api.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    categories = ['Broadband', 'Dedicated Internet', 'Cross Connect', 'Dark Fiber', 'Metro Ethernet']
    by_category = {}
    for c in categories:
        by_category[c] = await db.customers.count_documents({"category": c})

    total_customers = await db.customers.count_documents({})
    active_customers = await db.customers.count_documents({"status": "Active"})
    total_docs = await db.documents.count_documents({})
    active_incidents = await db.incidents.count_documents({"status": {"$in": ["Open", "Monitoring", "Pending"]}})
    total_incidents = await db.incidents.count_documents({})
    active_maintenances = await db.maintenances.count_documents({"status": {"$in": ["Open", "Monitoring", "Pending"]}})
    total_shifts = await db.shift_handovers.count_documents({})
    total_partners = await db.partners.count_documents({})
    total_racks = await db.racks.count_documents({})
    total_devices = await db.devices.count_documents({})

    doc_categories = ['BA', 'SLA', 'Kontrak', 'PO', 'SO', 'Teknis']
    docs_by_category = {}
    for c in doc_categories:
        docs_by_category[c] = await db.documents.count_documents({"category": c})

    status_breakdown = {}
    for s in ["Open", "Monitoring", "Pending", "Resolved"]:
        status_breakdown[s] = await db.incidents.count_documents({"status": s})

    # Recent activity
    recent = []
    async for d in db.incidents.find({}, {"_id": 0}).sort("created_at", -1).limit(4):
        recent.append({"type": "incident", "title": d.get("title", ""), "status": d.get("status"), "at": d.get("created_at"), "id": d.get("id")})
    async for d in db.shift_handovers.find({}, {"_id": 0}).sort("created_at", -1).limit(3):
        recent.append({"type": "shift", "title": f"Shift {d.get('shift')} - {d.get('officer')}", "status": d.get("status"), "at": d.get("created_at"), "id": d.get("id")})
    async for d in db.maintenances.find({}, {"_id": 0}).sort("created_at", -1).limit(3):
        recent.append({"type": "maintenance", "title": d.get("title", ""), "status": d.get("status"), "at": d.get("created_at"), "id": d.get("id")})
    recent.sort(key=lambda x: x.get("at") or "", reverse=True)

    return {
        "customers_by_category": by_category,
        "docs_by_category": docs_by_category,
        "total_customers": total_customers,
        "active_customers": active_customers,
        "total_documents": total_docs,
        "active_incidents": active_incidents,
        "total_incidents": total_incidents,
        "active_maintenances": active_maintenances,
        "total_shifts": total_shifts,
        "total_partners": total_partners,
        "total_racks": total_racks,
        "total_devices": total_devices,
        "status_breakdown": status_breakdown,
        "recent": recent[:8],
    }


# -----------------------------------------------------------------------------
# Sidebar counts (for badges)
# -----------------------------------------------------------------------------
@api.get("/counts")
async def get_counts(user: dict = Depends(get_current_user)):
    async def c(coll, q=None):
        return await db[coll].count_documents(q or {})
    return {
        "customers": {
            "Broadband": await c("customers", {"category": "Broadband"}),
            "Dedicated Internet": await c("customers", {"category": "Dedicated Internet"}),
            "Cross Connect": await c("customers", {"category": "Cross Connect"}),
            "Dark Fiber": await c("customers", {"category": "Dark Fiber"}),
            "Metro Ethernet": await c("customers", {"category": "Metro Ethernet"}),
            "_total": await c("customers"),
        },
        "documents": {
            "BA": await c("documents", {"category": "BA"}),
            "BA_customer": await c("documents", {"category": "BA", "scope": "customer"}),
            "BA_provider": await c("documents", {"category": "BA", "scope": "provider"}),
            "SLA": await c("documents", {"category": "SLA"}),
            "SLA_customer": await c("documents", {"category": "SLA", "scope": "customer"}),
            "SLA_provider": await c("documents", {"category": "SLA", "scope": "provider"}),
            "Kontrak": await c("documents", {"category": "Kontrak"}),
            "Kontrak_customer": await c("documents", {"category": "Kontrak", "scope": "customer"}),
            "Kontrak_provider": await c("documents", {"category": "Kontrak", "scope": "provider"}),
            "Teknis": await c("documents", {"category": "Teknis"}),
            "KMZ": await c("kmz_mappings"),
            "_total": await c("documents") + await c("kmz_mappings"),
        },
        "partners": {
            "Broadband": await c("partners", {"category": "Broadband"}),
            "Dedicated Internet": await c("partners", {"category": "Dedicated Internet"}),
            "Metro Ethernet": await c("partners", {"category": "Metro Ethernet"}),
            "Dark Fiber": await c("partners", {"category": "Dark Fiber"}),
            "Cross Connect": await c("partners", {"category": "Cross Connect"}),
            "_total": await c("partners"),
        },
        "racks": await c("racks"),
        "devices": await c("devices"),
        "interconnections": await c("interconnections"),
        "handovers": {
            "total": await c("shift_handovers"),
            "pending_accept": await c("shift_handovers", {"status": {"$in": ["Submitted", "Reviewed"]}}),
            "draft": await c("shift_handovers", {"status": "Draft"}),
        },
        "shifts": await c("shift_handovers"),
        "incidents": await c("incidents"),
        "incidents_active": await c("incidents", {"status": {"$in": ["Open", "Monitoring", "Pending"]}}),
        "maintenances": await c("maintenances"),
        "maintenances_active": await c("maintenances", {"status": {"$in": ["Open", "Monitoring", "Pending"]}}),
        "crm": {
            "total": await c("helpdesk_tickets"),
            "masuk": await c("helpdesk_tickets", {"status": "MASUK"}),
            "diproses": await c("helpdesk_tickets", {"status": "DIPROSES"}),
            "selesai": await c("helpdesk_tickets", {"status": "SELESAI"}),
        },
    }


# -----------------------------------------------------------------------------
# CRM Ticket Helpdesk router registered below (see @app.on_event startup)
# -----------------------------------------------------------------------------


# -----------------------------------------------------------------------------
# Startup: indexes + seed
# -----------------------------------------------------------------------------
async def seed_users():
    default_users = [
        {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "name": "Administrator", "role": "admin"},
        {"email": "supervisor@noc.local", "password": "Password@123", "name": "Supervisor NOC", "role": "supervisor"},
        {"email": "engineer@noc.local", "password": "Password@123", "name": "NOC Engineer", "role": "engineer"},
        {"email": "viewer@noc.local", "password": "Password@123", "name": "Viewer", "role": "viewer"},
        {"email": "teknisi@noc.local", "password": "Teknisi@123", "name": "Teknisi Lapangan", "role": "teknisi"},
    ]
    for u in default_users:
        existing = await db.users.find_one({"email": u["email"]})
        if not existing:
            await db.users.insert_one({
                "id": new_id(),
                "email": u["email"].lower(),
                "name": u["name"],
                "role": u["role"],
                "password_hash": hash_password(u["password"]),
                "active": True,
                "created_at": now_iso(),
            })
        elif not verify_password(u["password"], existing["password_hash"]):
            await db.users.update_one({"email": u["email"]}, {"$set": {"password_hash": hash_password(u["password"])}})


async def seed_mock_data():
    # Only seed once
    if await db.customers.count_documents({}) > 0:
        return

    customers_mock = [
        {"sid": "SID-001", "company_name": "PT Sinar Nusantara", "service_name": "Home Fiber 100M", "category": "Broadband", "location": "Jakarta Pusat", "address": "Jl. Sudirman No. 12", "bandwidth": "100 Mbps", "ip_address": "10.10.1.2/30", "vlan": "101", "provider": "Internal", "pic_name": "Budi Santoso", "phone": "+62-812-3456-7890", "email": "budi@sinarnusantara.co.id", "activation_date": "2024-03-15", "status": "Active", "notes": "Router Mikrotik RB750"},
        {"sid": "SID-002", "company_name": "CV Karya Mandiri", "service_name": "Home Fiber 50M", "category": "Broadband", "location": "Bandung", "address": "Jl. Asia Afrika No. 88", "bandwidth": "50 Mbps", "ip_address": "10.10.1.6/30", "vlan": "102", "provider": "Internal", "pic_name": "Siti Rahayu", "phone": "+62-813-1122-3344", "email": "siti@karyamandiri.co.id", "activation_date": "2024-06-01", "status": "Active", "notes": ""},
        {"sid": "SID-100", "company_name": "PT Bank Sejahtera", "service_name": "DIA 200M SLA 99.9", "category": "Dedicated Internet", "location": "Jakarta Selatan", "address": "SCBD Tower A Lt 20", "bandwidth": "200 Mbps", "ip_address": "203.194.10.8/29", "vlan": "201", "provider": "Telkom", "pic_name": "Ahmad Fauzi", "phone": "+62-811-9988-7766", "email": "noc@banksejahtera.co.id", "activation_date": "2023-11-20", "status": "Active", "notes": "Dual homing"},
        {"sid": "SID-101", "company_name": "PT Global Trading", "service_name": "DIA 500M", "category": "Dedicated Internet", "location": "Surabaya", "address": "Jl. Basuki Rahmat No. 5", "bandwidth": "500 Mbps", "ip_address": "203.194.10.16/29", "vlan": "202", "provider": "Indosat", "pic_name": "Rina Wulandari", "phone": "+62-812-5566-7788", "email": "it@globaltrading.co.id", "activation_date": "2024-01-10", "status": "Active", "notes": ""},
        {"sid": "SID-200", "company_name": "PT DataCenter Indo", "service_name": "Cross Connect 10G", "category": "Cross Connect", "location": "DC Cyber 1 Jakarta", "address": "Kuningan Barat", "bandwidth": "10 Gbps", "ip_address": "-", "vlan": "-", "provider": "Internal", "pic_name": "Rizky Pratama", "phone": "+62-815-4433-2211", "email": "ops@datacenterindo.co.id", "activation_date": "2023-08-05", "status": "Active", "notes": "Rack A12 to B04"},
        {"sid": "SID-300", "company_name": "PT Fiber Nusantara", "service_name": "Dark Fiber JKT-BDG", "category": "Dark Fiber", "location": "Jakarta-Bandung", "address": "Route via Cikampek", "bandwidth": "N/A", "ip_address": "-", "vlan": "-", "provider": "Internal", "pic_name": "Dewi Lestari", "phone": "+62-812-7788-9900", "email": "dewi@fibernusantara.co.id", "activation_date": "2023-05-01", "status": "Active", "notes": "1 core, 145km"},
        {"sid": "SID-400", "company_name": "PT MetroConnect", "service_name": "Metro-E 1Gbps", "category": "Metro Ethernet", "location": "Jakarta Barat", "address": "Puri Indah", "bandwidth": "1 Gbps", "ip_address": "-", "vlan": "301", "provider": "Internal", "pic_name": "Fajar Nugroho", "phone": "+62-813-2233-4455", "email": "fajar@metroconnect.co.id", "activation_date": "2024-02-14", "status": "Active", "notes": "Point to point"},
        {"sid": "SID-401", "company_name": "PT Retail Prima", "service_name": "Metro-E 500M", "category": "Metro Ethernet", "location": "Jakarta Selatan", "address": "Kemang", "bandwidth": "500 Mbps", "ip_address": "-", "vlan": "302", "provider": "Internal", "pic_name": "Andi Wijaya", "phone": "+62-812-9988-0011", "email": "andi@retailprima.co.id", "activation_date": "2024-04-22", "status": "Suspended", "notes": "Pending billing"},
    ]

    now = now_iso()
    for c in customers_mock:
        c["id"] = new_id()
        c["created_at"] = now
        c["updated_at"] = now
        c["created_by"] = "system"
    await db.customers.insert_many(customers_mock)

    documents_mock = [
        {"title": "BA Instalasi PT Sinar Nusantara", "category": "BA", "doc_number": "BA-2024-001", "doc_date": "2024-03-15", "valid_from": "2024-03-15", "valid_until": "2025-03-15", "customer_id": customers_mock[0]["id"], "description": "Berita Acara instalasi awal"},
        {"title": "SLA Bank Sejahtera 99.9%", "category": "SLA", "doc_number": "SLA-2023-100", "doc_date": "2023-11-20", "valid_from": "2023-11-20", "valid_until": "2026-11-20", "customer_id": customers_mock[2]["id"], "description": "SLA komitmen 99.9%"},
        {"title": "Kontrak Kerjasama Global Trading", "category": "Kontrak", "doc_number": "KT-2024-050", "doc_date": "2024-01-10", "valid_from": "2024-01-10", "valid_until": "2027-01-10", "customer_id": customers_mock[3]["id"], "description": "Kontrak 3 tahun"},
        {"title": "Topologi Dark Fiber JKT-BDG", "category": "Topologi", "doc_number": "TOP-2023-005", "doc_date": "2023-05-01", "customer_id": customers_mock[5]["id"], "description": "Topologi rute serat"},
        {"title": "Standar Operasi NOC", "category": "Lainnya", "doc_number": "SOP-NOC-01", "doc_date": "2024-01-01", "description": "SOP internal operasional NOC"},
    ]
    for d in documents_mock:
        d["id"] = new_id()
        d["created_at"] = now
        d["updated_at"] = now
        d["created_by"] = "system"
    await db.documents.insert_many(documents_mock)

    shifts_mock = [
        {"date": "2026-02-14", "shift": "Morning", "officer": "Andi Setiawan", "customer_id": customers_mock[2]["id"], "site": "SCBD Tower A", "issue": "Latency tinggi ke gateway", "action_taken": "Restart BGP session, monitoring", "status": "Monitoring", "priority": "High", "notes_next_shift": "Cek kembali jam 15:00"},
        {"date": "2026-02-14", "shift": "Afternoon", "officer": "Rina Kartika", "customer_id": customers_mock[3]["id"], "site": "Surabaya", "issue": "Intermittent packet loss", "action_taken": "Ganti patch cord, test iperf", "status": "Resolved", "priority": "Medium", "notes_next_shift": "-"},
        {"date": "2026-02-13", "shift": "Night", "officer": "Bagus Prasetya", "customer_id": customers_mock[0]["id"], "site": "Jakarta Pusat", "issue": "Link down 03:12 - 03:20", "action_taken": "Auto recovery, root cause analysis", "status": "Pending", "priority": "Low", "notes_next_shift": "Menunggu report vendor"},
    ]
    for s in shifts_mock:
        s["id"] = new_id()
        s["created_at"] = now
        s["updated_at"] = now
        s["created_by"] = "system"
    await db.shift_handovers.insert_many(shifts_mock)

    incidents_mock = [
        {"title": "Fiber cut ruas Cikampek", "customer_id": customers_mock[5]["id"], "site": "Jakarta-Bandung", "started_at": "2026-02-13T02:14:00Z", "resolved_at": None, "description": "Kabel terputus akibat pekerjaan galian", "root_cause": "Konstruksi pihak ketiga", "action_taken": "Tim maintenance on-site, ETA 8 jam", "status": "Open", "priority": "Critical"},
        {"title": "Packet loss intermittent", "customer_id": customers_mock[3]["id"], "site": "Surabaya", "started_at": "2026-02-14T09:00:00Z", "resolved_at": "2026-02-14T11:30:00Z", "description": "PL 3-5% pada core switch", "root_cause": "Buffer overrun", "action_taken": "Reconfigure QoS", "status": "Resolved", "priority": "High"},
        {"title": "Latency anomaly PT Bank Sejahtera", "customer_id": customers_mock[2]["id"], "site": "Jakarta Selatan", "started_at": "2026-02-14T14:20:00Z", "resolved_at": None, "description": "RTT naik dari 5ms ke 45ms", "root_cause": "Investigasi", "action_taken": "Traceroute, contact upstream", "status": "Monitoring", "priority": "High"},
        {"title": "Alarm SNMP timeout", "customer_id": customers_mock[6]["id"], "site": "Jakarta Barat", "started_at": "2026-02-12T18:00:00Z", "resolved_at": None, "description": "SNMP polling gagal", "root_cause": "Belum diketahui", "action_taken": "-", "status": "Pending", "priority": "Medium"},
    ]
    for i in incidents_mock:
        i["id"] = new_id()
        i["created_at"] = now
        i["updated_at"] = now
        i["created_by"] = "system"
    await db.incidents.insert_many(incidents_mock)

    maintenances_mock = [
        {"title": "Firmware upgrade router core", "customer_id": None, "site": "DC Cyber 1", "scheduled_start": "2026-02-16T00:00:00Z", "scheduled_end": "2026-02-16T04:00:00Z", "type": "Planned", "description": "Upgrade IOS-XR 7.5 ke 7.8", "status": "Open", "priority": "Medium"},
        {"title": "Splicing perbaikan darurat", "customer_id": customers_mock[5]["id"], "site": "Cikampek KM 45", "scheduled_start": "2026-02-13T04:00:00Z", "scheduled_end": "2026-02-13T10:00:00Z", "type": "Emergency", "description": "Perbaikan fiber cut", "status": "Resolved", "priority": "Critical"},
        {"title": "Preventive maintenance rack A12", "customer_id": customers_mock[4]["id"], "site": "DC Cyber 1", "scheduled_start": "2026-02-20T02:00:00Z", "scheduled_end": "2026-02-20T05:00:00Z", "type": "Planned", "description": "Cleaning, cable management", "status": "Open", "priority": "Low"},
    ]
    for m in maintenances_mock:
        m["id"] = new_id()
        m["created_at"] = now
        m["updated_at"] = now
        m["created_by"] = "system"
    await db.maintenances.insert_many(maintenances_mock)

    # Partners (categorized by service category)
    partners_mock = [
        # Broadband
        {"name": "Biznet", "category": "Broadband", "cid": "BZN-BB-000112", "service_name": "Biznet Home Ultimate 100M", "capacity": "100 Mbps", "install_address": "Jl. Sudirman No. 12, Jakarta Pusat", "atas_nama": "PT Sinar Nusantara", "location": "Jakarta Pusat", "pic_name": "Rian Wibowo", "phone": "+62-21-57998888", "helpdesk": "1500933", "email_support": "helpdesk@biznetnetworks.com", "contract_start": "2024-03-15", "contract_end": "2027-03-15", "contract_period": "36 bulan", "status": "Active", "notes": "SLA best effort"},
        # Dedicated Internet
        {"name": "Telkom", "category": "Dedicated Internet", "cid": "TLK-DIA-77021", "service_name": "Astinet Premium 200M", "capacity": "200 Mbps", "install_address": "SCBD Tower A Lt 20, Jakarta Selatan", "atas_nama": "PT Bank Sejahtera", "location": "Nasional", "pic_name": "Melati Sari", "phone": "+62-21-5210000", "helpdesk": "147", "email_support": "premium.support@telkom.co.id", "contract_start": "2023-11-20", "contract_end": "2026-11-20", "contract_period": "36 bulan", "status": "Active", "notes": "SLA 99.9%, IP publik /29"},
        {"name": "Indosat", "category": "Dedicated Internet", "cid": "ISAT-IPT-55011", "service_name": "Indosat IP Transit 500M", "capacity": "500 Mbps", "install_address": "Jl. Basuki Rahmat No. 5, Surabaya", "atas_nama": "PT Global Trading", "location": "Surabaya", "pic_name": "Rudi Hartono", "phone": "+62-21-5054045", "helpdesk": "185", "email_support": "noc@indosatooredoo.com", "contract_start": "2024-01-10", "contract_end": "2027-01-10", "contract_period": "36 bulan", "status": "Active", "notes": "Dual homing"},
        # Metro Ethernet
        {"name": "Lintasarta", "category": "Metro Ethernet", "cid": "LA-MTE-88112", "service_name": "Lintasarta Metro-E 200M", "capacity": "200 Mbps", "location": "Jakarta", "pic_name": "Hendra Kusuma", "phone": "+62-21-5758888", "helpdesk": "5757", "email_support": "noc@lintasarta.net", "contract_start": "2024-01-01", "contract_end": "2027-01-01", "contract_period": "36 bulan", "status": "Active", "notes": "Layer-2, VLAN 301"},
        # Dark Fiber
        {"name": "Moratel", "category": "Dark Fiber", "cid": "MRT-DF-4501", "service_name": "Dark Fiber JKT-BDG", "capacity": "1 core", "location": "Jakarta-Bandung", "pic_name": "Setia Nugraha", "phone": "+62-21-25505050", "helpdesk": "50505", "email_support": "noc@moratelindo.co.id", "contract_start": "2023-05-01", "contract_end": "2028-05-01", "contract_period": "60 bulan", "status": "Active", "notes": "Panjang jalur 145km"},
        # Cross Connect
        {"name": "NTT", "category": "Cross Connect", "cid": "NTT-XC-12", "service_name": "Cross Connect 10G", "capacity": "10 Gbps", "location": "DC Cyber 1", "pic_name": "Kenji Sato", "phone": "+62-21-29985000", "helpdesk": "29985", "email_support": "support@ntt.co.id", "contract_start": "2023-08-01", "contract_end": "2026-08-01", "contract_period": "36 bulan", "status": "Active", "notes": "DC interconnect"},
    ]
    for p in partners_mock:
        p["id"] = new_id()
        p["created_at"] = now
        p["updated_at"] = now
        p["created_by"] = "system"
    await db.partners.insert_many(partners_mock)

    # Link some customers to partners (using name lookup for readability)
    def _pid(name):
        return next((p["id"] for p in partners_mock if p["name"] == name), None)

    await db.customers.update_one({"id": customers_mock[0]["id"]}, {"$set": {"partner_id": _pid("Biznet")}})       # Sinar Nusantara -> Biznet (Broadband)
    await db.customers.update_one({"id": customers_mock[2]["id"]}, {"$set": {"partner_id": _pid("Telkom")}})       # Bank Sejahtera -> Telkom (Dedicated)
    await db.customers.update_one({"id": customers_mock[3]["id"]}, {"$set": {"partner_id": _pid("Indosat")}})      # Global Trading -> Indosat (Dedicated)
    await db.customers.update_one({"id": customers_mock[4]["id"]}, {"$set": {"partner_id": _pid("NTT")}})          # DataCenter Indo -> NTT (Cross Connect)
    await db.customers.update_one({"id": customers_mock[5]["id"]}, {"$set": {"partner_id": _pid("Moratel")}})      # Fiber Nusantara -> Moratel (Dark Fiber)
    await db.customers.update_one({"id": customers_mock[6]["id"]}, {"$set": {"partner_id": _pid("Lintasarta")}})   # MetroConnect -> Lintasarta (Metro-E)

    # Racks
    racks_mock = [
        {"datacenter": "DC Cyber 1 Jakarta", "room": "Hall A", "name": "Rack A12", "number": "A12", "capacity_u": 42, "position": "Row A - Col 12", "status": "Active", "notes": "Main core rack"},
        {"datacenter": "DC Cyber 1 Jakarta", "room": "Hall A", "name": "Rack A13", "number": "A13", "capacity_u": 42, "position": "Row A - Col 13", "status": "Active", "notes": "Distribution"},
        {"datacenter": "DC NTT Serpong", "room": "Hall 2", "name": "Rack B04", "number": "B04", "capacity_u": 48, "position": "Row B - Col 04", "status": "Active", "notes": ""},
    ]
    for r in racks_mock:
        r["id"] = new_id()
        r["created_at"] = now
        r["updated_at"] = now
        r["created_by"] = "system"
    await db.racks.insert_many(racks_mock)

    # Devices
    devices_mock = [
        {"rack_id": racks_mock[0]["id"], "name": "CORE-RTR-01", "hostname": "core-rtr-01", "brand": "Cisco", "model": "ASR 9010", "serial_number": "FOX2412ABCD", "position_u": 38, "height_u": 4, "ip_management": "10.99.0.1/24", "power_ports": "2", "power_source_a": "PDU-A1", "power_source_b": "PDU-B1", "status": "Active", "install_date": "2023-05-10", "customer_id": None, "partner_id": None, "service": "Core routing", "notes": "Redundant power"},
        {"rack_id": racks_mock[0]["id"], "name": "AGG-SW-01", "hostname": "agg-sw-01", "brand": "Juniper", "model": "QFX5120", "serial_number": "JN12345XYZ", "position_u": 34, "height_u": 2, "ip_management": "10.99.0.10/24", "power_ports": "2", "power_source_a": "PDU-A1", "power_source_b": "PDU-B1", "status": "Active", "install_date": "2023-06-01", "customer_id": customers_mock[2]["id"], "partner_id": partners_mock[1]["id"], "service": "Bank Sejahtera aggregation", "notes": ""},
        {"rack_id": racks_mock[0]["id"], "name": "SVR-MON-01", "hostname": "monitor-01", "brand": "Dell", "model": "PowerEdge R650", "serial_number": "DL-R650-889", "position_u": 20, "height_u": 1, "ip_management": "10.99.5.20/24", "power_ports": "2", "power_source_a": "PDU-A1", "power_source_b": "PDU-B1", "status": "Active", "install_date": "2024-02-15", "customer_id": None, "partner_id": None, "service": "NMS server", "notes": ""},
        {"rack_id": racks_mock[1]["id"], "name": "DIST-SW-02", "hostname": "dist-sw-02", "brand": "Cisco", "model": "Catalyst 9300", "serial_number": "FCW23CD4321", "position_u": 40, "height_u": 1, "ip_management": "10.99.0.20/24", "power_ports": "2", "power_source_a": "PDU-A2", "power_source_b": "PDU-B2", "status": "Active", "install_date": "2024-01-20", "customer_id": None, "partner_id": None, "service": "Distribution", "notes": ""},
        {"rack_id": racks_mock[2]["id"], "name": "XC-DEMARC-01", "hostname": "xc-demarc-01", "brand": "Corning", "model": "ODF 48-port", "serial_number": "CN-ODF-4801", "position_u": 42, "height_u": 1, "ip_management": "-", "power_ports": "0", "power_source_a": "-", "power_source_b": "-", "status": "Active", "install_date": "2023-08-10", "customer_id": customers_mock[4]["id"], "partner_id": partners_mock[3]["id"], "service": "Cross connect demarc", "notes": ""},
    ]
    for d in devices_mock:
        d["id"] = new_id()
        d["created_at"] = now
        d["updated_at"] = now
        d["created_by"] = "system"
    await db.devices.insert_many(devices_mock)

    logger.info("Mock data seeded")


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.customers.create_index("sid")
    await db.customers.create_index("category")
    await db.customers.create_index("status")
    await db.customers.create_index("partner_id")
    await db.documents.create_index("category")
    await db.documents.create_index("scope")
    await db.documents.create_index("customer_id")
    await db.documents.create_index("partner_id")
    await db.incidents.create_index("status")
    await db.shift_handovers.create_index("status")
    await db.maintenances.create_index("status")
    await db.partners.create_index("name")
    await db.racks.create_index("datacenter")
    await db.devices.create_index("rack_id")
    await db.interconnections.create_index("source_rack_id")
    await db.interconnections.create_index("dest_rack_id")
    # CRM Ticket Helpdesk indexes (new)
    await db.helpdesk_tickets.create_index("ticket_number", unique=False)
    await db.helpdesk_tickets.create_index("status")
    await db.helpdesk_tickets.create_index("priority")
    await db.helpdesk_tickets.create_index("customer_id")
    await db.helpdesk_tickets.create_index("troubleshooter_id")
    await db.helpdesk_tickets.create_index("created_at")
    await db.helpdesk_ticket_files.create_index("ticket_id")
    await db.helpdesk_ticket_files.create_index("evidence_type")
    await db.helpdesk_categories.create_index("name")
    # Network / IPAM indexes
    await db.mikrotik_routers.create_index("name")
    await db.ipam_routes.create_index([("router_id", 1), ("cidr", 1)])
    await db.ipam_routes.create_index("missing_since")
    await db.ipam_allocations.create_index("cidr")
    await db.ipam_allocations.create_index("status")
    await db.ipam_audit_logs.create_index("at")
    await db.ipam_sync_logs.create_index("at")
    # SNMP indexes
    await db.snmp_configs.create_index("device_id", unique=True)
    await db.device_telemetry.create_index("device_id", unique=True)
    await seed_users()
    await seed_mock_data()
    # Backfill: any legacy document without scope gets one (customer if linked to a customer, otherwise provider if linked to partner, else customer).
    async for d in db.documents.find({"scope": {"$exists": False}}, {"_id": 1, "customer_id": 1, "partner_id": 1}):
        scope = "customer" if d.get("customer_id") else ("provider" if d.get("partner_id") else "customer")
        await db.documents.update_one({"_id": d["_id"]}, {"$set": {"scope": scope}})
    # Expose db + start auto-sync background loops
    app.state.db = db
    import asyncio as _asyncio
    from network_ipam import auto_sync_loop  # noqa
    from snmp_discovery import auto_sync_loop as snmp_auto_sync_loop  # noqa
    from device_templates import seed_default_templates  # noqa
    await seed_default_templates(db)
    try:
        await notif_seed_templates(db)
    except Exception as ex:
        logger.error(f"Notification templates seed failed: {ex}")
    # CRM Ticket Helpdesk: seed categories + migrate legacy tickets (idempotent, safe to re-run)
    try:
        await crm_seed_categories(db)
        summary = await crm_run_migration(db)
        logger.info(f"CRM helpdesk migration ran: {summary}")
    except Exception as ex:
        logger.error(f"CRM helpdesk migration/seed failed: {ex}")
    try:
        sh_summary = await shift_handover_migration(db)
        logger.info(f"Shift handover migration ran: {sh_summary}")
        await db.shift_handovers.create_index("handover_number")
        await db.shift_handovers.create_index("status")
        await db.shift_handovers.create_index("handover_date")
        await db.shift_handovers.create_index("shift_code")
        await db.shift_handovers.create_index("worker_id")
        await db.shift_handovers.create_index("receiver_id")
        await db.shift_handover_files.create_index("handover_id")
        await db.shift_handover_files.create_index("case_id")
    except Exception as ex:
        logger.error(f"Shift handover migration failed: {ex}")
    try:
        topo_summary = await seed_topology(db)
        logger.info(f"Topology seeding: {topo_summary}")
        await db.topology_sites.create_index("ref_customer_id")
        await db.topology_sites.create_index("ref_rack_id")
        await db.topology_sites.create_index("ref_partner_id")
        await db.topology_links.create_index("source_device_id")
        await db.topology_links.create_index("dest_device_id")
        await db.topology_links.create_index("legacy_interconnection_id")
        await db.topology_links.create_index("redundancy_group_id")
        await db.topology_tunnels.create_index("a_device_id")
        await db.topology_tunnels.create_index("b_device_id")
        await db.topology_audit.create_index("at")
        await db.topology_audit.create_index("entity_type")
        await db.uisp_sync_cache.create_index([("kind", 1), ("uisp_id", 1)], unique=True)
    except Exception as ex:
        logger.error(f"Topology seed/index failed: {ex}")
    app.state._auto_sync_task = _asyncio.create_task(auto_sync_loop(app))
    app.state._snmp_sync_task = _asyncio.create_task(snmp_auto_sync_loop(app))


@app.on_event("shutdown")
async def on_shutdown():
    try:
        t = getattr(app.state, "_auto_sync_task", None)
        if t:
            t.cancel()
    except Exception:
        pass
    try:
        t = getattr(app.state, "_snmp_sync_task", None)
        if t:
            t.cancel()
    except Exception:
        pass
    client.close()


# --- Register network / IPAM sub-router
from network_ipam import build_network_router  # noqa: E402
from snmp_discovery import build_snmp_router  # noqa: E402
from device_templates import build_device_templates_router  # noqa: E402
from zabbix_integration import build_zabbix_router  # noqa: E402
from topology import build_topology_router  # noqa: E402
from crm_helpdesk import (  # noqa: E402
    build_crm_helpdesk_router,
    seed_categories as crm_seed_categories,
    run_migration as crm_run_migration,
)
from shift_handover import (  # noqa: E402
    build_shift_handover_router,
    run_migration as shift_handover_migration,
)
from topology_v2 import build_topology_v2_router, seed_topology  # noqa: E402
from uisp_integration import build_uisp_router  # noqa: E402
from genieacs_integration import build_genieacs_router  # noqa: E402
from notifications import (  # noqa: E402
    build_notifications_router,
    build_public_tracking_router,
    seed_templates as notif_seed_templates,
)
api.include_router(build_network_router(get_current_user, require_roles))
api.include_router(build_snmp_router(get_current_user, require_roles))
api.include_router(build_device_templates_router(get_current_user, require_roles))
api.include_router(build_zabbix_router(get_current_user, require_roles))
api.include_router(build_topology_router(get_current_user, require_roles))
api.include_router(build_crm_helpdesk_router(get_current_user, lambda: db))
api.include_router(build_shift_handover_router(get_current_user, lambda: db))
api.include_router(build_topology_v2_router(get_current_user, lambda: db))
api.include_router(build_uisp_router(get_current_user, lambda: db))
api.include_router(build_genieacs_router(get_current_user, require_roles))
api.include_router(build_notifications_router(get_current_user, require_roles, lambda: db))
api.include_router(build_public_tracking_router(lambda: db))

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
