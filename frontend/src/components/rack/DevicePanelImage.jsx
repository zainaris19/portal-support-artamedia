import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ZoomIn, ZoomOut, Maximize2, Minimize2, RefreshCw, Search, Filter, X,
} from 'lucide-react';
import { PORT_STATUS_COLORS } from '@/lib/deviceTemplates';

/**
 * DevicePanelImage — PNG-based front panel renderer.
 *
 * Draws the front-panel PNG (from Device Template Engine) and overlays each
 * port as a positioned <div> using **percentage-based** coordinates so the
 * overlay follows the image at every zoom/screen size.
 *
 * Props:
 *   template        — { id, image_filename, ports:[{id,label,type,x%,y%,width%,height%,...}] }
 *   imageUrl        — url of the PNG (e.g. /api/device-templates/<id>/image)
 *   portStates      — { [portId]: {status, ...} }  — live state map
 *   selectedPortId  — currently-highlighted port
 *   onPortClick(port, state)
 *   onPortHover(port, state|null) — optional
 *   lastSyncAt      — string/Date for the "last sync" indicator
 *   onRefreshNow    — callback for the "refresh now" button
 *   autoRefresh     — bool (indicator only; timer lives in parent)
 */
function DevicePanelImage({
  template,
  imageUrl,
  portStates = {},
  selectedPortId,
  onPortClick,
  onPortHover,
  lastSyncAt,
  onRefreshNow,
  autoRefresh = true,
}) {
  const wrapperRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [hoveredPort, setHoveredPort] = useState(null); // { port, state, coords }

  const ports = template?.ports || [];

  // Search + filter
  const filteredIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return new Set(
      ports
        .filter((p) => {
          const st = portStates[p.id];
          const status = st?.status || 'Unused';
          if (statusFilter && status !== statusFilter) return false;
          if (!q) return true;
          const hay = `${p.id} ${p.label} ${p.if_name_hint || ''} ${st?.description || ''} ${st?.zabbix?.if_name || ''}`.toLowerCase();
          return hay.includes(q);
        })
        .map((p) => p.id),
    );
  }, [ports, portStates, search, statusFilter]);

  const zoomIn = () => setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)));
  const zoomOut = () => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)));
  const fitToScreen = () => setScale(1);

  // Fullscreen
  const toggleFullscreen = useCallback(async () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const showTooltip = (port, state, e) => {
    if (!e) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredPort({
      port,
      state,
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top + 12,
    });
    onPortHover?.(port, state);
  };
  const hideTooltip = () => {
    setHoveredPort(null);
    onPortHover?.(null);
  };

  const lastSyncLabel = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString()
    : '—';

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'rounded-xl border border-border/70 bg-gradient-to-b from-slate-900/60 to-slate-950/80 overflow-hidden',
        isFullscreen && 'p-8',
      )}
      data-testid="device-panel-image"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/60 bg-slate-900/60">
        {/* Zoom controls */}
        <div className="inline-flex rounded-md border border-border/60 bg-background/50">
          <ToolBtn onClick={zoomOut} title="Zoom out" testId="btn-zoom-out">
            <ZoomOut className="w-3.5 h-3.5" />
          </ToolBtn>
          <button
            className="text-[11px] font-mono px-2 min-w-[52px] hover:bg-accent border-l border-r border-border/60"
            onClick={fitToScreen}
            data-testid="btn-fit-screen"
            title="Fit to screen"
          >
            {Math.round(scale * 100)}%
          </button>
          <ToolBtn onClick={zoomIn} title="Zoom in" testId="btn-zoom-in">
            <ZoomIn className="w-3.5 h-3.5" />
          </ToolBtn>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search interface…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-[12px] pl-7 pr-2 py-1.5 rounded-md border border-border/60 bg-background/40 w-40 focus:outline-none focus:ring-1 focus:ring-primary/60"
            data-testid="input-port-search"
          />
        </div>

        {/* Status filter */}
        <div className="inline-flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-[12px] px-1.5 py-1.5 rounded-md border border-border/60 bg-background/40 focus:outline-none focus:ring-1 focus:ring-primary/60"
            data-testid="select-status-filter"
          >
            <option value="">All status</option>
            {Object.keys(PORT_STATUS_COLORS).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          {statusFilter && (
            <button
              onClick={() => setStatusFilter('')}
              className="text-muted-foreground hover:text-foreground"
              title="Clear filter"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Refresh + last sync + auto-refresh */}
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <div
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border',
              autoRefresh
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-border/60 text-muted-foreground',
            )}
            title={autoRefresh ? 'Auto-refresh every 30s' : 'Auto-refresh paused'}
          >
            <span className={cn(
              'w-1.5 h-1.5 rounded-full',
              autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground',
            )} />
            {autoRefresh ? 'AUTO 30s' : 'MANUAL'}
          </div>
          <span className="text-muted-foreground">
            last sync <span className="text-foreground">{lastSyncLabel}</span>
          </span>
          {onRefreshNow && (
            <ToolBtn onClick={onRefreshNow} title="Refresh now" testId="btn-refresh-now">
              <RefreshCw className="w-3.5 h-3.5" />
            </ToolBtn>
          )}
          <ToolBtn onClick={toggleFullscreen} title="Fullscreen" testId="btn-fullscreen">
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </ToolBtn>
        </div>
      </div>

      {/* Image + overlay */}
      <div
        className="relative overflow-auto bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.5)_0%,rgba(2,6,23,0.9)_100%)]"
        style={{ maxHeight: isFullscreen ? '75vh' : 400 }}
      >
        <div
          className="relative inline-block origin-top-left transition-transform duration-100"
          style={{ transform: `scale(${scale})` }}
        >
          <img
            src={imageUrl}
            alt={`${template?.vendor} ${template?.model} front panel`}
            className="block max-w-none select-none pointer-events-none"
            style={{ minWidth: 900 }}
            draggable={false}
            data-testid="device-panel-png"
          />

          {/* Port overlays */}
          {ports.map((port) => {
            const state = portStates[port.id];
            const status = state?.status || 'Unused';
            const colors = PORT_STATUS_COLORS[status] || PORT_STATUS_COLORS.Unused;
            const selected = selectedPortId === port.id;
            const dimmed = (search || statusFilter) && !filteredIds.has(port.id);
            const isActive = status === 'Link Up' || status === 'Backbone' || status === 'Trunk' || status === 'Customer';
            const isError = status === 'Error';
            return (
              <button
                key={port.id}
                type="button"
                onClick={() => onPortClick?.(port, state)}
                onMouseEnter={(e) => showTooltip(port, state, e)}
                onMouseMove={(e) => showTooltip(port, state, e)}
                onMouseLeave={hideTooltip}
                onFocus={(e) => showTooltip(port, state, e)}
                onBlur={hideTooltip}
                data-testid={`png-port-${port.id}`}
                aria-label={`${port.label} — ${status}`}
                className={cn(
                  'absolute rounded-[2px] cursor-pointer transition-all duration-150 focus:outline-none',
                  'ring-offset-1',
                  selected && 'ring-2 ring-sky-400 shadow-[0_0_16px_2px_rgba(56,189,248,0.6)] z-20',
                  dimmed && 'opacity-25',
                )}
                style={{
                  left: `${port.x}%`,
                  top: `${port.y}%`,
                  width: `${port.width}%`,
                  height: `${port.height}%`,
                  background: `linear-gradient(135deg, ${colors.fill}dd 0%, ${colors.fill}88 100%)`,
                  boxShadow: isError
                    ? `0 0 0 1px ${colors.ring}, 0 0 10px 1px ${colors.fill}cc`
                    : `0 0 0 1px ${colors.ring}, inset 0 0 4px rgba(0,0,0,0.35)`,
                  mixBlendMode: 'screen',
                  animation: isActive ? 'portGlow 2.4s ease-in-out infinite' : isError ? 'portError 0.8s ease-in-out infinite' : undefined,
                }}
              />
            );
          })}
        </div>

        {/* Floating tooltip */}
        {hoveredPort && (
          <div
            className="pointer-events-none absolute z-50 min-w-[240px] max-w-[320px] rounded-md border border-border/70 bg-slate-950/95 backdrop-blur p-2.5 shadow-xl"
            style={{ left: hoveredPort.x, top: hoveredPort.y }}
          >
            <PortTooltip port={hoveredPort.port} state={hoveredPort.state} />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-3 py-2 border-t border-border/60 bg-slate-900/40 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground">
        {Object.entries(PORT_STATUS_COLORS).map(([k, v]) => (
          <span
            key={k}
            className={cn(
              'flex items-center gap-1 cursor-pointer hover:text-foreground',
              statusFilter === k && 'text-foreground',
            )}
            onClick={() => setStatusFilter(statusFilter === k ? '' : k)}
          >
            <span
              className="w-2.5 h-2.5 rounded-sm border"
              style={{ background: v.fill, borderColor: v.ring }}
            />
            {v.label}
          </span>
        ))}
      </div>

      {/* CSS-only animations */}
      <style>{`
        @keyframes portGlow {
          0%,100% { filter: brightness(1); }
          50% { filter: brightness(1.4); }
        }
        @keyframes portError {
          0%,100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function ToolBtn({ children, onClick, title, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-testid={testId}
      className="px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {children}
    </button>
  );
}

function PortTooltip({ port, state }) {
  const status = state?.status || 'Unused';
  const colors = PORT_STATUS_COLORS[status] || PORT_STATUS_COLORS.Unused;
  const zbx = state?.zabbix;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm truncate" data-testid={`tooltip-port-id-${port.id}`}>{port.id}</div>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
          style={{ borderColor: colors.ring, background: `${colors.fill}22`, color: colors.fill }}
        >
          {status}
        </span>
      </div>
      <KV k="Interface" v={port.label} />
      {zbx?.if_name && <KV k="If Name" v={<span data-testid={`tooltip-if-name-${port.id}`}>{zbx.if_name}</span>} />}
      {state?.description && <KV k="Description" v={state.description} />}
      {zbx && (
        <>
          <KV k="Admin" v={<span data-testid={`tooltip-admin-${port.id}`}>{zbx.admin_status || 'unknown'}</span>} />
          <KV k="Oper" v={<span data-testid={`tooltip-oper-${port.id}`}>{zbx.stale ? 'stale' : (zbx.oper_status || 'unknown')}</span>} />
          <KV k="Speed" v={<span data-testid={`tooltip-speed-${port.id}`}>{zbx.speed_mbps != null ? `${Math.round(zbx.speed_mbps)} Mbps` : '—'}</span>} />
          <KV k="RX" v={fmtBps(zbx.rx_bps)} />
          <KV k="TX" v={fmtBps(zbx.tx_bps)} />
          {zbx.last_update && <KV k="Last Update" v={new Date(zbx.last_update).toLocaleTimeString()} />}
        </>
      )}
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground font-mono uppercase tracking-wider text-[9px]">{k}</span>
      <span className="text-foreground font-mono truncate max-w-[180px]">{v || '—'}</span>
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

export default memo(DevicePanelImage);
