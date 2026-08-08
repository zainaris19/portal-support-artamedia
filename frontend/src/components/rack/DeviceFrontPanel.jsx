import React, { memo, useMemo } from 'react';
import { INTERFACE_TYPES, PORT_STATUS_COLORS } from '@/lib/deviceTemplates';
import { cn } from '@/lib/utils';

/**
 * DeviceFrontPanel
 * ----------------
 * Pure-SVG front panel renderer driven by a device template.
 *
 * Props:
 *   template   — required. { vendor, model, front: { rows, accessories } }
 *   portStates — optional map { [portId]: { status, description?, speed?, ... } }
 *                Used to overlay live/DB state. Missing ports fall back to
 *                'Unused'. Future SNMP sync can hydrate this map without any
 *                UI changes.
 *   onPortClick(port, state) — click handler
 *   selectedPortId — highlight ring
 *   side       — 'front' (default) | 'rear' — toggles which side to render
 *   compact    — smaller port size for narrow layouts
 */
function DeviceFrontPanel({
  template,
  portStates = {},
  onPortClick,
  selectedPortId,
  side = 'front',
  compact = false,
}) {
  const panel = side === 'rear' ? template.rear : template.front;
  const rows = panel?.rows || (panel?.items ? [{ label: '', ports: panel.items }] : []);
  const accessories = template.front?.accessories || [];

  // Layout metrics
  const size = compact ? 14 : 18;                 // base port size
  const gap = compact ? 3 : 4;                    // gap between ports
  const rowGap = compact ? 8 : 12;                // gap between rows
  const portsPerRowMax = Math.max(
    12,
    ...rows.map((r) => Math.min(r.ports.length, 24)),
  );

  // Compute width: max row length × (size+gap)
  const maxRowPorts = Math.max(1, ...rows.map((r) => r.ports.length));
  const accessoryWidth = accessories.length ? 60 : 0;
  const chassisPaddingX = 16;
  const chassisPaddingY = 14;
  const width =
    accessoryWidth +
    chassisPaddingX * 2 +
    // Group of every 4 ports slightly separated
    maxRowPorts * (size + gap) +
    Math.floor(maxRowPorts / 4) * 2;

  const height =
    chassisPaddingY * 2 +
    rows.reduce((acc, r) => acc + size + rowGap, 0) -
    rowGap +
    (rows.length > 1 ? 12 : 0);

  return (
    <div className="rounded-xl border border-border/70 bg-slate-950/60 shadow-inner overflow-hidden">
      {/* Header bar */}
      <div className="px-3 py-2 bg-slate-900/70 border-b border-border/60 flex items-center justify-between font-mono">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-slate-400">
          <span className="text-slate-300 font-semibold">{template.vendor}</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300">{template.model}</span>
        </div>
        <div className="text-[10px] uppercase text-slate-500">
          {side === 'rear' ? 'Rear panel' : 'Front panel'}
        </div>
      </div>

      {/* Chassis SVG */}
      <div className="p-4 overflow-x-auto bg-gradient-to-b from-slate-900/40 to-slate-950/60">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
          role="img"
          aria-label={`${template.vendor} ${template.model} ${side} panel`}
        >
          {/* Chassis background */}
          <rect
            x="1"
            y="1"
            width={width - 2}
            height={height - 2}
            rx="6"
            fill="url(#chassisGradient)"
            stroke="#1e293b"
            strokeWidth="1"
          />
          <defs>
            <linearGradient id="chassisGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1f2937" />
              <stop offset="50%" stopColor="#111827" />
              <stop offset="100%" stopColor="#1f2937" />
            </linearGradient>
            <linearGradient id="portShine" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.25)" />
            </linearGradient>
          </defs>

          {/* Accessory column (console, mgmt, usb) on the left */}
          {side === 'front' && accessories.length > 0 && (
            <g transform={`translate(${chassisPaddingX}, ${chassisPaddingY})`}>
              {accessories.map((a, idx) => {
                const st = portStates[a.id] || { status: 'Unused' };
                const y = idx * (size + gap);
                return (
                  <PortNode
                    key={a.id}
                    x={0}
                    y={y}
                    size={size}
                    port={a}
                    state={st}
                    selected={selectedPortId === a.id}
                    onClick={onPortClick}
                  />
                );
              })}
              <text
                x={0}
                y={accessories.length * (size + gap) + 10}
                fill="#64748b"
                fontSize="8"
                fontFamily="ui-monospace, monospace"
              >
                I/O
              </text>
            </g>
          )}

          {/* Port rows */}
          <g
            transform={`translate(${chassisPaddingX + accessoryWidth}, ${chassisPaddingY})`}
          >
            {rows.map((row, rIdx) => {
              const rowY =
                rows.slice(0, rIdx).reduce((acc) => acc + size + rowGap, 0);
              return (
                <g key={rIdx} transform={`translate(0, ${rowY})`}>
                  {row.ports.map((p, i) => {
                    const groupOffset = Math.floor(i / 4) * 2;
                    const x = i * (size + gap) + groupOffset;
                    const st = portStates[p.id] || { status: 'Unused' };
                    return (
                      <PortNode
                        key={p.id}
                        x={x}
                        y={0}
                        size={size}
                        port={p}
                        state={st}
                        selected={selectedPortId === p.id}
                        onClick={onPortClick}
                      />
                    );
                  })}
                  {row.label && (
                    <text
                      x={row.ports.length * (size + gap) + Math.floor(row.ports.length / 4) * 2 + 8}
                      y={size - 4}
                      fill="#64748b"
                      fontSize="8"
                      fontFamily="ui-monospace, monospace"
                    >
                      {row.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="px-3 py-2 border-t border-border/60 bg-slate-900/40 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-slate-400">
        {Object.entries(PORT_STATUS_COLORS).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span
              className="w-2.5 h-2.5 rounded-sm border"
              style={{ background: v.fill, borderColor: v.ring }}
            />
            {v.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Single port node (memoized — thousands of ports possible on chassis switches)
// -------------------------------------------------------------------------
const PortNode = memo(function PortNode({ x, y, size, port, state, selected, onClick }) {
  const meta = INTERFACE_TYPES[port.type] || INTERFACE_TYPES.RJ45;
  const status = state?.status || 'Unused';
  const colors = PORT_STATUS_COLORS[status] || PORT_STATUS_COLORS.Unused;

  const isSlot = meta.shape === 'slot' || meta.shape === 'slot-wide';
  const width = isSlot ? size + (meta.shape === 'slot-wide' ? 4 : 2) : size;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={() => onClick?.(port, state)}
      tabIndex={0}
      role="button"
      aria-label={`${port.label} — ${status}`}
      data-testid={`port-node-${port.id}`}
    >
      <title>
        {port.type} {port.label} — {status}
        {state?.description ? `\n${state.description}` : ''}
      </title>

      {/* Selection ring */}
      {selected && (
        <rect
          x={-2}
          y={-2}
          width={width + 4}
          height={size + 4}
          rx={meta.shape === 'circle' ? size : 3}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="2"
        />
      )}

      {/* Port body */}
      {meta.shape === 'circle' ? (
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={colors.fill} stroke={colors.ring} strokeWidth="1" />
      ) : (
        <rect
          x={0}
          y={0}
          width={width}
          height={size}
          rx={meta.shape === 'square' ? 2 : 1}
          fill={colors.fill}
          stroke={colors.ring}
          strokeWidth="1"
        />
      )}

      {/* Shine overlay */}
      <rect x={0} y={0} width={width} height={size / 2} rx={2} fill="url(#portShine)" opacity="0.6" pointerEvents="none" />

      {/* Slot indicator lines (for SFP/QSFP) */}
      {isSlot && (
        <>
          <line x1={2} y1={size / 2} x2={width - 2} y2={size / 2} stroke={colors.ring} strokeWidth="1" opacity="0.7" />
          <line x1={width / 2} y1={2} x2={width / 2} y2={size - 2} stroke={colors.ring} strokeWidth="0.5" opacity="0.4" />
        </>
      )}

      {/* Label */}
      <text
        x={width / 2}
        y={size + 8}
        fill="#94a3b8"
        fontSize="7"
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
      >
        {port.label}
      </text>
    </g>
  );
});

export default memo(DeviceFrontPanel);
