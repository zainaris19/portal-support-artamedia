import React, { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { PORT_STATUS_COLORS, INTERFACE_TYPES } from '@/lib/deviceTemplates';
import { cn } from '@/lib/utils';
import { ArrowRight, Cable, Zap } from 'lucide-react';
import PortTrafficChart from '@/components/rack/PortTrafficChart';
import api from '@/lib/api';

/**
 * PortDetailSheet
 * ---------------
 * Section 4 — right-slide port detail with clickable "Connected Device" so
 * the user can navigate from port → destination device (mimics NetBox cable
 * tracing).
 *
 * Props:
 *   open                  — bool
 *   onOpenChange(bool)    — closer
 *   port                  — template port object
 *   state                 — port state ({status, description, speed, ...})
 *   device                — current device
 *   onNavigateToDevice(deviceId) — parent navigates to connected device
 */
export default function PortDetailSheet({ open, onOpenChange, port, state, device, onNavigateToDevice }) {
  if (!port) return null;
  const status = state?.status || 'Unused';
  const colors = PORT_STATUS_COLORS[status] || PORT_STATUS_COLORS.Unused;
  const meta = INTERFACE_TYPES[port.type] || INTERFACE_TYPES.RJ45;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto p-0 flex flex-col">
        {/* Header with status color */}
        <div
          className="px-5 py-4 border-b border-border/60"
          style={{ background: `linear-gradient(135deg, ${colors.fill}22 0%, transparent 100%)` }}
        >
          <SheetHeader className="text-left">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm border shrink-0 animate-pulse"
                style={{ background: colors.fill, borderColor: colors.ring }}
              />
              <SheetTitle className="text-lg tracking-tight" style={{ fontFamily: 'Manrope' }}>
                {device?.name} · {port.label}
              </SheetTitle>
            </div>
            <SheetDescription className="text-xs font-mono">
              {port.id} · {meta.label} interface
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="p-5 space-y-4 flex-1">
          {/* Status badge */}
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Status</div>
            <span
              className="px-2.5 py-1 text-xs font-semibold rounded-md border"
              style={{ background: `${colors.fill}22`, borderColor: colors.ring, color: colors.fill }}
            >
              {status}
            </span>
          </div>

          <Grid>
            <KV k="Port Name" v={port.id} mono />
            <KV k="Label" v={port.label} mono />
            <KV k="Media Type" v={meta.label} />
            <KV k="Speed" v={state?.speed || speedFor(port.type)} mono />
            <KV k="Description" v={state?.description} full />
            <KV k="VLAN" v={state?.vlan} mono />
            <KV k="Connection Type" v={state?.connection_type} />
            <KV k="Customer" v={state?.customer} />
            <KV k="Service" v={state?.service} full />
          </Grid>

          {/* Connected device — clickable if we have a target id */}
          {(state?.connected_device || state?.connected_port) && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2" data-testid="port-cable-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                  <Cable className="w-3 h-3" /> Cable Connection
                </div>
                {state.cable_label && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border/60 bg-background">
                    {state.cable_label}
                  </span>
                )}
              </div>

              {/* Cable visualization strip */}
              <div className="flex items-center gap-2 rounded-md bg-slate-950/40 border border-border/60 px-2 py-2">
                <EndpointChip type={state.source_type || 'device'} label={device?.name} />
                <div className="flex-1 relative h-2 rounded-full overflow-hidden" data-testid="cable-strip"
                     style={{ background: cableHex(state.cable_color) }}
                     title={`${state.cable_color || 'no color'} · ${state.cable_length || '—'}`}>
                  <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-white/20 pointer-events-none" />
                </div>
                <EndpointChip type={state.dest_type || 'device'} label={state.connected_device} />
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1">
                <KV k="Media" v={state.connection_type} />
                <KV k="Length" v={state.cable_length} mono />
                <KV k="Color" v={<span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-border" style={{ background: cableHex(state.cable_color) }} />{state.cable_color || '—'}</span>} />
                <KV k="Install date" v={state.install_date} mono />
                <KV k="Cable ID" v={state.cable_id} mono />
                <KV k="Peer port" v={state.connected_port} mono />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Peer device</div>
                  <div className="text-sm font-semibold truncate">{state.connected_device || '—'}</div>
                </div>
                {state.connected_device_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigateToDevice?.(state.connected_device_id)}
                    data-testid="port-navigate-to-device"
                    className="shrink-0"
                  >
                    Explore <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                )}
              </div>
              {state.cable_id && !state.cable_label && (
                <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Cable ID: {state.cable_id}
                </div>
              )}
            </div>
          )}

          {state?.notes && (
            <div className="pt-3 border-t border-border/60">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Notes</div>
              <p className="text-sm whitespace-pre-wrap text-foreground/90">{state.notes}</p>
            </div>
          )}

          {/* Zabbix per-port traffic graph (below cable connection) */}
          {device?.id && port && (
            <PortTrafficChart deviceId={device.id} port={port} />
          )}

          {/* LIVE ZABBIX — oper/admin/speed/rx/tx from the same Zabbix host+iface as the graph */}
          {device?.id && port && (
            <LiveZabbixPanel deviceId={device.id} port={port} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --------------------------------------------------------------------------
// LiveZabbixPanel — single-source Zabbix live telemetry for the port.
// Guarantees the interface displayed here is exactly the same interface used
// by <PortTrafficChart /> (both call the backend with the same ifname/alt).
// --------------------------------------------------------------------------
function LiveZabbixPanel({ deviceId, port }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const ifname = port?.id;
  const alt = useMemo(() => {
    const set = new Set([port?.if_name_hint, port?.label, port?.id].filter(Boolean));
    return [...set].join(',');
  }, [port]);

  useEffect(() => {
    let alive = true;
    let timer = null;
    if (!deviceId || !ifname) return () => { alive = false; };
    const fetchOnce = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: d } = await api.get(`/zabbix/device/${deviceId}/port-status`, {
          params: { ifname, alt, polling_interval: 60 },
        });
        if (alive) setData(d);
      } catch (e) {
        if (alive) setError(e.response?.data?.detail || e.message || 'Zabbix unavailable');
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchOnce();
    timer = setInterval(fetchOnce, 30000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [deviceId, ifname, alt]);

  const oper = data?.oper_status?.value;
  const admin = data?.admin_status?.value;
  const operStale = data?.oper_status?.stale;

  const operColor =
    !oper || oper === 'unknown' || operStale ? 'text-slate-300'
      : oper === 'up' ? 'text-emerald-300'
      : oper === 'dormant' || oper === 'testing' ? 'text-amber-300'
      : 'text-rose-300';
  const adminColor = admin === 'up' ? 'text-emerald-300' : admin === 'down' ? 'text-rose-300' : 'text-slate-300';

  const notMatched = data && data.configured === false;
  const hostMissing = data && data.configured && data.matched === false;

  return (
    <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2" data-testid="port-live-zabbix-card">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest font-mono text-emerald-300 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Zabbix
        </div>
        <span className="text-[10px] font-mono text-muted-foreground" data-testid="live-zabbix-last-update">
          {loading && !data ? 'loading…'
            : data?.last_update ? new Date(data.last_update).toLocaleTimeString()
            : '—'}
        </span>
      </div>

      {error && (
        <div className="text-[11px] text-rose-300 font-mono">{error}</div>
      )}
      {!error && notMatched && (
        <div className="text-[11px] text-muted-foreground">
          Device belum di-set <span className="font-mono">Zabbix Host</span>.
        </div>
      )}
      {!error && hostMissing && (
        <div className="text-[11px] text-muted-foreground">
          Host tidak ditemukan di Zabbix ({data?.reason || 'unknown'}).
        </div>
      )}

      {!error && data?.matched && (
        <Grid>
          <KV
            k="Oper Status"
            v={<span className={cn('font-semibold', operColor)} data-testid="live-oper-status">
              {operStale ? 'stale' : (oper || 'unknown')}
            </span>}
          />
          <KV
            k="Admin Status"
            v={<span className={cn('font-semibold', adminColor)} data-testid="live-admin-status">
              {data?.admin_status?.stale ? 'stale' : (admin || 'unknown')}
            </span>}
          />
          <KV
            k="Live Speed"
            v={<span data-testid="live-speed">
              {data?.speed?.value_mbps != null ? `${Math.round(data.speed.value_mbps)} Mbps` : '—'}
            </span>}
            mono
          />
          <KV k="If Name" v={<span data-testid="live-if-name">{data?.if_name || ifname}</span>} mono />
          <KV k="In Traffic" v={<span data-testid="live-in-traffic">{fmtBps(data?.rx?.value)}</span>} mono />
          <KV k="Out Traffic" v={<span data-testid="live-out-traffic">{fmtBps(data?.tx?.value)}</span>} mono />
        </Grid>
      )}
      <div className="text-[9px] font-mono text-muted-foreground/70 pt-1 border-t border-emerald-500/20 flex items-center justify-between">
        <span>source: zabbix</span>
        {data?.host && <span className="truncate max-w-[60%]" title={data.host}>{data.host}</span>}
      </div>
    </div>
  );
}

function fmtBps(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs > 1e9) return `${(v / 1e9).toFixed(2)} Gbps`;
  if (abs > 1e6) return `${(v / 1e6).toFixed(2)} Mbps`;
  if (abs > 1e3) return `${(v / 1e3).toFixed(2)} Kbps`;
  return `${Number(v).toFixed(0)} bps`;
}

function speedFor(type) {
  switch (type) {
    case 'RJ45': return '1 Gbps';
    case 'SFP': return '1 Gbps';
    case 'SFP+': return '10 Gbps';
    case 'QSFP': return '40 Gbps';
    case 'QSFP28':
    case '100GE': return '100 Gbps';
    case 'CONSOLE': return 'RS-232';
    case 'MGMT': return '1 Gbps';
    case 'USB': return 'USB 2.0';
    default: return '—';
  }
}

const CABLE_HEX = {
  yellow: '#eab308', orange: '#f97316', aqua: '#22d3ee',
  blue: '#3b82f6', red: '#ef4444', green: '#10b981',
  gray: '#94a3b8', black: '#0f172a', white: '#f8fafc', violet: '#a855f7',
};
function cableHex(color) {
  return CABLE_HEX[String(color || '').toLowerCase()] || '#64748b';
}

const ENDPOINT_STYLE = {
  device: { label: 'Device', cls: 'bg-blue-500/20 text-blue-200 border-blue-500/40' },
  patch_panel: { label: 'PP', cls: 'bg-sky-500/20 text-sky-200 border-sky-500/40' },
  odf: { label: 'ODF', cls: 'bg-amber-500/20 text-amber-200 border-amber-500/40' },
  cross_connect: { label: 'XC', cls: 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40' },
  partner_rack: { label: 'Partner', cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' },
};

function EndpointChip({ type, label }) {
  const s = ENDPOINT_STYLE[type] || ENDPOINT_STYLE.device;
  return (
    <div className={cn('flex flex-col items-center min-w-[70px] px-2 py-1 rounded-md border text-center', s.cls)}>
      <span className="text-[9px] font-mono uppercase tracking-widest">{s.label}</span>
      <span className="text-[10px] font-semibold truncate max-w-[80px]">{label || '—'}</span>
    </div>
  );
}

function Grid({ children }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-3">{children}</div>;
}
function KV({ k, v, mono, full }) {
  return (
    <div className={cn('min-w-0', full && 'col-span-2')}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{k}</div>
      <div className={cn('text-sm mt-0.5 truncate', mono && 'font-mono text-[13px]')}>{v || '—'}</div>
    </div>
  );
}
