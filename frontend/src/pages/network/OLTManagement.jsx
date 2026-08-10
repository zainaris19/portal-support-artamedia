import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Server, RefreshCw, Search, Filter, MapPin, Cpu, CheckCircle2, XCircle, AlertTriangle, Signal, Wifi } from 'lucide-react';
import api, { formatApiError } from '@/lib/api';

const STATUS = {
  ONLINE: { label: 'Online', cls: 'text-emerald-400', dot: 'bg-emerald-400' },
  UNREACHABLE: { label: 'Unreachable', cls: 'text-rose-400', dot: 'bg-rose-400' },
  UNKNOWN: { label: 'Unknown', cls: 'text-slate-400', dot: 'bg-slate-400' },
};

export default function OLTManagement() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [vendor, setVendor] = useState('all');
  const [model, setModel] = useState('all');
  const [location, setLocation] = useState('all');
  const [conn, setConn] = useState('all');
  const [sort, setSort] = useState('name');
  const [group, setGroup] = useState('none');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/olt');
      setItems((data.items || []).map((x) => ({ ...x.summary_card, implemented: x.implemented, location_id: x.location_id })));
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const vendors = useMemo(() => Array.from(new Set(items.map((i) => i.vendor).filter(Boolean))), [items]);
  const modelsList = useMemo(() => Array.from(new Set(items.map((i) => i.model).filter(Boolean))), [items]);
  const locations = useMemo(() => Array.from(new Set(items.map((i) => i.location_id).filter(Boolean))), [items]);

  const filtered = useMemo(() => {
    let list = items.filter((i) => {
      if (vendor !== 'all' && i.vendor !== vendor) return false;
      if (model !== 'all' && i.model !== model) return false;
      if (location !== 'all' && i.location_id !== location) return false;
      if (conn === 'online' && !i.connected) return false;
      if (conn === 'unreachable' && i.connected) return false;
      if (q) {
        const hay = `${i.name} ${i.vendor} ${i.model} ${i.host} ${i.location_id || ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === 'onu') return (b.total_onu || 0) - (a.total_onu || 0);
      if (sort === 'status') return Number(b.connected) - Number(a.connected);
      return (a.name || '').localeCompare(b.name || '');
    });
    return list;
  }, [items, vendor, model, location, conn, q, sort]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: null, items: filtered }];
    const map = {};
    filtered.forEach((i) => {
      const k = group === 'location' ? (i.location_id || 'Tanpa Lokasi') : group === 'vendor' ? i.vendor : i.model;
      (map[k] = map[k] || []).push(i);
    });
    return Object.entries(map).map(([key, its]) => ({ key, items: its }));
  }, [filtered, group]);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'OLT Management' }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30"><Server className="w-4 h-4 text-sky-300" /></span>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>OLT Management</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Monitoring OLT & ONU multi-vendor + provisioning ONU. Data ONU dari background polling ringan.</p>
        </div>
        <Button variant="outline" onClick={load} data-testid="olt-mgmt-refresh"><RefreshCw className="w-4 h-4 mr-1.5" /> Refresh</Button>
      </div>

      <Card className="border-border"><CardContent className="p-3">
        <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 h-9" placeholder="Cari OLT, host, lokasi…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="olt-search" />
          </div>
          <FilterSelect value={vendor} onChange={setVendor} placeholder="Vendor" options={vendors} testid="olt-filter-vendor" />
          <FilterSelect value={model} onChange={setModel} placeholder="Model" options={modelsList} testid="olt-filter-model" />
          <FilterSelect value={location} onChange={setLocation} placeholder="Lokasi" options={locations} testid="olt-filter-loc" />
          <Select value={conn} onValueChange={setConn}><SelectTrigger className="w-full lg:w-36 h-9" data-testid="olt-filter-conn"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Semua Koneksi</SelectItem><SelectItem value="online">Online</SelectItem><SelectItem value="unreachable">Unreachable</SelectItem></SelectContent></Select>
          <Select value={sort} onValueChange={setSort}><SelectTrigger className="w-full lg:w-32 h-9" data-testid="olt-sort"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="name">Sort: Name</SelectItem><SelectItem value="onu">Sort: ONU</SelectItem><SelectItem value="status">Sort: Status</SelectItem></SelectContent></Select>
          <Select value={group} onValueChange={setGroup}><SelectTrigger className="w-full lg:w-40 h-9" data-testid="olt-group"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">No Grouping</SelectItem><SelectItem value="location">By Location</SelectItem><SelectItem value="vendor">By Vendor</SelectItem><SelectItem value="model">By Model</SelectItem></SelectContent></Select>
        </div>
      </CardContent></Card>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground border border-dashed border-border rounded-lg">Belum ada OLT. Tambahkan di Master Settings → Integrations → OLT.</div>
      ) : groups.map((g) => (
        <div key={g.key || 'all'} className="space-y-2">
          {g.key !== null && (<div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mt-2"><Filter className="w-3.5 h-3.5" />{g.key} <span className="text-muted-foreground/60">({g.items.length})</span></div>)}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {g.items.map((o) => <OLTCard key={o.id} o={o} onOpen={() => nav(`/network/olt/${o.id}`)} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options, testid }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full lg:w-36 h-9" data-testid={testid}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Semua {placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function OLTCard({ o, onOpen }) {
  const st = STATUS[o.status] || STATUS.UNKNOWN;
  return (
    <button onClick={onOpen} data-testid={`olt-card-${o.id}`}
      className="text-left rounded-xl border border-border bg-card p-4 transition-all hover:border-sky-500/50 hover:shadow-lg hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-base truncate" style={{ fontFamily: 'Manrope' }}>{o.name}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Cpu className="w-3 h-3" />{o.vendor} · {o.model}</div>
        </div>
        {o.implemented ? (
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${st.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}</span>
        ) : (<Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">Coming Soon</Badge>)}
      </div>
      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-2"><MapPin className="w-3 h-3" />{o.location_id || 'Tanpa lokasi'} · <span className="font-mono">{o.host}</span></div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <Metric label="Total ONU" value={o.total_onu} />
        <Metric label="Online" value={o.online_onu} tone="emerald" />
        <Metric label="PON" value={o.total_pon} />
      </div>
      <div className="grid grid-cols-4 gap-2 mt-2 text-[11px]">
        <MiniStat dot="bg-rose-400" label="LOS" value={o.los_onu} />
        <MiniStat dot="bg-fuchsia-400" label="Dying" value={o.dying_gasp_onu} />
        <MiniStat dot="bg-slate-400" label="Offline" value={o.offline_onu} />
        <MiniStat dot="bg-amber-400" label="Uncfg" value={o.unconfigured_onu} />
      </div>
      <div className="text-[10px] text-muted-foreground mt-3">Last Poll: {o.last_poll ? new Date(o.last_poll).toLocaleString('id-ID') : 'belum pernah'}</div>
      {o.error && <div className="text-[10px] text-rose-400 mt-1 truncate" title={o.error}>{o.error}</div>}
    </button>
  );
}

function Metric({ label, value, tone }) {
  const cls = tone === 'emerald' ? 'text-emerald-400' : 'text-foreground';
  return (<div className="rounded-lg border border-border/60 p-2"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div><div className={`text-xl font-bold tabular-nums ${cls}`} style={{ fontFamily: 'Manrope' }}>{value ?? '—'}</div></div>);
}
function MiniStat({ dot, label, value }) {
  return (<div className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} /><span className="text-muted-foreground">{label}</span><span className="ml-auto tabular-nums font-medium">{value ?? 0}</span></div>);
}
