# Portal Support Artamedia — PRD

## Overview
NOC portal untuk PT. Artamedia. Iterasi bertahap:
1. Phase 1 — Clone repo dari GitHub + run di Emergent.
2. Phase 2 — CRM Ticket Helpdesk (redesign penuh).
3. Phase 3 — Shift Handover (multi-case + carry-over).
4. Phase 4 — Sidebar reorg (MikroTik/SNMP ke Settings, Maps Topology ke Network, urutan Network→CRM→Ops).
5. Phase 5 — **Topology Management System (Feb 2026)**.

## Phase 5 — Topology Management System

### Backend
- **`/app/backend/topology_v2.py`** (~500 baris) — modul baru, mount di `/api/topology/v2/*`. Legacy `topology.py` tetap di-mount di `/api/topology/*` untuk backward compat.
- **`/app/backend/uisp_integration.py`** (~200 baris) — kredensial UISP encrypted Fernet, endpoint config/test/sync/entities/map. Kredensial disimpan di collection `uisp_config` (token_encrypted); tidak pernah dikirim ke frontend.
- **11 collection baru**: `topology_sites`, `topology_patch_panels`, `topology_odf`, `topology_fibers`, `topology_port_mappings`, `topology_links`, `topology_tunnels`, `topology_layouts` (dengan history 10-snapshot), `topology_audit`, `uisp_config`, `uisp_sync_cache`.
- **Seeding otomatis (idempotent)**: setiap `racks` → `topology_sites` type=datacenter; setiap `customers` → `topology_sites` type=customer_site; setiap `interconnections` → `topology_links` legacy_interconnection_id. Data master TIDAK diduplikasi — hanya reference id.
- **Dependency graph on-the-fly** (`_build_graph`): tidak persistent, di-compute dari sites+racks+devices+links+tunnels+customers per request. Adjacency `adj_down` + `adj_up`.
- **Impact propagation** (`_propagate_status`): DOWN → BFS turun; child yang punya alt-parent UP jadi DEGRADED, sisanya UNREACHABLE. Ada perbedaan tegas: down ≠ unreachable ≠ degraded.
- **Trace** upstream/downstream via BFS dari node terpilih.
- **Redundancy** via `topology_links.redundancy_group_id` + role primary/secondary/backup.
- **Tunnel** dengan underlay reference (`a_side_underlay_link_id`, `underlay_type`) — otomatis kena impact jika underlay down.
- **Audit** untuk semua CRUD di `topology_audit`, `topology_layouts` menyimpan history 10 snapshot.

### Frontend
- **`/app/frontend/src/pages/MapsTopology.jsx`** (rewrite penuh) — 4 mode tab (Service/Physical/Geographic/Tunnel), Edit Mode toggle (admin/supervisor only), UISP button dengan status, filter kind + search, legend 8 link-type dengan warna berbeda, stats chip, Detail Panel dengan Impact/Trace Upstream/Trace Downstream.
- **`/app/frontend/src/components/topology/LogicalCanvas.jsx`** — React Flow (`@xyflow/react`) + custom EntityNode + Dagre auto-layout. Save/load layout via `/api/topology/v2/layouts`.
- **`/app/frontend/src/components/topology/UISPPanel.jsx`** — Sheet konfigurasi UISP dengan Test/Sync/Save. Status "UISP Not Connected" bila belum ada config.
- **`/app/frontend/src/components/topology/GeographicMap.jsx`** — reuse existing, sudah pakai leaflet.
- **`/app/frontend/src/pages/topology.css`** — light-theme lock (`.topology-light-scope`) untuk canvas + map (selalu terang), link-type stroke colors (`.link-fiber` etc.).
- Deleted: `LogicalTopology.jsx` (diganti LogicalCanvas.jsx).

### Verifikasi
- Migration: 3 sites-from-racks + 8 sites-from-customers seeded → 11 topology_sites total.
- Backend graph endpoint: 27 nodes computed (11 sites + 3 racks + 5 devices + 8 customers).
- Impact endpoint: down 1 device → propagation correct.
- Trace downstream + layout save + audit log OK.
- UISP status endpoint returns `UISP Not Connected` (belum ada kredensial).
- Frontend screenshot: 3 mode berhasil render (Service, Geographic, UISP panel).

## Phase 6 — GIS Map Rewrite (Feb 2026)
User menolak konsep drawing-canvas (React Flow). MapsTopology dirombak jadi GIS-only:
- Site → Device → Connection auto-drawn dari database.
- Leaflet + CartoDB Positron tiles. Legend berdasar link-type.
- Add/Edit Site, Add Device (existing/new), Add Connection dari device panel.

