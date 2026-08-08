import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { renderToStaticMarkup } from 'react-dom/server';
import { Building2, Server, Radio as RadioIcon, Cable, Wifi, ArrowLeftRight, Antenna } from 'lucide-react';

// Marker icon per site type
const SITE_STYLE = {
  datacenter: { color: '#2563eb', Icon: Building2, label: 'Data Center' },
  pop: { color: '#7c3aed', Icon: Antenna, label: 'POP' },
  tower: { color: '#f59e0b', Icon: RadioIcon, label: 'BTS/Tower' },
  outdoor_pole: { color: '#f59e0b', Icon: RadioIcon, label: 'Pole' },
  customer_site: { color: '#10b981', Icon: Server, label: 'Customer Site' },
  office: { color: '#64748b', Icon: Building2, label: 'Office' },
};

// Connection style per type — sesuai spek user
const CONN_STYLE = {
  'Fiber Optic': { color: '#22c55e', dashArray: null, weight: 3, kind: 'solid', legend: 'Fiber · Solid Green' },
  'Fiber Optic Artamedia': { color: '#22c55e', dashArray: null, weight: 3, kind: 'solid', legend: 'Fiber · Solid Green' },
  'Wireless': { color: '#f97316', dashArray: '10 6', weight: 3, kind: 'dashed', legend: 'Wireless · Dashed Orange' },
  'Wireless BTS to BTS': { color: '#f97316', dashArray: '10 6', weight: 3, kind: 'dashed', legend: 'Wireless · Dashed Orange' },
  'Tunnel': { color: '#a855f7', dashArray: '2 5', weight: 3, kind: 'dotted', legend: 'Tunnel · Purple Dotted' },
  'Metro Ethernet': { color: '#2563eb', dashArray: null, weight: 5, kind: 'double', legend: 'Metro Ethernet · Double Blue' },
  'Metro Ethernet Mitra': { color: '#2563eb', dashArray: null, weight: 5, kind: 'double', legend: 'Metro Ethernet · Double Blue' },
  'Cross Connect': { color: '#64748b', dashArray: null, weight: 2, kind: 'solid', legend: 'Cross Connect · Gray' },
  'Dedicated Internet': { color: '#0ea5e9', dashArray: null, weight: 3, kind: 'solid', legend: 'Dedicated · Sky' },
  'Broadband': { color: '#06b6d4', dashArray: null, weight: 2, kind: 'solid', legend: 'Broadband · Cyan' },
};

const DEFAULT_CONN_STYLE = { color: '#64748b', dashArray: null, weight: 2, kind: 'solid', legend: 'Other' };

export function getConnStyle(type) {
  return CONN_STYLE[type] || DEFAULT_CONN_STYLE;
}
export function getSiteStyle(type) {
  return SITE_STYLE[type] || SITE_STYLE.office;
}

function makeSiteIcon(type, selected) {
  const s = getSiteStyle(type);
  const html = renderToStaticMarkup(
    <div style={{
      background: s.color, width: selected ? 34 : 28, height: selected ? 34 : 28,
      borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `3px solid ${selected ? '#fbbf24' : '#ffffff'}`,
      boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
    }}>
      <s.Icon size={selected ? 16 : 14} color="#fff" strokeWidth={2.5} />
    </div>
  );
  return L.divIcon({ html, className: 'site-marker', iconSize: [28, 28], iconAnchor: [14, 14] });
}

function FitBounds({ sites }) {
  const map = useMap();
  useEffect(() => {
    const withCoords = sites.filter((s) => s.latitude && s.longitude);
    if (!withCoords.length) { map.setView([-2.5, 118], 5); return; }
    if (withCoords.length === 1) { map.setView([withCoords[0].latitude, withCoords[0].longitude], 12); return; }
    const pts = withCoords.map((s) => [s.latitude, s.longitude]);
    map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 13 });
  }, [sites, map]);
  return null;
}

function ClickCatcher({ onMapClick, active }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const handler = (e) => onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    map.on('click', handler);
    return () => { map.off('click', handler); };
  }, [map, onMapClick, active]);
  return null;
}

// Disable ALL map interactions (drag / zoom / click / marker) while a modal is
// open — professional GIS behavior: the map must be inert behind dialogs.
function InteractionLock({ disabled }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const controls = ['dragging', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom', 'keyboard', 'touchZoom', 'tap'];
    controls.forEach((c) => {
      const h = map[c];
      if (h && typeof h.disable === 'function' && typeof h.enable === 'function') {
        disabled ? h.disable() : h.enable();
      }
    });
  }, [map, disabled]);
  return null;
}

