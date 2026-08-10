import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area,
} from 'recharts';
import { Activity, Cpu, MemoryStick, Thermometer, Wifi, Signal, PieChart, Radio, RefreshCw, AlertCircle } from 'lucide-react';
import api from '@/lib/api';

/**
 * ZabbixGraphPanel — histori monitoring dari server Zabbix Portal Support.
 *
 * Props:
 *   deviceId  — id device Portal Support
 *   host      — nama zabbix_host device (untuk tampilan)
 *   compact   — bool
 */
const RANGES = [
  { key: '1h', label: 'Last Hour' },
  { key: '6h', label: 'Last 6 Hours' },
  { key: '24h', label: 'Last 24 Hours' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
];

const CATEGORY_META = {
  cpu:           { label: 'CPU',           icon: Cpu,          color: '#a78bfa', unit: '%' },
  memory:        { label: 'Memory',        icon: MemoryStick,  color: '#34d399', unit: '%' },
  temperature:   { label: 'Temperature',   icon: Thermometer,  color: '#fb923c', unit: '°C' },
  availability:  { label: 'Availability',  icon: Signal,       color: '#22d3ee', unit: '' },
  packet_loss:   { label: 'Packet Loss',   icon: PieChart,     color: '#ef4444', unit: '%' },
  ping:          { label: 'Ping',          icon: Radio,        color: '#eab308', unit: 'ms' },
};

const CATEGORY_ORDER = ['cpu', 'memory', 'temperature', 'availability', 'packet_loss', 'ping'];

export default function ZabbixGraphPanel({ deviceId }) {
  const [range, setRange] = useState('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const fetchData = React.useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/zabbix/device/${deviceId}/graphs`, {
        params: { range },
      });
      setData(data);
      setLastFetch(new Date());
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Gagal ambil data Zabbix');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [deviceId, range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(fetchData, 60_000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchData]);

  const categoriesWithData = useMemo(() => {
    if (!data?.categories) return [];
    return CATEGORY_ORDER
      .filter((k) => (data.categories[k] || []).some((it) => (it.points || []).length > 0));
  }, [data]);

  const hasSomeSeries = categoriesWithData.length > 0;

  return (
    <Card className="border-border/70">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold">Monitoring History</span>
            <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
              Zabbix
            </span>
            {data?.host && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                {data.host}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border/60 p-0.5 bg-muted/30" data-testid="zabbix-range-tabs">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  data-testid={`zabbix-range-${r.key}`}
                  className={cn(
                    'text-[11px] px-2 py-1 rounded transition-colors',
                    range === r.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={cn(
                'text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-md border transition-colors',
                autoRefresh
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-border/60 text-muted-foreground',
              )}
              data-testid="zabbix-toggle-auto"
              title="Toggle auto-refresh (60s)"
            >
              AUTO 60s
            </button>
            <button
              onClick={fetchData}
              className="p-1.5 rounded-md border border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent"
              data-testid="zabbix-refresh-now"
              title="Refresh now"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Zabbix tidak dapat diakses</div>
              <div className="opacity-80 mt-0.5 font-mono text-[11px]">{error}</div>
              <div className="opacity-70 mt-1">
                Pastikan konfigurasi di <span className="font-mono">Settings → Monitoring Integration → Zabbix</span> sudah benar dan device memiliki field <span className="font-mono">zabbix_host</span> yang cocok.
              </div>
            </div>
          </div>
        )}

        {!error && data && !data.configured && (
          <EmptyState
            title="Device belum di-monitoring via Zabbix"
            body="Isi field 'Zabbix Host' di detail device supaya graph histori dari Zabbix bisa ditampilkan di sini. Monitoring SNMP live tetap tersedia terpisah."
          />
        )}
        {!error && data?.configured && !data.matched && (
          <EmptyState
            title={`Host '${data?.host || ''}' tidak ditemukan di Zabbix`}
            body={data.reason || 'Nama host mungkin berbeda. Periksa Zabbix → Configuration → Hosts.'}
          />
        )}

        {!error && data?.matched && !hasSomeSeries && (
          <EmptyState
            title="Belum ada data history"
            body="Zabbix host ditemukan tetapi belum ada item metric yang menghasilkan data pada rentang waktu ini."
          />
        )}

        {hasSomeSeries && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="zabbix-graph-grid">
            {categoriesWithData.map((catKey) => (
              <GraphCard
                key={catKey}
                meta={CATEGORY_META[catKey]}
                items={data.categories[catKey]}
                source={data.source}
                range={range}
              />
            ))}
          </div>
        )}

        {lastFetch && (
          <div className="text-[10px] font-mono text-muted-foreground text-right">
            Last sync: {lastFetch.toLocaleString()} · source: {data?.source || '—'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GraphCard({ meta, items, source, range }) {
  const Icon = meta.icon;
  // Combine multi-item series onto a merged timeline
  const merged = useMemo(() => {
    if (!items || items.length === 0) return [];
    const timeMap = new Map();
    items.forEach((it, seriesIdx) => {
      (it.points || []).forEach((p) => {
        if (!timeMap.has(p.t)) timeMap.set(p.t, { t: p.t });
        timeMap.get(p.t)[`s${seriesIdx}`] = p.v;
      });
    });
    return [...timeMap.values()].sort((a, b) => a.t - b.t);
  }, [items]);

  const fmtVal = (v) => {
    if (v == null || Number.isNaN(v)) return '—';
    if (meta.unit === 'bps') {
      // Zabbix stores octets/sec typically, or Bytes total — heuristic
      const abs = Math.abs(v);
      if (abs > 1e9) return `${(v / 1e9).toFixed(2)} G`;
      if (abs > 1e6) return `${(v / 1e6).toFixed(2)} M`;
      if (abs > 1e3) return `${(v / 1e3).toFixed(2)} K`;
      return v.toFixed(0);
    }
    return typeof v === 'number' ? v.toFixed(2) : v;
  };
  const fmtTime = (t) => {
    const d = new Date(t);
    if (range === '7d' || range === '30d') return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="p-1 rounded-md" style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}55` }}>
            <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
          </span>
          <span className="text-sm font-semibold">{meta.label}</span>
        </div>
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
          {source} · {items.length} series
        </span>
      </div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={merged} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${meta.color}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={meta.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={meta.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="2 4" />
            <XAxis dataKey="t" tickFormatter={fmtTime} minTickGap={40}
                   tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: 'ui-monospace' }}
                   stroke="rgba(148,163,184,0.2)" />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: 'ui-monospace' }}
                   tickFormatter={fmtVal}
                   stroke="rgba(148,163,184,0.2)" />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
              labelFormatter={(t) => new Date(t).toLocaleString()}
              formatter={(v, key) => {
                const idx = Number(String(key).replace('s', ''));
                const it = items[idx];
                return [fmtVal(v) + (meta.unit ? ` ${meta.unit}` : ''), it?.name || `Series ${idx + 1}`];
              }}
            />
            {items.map((it, idx) => (
              <Area
                key={idx}
                type="monotone"
                dataKey={`s${idx}`}
                stroke={idx === 0 ? meta.color : shiftColor(meta.color, idx)}
                strokeWidth={1.5}
                fill={idx === 0 ? `url(#grad-${meta.color})` : 'transparent'}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {items.length > 1 && (
        <div className="text-[10px] font-mono text-muted-foreground truncate mt-1">
          {items.map((it) => it.name).join(' · ')}
        </div>
      )}
    </div>
  );
}

function shiftColor(hex, seed) {
  // Simple hash-based hue rotation for extra series
  const alt = ['#7dd3fc', '#c4b5fd', '#fdba74', '#86efac', '#fca5a5', '#fcd34d'];
  return alt[seed % alt.length];
}

function EmptyState({ title, body }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{body}</div>
    </div>
  );
}