### 6.1 Detail Panel Fix (Feb 04, 2026) — ✅ DONE, verified iter_19
Bug: klik marker/connection membuat Sheet overlay yang menutupi peta.
Fix: hapus `<Sheet>` untuk site/conn detail; render inline sebagai `<aside w-[400px]>` di samping map (`flex-1`). Tambah `MapResizer` (ResizeObserver → `map.invalidateSize()`) di GeographicMap agar tile Leaflet re-render saat panel dibuka/ditutup. Form sheets (Site/Device/Conn) tetap `<Sheet>` (tidak diubah).

## Backlog (P1/P2)
- **P1** Cable Connection: filter "Destination B" summary di MyInterconnection.
- **P1** Geographic Map: marker tooltips (customer/device count).
- **P1** UISP live sync (tunggu URL + token dari user).
- **P2** Settings: Auto-Import MikroTik & SNMP Bulk Discovery.
- **P2** Refactor MapsTopology.jsx (624 lines) — pisah SiteForm/DeviceForm/ConnForm ke file terpisah.
- **P2** Ganti Leaflet renderer ke SVG (`renderer={L.svg()}`) untuk memudahkan E2E klik polyline.

## Phase 7 — Mobile-first CRM + Teknisi Role (Feb 04, 2026) — ✅ DONE, verified iter_20 (100%)

### Backend
- **Role baru `teknisi`** — added to `Role` Literal di `/app/backend/server.py` line 36.
- Seed user: `teknisi@noc.local` / `Teknisi@123`.
- `/app/backend/crm_helpdesk.py` — `TECH`, `NOC`, `ALL_READ` sets sekarang include `"teknisi"` sehingga teknisi bisa CRUD ticket, upload evidence, progress, close ticket.
- Regression tests: `/app/backend/tests/test_teknisi_rbac.py` (7/7 pass).

### Frontend
- **`/app/frontend/src/lib/roleAccess.js`**: `teknisi` → allowed sections = `['crm']`, `ROLE_HAS_DASHBOARD.teknisi = false`, `ROLE_LANDING.teknisi = '/crm/dashboard'`.
- **`/app/frontend/src/context/AuthContext.jsx`**: `canWrite` include teknisi.
- **`/app/frontend/src/components/Sidebar.jsx`**: di-refactor. Default export = desktop `Sidebar` (hidden md:flex). Named export `MobileSidebar` = Shadcn `Sheet` drawer dengan `data-testid="mobile-sidebar"`. Kedua-nya pakai internal `<SidebarNav>` yang shared. Semua NavLink dapat `onClick={onNavigate}` untuk auto-close drawer pada navigasi.
- **`/app/frontend/src/components/Layout.jsx`**: kelola state `mobileOpen`, render `<MobileSidebar>`, auto-close drawer pada `location.pathname` change.
- **`/app/frontend/src/components/Header.jsx`**: tambah hamburger button `data-testid="mobile-menu-button"` (only visible `<md`), placeholder input shorter, `ROLE_LABEL.teknisi = 'Teknisi Lapangan'`.
- **CRM ticket lists** (`TicketMasuk.jsx`, `TicketDiproses.jsx`, `TicketSelesai.jsx`): tambah mobile card view (`md:hidden`) dengan test IDs `masuk-card-*`, `diproses-card-*`, `selesai-card-*`. Desktop table dibungkus `hidden md:block`.
- **Camera capture**: sudah tersedia sebelumnya di `UploadZone.jsx` via `<input type="file" accept="image/*" capture="environment">`. Verified via testing agent.

### Verifikasi (iter_20)
- Backend 100% pass: teknisi login OK, RBAC OK (CRM full write, /users → 403), upload endpoint reachable.
- Frontend 100% pass: teknisi lands `/crm/dashboard`, drawer hanya menampilkan section CRM, drawer auto-close saat klik menu, cards muncul di mobile, camera input `capture='environment'` terdeteksi, `/customers/dedicated` dan `/` diredirect ke `/crm/dashboard`.
- Desktop admin regression OK: sidebar penuh tetap render, hamburger tersembunyi.

