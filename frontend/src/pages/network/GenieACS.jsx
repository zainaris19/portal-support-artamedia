import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Router as RouterIcon, RefreshCw, Search, ChevronLeft, ChevronRight, Wifi, Server,
  AlertTriangle, CheckCircle2, XCircle, HelpCircle, Cpu, Thermometer, Activity, Users,
  RotateCcw, Power, Settings2, Tag as TagIcon, X, Signal, Clock, MapPin, Filter,
} from 'lucide-react';
import api, { formatApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const ACTION_ROLES = ['admin', 'supervisor', 'engineer'];
const PAGE_SIZES = [20, 50, 100];

// ---------- formatting helpers ----------
function fmtInform(iso, minutes) {
  if (!iso) return '—';
  if (minutes == null) return '—';
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${Math.round(minutes)} mnt lalu`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} jam lalu`;
  return `${Math.round(minutes / 1440)} hr lalu`;
}
function fmtUptime(sec) {
  if (sec == null) return '—';
  const s = Number(sec); if (!s) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d ? d + 'h ' : ''}${h}j ${m}m`;
}
function fmtDbm(v) { return v == null ? '—' : `${Number(v).toFixed(1)} dBm`; }
function fmtTemp(v) { return v == null ? '—' : `${Number(v).toFixed(0)}°C`; }
function titleCase(s) {
  if (!s) return s;
  return String(s).toLowerCase().replace(/(^|[\s\-_/])([a-z0-9])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

const STATUS_META = {
  Online: { color: 'text-emerald-400', dot: 'bg-emerald-400', badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', icon: CheckCircle2 },
  Warning: { color: 'text-amber-400', dot: 'bg-amber-400', badge: 'border-amber-500/40 bg-amber-500/10 text-amber-300', icon: AlertTriangle },
  Offline: { color: 'text-rose-400', dot: 'bg-rose-400', badge: 'border-rose-500/40 bg-rose-500/10 text-rose-300', icon: XCircle },
  Unknown: { color: 'text-slate-400', dot: 'bg-slate-400', badge: 'border-border text-muted-foreground bg-muted/40', icon: HelpCircle },
};
function StatusBadge({ value }) {
  const m = STATUS_META[value] || STATUS_META.Unknown;
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${m.badge}`}><span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{value}</span>;
}

