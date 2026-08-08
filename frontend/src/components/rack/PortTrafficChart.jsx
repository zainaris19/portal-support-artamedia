import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { Activity, RefreshCw, TrendingDown, TrendingUp, AlertCircle, Wand2, ChevronDown, Check, List } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

const RANGES = [
  { key: '1h', label: '1H' },
  { key: '6h', label: '6H' },
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
];

/**
 * PortTrafficChart — per-port traffic history (RX + TX only) from Zabbix.
 *
 * Props:
 *   deviceId   — Portal device id (required for the /zabbix/device/.../port-traffic call)
 *   port       — template port object (uses .id, .label, .if_name_hint)
 */
export default function PortTrafficChart({ deviceId, port }) {
  const [range, setRange] = useState('24h');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [rxOverride, setRxOverride] = useState('');
  const [txOverride, setTxOverride] = useState('');
  const [showAllItems, setShowAllItems] = useState(false);
  const [allItems, setAllItems] = useState(null);
  const [allItemsLoading, setAllItemsLoading] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);

  const ifname = port?.id;
  const alt = useMemo(() => {
    const set = new Set([port?.if_name_hint, port?.label, port?.id].filter(Boolean));
    return [...set].join(',');
  }, [port]);

  const fetchTraffic = React.useCallback(async () => {
    if (!deviceId || !ifname) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/zabbix/device/${deviceId}/port-traffic`, {
        params: {
          ifname,
          alt,
          range,
          ...(rxOverride && { rx_itemid: rxOverride }),
          ...(txOverride && { tx_itemid: txOverride }),
        },
      });
      setData(data);
      setLastFetch(new Date());
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Gagal ambil traffic');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [deviceId, ifname, alt, range, rxOverride, txOverride]);

  useEffect(() => { fetchTraffic(); }, [fetchTraffic]);

  // Reset overrides when port changes
  useEffect(() => {
    setRxOverride('');
    setTxOverride('');
    setShowAllItems(false);
    setAllItems(null);
    setShowCandidates(false);
  }, [port?.id]);

  const loadAllItems = React.useCallback(async () => {
    if (!deviceId || allItems || allItemsLoading) return;
    setAllItemsLoading(true);
    try {
      const { data } = await api.get(`/zabbix/device/${deviceId}/interface-items`);
      setAllItems(data);
    } catch (e) {
      setAllItems({ error: e.response?.data?.detail || e.message });
    } finally {
      setAllItemsLoading(false);
    }
  }, [deviceId, allItems, allItemsLoading]);

  const merged = useMemo(() => {
    const rx = data?.rx?.points || [];
    const tx = data?.tx?.points || [];
    const map = new Map();
    rx.forEach((p) => map.set(p.t, { t: p.t, rx: p.v }));
    tx.forEach((p) => {
      const existing = map.get(p.t);
      if (existing) existing.tx = p.v;
      else map.set(p.t, { t: p.t, tx: p.v });
    });
    return [...map.values()].sort((a, b) => a.t - b.t);
  }, [data]);

  const hasData = merged.length > 0 && (data?.rx || data?.tx);

  const fmtBps = (v) => {
    if (v == null || Number.isNaN(v)) return '—';
    const abs = Math.abs(v);
    if (abs > 1e9) return `${(v / 1e9).toFixed(2)} Gbps`;
    if (abs > 1e6) return `${(v / 1e6).toFixed(2)} Mbps`;
    if (abs > 1e3) return `${(v / 1e3).toFixed(2)} Kbps`;
    return `${v.toFixed(0)} bps`;
  };
  const fmtTime = (t) => {
    const d = new Date(t);
    if (range === '7d' || range === '30d') return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const yAxisFmt = (v) => {
    const abs = Math.abs(v);
    if (abs > 1e9) return `${(v / 1e9).toFixed(1)}G`;
    if (abs > 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (abs > 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toString();
  };

  const lastRx = data?.rx?.lastvalue ? Number(data.rx.lastvalue) : null;
  const lastTx = data?.tx?.lastvalue ? Number(data.tx.lastvalue) : null;

  return (
    <div className="rounded-lg border border-border/60 bg-slate-950/40 overflow-hidden" data-testid="port-traffic-chart">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-slate-900/40">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-semibold">Port Traffic</span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Zabbix</span>
          {data?.host && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              {data.host}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="inline-flex rounded-md border border-border/60 p-0.5 bg-muted/30">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                data-testid={`port-traffic-range-${r.key}`}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded transition-colors font-mono',
                  range === r.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchTraffic}
            className="p-1 rounded-md border border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent"
            data-testid="port-traffic-refresh"
            title="Refresh"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="p-3">
        {error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Zabbix tidak dapat diakses</div>
              <div className="opacity-80 font-mono">{error}</div>
            </div>
          </div>
        )}

        {!error && data && !data.configured && (
          <div className="text-[11px] text-muted-foreground text-center py-3">
            Device belum di-set <span className="font-mono">Zabbix Host</span>. Isi field ini di edit device untuk melihat grafik traffic port.
          </div>
        )}

        {!error && data?.configured && !data.matched && (
          <div className="text-[11px] text-muted-foreground text-center py-3">
            Host tidak ditemukan di Zabbix ({data.reason || 'unknown'})
          </div>
        )}

        {!error && data?.matched && !hasData && (
          <div className="text-[11px] text-muted-foreground text-center py-3">
            Belum ada data traffic untuk interface <span className="font-mono">{ifname}</span> pada rentang ini.
            <div className="opacity-70 mt-0.5">Pastikan nama interface di Zabbix memuat teks <span className="font-mono">{ifname}</span> atau alias.</div>
          </div>
        )}

        {hasData && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-2 py-1.5">
                <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-sky-300">
                  <TrendingDown className="w-2.5 h-2.5" /> RX (in)
                </div>
                <div className="text-sm font-mono text-sky-200 truncate">{fmtBps(lastRx)}</div>
              </div>
              <div className="rounded-md border border-pink-500/30 bg-pink-500/5 px-2 py-1.5">
                <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-pink-300">
                  <TrendingUp className="w-2.5 h-2.5" /> TX (out)
                </div>
                <div className="text-sm font-mono text-pink-200 truncate">{fmtBps(lastTx)}</div>
              </div>
            </div>

            <div style={{ height: 190 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={merged} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="port-rx-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="port-tx-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f472b6" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#f472b6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="2 4" />
                  <XAxis
                    dataKey="t"
                    tickFormatter={fmtTime}
                    minTickGap={40}
                    tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'ui-monospace' }}
                    stroke="rgba(148,163,184,0.2)"
                  />
                  <YAxis
                    tickFormatter={yAxisFmt}
                    tick={{ fill: '#94a3b8', fontSize: 9, fontFamily: 'ui-monospace' }}
                    stroke="rgba(148,163,184,0.2)"
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
                    labelFormatter={(t) => new Date(t).toLocaleString()}
                    formatter={(v, k) => [fmtBps(v), k === 'rx' ? 'RX (in)' : 'TX (out)']}
                  />
                  <Area type="monotone" dataKey="rx" stroke="#38bdf8" strokeWidth={1.5}
                        fill="url(#port-rx-grad)" dot={false} connectNulls isAnimationActive={false} />
                  <Area type="monotone" dataKey="tx" stroke="#f472b6" strokeWidth={1.5}
                        fill="url(#port-tx-grad)" dot={false} connectNulls isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="text-[9px] font-mono text-muted-foreground truncate mt-1 flex justify-between">
              <span className="truncate">
                {data.rx?.name || data.tx?.name || ''}
              </span>
              <span className="text-muted-foreground/70 shrink-0 pl-2">
                {data.source} · {lastFetch ? lastFetch.toLocaleTimeString() : ''}
              </span>
            </div>
          </>
        )}

        {/* --- Candidate picker (admin override) --- */}
        {data?.matched && (
          <div className="mt-2 border-t border-border/40 pt-2">
            <button
              type="button"
              onClick={() => setShowCandidates((v) => !v)}
              className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest font-mono text-muted-foreground hover:text-foreground"
              data-testid="btn-toggle-candidates"
            >
              <span className="flex items-center gap-1.5">
                <Wand2 className="w-3 h-3" /> Auto-pick / manual override
                {(rxOverride || txOverride) && (
                  <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 font-normal">manual</span>
                )}
              </span>
              <ChevronDown className={cn('w-3 h-3 transition-transform', showCandidates && 'rotate-180')} />
            </button>

            {showCandidates && (
              <div className="mt-2 space-y-2">
                <CandidateSection
                  label="RX (Bits received)"
                  color="sky"
                  items={data.candidates?.rx || []}
                  selectedItemid={data.rx?.itemid}
                  onPick={(id) => setRxOverride(id === rxOverride ? '' : id)}
                  isOverridden={!!rxOverride}
                  onClearOverride={() => setRxOverride('')}
                />
                <CandidateSection
                  label="TX (Bits sent)"
                  color="pink"
                  items={data.candidates?.tx || []}
                  selectedItemid={data.tx?.itemid}
                  onPick={(id) => setTxOverride(id === txOverride ? '' : id)}
                  isOverridden={!!txOverride}
                  onClearOverride={() => setTxOverride('')}
                />

                {/* View all interface items on the host */}
                <div className="pt-1 border-t border-border/40">
                  <button
                    type="button"
                    onClick={() => { setShowAllItems((v) => !v); loadAllItems(); }}
                    className="w-full flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
                    data-testid="btn-toggle-all-items"
                  >
                    <span className="flex items-center gap-1.5">
                      <List className="w-3 h-3" /> Lihat semua interface Zabbix pada host ini
                    </span>
                    <ChevronDown className={cn('w-3 h-3 transition-transform', showAllItems && 'rotate-180')} />
                  </button>

                  {showAllItems && (
                    <div className="mt-2 max-h-[280px] overflow-auto rounded border border-border/50 bg-slate-950/60" data-testid="zabbix-all-items">
                      {allItemsLoading && (
                        <div className="p-2 text-[11px] text-muted-foreground">Memuat…</div>
                      )}
                      {allItems?.error && (
                        <div className="p-2 text-[11px] text-rose-300">{allItems.error}</div>
                      )}
                      {allItems?.items && allItems.items.length === 0 && (
                        <div className="p-2 text-[11px] text-muted-foreground">Tidak ada item traffic pada host ini.</div>
                      )}
                      {allItems?.items && allItems.items.map((it) => {
                        const isRxSel = String(it.itemid) === String(data.rx?.itemid);
                        const isTxSel = String(it.itemid) === String(data.tx?.itemid);
                        return (
                          <div key={it.itemid} className="flex items-center gap-2 px-2 py-1 border-b border-border/30 last:border-b-0">
                            <span className={cn(
                              'text-[9px] font-mono uppercase px-1 rounded shrink-0',
                              it.direction === 'rx' ? 'bg-sky-500/20 text-sky-300' : 'bg-pink-500/20 text-pink-300',
                            )}>{it.direction}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-mono truncate">{it.name}</div>
                              <div className="text-[9px] text-muted-foreground truncate">{it.key}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (it.direction === 'rx') setRxOverride(isRxSel ? '' : it.itemid);
                                else setTxOverride(isTxSel ? '' : it.itemid);
                              }}
                              className={cn(
                                'text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0',
                                (it.direction === 'rx' ? isRxSel : isTxSel)
                                  ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200'
                                  : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent',
                              )}
                              data-testid={`pick-item-${it.itemid}`}
                            >
                              {(it.direction === 'rx' ? isRxSel : isTxSel) ? (<><Check className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" /> picked</>) : 'pick'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateSection({ label, color, items, selectedItemid, onPick, isOverridden, onClearOverride }) {
  const tone = color === 'sky'
    ? { border: 'border-sky-500/30', bg: 'bg-sky-500/5', text: 'text-sky-300' }
    : { border: 'border-pink-500/30', bg: 'bg-pink-500/5', text: 'text-pink-300' };
  return (
    <div className={cn('rounded-md p-1.5 border', tone.border, tone.bg)}>
      <div className={cn('flex items-center justify-between text-[10px] font-mono uppercase tracking-widest', tone.text)}>
        <span>{label} <span className="text-muted-foreground/70 font-normal">— {items.length} kandidat</span></span>
        {isOverridden && (
          <button
            onClick={onClearOverride}
            className="text-[9px] px-1 rounded border border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
            title="Kembali ke auto-pick"
          >
            reset
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="text-[10px] text-muted-foreground px-1 py-0.5 mt-1">Tidak ada item cocok. Buka daftar lengkap di bawah.</div>
      ) : (
        <div className="mt-1 space-y-0.5 max-h-[110px] overflow-auto">
          {items.map((it) => {
            const selected = String(it.itemid) === String(selectedItemid);
            return (
              <button
                key={it.itemid}
                type="button"
                onClick={() => onPick(it.itemid)}
                className={cn(
                  'w-full text-left flex items-center gap-1.5 px-1.5 py-1 rounded border transition-colors',
                  selected
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
                    : 'border-border/40 hover:bg-accent text-muted-foreground',
                )}
                data-testid={`candidate-${it.itemid}`}
                title={it.key}
              >
                {selected ? <Check className="w-3 h-3 text-emerald-300 shrink-0" /> : <span className="w-3 h-3 shrink-0" />}
                <span className="flex-1 text-[10px] font-mono truncate">{it.name}</span>
                <span className="text-[9px] font-mono text-muted-foreground shrink-0">#{it.itemid}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