### 7.1 Teknisi Read-only pada Open Ticket (Feb 05, 2026) — ✅ DONE
User meminta teknisi tidak boleh membuat ticket baru — hanya lihat Dashboard, Ticket Masuk/Diproses/Selesai (dan proses/upload progress).
- **Backend** `/app/backend/crm_helpdesk.py` `create_ticket`: role check dipisah dari `NOC` set → hard-coded `{"admin","supervisor","engineer"}`. Verified curl: teknisi POST /crm/tickets → 403, engineer → 200.
- **Frontend** `/app/frontend/src/lib/roleAccess.js`: tambah `ROLE_BLOCKED_PATHS = {teknisi: ['/crm/open']}`; `isPathAllowed` cek block list dulu → teknisi navigasi ke `/crm/open` akan diredirect `defaultLandingPath` = `/crm/dashboard`.
- **Frontend** `/app/frontend/src/components/Sidebar.jsx`: `CRM.filter((c) => !(role === 'teknisi' && c.key === 'crm-open'))` di render — item "Open Ticket" hilang dari sidebar teknisi.

### 7.2 Shift Handover — Manual Input untuk Customer & Ticket (Feb 05, 2026) — ✅ DONE
User meminta di form "Input Shift Handover" NOC, field Customer/Client dan Nomor Ticket CRM juga bisa diisi manual (tidak harus pilih dari database).
- **Frontend** `/app/frontend/src/pages/operations/InputShiftHandover.jsx`:
  - `CustomerAutocomplete`: tambah `<Input>` di bawah picker dengan placeholder "…atau ketik manual nama customer/client". Manual input → `onChange(null, e.target.value, null)` → `customer_id = null`, `customer_name = teks`. Test id: `case-customer-{idx}-manual`.
  - `TicketPicker`: tambah `<Input>` di bawah picker dengan placeholder "…atau ketik nomor ticket manual". Manual input → `onChange({ id: null, ticket_number: value })` → `ticket_id = null`, `ticket_number = teks`; field lain (customer/location/kategori) dipertahankan via `|| c.xxx` fallback pada handler CaseCard. Test id: `case-ticket-{idx}-manual`.

### 7.3 Default Theme = Dark Mode (Feb 05, 2026) — ✅ DONE
- `/app/frontend/src/context/ThemeContext.jsx`: default sekarang `'dark'` untuk user baru (tanpa localStorage entry). User yang sudah pernah pilih light/dark tetap dipakai pilihan tersimpannya. Toggle tetap berfungsi.

## Backlog / Next Steps
- Isi kredensial UISP asli via panel Settings → UISP.
- Test dengan Zabbix real device state.
- Physical Path mode: bangun UI PortMappingEditor (backend siap).
- Tunnel mode: filter khusus tunnel + underlay path visualization.
- Fiber route drawing di Geographic mode (backend `topology_fibers.route_geojson` siap).
- Bulk import UISP entities via mapping table.

## Phase 8 — Centralized Notification Center (Aug 06, 2026) — ✅ DONE, verified iter_22 (100%)
- New module `/app/backend/notifications.py`: provider-agnostic Notification Service. CRM pages NEVER send WA directly — they call `notify_ticket_event(db, event, ticket, extra)`. Single choke point `send_message()` reused by any future module (Maintenance/Monitoring/SLA/Handover).
- Provider #1 = WhatsApp via **Fonnte** (`FonnteProvider`, POST /send + /device, raw Authorization token). Registry `PROVIDERS` + `SUPPORTED_PROVIDERS` advertises Telegram/Email/Discord as "coming soon" without touching CRM.
- Token stored ENCRYPTED (Fernet, same pattern as uisp/zabbix) in `notification_settings`; GET never returns raw token (masked only). Collections: `notification_settings`, `notification_templates` (9 customizable, {{placeholders}}), `notification_logs`.
- CRM hooks in crm_helpdesk.py: created / assigned (process+reassign) / progress / escalated (priority raised to High|Critical via PUT) / resolved. Each fires customer + internal group messages per EVENT_MATRIX. Best-effort — never breaks CRM flow.
- Public tracking: every ticket gets `tracking_token`; customer WA includes `{{tracking_url}}` = PUBLIC_BASE_URL + /track/{token}. Endpoint GET /api/track/{token} (NO auth) returns sanitized status/timeline/progress/tech-notes/documentation/completion. Public file content served read-only. Frontend `/track/:token` is top-level (outside ProtectedRoute) — no login.
- Settings UI: Settings → WhatsApp Gateway (`/settings/notifications/whatsapp`), Message Templates (`/settings/notifications/templates`), Delivery Logs (`/settings/notifications/logs`). Added to Sidebar SETTINGS.
- env: `PUBLIC_BASE_URL` added to backend/.env for tracking links.
- Regression: /app/backend/tests/test_notifications.py (15 tests). NOTE: keep notifications enabled=false in tests (dummy Fonnte token stored) — logs record 'skipped' fast.

