import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { toast } from 'sonner';
import {
  Server, RefreshCw, ChevronLeft, Search, Cpu, Signal, Users, ExternalLink,
  CheckCircle2, XCircle, AlertTriangle, HelpCircle, Wifi, MapPin, Clock, Link2, Zap,
} from 'lucide-react';
import api, { formatApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useProvisioning, AuthorizeSheet, ProvisionActionsBar } from '@/pages/network/OLTProvision';

const STATUS_META = {
  ONLINE: { badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400', icon: CheckCircle2 },
  LOS: { badge: 'border-rose-500/40 bg-rose-500/10 text-rose-300', dot: 'bg-rose-400', icon: XCircle },
  DYING_GASP: { badge: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300', dot: 'bg-fuchsia-400', icon: AlertTriangle },
  OFFLINE: { badge: 'border-slate-500/40 bg-slate-500/10 text-slate-300', dot: 'bg-slate-400', icon: XCircle },
  UNKNOWN: { badge: 'border-border text-muted-foreground bg-muted/40', dot: 'bg-slate-400', icon: HelpCircle },
};
const STATUS_LABEL = { ONLINE: 'Online', LOS: 'LOS', DYING_GASP: 'Dying Gasp', OFFLINE: 'Offline', UNKNOWN: 'Unknown' };
function StatusBadge({ value }) {
  const m = STATUS_META[value] || STATUS_META.UNKNOWN;
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${m.badge}`}><span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{STATUS_LABEL[value] || 'Unknown'}</span>;
}
const dbm = (v) => (v == null ? '—' : `${Number(v).toFixed(1)} dBm`);

export default function OLTDetail() {
  const { oltId } = useParams();
  const nav = useNavigate();
  const { canWrite, canDelete } = useAuth();
  const { enabled: provEnabled, profiles } = useProvisioning(oltId);
  const [authz, setAuthz] = useState(null); // null | {} | {pon, serial_number}
  const [audit, setAudit] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [tab, setTab] = useState('overview');

  const [pons, setPons] = useState([]);
  const [cards, setCards] = useState([]);
  const [uncfg, setUncfg] = useState([]);
  const [alarms, setAlarms] = useState(null);

  const [filters, setFilters] = useState({ q: '', pon: '', status: 'all', model: 'all' });
  const [onus, setOnus] = useState([]);
  const [onuTotal, setOnuTotal] = useState(0);
  const [onuModels, setOnuModels] = useState([]);
  const [loadingOnu, setLoadingOnu] = useState(false);
  const [detailIndex, setDetailIndex] = useState(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/olt/${oltId}/summary`);
      setSummary(data);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  }, [oltId]);

  const loadOnus = useCallback(async () => {
    setLoadingOnu(true);
    try {
      const params = { limit: 500 };
      if (filters.pon) params.pon = filters.pon;
      if (filters.q) params.q = filters.q;
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.model !== 'all') params.model = filters.model;
      const { data } = await api.get(`/olt/${oltId}/onus`, { params });
      setOnus(data.items || []); setOnuTotal(data.total || 0); setOnuModels(data.models || []);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoadingOnu(false); }
  }, [oltId, filters]);

  const loadTab = useCallback(async (t) => {
    try {
      if (t === 'pon') setPons((await api.get(`/olt/${oltId}/pon`)).data.items || []);
      else if (t === 'cards') setCards((await api.get(`/olt/${oltId}/cards`)).data.items || []);
      else if (t === 'uncfg') setUncfg((await api.get(`/olt/${oltId}/unconfigured`)).data.items || []);
      else if (t === 'alarms') setAlarms((await api.get(`/olt/${oltId}/alarms`)).data);
      else if (t === 'audit') setAudit((await api.get(`/olt/provision/audit`, { params: { olt_id: oltId, limit: 100 } })).data.items || []);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [oltId]);

  useEffect(() => { loadSummary(); loadOnus(); loadTab('pon'); }, [loadSummary]);  // eslint-disable-line
  useEffect(() => { if (tab === 'onu') loadOnus(); else loadTab(tab); }, [tab]);  // eslint-disable-line
  useEffect(() => { loadOnus(); }, [filters]);  // eslint-disable-line

  const manualPoll = async () => {
    setPolling(true);
    try {
      const { data } = await api.post(`/olt/${oltId}/poll`);
      if (data.ok) toast.success('Poll selesai'); else toast.error(data.error || 'Poll gagal');
      loadSummary(); loadOnus(); loadTab('pon');
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setPolling(false); }
  };

  const card = summary?.card || {};
  const olt = summary?.olt || {};
  const provWritable = provEnabled && !!olt.supports_provisioning;

  if (loading && !summary) return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'OLT Management', to: '/network/olt' }, { label: olt.name || 'OLT' }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => nav('/network/olt')}><ChevronLeft className="w-4 h-4" /></Button>
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30"><Server className="w-4 h-4 text-sky-300" /></span>
              <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>{olt.name}</h1>
              {card.connected ? <StatusBadge value="ONLINE" /> : <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-300">Unreachable</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <Cpu className="w-3.5 h-3.5" />{olt.vendor} · {olt.model}
              <MapPin className="w-3.5 h-3.5" />{olt.location_id || 'Tanpa lokasi'}
              <span className="font-mono">{olt.host}</span>
              {card.software_version && <Badge variant="secondary" className="text-[10px]">{card.software_version}</Badge>}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={manualPoll} disabled={polling} data-testid="olt-detail-poll"><RefreshCw className={`w-4 h-4 mr-1.5 ${polling ? 'animate-spin' : ''}`} /> Poll Now</Button>
      </div>

      {summary?.error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 p-3 text-sm">{summary.error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
        <Sum label="Total ONU" value={card.total_onu} />
        <Sum label="Online" value={card.online_onu} tone="emerald" />
        <Sum label="LOS" value={card.los_onu} tone="rose" />
        <Sum label="Dying Gasp" value={card.dying_gasp_onu} tone="fuchsia" />
        <Sum label="Offline" value={card.offline_onu} tone="slate" />
        <Sum label="Unconfigured" value={card.unconfigured_onu} tone="amber" />
        <Sum label="Total PON" value={card.total_pon} />
      </div>
      <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Last Poll: {card.last_poll ? new Date(card.last_poll).toLocaleString('id-ID') : 'belum pernah'}</div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview" data-testid="olt-tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="pon" data-testid="olt-tab-pon">PON Ports</TabsTrigger>
          <TabsTrigger value="onu" data-testid="olt-tab-onu">ONU</TabsTrigger>
          <TabsTrigger value="uncfg" data-testid="olt-tab-uncfg">Unconfigured ONU</TabsTrigger>
          <TabsTrigger value="cards" data-testid="olt-tab-cards">Cards / Boards</TabsTrigger>
          <TabsTrigger value="alarms" data-testid="olt-tab-alarms">Alarm / History</TabsTrigger>
          {provWritable && <TabsTrigger value="audit" data-testid="olt-tab-audit">Provisioning Log</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="mt-3">
          <Card className="border-border"><CardContent className="p-4 grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5 text-sm">
              <KV k="Name" v={olt.name} /><KV k="Vendor / Model" v={`${olt.vendor} ${olt.model}`} />
              <KV k="Host" v={olt.host} mono /><KV k="Protocol" v={(olt.protocol || '').toUpperCase()} />
              <KV k="Location / POP" v={olt.location_id} /><KV k="Software" v={card.software_version} />
            </div>
            <div className="space-y-1.5 text-sm">
              <KV k="Connection" v={card.connected ? 'Online' : 'Unreachable'} />
              <KV k="Poll Interval" v={`${olt.poll_interval}s`} /><KV k="Last Poll" v={card.last_poll ? new Date(card.last_poll).toLocaleString('id-ID') : '—'} />
              <KV k="Adapter" v={olt.implemented ? 'Ready' : 'Coming Soon'} />
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="pon" className="mt-3">
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{['PON', 'Total ONU', 'Online', 'LOS', 'Dying Gasp', 'Offline', ''].map((h) => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {pons.length === 0 && (<TableRow><TableCell colSpan={7} className="text-center py-8 text-sm text-muted-foreground">Belum ada data PON.</TableCell></TableRow>)}
                {pons.map((p) => (
                  <TableRow key={p.pon} className="hover:bg-accent/40">
                    <TableCell className="text-xs font-mono">{p.pon}</TableCell>
                    <TableCell className="text-xs tabular-nums">{p.total_onu}</TableCell>
                    <TableCell className="text-xs tabular-nums text-emerald-400">{p.online}</TableCell>
                    <TableCell className="text-xs tabular-nums text-rose-400">{p.los}</TableCell>
                    <TableCell className="text-xs tabular-nums text-fuchsia-400">{p.dying_gasp}</TableCell>
                    <TableCell className="text-xs tabular-nums text-slate-400">{p.offline}</TableCell>
                    <TableCell><Button size="sm" variant="outline" className="h-7" onClick={() => { setFilters((f) => ({ ...f, pon: p.pon })); setTab('onu'); }} data-testid={`olt-pon-view-${p.pon}`}>View ONU</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="onu" className="mt-3 space-y-3">
          <Card className="border-border"><CardContent className="p-3">
            <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9 h-9" placeholder="Cari name, serial, index, model, VLAN…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} data-testid="olt-onu-search" />
              </div>
              {filters.pon && <Badge variant="outline" className="h-9 flex items-center gap-1">PON {filters.pon}<button onClick={() => setFilters({ ...filters, pon: '' })} className="ml-1 text-rose-400">✕</button></Badge>}
              <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}><SelectTrigger className="w-full lg:w-36 h-9" data-testid="olt-onu-status"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua Status</SelectItem><SelectItem value="ONLINE">Online</SelectItem><SelectItem value="LOS">LOS</SelectItem><SelectItem value="DYING_GASP">Dying Gasp</SelectItem><SelectItem value="OFFLINE">Offline</SelectItem></SelectContent></Select>
              <Select value={filters.model} onValueChange={(v) => setFilters({ ...filters, model: v })}><SelectTrigger className="w-full lg:w-40 h-9" data-testid="olt-onu-model"><SelectValue placeholder="Model" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua Model</SelectItem>{onuModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="border border-border rounded-md overflow-x-auto mt-3">
              <Table>
                <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{['PON', 'ONU', 'Name', 'Model', 'Serial', 'Status', 'RX', 'TX', 'Profile', 'Bandwidth', 'INET VLAN', 'TR069 VLAN', ''].map((h) => <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {loadingOnu && Array.from({ length: 6 }).map((_, i) => (<TableRow key={i}><TableCell colSpan={13}><Skeleton className="h-6 w-full" /></TableCell></TableRow>))}
                  {!loadingOnu && onus.length === 0 && (<TableRow><TableCell colSpan={13} className="text-center py-10 text-sm text-muted-foreground">Tidak ada ONU.</TableCell></TableRow>)}
                  {!loadingOnu && onus.map((o) => (
                    <TableRow key={o.onu_index} className="hover:bg-accent/40 cursor-pointer" onClick={() => setDetailIndex(o.onu_index)} data-testid={`olt-onu-row-${o.onu_index}`}>
                      <TableCell className="text-xs font-mono">{o.pon}</TableCell>
                      <TableCell className="text-xs font-mono">{o.onu_index}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate">{o.name || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs">{o.model || '—'}</TableCell>
                      <TableCell className="text-xs font-mono">{o.serial_number || '—'}</TableCell>
                      <TableCell><StatusBadge value={o.status} /></TableCell>
                      <TableCell className="text-xs font-mono tabular-nums">{dbm(o.rx_power)}</TableCell>
                      <TableCell className="text-xs font-mono tabular-nums">{dbm(o.tx_power)}</TableCell>
                      <TableCell className="text-xs">{o.profile || '—'}</TableCell>
                      <TableCell className="text-xs">{o.downstream_limit ? `${o.upstream_limit || '?'}/${o.downstream_limit}` : '—'}</TableCell>
                      <TableCell className="text-xs tabular-nums">{o.internet_vlan ?? '—'}</TableCell>
                      <TableCell className="text-xs tabular-nums">{o.tr069_vlan ?? '—'}</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="h-7" onClick={(e) => { e.stopPropagation(); setDetailIndex(o.onu_index); }}>Detail</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="text-xs text-muted-foreground mt-2">Menampilkan {onus.length} dari {onuTotal} ONU. Kolom optical/VLAN terisi bertahap dari background polling atau saat detail dibuka.</div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="uncfg" className="mt-3">
          {provWritable && canWrite && (
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-xs text-muted-foreground">ONU terdeteksi namun belum terdaftar. Klik <b>Authorize</b> untuk provisioning.</p>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => setAuthz({})} data-testid="olt-authorize-open"><Zap className="w-3.5 h-3.5 mr-1.5" /> Authorize ONU (Manual)</Button>
            </div>
          )}
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{['PON', 'Serial Number', 'State', provWritable && canWrite ? 'Action' : ''].map((h) => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {uncfg.length === 0 && (<TableRow><TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground">Unconfigured ONU = 0</TableCell></TableRow>)}
                {uncfg.map((u, i) => (
                  <TableRow key={i} data-testid={`olt-uncfg-row-${i}`}>
                    <TableCell className="text-xs font-mono">{u.pon || '—'}</TableCell>
                    <TableCell className="text-xs font-mono">{u.serial_number}</TableCell>
                    <TableCell className="text-xs">{u.state || '—'}</TableCell>
                    <TableCell>{provWritable && canWrite && (
                      <Button size="sm" variant="outline" className="h-7 border-amber-500/40 text-amber-300" onClick={() => setAuthz(u)} data-testid={`olt-uncfg-authorize-${i}`}><Zap className="w-3.5 h-3.5 mr-1" /> Authorize</Button>
                    )}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="cards" className="mt-3">
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{['Rack', 'Shelf', 'Slot', 'Configured Type', 'Real Type', 'Ports', 'HW Ver', 'SW Ver', 'Status'].map((h) => <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {cards.length === 0 && (<TableRow><TableCell colSpan={9} className="text-center py-8 text-sm text-muted-foreground">Belum ada data card.</TableCell></TableRow>)}
                {cards.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{c.rack}</TableCell><TableCell className="text-xs">{c.shelf}</TableCell><TableCell className="text-xs">{c.slot}</TableCell>
                    <TableCell className="text-xs font-mono">{c.cfg_type || '—'}</TableCell><TableCell className="text-xs font-mono">{c.real_type || '—'}</TableCell>
                    <TableCell className="text-xs tabular-nums">{c.port_count ?? '—'}</TableCell><TableCell className="text-xs">{c.hardware_version || '—'}</TableCell>
                    <TableCell className="text-xs">{c.software_version || '—'}</TableCell><TableCell className="text-xs">{c.status || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="alarms" className="mt-3">
          <div className="text-center py-16 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            {alarms && alarms.supported === false ? 'Not Supported by This Adapter' : 'Tidak ada alarm.'}
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{['Waktu', 'User', 'Action', 'ONU', 'Result', 'Commands'].map((h) => <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {audit.length === 0 && (<TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Belum ada aktivitas provisioning.</TableCell></TableRow>)}
                {audit.map((a) => (
                  <TableRow key={a.id} data-testid={`olt-audit-${a.id}`}>
                    <TableCell className="text-xs whitespace-nowrap">{a.ts ? new Date(a.ts).toLocaleString('id-ID') : '—'}</TableCell>
                    <TableCell className="text-xs">{a.user_name || a.user_email || '—'}</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline" className="text-[10px] uppercase">{a.action}</Badge>{a.dry_run && <span className="text-[10px] text-muted-foreground ml-1">(preview)</span>}</TableCell>
                    <TableCell className="text-xs font-mono">{a.onu_index || '—'}</TableCell>
                    <TableCell className="text-xs">{a.ok ? <span className="text-emerald-400">OK</span> : <span className="text-rose-400" title={a.error}>Failed</span>}</TableCell>
                    <TableCell className="text-[11px] font-mono max-w-[280px] truncate" title={(a.commands || []).join('\n')}>{(a.commands || []).join(' ; ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {authz !== null && (
        <AuthorizeSheet oltId={oltId} open={authz !== null} prefill={authz} profiles={profiles}
          onClose={() => setAuthz(null)} onDone={() => { setAuthz(null); manualPoll(); loadTab('uncfg'); }} />
      )}

      {detailIndex && <ONUDetailDrawer oltId={oltId} onuIndex={detailIndex} onClose={() => setDetailIndex(null)} onMapped={loadOnus} provEnabled={provWritable} canWrite={canWrite} canDelete={canDelete} />}
    </div>
  );
}

function Sum({ label, value, tone }) {
  const t = { emerald: 'text-emerald-400', rose: 'text-rose-400', fuchsia: 'text-fuchsia-400', amber: 'text-amber-400', slate: 'text-slate-400' }[tone] || 'text-foreground';
  return (<Card className="border-border"><CardContent className="p-3"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div><div className={`text-2xl font-bold tabular-nums ${t}`} style={{ fontFamily: 'Manrope' }}>{value ?? '—'}</div></CardContent></Card>);
}
function KV({ k, v, mono }) {
  return (<div className="flex items-center justify-between gap-3"><span className="text-[11px] uppercase tracking-widest text-muted-foreground">{k}</span><span className={`text-sm ${mono ? 'font-mono' : ''}`}>{v ?? '—'}</span></div>);
}

function ONUDetailDrawer({ oltId, onuIndex, onClose, onMapped, provEnabled, canWrite, canDelete }) {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapName, setMapName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/olt/${oltId}/onu/${onuIndex}`, { params: refresh ? { refresh: true } : {} });
      setD(data); setMapName(data?.customer?.customer_name || '');
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  }, [oltId, onuIndex]);
  useEffect(() => { load(); }, [load]);

  const saveMap = async () => {
    setSaving(true);
    try {
      await api.post(`/olt/${oltId}/onu/${onuIndex}/customer`, { customer_name: mapName || null, match_by: 'manual' });
      toast.success('Mapping customer disimpan'); onMapped?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="olt-onu-detail">
        <SheetHeader>
          <SheetTitle className="font-mono text-base flex items-center gap-2">{onuIndex} {d && <StatusBadge value={d.status} />}</SheetTitle>
          <SheetDescription>{d?.name || 'ONU'} · {d?.model || '—'}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={() => load(true)} disabled={loading} data-testid="olt-onu-refresh"><RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh</Button>
          {d?.genieacs_serial && (
            <Button size="sm" variant="outline" onClick={() => nav(`/network/genieacs?q=${encodeURIComponent(d.genieacs_serial)}`)} data-testid="olt-onu-genieacs">
              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open GenieACS Detail
            </Button>
          )}
        </div>

        {loading && !d ? (<div className="space-y-3 mt-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>) : d ? (
          <div className="space-y-4 mt-4">
            <Section title="Identity" icon={Cpu}>
              <KV2 k="ONU Index" v={d.onu_index} mono /><KV2 k="Name" v={d.name} />
              <KV2 k="Model" v={d.model} /><KV2 k="Serial" v={d.serial_number} mono />
              <KV2 k="Status" v={STATUS_LABEL[d.status] || 'Unknown'} /><KV2 k="Channel" v={d.channel} />
              {d.vendor_id && <KV2 k="Vendor" v={d.vendor_id} />}
              {d.version && <KV2 k="Version" v={d.version} />}
              {d.equipment_id && <KV2 k="Equipment ID" v={d.equipment_id} mono />}
            </Section>
            <Section title="Optical" icon={Signal}>
              <KV2 k="ONU RX Power" v={dbm(d.rx_power)} highlight={d.rx_power != null && d.rx_power < -27} />
              {d.olt_rx_power != null && <KV2 k="OLT RX Power" v={dbm(d.olt_rx_power)} />}
              <KV2 k="TX Power" v={dbm(d.tx_power)} />
              <KV2 k="Attenuation" v={d.attenuation != null ? `${Number(d.attenuation).toFixed(2)} dB` : null} />
              <KV2 k="Distance" v={d.distance != null ? `${d.distance} m (${(d.distance / 1000).toFixed(2)} km)` : null} />
              {d.temperature != null && <KV2 k="Temperature" v={`${Number(d.temperature).toFixed(1)} °C`} />}
              {d.voltage != null && <KV2 k="Voltage" v={`${Number(d.voltage).toFixed(2)} V`} />}
            </Section>
            <Section title="Service" icon={Wifi}>
              <KV2 k="Profile" v={d.profile} /><KV2 k="Bandwidth" v={d.downstream_limit ? `${d.upstream_limit || '?'} / ${d.downstream_limit}` : null} />
              <KV2 k="Internet VLAN" v={d.internet_vlan} /><KV2 k="TR069 VLAN" v={d.tr069_vlan} />
              <KV2 k="INET Gemport" v={d.internet_gemport} /><KV2 k="TR069 Gemport" v={d.tr069_gemport} />
            </Section>
            <Section title="History" icon={Clock}>
              <KV2 k="Online Time" v={d.online_time} /><KV2 k="Offline Time" v={d.offline_time} />
              <KV2 k="Offline Cause" v={d.offline_cause} /><KV2 k="Uptime" v={d.uptime} />
            </Section>
            {d.eth && (
              <Section title="LAN / Ethernet" icon={Wifi}>
                <KV2 k="Link Status" v={d.eth.link_status} /><KV2 k="Speed Status" v={d.eth.speed_status} />
                <KV2 k="Admin Status" v={d.eth.admin_status} /><KV2 k="Speed Config" v={d.eth.speed_config} />
                <KV2 k="Bridge / IP" v={d.eth.bridge_ip} /><KV2 k="Eth Loop" v={d.eth.eth_loop} />
              </Section>
            )}
            {Array.isArray(d.deregist_history) && d.deregist_history.length > 0 && (
              <div className="rounded-lg border border-border p-3" data-testid="olt-onu-dereg-history">
                <div className="flex items-center gap-2 mb-2"><Clock className="w-4 h-4 text-primary" /><div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>Deregistration History</div></div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {d.deregist_history.map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-xs border-b border-border/40 pb-1">
                      <span className="font-mono text-muted-foreground">{h.time}</span>
                      <span className="flex items-center gap-1.5">
                        {h.reason && <Badge variant="outline" className="text-[10px]">{h.reason}</Badge>}
                        <span>{h.raw_reason || '—'}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Section title="Customer Mapping" icon={Link2}>
              <div className="col-span-2 flex items-end gap-2">
                <div className="flex-1"><Label className="text-xs">Customer / Service Name</Label>
                  <Input className="mt-1" value={mapName} onChange={(e) => setMapName(e.target.value)} placeholder="nama customer / service" data-testid="olt-onu-map-name" /></div>
                <Button onClick={saveMap} disabled={saving} data-testid="olt-onu-map-save">Simpan</Button>
              </div>
            </Section>
            {provEnabled && (
              <ProvisionActionsBar oltId={oltId} onuIndex={onuIndex} currentName={d.name}
                canWrite={canWrite} canDelete={canDelete}
                onDone={() => { load(true); onMapped?.(); }} />
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
function Section({ title, icon: Icon, children }) {
  return (<div className="rounded-lg border border-border p-3"><div className="flex items-center gap-2 mb-2"><Icon className="w-4 h-4 text-primary" /><div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>{title}</div></div><div className="grid grid-cols-2 gap-x-4 gap-y-1.5">{children}</div></div>);
}
function KV2({ k, v, mono, highlight }) {
  return (<div><div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{k}</div><div className={`text-sm ${mono ? 'font-mono' : ''} ${highlight ? 'text-amber-400 font-semibold' : ''}`}>{v ?? '—'}</div></div>);
}
