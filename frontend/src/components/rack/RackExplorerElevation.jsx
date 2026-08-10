import React from 'react';
import { cn } from '@/lib/utils';
import { Server } from 'lucide-react';

/**
 * RackExplorerElevation
 * ---------------------
 * Enhanced rack elevation for the Infrastructure Explorer.
 * - Numbered U positions (top = highest U)
 * - Devices drawn as multi-U blocks with visible height + hover glow
 * - Empty slots remain clickable (falls through to onSlotClick)
 * - Selected device highlighted with accent ring
 * - Purely presentational — CRUD is left to the parent
 */
export default function RackExplorerElevation({
  capacityU,
  devices = [],
  selectedId,
  onSelectDevice,
  onSlotClick,
}) {
  // Build slots from top (capacity) to bottom (1)
  const slots = [];
  for (let u = capacityU; u >= 1; u--) {
    const dev = devices.find(
      (d) => d.position_u <= u && d.position_u + (d.height_u || 1) - 1 >= u,
    );
    const isTop = dev && dev.position_u + (dev.height_u || 1) - 1 === u;
    slots.push({ u, dev, isTop });
  }

  return (
    <div className="rounded-xl border border-border/70 bg-gradient-to-b from-slate-900/40 via-slate-950/40 to-slate-900/40 overflow-hidden shadow-inner">
      {/* Rack header */}
      <div className="px-3 py-2 bg-slate-900/60 border-b border-border/60 flex items-center justify-between text-[10px] uppercase tracking-widest font-mono text-slate-400">
        <span>Rack Elevation</span>
        <span>{capacityU}U</span>
      </div>
      <div className="grid grid-cols-[40px_1fr] font-mono text-[11px]">
        {slots.map(({ u, dev, isTop }) => {
          if (dev) {
            if (!isTop) return null; // rendered in top row via rowSpan
            const selected = selectedId === dev.id;
            const height = dev.height_u || 1;
            return (
              <React.Fragment key={u}>
                {/* U label column — spans device rows */}
                <div
                  className="border-r border-b border-border/40 flex items-center justify-center bg-slate-900/40 text-slate-500"
                  style={{
                    gridRow: `span ${height}`,
                    minHeight: `${height * 30}px`,
                  }}
                >
                  <div className="text-center leading-tight">
                    <div className="font-semibold text-slate-300">U{dev.position_u + height - 1}</div>
                    {height > 1 && (
                      <div className="text-[9px] text-slate-500">↕ U{dev.position_u}</div>
                    )}
                  </div>
                </div>
                {/* Device block */}
                <button
                  onClick={() => onSelectDevice?.(dev)}
                  className={cn(
                    'group relative border-b border-border/40 px-3 py-1.5 flex items-center gap-2 text-left transition-all duration-200',
                    'bg-gradient-to-r from-slate-800/80 via-slate-800/60 to-slate-800/80 hover:from-blue-950/70 hover:via-blue-900/50 hover:to-blue-950/70',
                    selected && 'ring-2 ring-inset ring-blue-400/70 bg-gradient-to-r from-blue-900/60 via-blue-800/40 to-blue-900/60',
                  )}
                  style={{
                    gridRow: `span ${height}`,
                    minHeight: `${height * 30}px`,
                  }}
                  data-testid={`rack-explorer-device-${dev.id}`}
                  data-selected={selected ? 'true' : 'false'}
                >
                  <div className={cn(
                    'w-1 rounded-full self-stretch shrink-0 transition-colors',
                    selected ? 'bg-blue-400' : 'bg-slate-600 group-hover:bg-blue-400/70',
                  )} />
                  <Server className="w-3.5 h-3.5 shrink-0 text-blue-300" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-slate-100 truncate">{dev.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {dev.brand || '—'} {dev.model || ''} · {height}U · {dev.hostname || 'no-host'}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-[9px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded border',
                      dev.status === 'Active' && 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
                      dev.status === 'Maintenance' && 'border-amber-500/40 text-amber-300 bg-amber-500/10',
                      dev.status === 'Offline' && 'border-rose-500/40 text-rose-300 bg-rose-500/10',
                      dev.status === 'Retired' && 'border-slate-500/40 text-slate-400 bg-slate-500/10',
                    )}
                  >
                    {dev.status || '—'}
                  </span>
                </button>
              </React.Fragment>
            );
          }
          // empty slot
          return (
            <React.Fragment key={u}>
              <div className="border-r border-b border-border/40 py-1.5 text-center bg-slate-900/40 text-slate-600">
                U{u}
              </div>
              <button
                onClick={() => onSlotClick?.(u)}
                className="border-b border-border/40 px-3 py-1.5 text-slate-600 hover:bg-blue-500/5 hover:text-blue-300 transition-colors text-left"
                title={`Slot kosong U${u}`}
              >
                <span className="text-[10px] opacity-60">— free —</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
      <div className="px-3 py-2 bg-slate-900/60 border-t border-border/60 flex items-center justify-between text-[10px] text-slate-500 font-mono">
        <span>Front view</span>
        <span>{devices.length} device{devices.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