export default function GenieACS() {
  const { hasRole } = useAuth();
  const canAct = hasRole(...ACTION_ROLES);
  const [connected, setConnected] = useState(true);
  const [connError, setConnError] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summary, setSummary] = useState(null);
  const [clusters, setClusters] = useState([]);

  const [tab, setTab] = useState('device');
  const [cluster, setCluster] = useState('__all__');
  const [clusterSearch, setClusterSearch] = useState('');
  const [problemOnly, setProblemOnly] = useState(false);

  // device table state
  const [filters, setFilters] = useState({ q: '', status: 'all', model: 'all', tag: '', fault: false });
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loadingDev, setLoadingDev] = useState(true);

  // faults
  const [faults, setFaults] = useState([]);
  const [loadingFaults, setLoadingFaults] = useState(false);

  const [detailId, setDetailId] = useState(null);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const { data } = await api.get('/genieacs/summary');
      setSummary(data.summary); setClusters(data.clusters || []);
      setConnected(data.connected); setConnError(data.error);
    } catch (e) { setConnected(false); setConnError(formatApiError(e)); }
    finally { setLoadingSummary(false); }
  }, []);

  const loadDevices = useCallback(async () => {
    setLoadingDev(true);
    try {
      const params = { page, limit };
      if (cluster !== '__all__') params.cluster = cluster;
      if (filters.q) params.q = filters.q;
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.model !== 'all') params.model = filters.model;
      if (filters.tag) params.tag = filters.tag;
      if (filters.fault) params.fault = true;
      const { data } = await api.get('/genieacs/devices', { params });
      setDevices(data.items || []); setTotal(data.total || 0);
      setModels(data.models || []); setConnected(data.connected); setConnError(data.error);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoadingDev(false); }
  }, [page, cluster, filters, limit]);

  const loadFaults = useCallback(async () => {
    setLoadingFaults(true);
    try {
      const params = {};
      if (cluster !== '__all__') params.cluster = cluster;
      const { data } = await api.get('/genieacs/faults', { params });
      setFaults(data.items || []); setConnected(data.connected); setConnError(data.error);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoadingFaults(false); }
  }, [cluster]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { if (tab === 'device') loadDevices(); }, [loadDevices, tab]);
  useEffect(() => { if (tab === 'faults') loadFaults(); }, [loadFaults, tab]);
  useEffect(() => { setPage(1); }, [cluster, filters]);

  const refreshAll = () => { loadSummary(); if (tab === 'device') loadDevices(); else loadFaults(); toast.success('Data diperbarui'); };
  const resetFilters = () => { setFilters({ q: '', status: 'all', model: 'all', tag: '', fault: false }); setCluster('__all__'); };

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const visibleClusters = useMemo(() => {
    let list = clusters;
    if (clusterSearch) list = list.filter((c) => (c.label || c.name).toLowerCase().includes(clusterSearch.toLowerCase()));
    if (problemOnly) list = list.filter((c) => (c.warning + c.offline + c.fault) > 0);
    return list;
  }, [clusters, clusterSearch, problemOnly]);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'GenieACS' }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30"><RouterIcon className="w-4 h-4 text-sky-300" /></span>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>GenieACS</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Monitoring & provisioning ONT/Router pelanggan via GenieACS NBI. Cluster otomatis dari GenieACS tags.</p>
        </div>
        <Button variant="outline" onClick={refreshAll} data-testid="genieacs-refresh"><RefreshCw className="w-4 h-4 mr-1.5" /> Refresh</Button>
      </div>

      {!connected && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 p-3 flex items-start gap-2" data-testid="genieacs-disconnected">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">GenieACS Disconnected</div>
            <div className="text-amber-300/80 text-xs mt-0.5">{connError || 'NBI API belum terhubung.'} Konfigurasi di Settings → Integrations → GenieACS. Halaman lain tetap berjalan normal.</div>
          </div>
        </div>
      )}

      {/* Summary cards removed — per-cluster & "Semua Device" cards already show these stats */}

      <Tabs value={tab} onValueChange={setTab} className="mt-1">
        <TabsList>
          <TabsTrigger value="device" data-testid="genieacs-tab-device">Device</TabsTrigger>
          <TabsTrigger value="faults" data-testid="genieacs-tab-faults">Faults ({summary?.fault ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="device" className="space-y-3 mt-3">
          {/* Cluster cards */}
          <ClusterCards
            clusters={visibleClusters} allTotal={summary?.total} selected={cluster} onSelect={setCluster}
            search={clusterSearch} onSearch={setClusterSearch} problemOnly={problemOnly} onProblemOnly={setProblemOnly}
            summary={summary}
          />

          {/* Filters */}
          <Card className="border-border">
            <CardContent className="p-3 space-y-3">
              <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9 h-9" placeholder="Cari serial, username, IP, MAC, SSID…"
                    value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                    data-testid="genieacs-search" />
                </div>
                <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                  <SelectTrigger className="w-full lg:w-36 h-9" data-testid="genieacs-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="Online">Online</SelectItem>
                    <SelectItem value="Warning">Warning</SelectItem>
                    <SelectItem value="Offline">Offline</SelectItem>
                    <SelectItem value="Unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filters.model} onValueChange={(v) => setFilters({ ...filters, model: v })}>
                  <SelectTrigger className="w-full lg:w-40 h-9" data-testid="genieacs-filter-model"><SelectValue placeholder="Model" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Model</SelectItem>
                    {models.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="w-full lg:w-32 h-9" placeholder="Tag" value={filters.tag}
                  onChange={(e) => setFilters({ ...filters, tag: e.target.value })} data-testid="genieacs-filter-tag" />
                <Button variant={filters.fault ? 'default' : 'outline'} size="sm" className="h-9"
                  onClick={() => setFilters({ ...filters, fault: !filters.fault })} data-testid="genieacs-filter-fault">
                  <AlertTriangle className="w-4 h-4 mr-1" /> Fault
                </Button>
                <Button variant="ghost" size="sm" className="h-9" onClick={resetFilters} data-testid="genieacs-reset"><Filter className="w-4 h-4 mr-1" /> Reset</Button>
              </div>

              <DeviceTable devices={devices} loading={loadingDev} onOpen={setDetailId} pageStart={(page - 1) * limit} />

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>Menampilkan {devices.length} dari {total} device</span>
                  <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}>
                    <SelectTrigger className="w-28 h-8" data-testid="genieacs-page-size"><SelectValue /></SelectTrigger>
                    <SelectContent>{PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s} / halaman</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="genieacs-page-prev"><ChevronLeft className="w-4 h-4" /></Button>
                  <span className="tabular-nums">Hal. {page} / {pageCount}</span>
                  <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid="genieacs-page-next"><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faults" className="mt-3">
          <FaultsTable faults={faults} loading={loadingFaults} cluster={cluster} clusters={clusters} onCluster={setCluster} onOpen={setDetailId} />
        </TabsContent>
      </Tabs>

      {detailId && (
        <DeviceDetailSheet deviceId={detailId} onClose={() => setDetailId(null)} canAct={canAct}
          onChanged={() => { loadSummary(); if (tab === 'device') loadDevices(); }} />
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, loading, tone }) {
  const toneCls = tone === 'emerald' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400'
    : tone === 'rose' ? 'text-rose-400' : tone === 'sky' ? 'text-sky-400' : 'text-foreground';
  const display = value == null ? '—' : value;
  return (
    <Card className="border-border">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground"><Icon className="w-3.5 h-3.5" />{label}</div>
        {loading ? <Skeleton className="h-7 w-12 mt-1" /> : <div className={`text-2xl font-bold tabular-nums mt-0.5 ${toneCls}`} style={{ fontFamily: 'Manrope' }}>{display}</div>}
      </CardContent>
    </Card>
  );
}

function ClusterCards({ clusters, allTotal, selected, onSelect, search, onSearch, problemOnly, onProblemOnly, summary }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-xs" placeholder="Cari cluster…" value={search} onChange={(e) => onSearch(e.target.value)} data-testid="genieacs-cluster-search" />
        </div>
        <Button variant={problemOnly ? 'default' : 'outline'} size="sm" className="h-8 text-xs" onClick={() => onProblemOnly(!problemOnly)} data-testid="genieacs-problem-only">
          <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Problem Cluster Only
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        <ClusterCard name="Semua Device" total={allTotal} online={summary?.online} warning={summary?.warning}
          offline={summary?.offline} fault={summary?.fault} selected={selected === '__all__'}
          onClick={() => onSelect('__all__')} testId="genieacs-cluster-all" isAll />
        {clusters.map((c) => (
          <ClusterCard key={c.name} name={c.label || c.name} total={c.total} online={c.online} warning={c.warning}
            offline={c.offline} fault={c.fault} selected={selected === c.name} onClick={() => onSelect(c.name)}
            testId={`genieacs-cluster-${c.name}`} />
        ))}
        {clusters.length === 0 && (
          <div className="text-xs text-muted-foreground py-3 px-2">Belum ada cluster terdeteksi. Beri tag <span className="font-mono">CLUSTER:NAMA</span> pada device di GenieACS.</div>
        )}
      </div>
    </div>
  );
}

function ClusterCard({ name, total, online, warning, offline, fault, selected, onClick, testId, isAll }) {
  return (
    <button onClick={onClick} data-testid={testId}
      className={`shrink-0 w-[180px] text-left rounded-xl border p-3 transition-all ${selected ? 'border-sky-500 bg-sky-500/10 ring-2 ring-sky-500/40' : 'border-border bg-card hover:border-sky-500/40 hover:bg-accent/40'}`}>
      <div className="flex items-center gap-1.5">
        <MapPin className={`w-3.5 h-3.5 ${selected ? 'text-sky-400' : 'text-muted-foreground'}`} />
        <div className="font-semibold text-sm truncate" style={{ fontFamily: 'Manrope' }}>{name}</div>
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1" style={{ fontFamily: 'Manrope' }}>{total ?? 0}<span className="text-[10px] font-normal text-muted-foreground ml-1">device</span></div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1.5 text-[11px]">
        <Stat dot="bg-emerald-400" label="Online" value={online} />
        <Stat dot="bg-amber-400" label="Warning" value={warning} />
        <Stat dot="bg-rose-400" label="Offline" value={offline} />
        <Stat dot="bg-fuchsia-400" label="Fault" value={fault} />
      </div>
    </button>
  );
}
function Stat({ dot, label, value }) {
  return <div className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} /><span className="text-muted-foreground">{label}</span><span className="ml-auto tabular-nums font-medium">{value ?? 0}</span></div>;
}