// Auto-invalidate map size whenever its container size changes
// (fixes broken tiles when the side panel opens/closes)
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    const ro = new ResizeObserver(() => {
      // small delay so flex reflow completes before Leaflet re-measures
      setTimeout(() => map.invalidateSize(), 0);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/**
 * NetworkMap — Simple GIS-based map for Site → Device → Connection.
 * Users only see markers + colored lines. No drawing, no palette.
 */
export default function NetworkMap({
  sites = [],
  connections = [],
  onSiteClick,
  onConnectionClick,
  selectedSiteId,
  selectedConnectionId,
  pickCoords = false,
  onCoordsPick,
  onCancelPick,
  interactionsDisabled = false,
}) {
  const withCoords = useMemo(() => sites.filter((s) => s.latitude && s.longitude), [sites]);
  const siteById = useMemo(() => Object.fromEntries(sites.map((s) => [s.id, s])), [sites]);

  return (
    <div className={`w-full topology-light-scope relative${pickCoords ? ' picking' : ''}`} style={{ height: '100%', minHeight: 500 }}>
      <MapContainer
        center={[-2.5, 118]}
        zoom={5}
        style={{ width: '100%', height: '100%', background: '#f8fafc', cursor: pickCoords ? 'crosshair' : '' }}
        scrollWheelZoom
        preferCanvas
        whenReady={(e) => {
          const m = e.target;
          setTimeout(() => m.invalidateSize(), 100);
          setTimeout(() => m.invalidateSize(), 500);
        }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap · CARTO'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <FitBounds sites={withCoords} />
        <ClickCatcher onMapClick={onCoordsPick} active={pickCoords && !interactionsDisabled} />
        <InteractionLock disabled={interactionsDisabled} />
        <MapResizer />

        {/* Connections first (below markers) */}
        {connections.map((c) => {
          const a = siteById[c.source_site_id];
          const b = siteById[c.dest_site_id];
          if (!a || !b || !a.latitude || !b.latitude) return null;
          const style = getConnStyle(c.link_type);
          const isSelected = selectedConnectionId === c.id;
          if (style.kind === 'double') {
            // Render 2 parallel lines slightly offset for Metro Ethernet "double blue" effect
            return (
              <React.Fragment key={c.id}>
                <Polyline positions={[[a.latitude, a.longitude], [b.latitude, b.longitude]]}
                  pathOptions={{ color: style.color, weight: isSelected ? 6 : 5, opacity: 1 }}
                  eventHandlers={{ click: () => !interactionsDisabled && onConnectionClick?.(c) }}>
                  <Tooltip sticky>{c.link_type}{c.description ? ` · ${c.description}` : ''}</Tooltip>
                </Polyline>
                <Polyline positions={[[a.latitude, a.longitude], [b.latitude, b.longitude]]}
                  pathOptions={{ color: '#ffffff', weight: 1.5, opacity: 1 }} />
              </React.Fragment>
            );
          }
          return (
            <Polyline
              key={c.id}
              positions={[[a.latitude, a.longitude], [b.latitude, b.longitude]]}
              pathOptions={{
                color: style.color, weight: isSelected ? style.weight + 2 : style.weight,
                dashArray: style.dashArray || undefined,
                opacity: isSelected ? 1 : 0.85, lineCap: 'round',
              }}
              eventHandlers={{ click: () => !interactionsDisabled && onConnectionClick?.(c) }}
            >
              <Tooltip sticky>{c.link_type}{c.description ? ` · ${c.description}` : ''}</Tooltip>
            </Polyline>
          );
        })}

        {/* Site markers */}
        {withCoords.map((s) => (
          <Marker
            key={s.id}
            position={[s.latitude, s.longitude]}
            icon={makeSiteIcon(s.type, selectedSiteId === s.id)}
            eventHandlers={{ click: () => !interactionsDisabled && onSiteClick?.(s) }}
          >
            <Tooltip>{s.name}</Tooltip>
          </Marker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-[500] rounded-md border border-slate-300 bg-white/95 backdrop-blur px-3 py-2 text-[11px] space-y-1 shadow" data-testid="map-legend">
        <div className="uppercase tracking-widest text-[9px] font-mono text-slate-500 mb-1">Site</div>
        {Object.entries(SITE_STYLE).slice(0, 4).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: v.color }} />
            <span className="text-slate-700">{v.label}</span>
          </div>
        ))}
        <div className="uppercase tracking-widest text-[9px] font-mono text-slate-500 mt-2 mb-1">Connection</div>
        <div className="flex items-center gap-2"><svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#22c55e" strokeWidth="3" /></svg><span>Fiber</span></div>
        <div className="flex items-center gap-2"><svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#f97316" strokeWidth="3" strokeDasharray="6 4" /></svg><span>Wireless</span></div>
        <div className="flex items-center gap-2"><svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#a855f7" strokeWidth="3" strokeDasharray="2 4" /></svg><span>Tunnel</span></div>
        <div className="flex items-center gap-2"><svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#2563eb" strokeWidth="4" /></svg><span>Metro Ethernet</span></div>
        <div className="flex items-center gap-2"><svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#64748b" strokeWidth="2" /></svg><span>Cross Connect</span></div>
      </div>

      {pickCoords && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow" data-testid="map-pick-hint">
          <span>Klik peta untuk menetapkan koordinat site</span>
          {onCancelPick && (
            <button onClick={onCancelPick} className="underline font-medium hover:text-amber-700" data-testid="map-pick-cancel">Batal</button>
          )}
        </div>
      )}

      {/* Interaction-blocking backdrop — guarantees the map is inert while a
          modal is open, even before the Radix overlay paints. */}
      {interactionsDisabled && (
        <div className="absolute inset-0 z-[450]" style={{ cursor: 'not-allowed', background: 'transparent' }} data-testid="map-interaction-block" />
      )}
    </div>
  );
}
