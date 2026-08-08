import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Layers, Server, ChevronRight, PanelTop, PanelBottom, ImageOff, ArrowRight } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import api from '@/lib/api';
import { getDeviceTemplate } from '@/lib/deviceTemplates';
import RackExplorerElevation from '@/components/rack/RackExplorerElevation';
import DeviceInfoPanel from '@/components/rack/DeviceInfoPanel';
import DeviceFrontPanel from '@/components/rack/DeviceFrontPanel';
import DevicePanelImage from '@/components/rack/DevicePanelImage';
import ZabbixGraphPanel from '@/components/rack/ZabbixGraphPanel';
import PortDetailSheet from '@/components/rack/PortDetailSheet';
import { cn } from '@/lib/utils';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

/**
 * InfrastructureExplorer
 * ----------------------
 * Netbox-style explorer surface used from the existing RackDevice page.
 * Read-only: never mutates any device/rack; CRUD stays in the classic view.
 *
 * Props:
 *   rack        — currently opened rack
 *   devices     — devices in this rack (already fetched by parent)
 *   loading     — bool
 *   customerMap — {id: name}
 *   partnerMap  — {id: name}
 *   onSlotClick(u) — parent uses this to open the "add device" sheet
 */
export default function InfrastructureExplorer({
  rack,
  devices,
  loading,
  customerMap = {},
  partnerMap = {},
  onSlotClick,
}) {
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [side, setSide] = useState('front');
  const [selectedPort, setSelectedPort] = useState(null); // { port, state }
  const [interconnects, setInterconnects] = useState([]); // raw list
  const [loadingCables, setLoadingCables] = useState(false);
  const [zabbixPorts, setZabbixPorts] = useState(null); // batch Zabbix per-port telemetry
  const [zabbixLoading, setZabbixLoading] = useState(false);
  const [dbTemplate, setDbTemplate] = useState(null); // PNG-backed template resolved from backend
  const [dbTemplateLoading, setDbTemplateLoading] = useState(false);

  // Auto-select the first device when the list changes
  useEffect(() => {
    if (!selectedDevice && devices.length > 0) {
      setSelectedDevice(devices[0]);
    }
    if (selectedDevice && !devices.find((d) => d.id === selectedDevice.id)) {
      setSelectedDevice(devices[0] || null);
    }
  }, [devices, selectedDevice]);

  // Load interconnections once so we can derive port link-state
  useEffect(() => {
    let alive = true;
    setLoadingCables(true);
    api
      .get('/interconnections', { params: { page_size: 500 } })
      .then(({ data }) => {
        if (alive) setInterconnects(data.items || []);
      })
      .catch(() => {})
      .finally(() => alive && setLoadingCables(false));
    return () => {
      alive = false;
    };
  }, []);

  // Reset selected port when device changes
  useEffect(() => {
    setSelectedPort(null);
  }, [selectedDevice?.id]);

  // Resolve DB-backed template (PNG-based) whenever device changes
  useEffect(() => {
    let alive = true;
    setDbTemplate(null);
    if (!selectedDevice) return () => { alive = false; };
    setDbTemplateLoading(true);
    api.get(`/device-templates/resolve/${selectedDevice.id}`)
      .then(({ data }) => { if (alive) setDbTemplate(data.template); })
      .catch(() => alive && setDbTemplate(null))
      .finally(() => alive && setDbTemplateLoading(false));
    return () => { alive = false; };
  }, [selectedDevice?.id]);

  // Template resolution
  const template = useMemo(
    () => getDeviceTemplate(selectedDevice),
    [selectedDevice],
  );

  // Build port state map for the selected device — prefer DB template when available
  const activeTemplate = dbTemplate?.image_filename ? dbTemplate : template;

  // Compute the flat port list for the active template (used both by
  // Zabbix batch fetch and by buildPortStates below)
  const portList = useMemo(() => {
    if (!activeTemplate) return [];
    const list = [];
    if (Array.isArray(activeTemplate.ports) && !activeTemplate.front) {
      list.push(...activeTemplate.ports);
    } else {
      activeTemplate.front?.rows?.forEach((r) => r.ports?.forEach((p) => list.push(p)));
      if (activeTemplate.front?.accessories) list.push(...activeTemplate.front.accessories);
    }
    return list;
  }, [activeTemplate]);

  // Fetch Zabbix live telemetry for ALL ports on the device (single batch call,
  // auto-refresh every 30s). Replaces the previous direct SNMP polling so the
  // panel mapping, tooltip and detail sheet all reflect the same Zabbix data.
  useEffect(() => {
    let alive = true;
    let intervalId = null;
    setZabbixPorts(null);
    if (!selectedDevice || portList.length === 0) return () => { alive = false; };
    const ifnames = portList.map((p) => p.id).filter(Boolean).join(',');
    if (!ifnames) return () => { alive = false; };
    const fetchOnce = () => {
      setZabbixLoading(true);
      api.get(`/zabbix/device/${selectedDevice.id}/ports-status`, {
        params: { ifnames, polling_interval: 60 },
      })
        .then(({ data }) => { if (alive) setZabbixPorts(data); })
        .catch(() => alive && setZabbixPorts({ configured: false, error: true }))
        .finally(() => alive && setZabbixLoading(false));
    };
    fetchOnce();
    intervalId = setInterval(fetchOnce, 30000);
    return () => {
      alive = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [selectedDevice?.id, portList]);

  const manualRefresh = useCallback(() => {
    if (!selectedDevice || portList.length === 0) return;
    setZabbixLoading(true);
    const ifnames = portList.map((p) => p.id).filter(Boolean).join(',');
    api.get(`/zabbix/device/${selectedDevice.id}/ports-status`, {
      params: { ifnames, polling_interval: 60 },
    })
      .then(({ data }) => setZabbixPorts(data))
      .catch(() => {})
      .finally(() => setZabbixLoading(false));
  }, [selectedDevice?.id, portList]);

  const portStates = useMemo(() => {
    if (!selectedDevice || !activeTemplate) return {};
    return buildPortStates(selectedDevice, portList, interconnects, devices, customerMap, zabbixPorts);
  }, [selectedDevice, activeTemplate, portList, interconnects, devices, customerMap, zabbixPorts]);

  const handleNavigateToDevice = useCallback(
    (deviceId) => {
      const target = devices.find((d) => d.id === deviceId);
      if (target) {
        setSelectedDevice(target);
        setSelectedPort(null);
      }
    },
    [devices],
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4">
      {/* --- Section 1: Rack Elevation ------------------------------------ */}
      <div className="min-w-0">
        {loading ? (
          <Skeleton className="h-[600px] w-full" />
        ) : (
          <RackExplorerElevation
            capacityU={rack.capacity_u}
            devices={devices}
            selectedId={selectedDevice?.id}
            onSelectDevice={setSelectedDevice}
            onSlotClick={onSlotClick}
          />
        )}
      </div>

      {/* --- Sections 2 + 3 ---------------------------------------------- */}
      <div className="min-w-0 space-y-4">
        <DeviceInfoPanel
          device={selectedDevice}
          template={template}
          customer={selectedDevice?.customer_id ? customerMap[selectedDevice.customer_id] : null}
          partner={selectedDevice?.partner_id ? partnerMap[selectedDevice.partner_id] : null}
        />

        {selectedDevice && (
          <Card className="border-border/70">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Layers className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold">Front Panel Visualization</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                    · click any port
                  </span>
                  <ZabbixBadge zabbixPorts={zabbixPorts} loading={zabbixLoading} />
                  {dbTemplate && (
                    <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300">
                      TEMPLATE · {dbTemplate.vendor} {dbTemplate.model}
                    </span>
                  )}
                </div>
                {!dbTemplate?.image_filename && (
                  <div className="inline-flex rounded-md border border-border/60 p-0.5 bg-muted/40">
                    <button
                      onClick={() => setSide('front')}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded-[5px] transition-colors flex items-center gap-1',
                        side === 'front' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                      data-testid="panel-side-front"
                    >
                      <PanelTop className="w-3.5 h-3.5" /> Front
                    </button>
                    <button
                      onClick={() => setSide('rear')}
                      disabled={!template?.rear?.items?.length}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded-[5px] transition-colors flex items-center gap-1',
                        side === 'rear' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                        !template?.rear?.items?.length && 'opacity-40 cursor-not-allowed',
                      )}
                      data-testid="panel-side-rear"
                    >
                      <PanelBottom className="w-3.5 h-3.5" /> Rear
                    </button>
                  </div>
                )}
              </div>

              {dbTemplate?.image_filename ? (
                <DevicePanelImage
                  template={dbTemplate}
                  imageUrl={`${BACKEND}/api/device-templates/${dbTemplate.id}/image?t=${dbTemplate.updated_at}`}
                  portStates={portStates}
                  selectedPortId={selectedPort?.port?.id}
                  onPortClick={(port, state) => setSelectedPort({ port, state })}
                  lastSyncAt={zabbixPorts?.last_update}
                  onRefreshNow={manualRefresh}
                  autoRefresh
                />
              ) : (
                <>
                  {!dbTemplateLoading && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[12px] text-amber-200 flex items-start gap-2" data-testid="no-template-banner">
                      <ImageOff className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-semibold">Device ini belum memiliki template visualisasi PNG</div>
                        <div className="opacity-80 mt-0.5">Zabbix monitoring, port status, dan graph tetap berjalan normal. Untuk tampilan panel realistis, upload PNG di menu berikut.</div>
                      </div>
                      <NavLink
                        to="/settings/device-templates"
                        className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-amber-500/40 hover:bg-amber-500/10 inline-flex items-center gap-1"
                      >
                        Template Manager <ArrowRight className="w-3 h-3" />
                      </NavLink>
                    </div>
                  )}
                  <DeviceFrontPanel
                    template={template}
                    portStates={portStates}
                    selectedPortId={selectedPort?.port?.id}
                    side={side}
                    onPortClick={(port, state) => setSelectedPort({ port, state })}
                  />
                </>
              )}

              <PortStats
                portStates={portStates}
                totalPorts={dbTemplate?.image_filename ? (dbTemplate.ports?.length || 0) : countPorts(template, side)}
              />
            </CardContent>
          </Card>
        )}

        {/* --- Section 3B: Zabbix Graph History ---------------------- */}
        {selectedDevice && (
          <ZabbixGraphPanel deviceId={selectedDevice.id} />
        )}
      </div>

      {/* --- Section 4: Port Detail (right sheet) ------------------------ */}
      <PortDetailSheet
        open={!!selectedPort}
        onOpenChange={(o) => !o && setSelectedPort(null)}
        port={selectedPort?.port}
        state={selectedPort?.state}
        device={selectedDevice}
        onNavigateToDevice={handleNavigateToDevice}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function countPorts(template, side) {
  const panel = side === 'rear' ? template.rear : template.front;
  if (!panel) return 0;
  const rows = panel.rows || (panel.items ? [{ ports: panel.items }] : []);
  return rows.reduce((acc, r) => acc + (r.ports?.length || 0), 0);
}

function PortStats({ portStates, totalPorts }) {
  const counts = {};
  Object.values(portStates).forEach((s) => {
    const k = s.status || 'Unused';
    counts[k] = (counts[k] || 0) + 1;
  });
  const unused = Math.max(0, totalPorts - Object.values(counts).reduce((a, b) => a + b, 0));
  if (unused > 0) counts.Unused = (counts.Unused || 0) + unused;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-muted-foreground pt-2 border-t border-border/40">
      <span className="uppercase tracking-widest text-[9px]">Utilization:</span>
      {Object.entries(counts).map(([k, v]) => (
        <span key={k} className="px-2 py-0.5 rounded-md border border-border/60 bg-background">
          {k}: <span className="text-foreground font-semibold">{v}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * buildPortStates
 * ---------------
 * Layer priority (highest → lowest):
 *   1. Zabbix telemetry (live oper_status, admin_status, speed, RX/TX).
 *   2. Manual `device.ports_state[portId]` overrides.
 *   3. Interconnection-derived state (cable connections).
 *   4. Default 'Unused'.
 *
 * Zabbix is the single monitoring source (see /api/zabbix/device/{id}/ports-status).
 * Cable info is preserved even when a link reports down.
 */
function buildPortStates(device, portList, interconnects, allDevices, customerMap, zabbixPorts) {
  const state = { ...(device.ports_state || {}) };

  // helper to normalise for match
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s_-]/g, '');

  // --- Layer C: interconnections ---
  interconnects.forEach((ic) => {
    let matchedPort = null;
    let connectedDeviceName = null;
    let connectedPort = null;
    let connectedDeviceId = null;

    if (ic.source_device && norm(ic.source_device) === norm(device.name)) {
      matchedPort = findPort(portList, ic.source_port);
      connectedDeviceName = ic.dest_device || '—';
      connectedPort = ic.dest_port;
      const target = allDevices.find((d) => norm(d.name) === norm(ic.dest_device));
      if (target) connectedDeviceId = target.id;
    } else if (ic.dest_device && norm(ic.dest_device) === norm(device.name)) {
      matchedPort = findPort(portList, ic.dest_port);
      connectedDeviceName = ic.source_device || '—';
      connectedPort = ic.source_port;
      const target = allDevices.find((d) => norm(d.name) === norm(ic.source_device));
      if (target) connectedDeviceId = target.id;
    }

    if (matchedPort) {
      const status = deriveStatus(ic, device);
      state[matchedPort.id] = {
        ...(state[matchedPort.id] || {}),
        status,
        connection_type: ic.connection_type || undefined,
        connected_device: connectedDeviceName,
        connected_port: connectedPort,
        connected_device_id: connectedDeviceId,
        cable_id: ic.cable_id || undefined,
        cable_label: ic.cable_label || ic.cable_id || undefined,
        cable_color: ic.cable_color || undefined,
        cable_length: ic.cable_length || undefined,
        install_date: ic.install_date || undefined,
        source_type: ic.source_type || 'device',
        dest_type: ic.dest_type || 'device',
        interconnection_id: ic.id,
        description: ic.description || (state[matchedPort.id]?.description) || undefined,
        customer: customerMap[device.customer_id] || undefined,
        service: device.service || undefined,
      };
    }
  });

  // --- Layer A: Zabbix telemetry — override oper_status/speed/traffic ---
  if (zabbixPorts?.ports && typeof zabbixPorts.ports === 'object') {
    Object.entries(zabbixPorts.ports).forEach(([ifname, zp]) => {
      if (!zp || !zp.matched) return;
      const matched = portList.find((p) => p.id === ifname) || findPort(portList, ifname);
      if (!matched) return;
      const existing = state[matched.id] || {};
      const oper = zp.oper_status?.value;   // "up"/"down"/"unknown"/"stale"...
      const admin = zp.admin_status?.value;
      const isStale = !!zp.oper_status?.stale;
      // Visual status derivation — never render "down" when data is stale
      let zStatus;
      if (isStale || oper === 'unknown') {
        zStatus = existing.status && ['Backbone', 'Trunk', 'Customer', 'Reserved'].includes(existing.status)
          ? existing.status
          : (existing.connected_device ? existing.status || 'Unused' : 'Unused');
      } else if (admin === 'down') {
        zStatus = 'Disabled';
      } else if (oper === 'up') {
        if (existing.status && ['Backbone', 'Trunk', 'Customer'].includes(existing.status)) {
          zStatus = existing.status;
        } else {
          zStatus = 'Link Up';
        }
      } else if (oper === 'down') {
        zStatus = existing.connected_device ? 'Error' : 'Unused';
      } else {
        zStatus = existing.status || 'Unused';
      }
      state[matched.id] = {
        ...existing,
        status: zStatus,
        zabbix: {
          if_name: zp.if_name || ifname,
          admin_status: admin,
          oper_status: oper,
          stale: isStale,
          speed_mbps: zp.speed?.value_mbps ?? null,
          rx_bps: zp.rx?.value ?? null,
          tx_bps: zp.tx?.value ?? null,
          last_update: zp.last_update || zabbixPorts.last_update,
          item_ids: zp.item_ids || {},
        },
      };
    });
  }

  return state;
}

export function findPort(portList, hint) {
  if (!hint) return null;
  const raw = String(hint).trim();

  // 1. Exact match with all separators stripped (space, dash, underscore, equals)
  const stripped = raw.toLowerCase().replace(/[\s_\-=]/g, '');
  for (const pt of portList) {
    const pidS = String(pt.id).toLowerCase().replace(/[\s_\-=]/g, '');
    if (stripped === pidS) return pt;
    const plS = String(pt.label).toLowerCase().replace(/[\s_\-=]/g, '');
    if (stripped === plS) return pt;
  }

  // 2. Slash format (Huawei/Cisco): "<Prefix><chassis>/<slot>/<port>"
  //    e.g. "100GE1/0/24", "10GE1/0/10". LAST numeric segment = physical port.
  const slash = raw.match(/^(\d*[A-Za-z][A-Za-z0-9]*?)\s*(\d+)\/(\d+)(?:\/(\d+))?$/);
  if (slash) {
    const ifPrefix = slash[1].toLowerCase().replace(/[\s_\-=]/g, '');
    const ifPort = slash[4] || slash[3];
    for (const pt of portList) {
      const pn = String(pt.id).toLowerCase().replace(/[\s_\-=]/g, '');
      const s = pn.match(/^(\d*[a-z][a-z0-9]*?)(\d+)$/);
      if (!s) continue;
      if (s[1] === ifPrefix && (s[2] === ifPort || String(pt.number) === ifPort)) return pt;
    }
  }

  // 3. Prefix-boundary match (MikroTik dash + user-renamed interfaces).
  //    RouterOS lets users append custom suffixes to interface names such as
  //    "sfp-sfpplus1-j2-apjii", "sfp-sfpplus2 - 99teck - Rajegnet",
  //    "sfp-sfpplus24=trunk_bangka", "qsfpplus1-1..4" (sub-lanes).
  //    Strategy: try LONGEST port id first as a prefix of the hint, boundary
  //    = end-of-string OR non-digit char (prevents "sfp-sfpplus1" swallowing
  //    "sfp-sfpplus10-...").
  const normHint = raw.toLowerCase().replace(/[\s_=]/g, '-');
  const sorted = [...portList].sort((a, b) => String(b.id).length - String(a.id).length);
  for (const pt of sorted) {
    const pid = String(pt.id).toLowerCase().replace(/[\s_=]/g, '-');
    if (normHint.startsWith(pid)) {
      const next = normHint[pid.length];
      if (!next || !/[0-9]/.test(next)) return pt;
    }
  }
  // Second pass with all separators stripped — handles "sfpplus1" alias for "sfp-sfpplus1"
  for (const pt of sorted) {
    const pid = String(pt.id).toLowerCase().replace(/[\s_\-=]/g, '');
    if (stripped.startsWith(pid)) {
      const next = stripped[pid.length];
      if (!next || !/[0-9]/.test(next)) return pt;
    }
  }

  // Third pass with common vendor-prefix aliases applied to the port id.
  // Handles the case where RouterOS names ports as "sfpplus1" or "sfp+1"
  // (older/short form) but the device template declares them as "sfp-sfpplus1"
  // (canonical long form). Also covers reverse cases.
  const PREFIX_ALIASES = [
    // [pattern, replacement] — applied to normalized+stripped port id before comparing
    [/^sfpsfpplus/, 'sfpplus'],   // template "sfp-sfpplus" ↔ SNMP "sfpplus"
    [/^sfpsfp/, 'sfp'],           // template "sfp-sfp"    ↔ SNMP "sfp"
    [/^qsfpqsfp/, 'qsfp'],        // template "qsfp-qsfp"  ↔ SNMP "qsfp"
    [/^tengige/, 'te'],           // "TenGigE" ↔ "te"
    [/^gigabitethernet/, 'ge'],   // "GigabitEthernet" ↔ "ge"
  ];
  for (const pt of sorted) {
    let pid = String(pt.id).toLowerCase().replace(/[\s_\-=]/g, '');
    let changed = false;
    for (const [re, rep] of PREFIX_ALIASES) {
      if (re.test(pid)) { pid = pid.replace(re, rep); changed = true; break; }
    }
    if (!changed) continue;
    if (stripped.startsWith(pid)) {
      const next = stripped[pid.length];
      if (!next || !/[0-9]/.test(next)) return pt;
    }
  }

  // 4. Very last resort: trailing digits only (first match wins)
  const num = raw.match(/(\d+)\s*$/);
  if (num) {
    const p = portList.find((pt) => String(pt.number) === num[1] || String(pt.label) === num[1]);
    if (p) return p;
  }
  return null;
}


function deriveStatus(ic, device) {
  const status = String(ic.status || 'Active').toLowerCase();
  if (status === 'planned') return 'Reserved';
  if (status === 'maintenance') return 'Reserved';
  if (status === 'retired') return 'Disabled';
  // customer-attached device → Customer link
  if (device.customer_id) return 'Customer';
  // by type
  const ct = String(ic.connection_type || '').toLowerCase();
  if (ct.includes('backbone')) return 'Backbone';
  if (ct.includes('trunk')) return 'Trunk';
  return 'Link Up';
}

function ZabbixBadge({ zabbixPorts, loading }) {
  // Not configured — device has no zabbix_host or Zabbix returned configured=false
  if (!zabbixPorts || zabbixPorts.error) {
    return (
      <span
        className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-300 bg-rose-500/10"
        title={zabbixPorts?.reason || 'Zabbix tidak dapat diakses'}
        data-testid="badge-zabbix-error"
      >
        Zabbix: unreachable
      </span>
    );
  }
  if (zabbixPorts.configured === false) {
    return (
      <span
        className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground bg-muted/40"
        title="Device belum di-set Zabbix Host"
        data-testid="badge-zabbix-off"
      >
        Zabbix: off
      </span>
    );
  }
  if (loading && !zabbixPorts.last_update) {
    return (
      <span
        className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground bg-muted/40"
        data-testid="badge-zabbix-syncing"
      >
        Zabbix: syncing…
      </span>
    );
  }
  if (zabbixPorts.matched === false) {
    return (
      <span
        className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300 bg-amber-500/10"
        title={zabbixPorts.reason || 'Host Zabbix tidak ditemukan'}
        data-testid="badge-zabbix-nohost"
      >
        Zabbix: no host
      </span>
    );
  }
  const matchedCount = Object.values(zabbixPorts.ports || {}).filter((p) => p?.matched).length;
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-300 bg-emerald-500/10 inline-flex items-center gap-1"
      title={`Live from Zabbix · ${zabbixPorts.host || ''} · ${new Date(zabbixPorts.last_update || Date.now()).toLocaleString()}`}
      data-testid="badge-zabbix-live"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Zabbix: live
      {matchedCount > 0 ? <span className="text-emerald-400/80"> · {matchedCount} if</span> : null}
    </span>
  );
}