function DeviceTable({ devices, loading, onOpen, pageStart }) {
  return (
    <div className="border border-border rounded-md overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {['No', 'Cluster', 'PPPoE Username', 'RX Power', 'Serial Number', 'Manufacturer', 'Model', 'Last Inform', 'Last Boot', 'Status'].map((h) => (
              <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && Array.from({ length: 6 }).map((_, i) => (<TableRow key={i}><TableCell colSpan={10}><Skeleton className="h-6 w-full" /></TableCell></TableRow>))}
          {!loading && devices.length === 0 && (<TableRow><TableCell colSpan={10} className="text-center py-10 text-sm text-muted-foreground">Tidak ada device.</TableCell></TableRow>)}
          {!loading && devices.map((d, i) => (
            <TableRow key={d.id} className="hover:bg-accent/40 cursor-pointer" onClick={() => onOpen(d.id)} data-testid={`genieacs-row-${d.id}`}>
              <TableCell className="text-xs text-muted-foreground tabular-nums">{pageStart + i + 1}</TableCell>
              <TableCell className="text-xs">{d.cluster ? <Badge variant="outline" className="text-[10px]">{titleCase(d.cluster)}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-xs">
                <span className="font-mono">{d.pppoe_username || <span className="text-muted-foreground font-sans">—</span>}</span>
              </TableCell>
              <TableCell className={`text-xs font-mono tabular-nums whitespace-nowrap ${d.poor_optical ? 'text-amber-400 font-semibold' : ''}`}>
                {d.rx_optical == null ? <span className="text-muted-foreground font-sans">—</span> : `${Number(d.rx_optical).toFixed(1)} dBm`}
              </TableCell>
              <TableCell className="text-xs">
                <div className="font-mono font-medium flex items-center gap-1">{d.serial || '—'}{d.has_fault && <AlertTriangle className="w-3 h-3 text-rose-400" />}</div>
                <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{d.id}</div>
              </TableCell>
              <TableCell className="text-xs">{d.manufacturer || '—'}</TableCell>
              <TableCell className="text-xs">{d.product_class || '—'}</TableCell>
              <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtInform(d.last_inform, d.last_inform_minutes)}</TableCell>
              <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">{d.last_boot ? new Date(d.last_boot).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</TableCell>
              <TableCell><StatusBadge value={d.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FaultsTable({ faults, loading, cluster, clusters, onCluster, onOpen }) {
  return (
    <Card className="border-border">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Select value={cluster} onValueChange={onCluster}>
            <SelectTrigger className="w-52 h-9" data-testid="genieacs-fault-cluster"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Cluster</SelectItem>
              {clusters.map((c) => <SelectItem key={c.name} value={c.name}>{titleCase(c.label || c.name)}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">{faults.length} fault</div>
        </div>
        <div className="border border-border rounded-md overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">
              {['Cluster', 'Device', 'Fault Code', 'Message', 'Channel', 'Retry', 'Timestamp'].map((h) => <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {loading && Array.from({ length: 4 }).map((_, i) => (<TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>))}
              {!loading && faults.length === 0 && (<TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Tidak ada fault.</TableCell></TableRow>)}
              {!loading && faults.map((f, i) => (
                <TableRow key={i} className="hover:bg-accent/40 cursor-pointer" onClick={() => f.device && onOpen(f.device)} data-testid={`genieacs-fault-${i}`}>
                  <TableCell className="text-xs">{f.cluster ? <Badge variant="outline" className="text-[10px]">{titleCase(f.cluster)}</Badge> : '—'}</TableCell>
                  <TableCell className="text-xs font-mono">{f.serial || f.device || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-rose-400">{f.code || '—'}</TableCell>
                  <TableCell className="text-xs max-w-[320px] truncate" title={f.message}>{f.message || '—'}</TableCell>
                  <TableCell className="text-xs">{f.channel || '—'}</TableCell>
                  <TableCell className="text-xs tabular-nums text-center">{f.retries ?? 0}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">{f.timestamp ? new Date(f.timestamp).toLocaleString('id-ID') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Device Detail Drawer ----------
function DeviceDetailSheet({ deviceId, onClose, canAct, onChanged }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [wifiOpen, setWifiOpen] = useState(false);
  const [pppoeOpen, setPppoeOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [rebootOpen, setRebootOpen] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/genieacs/devices/${encodeURIComponent(deviceId)}`, { params: refresh ? { refresh: true } : {} });
      setD(data);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  }, [deviceId]);
  useEffect(() => { load(); }, [load]);

  const doAction = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.queued ? `${okMsg} — antri (menunggu device inform)` : okMsg); onChanged?.(); }
    catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="genieacs-detail-sheet">
        <SheetHeader>
          <SheetTitle className="font-mono text-base flex items-center gap-2">
            {d ? (d.serial || d.id) : 'Device'} {d && <StatusBadge value={d.status} />}
          </SheetTitle>
          <SheetDescription>{d?.model} · {d?.cluster ? titleCase(d.cluster) : 'Tanpa cluster'} · {d?.mode}</SheetDescription>
        </SheetHeader>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={() => load(false)} disabled={busy} data-testid="genieacs-act-refresh-data"><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh Data</Button>
          {canAct && <>
            <Button size="sm" variant="outline" onClick={() => doAction(() => api.post(`/genieacs/devices/${encodeURIComponent(deviceId)}/refresh`).then((r) => r.data), 'Refresh from device dikirim')} disabled={busy} data-testid="genieacs-act-refresh-device"><Cpu className="w-3.5 h-3.5 mr-1" /> Refresh From Device</Button>
            <Button size="sm" variant="outline" onClick={() => setWifiOpen(true)} disabled={busy} data-testid="genieacs-act-wifi"><Wifi className="w-3.5 h-3.5 mr-1" /> Change WiFi</Button>
            <Button size="sm" variant="outline" onClick={() => setPppoeOpen(true)} disabled={busy} data-testid="genieacs-act-pppoe"><Settings2 className="w-3.5 h-3.5 mr-1" /> PPPoE</Button>
            <Button size="sm" variant="outline" onClick={() => setTagOpen(true)} disabled={busy} data-testid="genieacs-act-tag"><TagIcon className="w-3.5 h-3.5 mr-1" /> Tags</Button>
            <Button size="sm" variant="outline" className="text-rose-400 border-rose-500/40 hover:bg-rose-500/10" onClick={() => setRebootOpen(true)} disabled={busy} data-testid="genieacs-act-reboot"><Power className="w-3.5 h-3.5 mr-1" /> Reboot</Button>
          </>}
        </div>

        {loading && !d ? (
          <div className="space-y-3 mt-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
        ) : d ? (
          <div className="space-y-4 mt-4">
            <Section title="Info Device" icon={Server}>
              <KV k="Manufacturer" v={d.manufacturer} /><KV k="Model" v={d.model} />
              <KV k="Product Class" v={d.product_class} /><KV k="Serial Number" v={d.serial} mono />
              <KV k="Hardware Version" v={d.hardware_version} /><KV k="Software Version" v={d.software_version} />
              <KV k="Uptime" v={fmtUptime(d.uptime)} /><KV k="Last Inform" v={fmtInform(d.last_inform, d.last_inform_minutes)} />
              <KV k="Cluster" v={d.cluster ? titleCase(d.cluster) : null} />
              <div className="col-span-2"><div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Tags</div>
                <div className="flex flex-wrap gap-1 mt-1">{(d.tags || []).length ? d.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}</div>
              </div>
            </Section>
            <Section title="WAN" icon={Activity}>
              <KV k="WAN IP" v={d.wan_ip} mono /><KV k="Management IP" v={d.mgmt_ip} mono />
              <KV k="PPPoE Username" v={d.pppoe_username} mono /><KV k="Connection Type" v={d.connection_type} />
              <KV k="VLAN" v={d.vlan} />
            </Section>
            <Section title="PON / Optical" icon={Signal}>
              <KV k="PON Mode" v={d.pon_mode} /><KV k="RX Power" v={fmtDbm(d.rx_optical)} highlight={d.poor_optical} />
              <KV k="TX Power" v={fmtDbm(d.tx_optical)} /><KV k="Temperature" v={fmtTemp(d.temperature)} />
              <KV k="Voltage" v={d.voltage != null ? `${d.voltage} mV` : null} />
            </Section>
            <Section title="WLAN" icon={Wifi}>
              <div className="col-span-2 space-y-1">
                {(d.wlan || []).length ? d.wlan.map((w) => (
                  <div key={w.slot} className="flex items-center gap-2 text-xs border border-border/50 rounded px-2 py-1">
                    <Badge variant="outline" className="text-[10px]">Slot {w.slot}</Badge>
                    <span className="font-medium truncate flex-1">{w.ssid || '—'}</span>
                    {w.channel != null && <span className="text-muted-foreground">ch {w.channel}</span>}
                    <span className={w.enabled ? 'text-emerald-400' : 'text-muted-foreground'}>{w.enabled ? 'Enabled' : 'Disabled'}</span>
                    <span className="text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" />{w.clients ?? 0}</span>
                  </div>
                )) : <span className="text-xs text-muted-foreground">—</span>}
              </div>
            </Section>
            <Section title={`LAN Client (${(d.lan_clients || []).length})`} icon={Users}>
              <div className="col-span-2 overflow-x-auto">
                {(d.lan_clients || []).length ? (
                  <table className="w-full text-xs">
                    <thead><tr className="text-muted-foreground text-left"><th className="py-1">Hostname</th><th>IP</th><th>MAC</th><th>Iface</th><th>Active</th></tr></thead>
                    <tbody>{d.lan_clients.map((c, i) => (
                      <tr key={i} className="border-t border-border/40"><td className="py-1">{c.hostname || '—'}</td><td className="font-mono">{c.ip || '—'}</td><td className="font-mono">{c.mac || '—'}</td><td>{c.interface || '—'}</td>
                        <td>{c.active == null ? '—' : c.active ? <span className="text-emerald-400">Yes</span> : <span className="text-muted-foreground">No</span>}</td></tr>
                    ))}</tbody>
                  </table>
                ) : <span className="text-xs text-muted-foreground">—</span>}
              </div>
            </Section>
            {(d.faults || []).length > 0 && (
              <Section title={`Active Fault (${d.faults.length})`} icon={AlertTriangle}>
                <div className="col-span-2 space-y-1">
                  {d.faults.map((f, i) => (<div key={i} className="text-xs border border-rose-500/30 bg-rose-500/5 rounded px-2 py-1"><span className="font-mono text-rose-400">{f.code}</span> · {f.message}</div>))}
                </div>
              </Section>
            )}
          </div>
        ) : null}

        {d && <WifiDialog open={wifiOpen} onOpenChange={setWifiOpen} deviceId={deviceId} wlan={d.wlan || []} onDone={() => { setWifiOpen(false); load(true); }} />}
        {d && <PppoeDialog open={pppoeOpen} onOpenChange={setPppoeOpen} deviceId={deviceId} current={d.pppoe_username} onDone={() => { setPppoeOpen(false); load(true); }} />}
        {d && <TagDialog open={tagOpen} onOpenChange={setTagOpen} deviceId={deviceId} tags={d.tags || []} onDone={() => { load(false); onChanged?.(); }} />}

        <AlertDialog open={rebootOpen} onOpenChange={setRebootOpen}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Reboot device?</AlertDialogTitle>
              <AlertDialogDescription>Perangkat <span className="font-mono">{d?.serial || deviceId}</span> akan direstart. Layanan pelanggan akan terputus sesaat.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" data-testid="genieacs-reboot-confirm"
                onClick={() => { setRebootOpen(false); doAction(() => api.post(`/genieacs/devices/${encodeURIComponent(deviceId)}/reboot`).then((r) => r.data), 'Perintah reboot dikirim'); }}>
                Ya, Reboot
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 mb-2"><Icon className="w-4 h-4 text-primary" /><div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>{title}</div></div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">{children}</div>
    </div>
  );
}
function KV({ k, v, mono, highlight }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{k}</div>
      <div className={`text-sm ${mono ? 'font-mono' : ''} ${highlight ? 'text-amber-400 font-semibold' : ''}`}>{v ?? '—'}</div>
    </div>
  );
}

function WifiDialog({ open, onOpenChange, deviceId, wlan, onDone }) {
  const [slot, setSlot] = useState('1');
  const [ssid, setSsid] = useState('');
  const [pwd, setPwd] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { const w = wlan[0]; setSlot(String(w?.slot || 1)); setSsid(w?.ssid || ''); setPwd(''); } }, [open]);  // eslint-disable-line
  const submit = async () => {
    if (!ssid.trim()) return toast.error('SSID wajib diisi');
    setSaving(true);
    try { const { data } = await api.post(`/genieacs/devices/${encodeURIComponent(deviceId)}/wifi`, { slot: Number(slot), ssid: ssid.trim(), password: pwd || null }); toast.success(data.queued ? 'Perubahan WiFi antri' : 'WiFi diperbarui'); onDone(); }
    catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="genieacs-wifi-dialog">
        <DialogHeader><DialogTitle>Change WiFi</DialogTitle><DialogDescription>Password lama tidak ditampilkan. Kosongkan password bila tidak ingin mengubahnya.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">WiFi Slot</Label>
            <Select value={slot} onValueChange={setSlot}><SelectTrigger className="mt-1" data-testid="genieacs-wifi-slot"><SelectValue /></SelectTrigger>
              <SelectContent>{(wlan.length ? wlan.map((w) => String(w.slot)) : ['1', '2']).map((s) => <SelectItem key={s} value={s}>Slot {s}</SelectItem>)}</SelectContent></Select>
          </div>
          <div><Label className="text-xs">SSID</Label><Input className="mt-1" value={ssid} onChange={(e) => setSsid(e.target.value)} data-testid="genieacs-wifi-ssid" /></div>
          <div><Label className="text-xs">New Password (opsional)</Label><Input className="mt-1" type="text" placeholder="kosongkan = tidak diubah" value={pwd} onChange={(e) => setPwd(e.target.value)} data-testid="genieacs-wifi-password" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button><Button onClick={submit} disabled={saving} data-testid="genieacs-wifi-submit">{saving ? 'Menyimpan…' : 'Terapkan'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PppoeDialog({ open, onOpenChange, deviceId, current, onDone }) {
  const [username, setUsername] = useState('');
  const [pwd, setPwd] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setUsername(current || ''); setPwd(''); } }, [open]);  // eslint-disable-line
  const submit = async () => {
    if (!username.trim()) return toast.error('Username wajib diisi');
    setSaving(true);
    try { const { data } = await api.post(`/genieacs/devices/${encodeURIComponent(deviceId)}/pppoe`, { username: username.trim(), password: pwd || null }); toast.success(data.queued ? 'Perubahan PPPoE antri' : 'PPPoE diperbarui'); onDone(); }
    catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="genieacs-pppoe-dialog">
        <DialogHeader><DialogTitle>PPPoE Setting</DialogTitle><DialogDescription>Kosongkan password bila tidak ingin mengubahnya.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">PPPoE Username</Label><Input className="mt-1" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="genieacs-pppoe-username" /></div>
          <div><Label className="text-xs">Password (opsional)</Label><Input className="mt-1" value={pwd} onChange={(e) => setPwd(e.target.value)} data-testid="genieacs-pppoe-password" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button><Button onClick={submit} disabled={saving} data-testid="genieacs-pppoe-submit">{saving ? 'Menyimpan…' : 'Terapkan'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagDialog({ open, onOpenChange, deviceId, tags, onDone }) {
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!newTag.trim()) return;
    setBusy(true);
    try { await api.post(`/genieacs/devices/${encodeURIComponent(deviceId)}/tags/${encodeURIComponent(newTag.trim())}`); toast.success('Tag ditambahkan'); setNewTag(''); onDone(); }
    catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  const remove = async (t) => {
    setBusy(true);
    try { await api.delete(`/genieacs/devices/${encodeURIComponent(deviceId)}/tags/${encodeURIComponent(t)}`); toast.success('Tag dihapus'); onDone(); }
    catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="genieacs-tag-dialog">
        <DialogHeader><DialogTitle>Tag Management</DialogTitle><DialogDescription>Tag <span className="font-mono">CLUSTER:NAMA</span> otomatis menjadi cluster filter.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {tags.length ? tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-xs border border-border rounded px-2 py-1">{t}
              <button className="text-rose-400 hover:text-rose-600" onClick={() => remove(t)} disabled={busy} data-testid={`genieacs-tag-remove-${t}`}><X className="w-3 h-3" /></button>
            </span>
          )) : <span className="text-xs text-muted-foreground">Belum ada tag.</span>}
        </div>
        <div className="flex gap-2 mt-2">
          <Input placeholder="CLUSTER:JAKARTA / VIP / OLT-01" value={newTag} onChange={(e) => setNewTag(e.target.value)} data-testid="genieacs-tag-input" />
          <Button onClick={add} disabled={busy} data-testid="genieacs-tag-add">Tambah</Button>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