## Phase 8.1 — Email (SMTP/Gmail) provider + rename "Notification Gateway" (Aug 06, 2026) — ✅ DONE, verified iter_23 (100%)
- Added `EmailProvider` (smtplib via asyncio.to_thread; STARTTLS 587 / SSL 465) to notifications.py. `PROVIDERS`/`SUPPORTED_PROVIDERS` now expose email available=true. Provider is selectable (Fonnte WhatsApp OR Email SMTP).
- Settings extended: smtp_host/port/security/username, smtp_password (encrypted, never returned — only smtp_password_configured), from_email/from_name, internal_email (internal recipient for email channel), subject_prefix. Blank password on re-save keeps stored value.
- `notify_ticket_event` resolves targets per active provider: email → customer email (pic_contact if it's an email, else customers.email) + internal_email + subject; whatsapp → pic_contact phone + default_group.
- `provider_ready()` gate + `/notifications/test` works for both providers (Fonnte /device, SMTP login test).
- Frontend: page renamed to **Notification Gateway** (`/settings/notifications/gateway`; old `/whatsapp` redirects). Provider-conditional fields; sidebar label updated. Gmail helper note: 2FA + 16-digit App Password required.
- To go live with email: Settings → Notification Gateway → pilih Email, isi Gmail + App Password + internal email, aktifkan toggle.

## Phase 8.2 — Maps Topology layering fix + click-to-place Add Site (Aug 06, 2026) — ✅ DONE, verified iter_24 (frontend 100%)
- Bug fix: Leaflet panes painted above dialogs. Root cause = map container did not isolate its stacking context so Leaflet z-indexes (200-1000) beat Radix overlay (z-50). Fix: `.topology-light-scope { isolation: isolate; }` traps all Leaflet z-indexes below app modals.
- Map inert while any modal open: `InteractionLock` disables dragging/scrollWheelZoom/doubleClickZoom/boxZoom/keyboard/touchZoom/tap; marker+polyline clicks gated; `map-interaction-block` backdrop; Radix overlay = semi-transparent backdrop blocking the map.
- Add Site click-to-place (Option A): 'Tambah Site' → pick mode (crosshair + hint banner + Batal) → click map captures lat/lng → drawer opens with coords banner + prefilled Latitude/Longitude → user enters Nama/Tipe/Deskripsi → Simpan (POST). Edit path uses isEdit=!!initial.id (PUT), fixing prior duplicate-on-edit risk. Crosshair cursor forced in pick mode via `.topology-light-scope.picking` CSS.

---
## GenieACS Integration (added 2026-06)
Integration layer over an EXISTING GenieACS server via NBI REST API (no install, no direct DB access).
- Backend: `/app/backend/genieacs_integration.py` mounted at `/api/genieacs/*`. Fernet-encrypted credentials (reuses IPAM key), short-TTL cache (one NBI call feeds summary/clusters/table), graceful degradation when NBI unreachable.
- Endpoints: config (GET/PUT admin), test-connection, summary, devices (filter+paginate), devices/{id} (detail; full params only on open), faults, actions refresh/reboot/wifi/pppoe/tags (roles admin,supervisor,engineer; NO factory reset), audit log, mappings + snapshot.
- Clusters derived from GenieACS tags (prefix `CLUSTER:` default, or manual mode). Names displayed Title-Case, prefix stripped. Never hardcoded.
- Status from Last Inform thresholds (configurable; default online<=10m, warning<=30m).
- Frontend: `pages/network/GenieACS.jsx` (summary, cluster cards, device table, detail drawer, faults tab), `pages/settings/GenieACSSettings.jsx`. Menu: Network → GenieACS (below Maps Topology); Settings → Integrations · GenieACS.
- CRM: `TicketDetail.jsx` shows ACS Monitoring snapshot when a mapping exists for the ticket customer.
- Verified end-to-end against a mock NBI (testing agent: 13/13 UI flows pass). Config reset to blank for user to enter their real server.
- REMAINING (P1): dedicated Customer↔Device mapping management UI and ACS panel inside the Customer detail page (backend `/genieacs/mappings` + `/snapshot` already exist).
