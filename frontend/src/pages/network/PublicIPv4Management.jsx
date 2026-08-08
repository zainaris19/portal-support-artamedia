import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Globe, Layers, CheckCircle2, Circle, Lock, Clock, AlertOctagon, Search, ArrowLeft, Sparkles, Plus, ShieldOff, Grid3x3, List, RefreshCw, Eye } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import Breadcrumb from '@/components/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

const STATUS_STYLES = {
  Used: 'bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300',
  Reserved: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
  Pending: 'bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300',
  Available: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  Conflict: 'bg-fuchsia-500/10 text-fuchsia-700 border-fuchsia-500/30 dark:text-fuchsia-300',
  Disabled: 'bg-slate-500/10 text-slate-700 border-slate-500/30 dark:text-slate-300',
};

const STATUS_DOT = {
  Used: 'bg-rose-500',
  Reserved: 'bg-amber-500',
  Pending: 'bg-sky-500',
  Available: 'bg-emerald-500',
  Conflict: 'bg-fuchsia-500',
  Disabled: 'bg-slate-400',
};

const ALL_STATUSES = ['Used', 'Available', 'Reserved', 'Pending', 'Conflict', 'Disabled'];

const USAGE_TYPES = [
  'Customer Dedicated', 'Customer Broadband', 'VPS Server', 'Internal Server',
  'Network Infrastructure', 'Point-to-Point', 'Management', 'Loopback',
  'Data Center', 'Reserved', 'Other',
];

export default function PublicIPv4Management() {
  const [summary, setSummary] = useState(null);
  const [prefixes, setPrefixes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrefix, setSelectedPrefix] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        api.get('/network/ipam/summary'),
        api.get('/network/ipam/prefixes'),
      ]);
      setSummary(s.data); setPrefixes(p.data || []);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (selectedPrefix) {
    return <PrefixDetail prefix={selectedPrefix} onBack={() => { setSelectedPrefix(null); load(); }} />;
  }

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'Public IPv4 Management' }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Public IPv4 Management</h1>
          <p className="text-sm text-muted-foreground mt-1">IPAM untuk 4 prefix publik Artamedia — total 1,024 alamat IPv4.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-1.5" /> Refresh</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Stat icon={Globe} label="Total IPv4" value={summary?.total} loading={loading} tone="slate" />
        <Stat icon={Circle} label="Used" value={summary?.used} loading={loading} tone="rose" />
        <Stat icon={CheckCircle2} label="Available" value={summary?.available} loading={loading} tone="emerald" />
        <Stat icon={Lock} label="Reserved" value={summary?.reserved} loading={loading} tone="amber" />
        <Stat icon={Layers} label="Used %" value={summary ? `${summary.utilization}%` : null} loading={loading} tone="sky" />
        <Stat icon={Layers} label="Available %" value={summary ? `${summary.available_pct}%` : null} loading={loading} tone="emerald" />
        <Stat icon={AlertOctagon} label="Conflicts" value={summary?.conflicts} loading={loading} tone="fuchsia" />
        <Stat icon={Clock} label="Last Sync" value={summary?.last_sync ? fmtDate(summary.last_sync) : '—'} loading={loading} tone="slate" small />
      </div>

      {/* Prefix cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44" />) :
          prefixes.map((p) => (
            <button key={p.prefix} onClick={() => setSelectedPrefix(p.prefix)} className="text-left group" data-testid={`prefix-card-${p.prefix.replace(/[./]/g, '-')}`}>
              <Card className="border-border h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/30">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Prefix</div>
                      <div className="text-lg font-semibold font-mono" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{p.prefix}</div>
                    </div>
                    {p.conflicts > 0 && (
                      <span className="text-[10px] uppercase px-2 py-0.5 rounded border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 flex items-center gap-1">
                        <AlertOctagon className="w-3 h-3" /> {p.conflicts} conflict
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <MiniStat label="Total" v={p.total} />
                    <MiniStat label="Used" v={p.used} className="text-rose-700 dark:text-rose-400" />
                    <MiniStat label="Free" v={p.available} className="text-emerald-700 dark:text-emerald-400" />
                    <MiniStat label="Rsv" v={p.reserved} className="text-amber-700 dark:text-amber-400" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                      <span>Utilization</span>
                      <span className="tabular-nums font-medium">{p.utilization}%</span>
                    </div>
                    <Progress value={p.utilization} className="h-2" />
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Clock className="w-3 h-3" /> Last sync: {p.last_sync ? fmtDate(p.last_sync) : 'Belum pernah'}
                  </div>
                </CardContent>
              </Card>
            </button>
          ))
        }
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------------
   Prefix detail (Subnet View / IP View + filters + reserve/allocate)
   ----------------------------------------------------------------------- */
function PrefixDetail({ prefix, onBack }) {
  const { canWrite } = useAuth();
  const [mode, setMode] = useState('subnet'); // 'subnet' or 'ip'
  const [data, setData] = useState({ blocks: [] });
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');
  const [routerFilter, setRouterFilter] = useState('all');
  const [q, setQ] = useState('');
  const [openReserve, setOpenReserve] = useState(false);
  const [openAllocate, setOpenAllocate] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState(null);

  const parts = prefix.split('/');
  const [a, b, c, d] = parts[0].split('.').map(Number);
  const plen = Number(parts[1]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/network/ipam/prefix/${a}/${b}/${c}/${d}/${plen}/subnets`;
      const { data: dd } = await api.get(url);
      setData(dd);
      if (mode === 'ip') {
        const { data: ipd } = await api.get(`/network/ipam/prefix/${a}/${b}/${c}/${d}/${plen}/addresses`);
        setAddresses(ipd.addresses || []);
      }
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, [a, b, c, d, plen, mode]);
  useEffect(() => { load(); }, [load]);

  const blocks = data.blocks || [];
  const routerNames = useMemo(() => {
    const s = new Set();
    blocks.forEach((b_) => (b_.routers || []).forEach((r) => s.add(r)));
    return Array.from(s);
  }, [blocks]);

  const filteredBlocks = useMemo(() => {
    return blocks.filter((b_) => {
      if (statusFilter !== 'all' && b_.status !== statusFilter) return false;
      if (sizeFilter !== 'all' && `/${b_.cidr.split('/')[1]}` !== sizeFilter) return false;
      if (routerFilter !== 'all' && !(b_.routers || []).includes(routerFilter)) return false;
      if (q) {
        const s = q.toLowerCase();
        const hay = [b_.cidr, ...(b_.route_comments || []).map((c) => c.comment), (b_.allocation?.allocation_name || ''), (b_.allocation?.sid || ''), ...(b_.routers || [])].join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [blocks, statusFilter, sizeFilter, routerFilter, q]);

  const filteredAddresses = useMemo(() => {
    return addresses.filter((ip) => {
      if (statusFilter !== 'all' && ip.status !== statusFilter) return false;
      if (q && !ip.ip.includes(q) && !(ip.allocation_name || '').toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [addresses, statusFilter, q]);

  const uniqueSizes = useMemo(() => Array.from(new Set(blocks.map((b_) => `/${b_.cidr.split('/')[1]}`))).sort(), [blocks]);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'Public IPv4 Management', to: '#' }, { label: prefix }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1.5" /> Kembali</Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight font-mono" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{prefix}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Detail alokasi dan reservasi.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="border border-border rounded-md flex overflow-hidden">
            <button onClick={() => setMode('subnet')} className={cn('px-3 py-1.5 text-xs flex items-center gap-1.5', mode === 'subnet' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
              <List className="w-3.5 h-3.5" /> Subnet View
            </button>
            <button onClick={() => setMode('ip')} className={cn('px-3 py-1.5 text-xs flex items-center gap-1.5', mode === 'ip' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}>
              <Grid3x3 className="w-3.5 h-3.5" /> IP Address View
            </button>
          </div>
          {canWrite && (
            <>
              <Button size="sm" variant="outline" onClick={() => setOpenAllocate(true)} data-testid="ipam-allocate-btn"><Sparkles className="w-4 h-4 mr-1.5" /> Allocate Available</Button>
              <Button size="sm" onClick={() => setOpenReserve(true)} data-testid="ipam-reserve-btn"><Plus className="w-4 h-4 mr-1.5" /> Reserve IP/Subnet</Button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="border-border"><CardContent className="p-3 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {['all', ...ALL_STATUSES].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} data-testid={`filter-${s}`}
              className={cn('text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1.5',
                statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-accent')}>
              {s !== 'all' && <span className={cn('w-2 h-2 rounded-full', STATUS_DOT[s])} />} {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari IP, CIDR, customer, comment, SID, router…" className="pl-9 h-9" />
          </div>
          {mode === 'subnet' && (
            <>
              <Select value={sizeFilter} onValueChange={setSizeFilter}>
                <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Subnet Size" /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua Ukuran</SelectItem>{uniqueSizes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              {routerNames.length > 0 && (
                <Select value={routerFilter} onValueChange={setRouterFilter}>
                  <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Router" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Semua Router</SelectItem>{routerNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </>
          )}
        </div>
      </CardContent></Card>

      {/* Body */}
      {loading ? <Skeleton className="h-96" /> : mode === 'subnet' ? (
        <SubnetTable blocks={filteredBlocks} onView={setSelectedBlock} />
      ) : (
        <IPGrid addresses={filteredAddresses} onView={(ip) => {
          const block = blocks.find((bl) => bl.cidr === ip.cidr);
          if (block) setSelectedBlock(block);
        }} />
      )}

      <ReserveDialog open={openReserve} onOpenChange={setOpenReserve} defaultParent={prefix} onSaved={load} />
      <AllocateDialog open={openAllocate} onOpenChange={setOpenAllocate} onPick={(cidr) => { setOpenAllocate(false); setOpenReserve(true); setTimeout(() => {}, 100); }} />
      <BlockDetail block={selectedBlock} onClose={() => setSelectedBlock(null)} onSaved={load} />
    </div>
  );
}

function SubnetTable({ blocks, onView }) {
  if (blocks.length === 0) return <div className="text-sm text-muted-foreground text-center py-12">Tidak ada block yang cocok dengan filter.</div>;
  return (
    <div className="border border-border rounded-md overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="text-xs">CIDR</TableHead>
            <TableHead className="text-xs">Size</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Router / Source</TableHead>
            <TableHead className="text-xs">Allocation / Customer</TableHead>
            <TableHead className="text-xs">Comment</TableHead>
            <TableHead className="text-xs text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {blocks.map((b) => (
            <TableRow key={b.cidr + b.status} className={cn('hover:bg-accent/40', b.conflict && 'bg-fuchsia-500/5')}>
              <TableCell className="font-mono text-xs">{b.cidr}</TableCell>
              <TableCell className="text-xs tabular-nums">{b.num_addresses}</TableCell>
              <TableCell>
                <span className={cn('text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-medium', STATUS_STYLES[b.status])}>{b.status}</span>
                {b.conflict && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300">CONFLICT</span>}
              </TableCell>
              <TableCell className="text-xs">
                {(b.routers || []).length > 0 ? b.routers.join(', ') : (b.allocation ? <span className="text-muted-foreground italic">manual</span> : '—')}
                {b.protocols?.length > 0 && <div className="text-[10px] text-muted-foreground">{b.protocols.join('·')}</div>}
              </TableCell>
              <TableCell className="text-xs">
                {b.allocation?.allocation_name || '—'}
                {b.allocation?.sid && <div className="text-[10px] text-muted-foreground font-mono">SID {b.allocation.sid}</div>}
              </TableCell>
              <TableCell className="text-xs max-w-xs truncate">
                {b.allocation?.noc_comment}
                {b.route_comments?.map((c, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground truncate">MT ({c.router}): {c.comment}</div>
                ))}
              </TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onView(b)}><Eye className="w-4 h-4" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function IPGrid({ addresses, onView }) {
  if (addresses.length === 0) return <div className="text-sm text-muted-foreground text-center py-12">Tidak ada alamat cocok dengan filter.</div>;
  return (
    <Card className="border-border"><CardContent className="p-3">
      <div className="grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 gap-1.5">
        {addresses.map((ip) => (
          <button key={ip.ip} onClick={() => onView(ip)} title={`${ip.ip} — ${ip.status}${ip.allocation_name ? ` · ${ip.allocation_name}` : ''}`}
            className={cn('h-8 rounded-md border text-[9px] font-mono font-medium flex items-center justify-center transition-transform hover:scale-110', STATUS_STYLES[ip.status])}>
            {ip.ip.split('.')[3]}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] pt-3 border-t border-border">
        {ALL_STATUSES.map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={cn('w-3 h-3 rounded border', STATUS_STYLES[s])} />
            <span className="text-muted-foreground">{s}</span>
          </div>
        ))}
      </div>
    </CardContent></Card>
  );
}

function BlockDetail({ block, onClose, onSaved }) {
  const { canWrite, user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  useEffect(() => {
    if (block?.allocation) setForm({
      allocation_name: block.allocation.allocation_name || '',
      customer_id: block.allocation.customer_id || null,
      sid: block.allocation.sid || '',
      usage_type: block.allocation.usage_type || 'Other',
      noc_comment: block.allocation.noc_comment || '',
      internal_notes: block.allocation.internal_notes || '',
      status: block.allocation.status,
    });
    else if (block) setForm({ allocation_name: '', customer_id: null, sid: '', usage_type: 'Other', noc_comment: '', internal_notes: '', status: block.status || 'Used' });
    setEditing(false);
  }, [block]);

  const save = async () => {
    try {
      if (block.allocation?.id) {
        await api.patch(`/network/ipam/allocations/${block.allocation.id}`, form);
        toast.success('Alokasi diperbarui');
      } else {
        // create new "annotation" allocation attached to this route-only cidr
        await api.post('/network/ipam/allocations', {
          cidr: block.cidr, status: 'Used', ...form, mikrotik_route_comment: (block.route_comments || []).map(c => c.comment).join('; '),
        });
        toast.success('Komentar internal ditambahkan');
      }
      onSaved(); setEditing(false); onClose();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <Sheet open={!!block} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {block && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono">{block.cidr}</SheetTitle>
              <SheetDescription>{block.num_addresses} addresses · <span className={cn('inline-block px-1.5 py-0.5 rounded border text-[10px]', STATUS_STYLES[block.status])}>{block.status}</span></SheetDescription>
            </SheetHeader>
            <div className="space-y-3 py-4 text-sm">
              {block.routers?.length > 0 && (
                <div className="p-3 rounded border border-border bg-muted/30">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">MikroTik Route Info</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <I k="Routers" v={block.routers.join(', ')} />
                    <I k="Protocols" v={(block.protocols || []).join(' · ') || '—'} />
                    <I k="Gateway" v={block.gateway || '—'} />
                    <I k="Distance" v={block.distance ?? '—'} />
                    <I k="Active" v={block.active ? 'Yes' : 'No'} />
                    <I k="Disabled" v={block.disabled ? 'Yes' : 'No'} />
                    <I k="Dynamic" v={block.dynamic ? 'Yes' : 'No'} />
                    <I k="Static" v={block.static ? 'Yes' : 'No'} />
                    <I k="First Detected" v={fmtDate(block.first_detected_at)} />
                    <I k="Last Detected" v={fmtDate(block.last_detected_at)} />
                  </div>
                  {block.route_comments?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">MikroTik Route Comment</div>
                      {block.route_comments.map((c, i) => (
                        <div key={i} className="text-xs"><span className="text-muted-foreground">({c.router}):</span> {c.comment}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="p-3 rounded border border-border">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Portal Internal Info</div>
                  {canWrite && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
                </div>
                {editing ? (
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Allocation Name" full><Input value={form.allocation_name || ''} onChange={(e) => setForm({ ...form, allocation_name: e.target.value })} /></F>
                    <F label="SID / Service ID"><Input value={form.sid || ''} onChange={(e) => setForm({ ...form, sid: e.target.value })} /></F>
                    <F label="Usage Type">
                      <Select value={form.usage_type} onValueChange={(v) => setForm({ ...form, usage_type: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{USAGE_TYPES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                      </Select>
                    </F>
                    <F label="Status">
                      <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{['Used', 'Reserved', 'Pending', 'Conflict', 'Disabled'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </F>
                    <F label="NOC Comment" full><Textarea rows={2} value={form.noc_comment || ''} onChange={(e) => setForm({ ...form, noc_comment: e.target.value })} /></F>
                    <F label="Internal Notes" full><Textarea rows={2} value={form.internal_notes || ''} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} /></F>
                    <div className="col-span-2 flex justify-end gap-2 mt-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Batal</Button>
                      <Button size="sm" onClick={save}>Simpan</Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <I k="Allocation Name" v={form.allocation_name || '—'} />
                    <I k="SID / Service ID" v={form.sid || '—'} />
                    <I k="Usage Type" v={form.usage_type || '—'} />
                    <I k="Assigned By" v={block.allocation?.assigned_by || '—'} />
                    <I k="Assigned Date" v={fmtDate(block.allocation?.assigned_at)} />
                    <I k="Planned Activation" v={block.allocation?.planned_activation_date || '—'} />
                    <div className="col-span-2"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">NOC Comment</div><div>{form.noc_comment || <span className="text-muted-foreground italic">Belum ada</span>}</div></div>
                    <div className="col-span-2"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Internal Notes</div><div>{form.internal_notes || <span className="text-muted-foreground italic">—</span>}</div></div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReserveDialog({ open, onOpenChange, defaultParent, onSaved }) {
  const [form, setForm] = useState({
    cidr: '', status: 'Reserved', allocation_name: '', sid: '', usage_type: 'Customer Dedicated',
    noc_comment: '', internal_notes: '', planned_activation_date: '', override_conflict: false,
  });
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState(null);

  useEffect(() => {
    if (open) setForm((f) => ({ ...f, cidr: '', override_conflict: false })); setConflicts(null);
  }, [open]);

  const save = async () => {
    if (!form.cidr) { toast.error('CIDR wajib'); return; }
    setSaving(true); setConflicts(null);
    try {
      await api.post('/network/ipam/allocations', form);
      toast.success(`${form.status} disimpan`);
      onOpenChange(false); onSaved && onSaved();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail && typeof detail === 'object' && detail.conflicts) {
        setConflicts(detail.conflicts);
      } else {
        toast.error(formatApiError(err));
      }
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Reserve IP / Subnet</DialogTitle><DialogDescription>Reservasi manual dalam prefix Artamedia.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <F label="CIDR *" full><Input value={form.cidr} onChange={(e) => setForm({ ...form, cidr: e.target.value })} placeholder={`${defaultParent || '103.103.144.0'} — mis. 103.103.144.16/28`} className="font-mono" /></F>
          <F label="Allocation Name" full><Input value={form.allocation_name} onChange={(e) => setForm({ ...form, allocation_name: e.target.value })} placeholder="mis. Reserved for Hotel A" /></F>
          <F label="SID / Service ID"><Input value={form.sid} onChange={(e) => setForm({ ...form, sid: e.target.value })} /></F>
          <F label="Status">
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{['Reserved', 'Pending', 'Used'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Usage Type" full>
            <Select value={form.usage_type} onValueChange={(v) => setForm({ ...form, usage_type: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{USAGE_TYPES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Planned Activation Date" full><Input type="date" value={form.planned_activation_date || ''} onChange={(e) => setForm({ ...form, planned_activation_date: e.target.value })} /></F>
          <F label="NOC Comment" full><Textarea rows={2} value={form.noc_comment} onChange={(e) => setForm({ ...form, noc_comment: e.target.value })} /></F>
        </div>
        {conflicts && (
          <div className="p-3 rounded border border-fuchsia-500/30 bg-fuchsia-500/10 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-fuchsia-700 dark:text-fuchsia-300 mb-1"><AlertOctagon className="w-3.5 h-3.5" /> CIDR overlap dengan {conflicts.length} record</div>
            <ul className="space-y-0.5">
              {conflicts.map((c, i) => <li key={i} className="font-mono">{c.cidr} <span className="text-muted-foreground">({c.src}{c.router ? ` · ${c.router}` : ''}{c.status ? ` · ${c.status}` : ''})</span></li>)}
            </ul>
            <label className="mt-2 flex items-center gap-2 cursor-pointer text-fuchsia-700 dark:text-fuchsia-300">
              <input type="checkbox" checked={form.override_conflict} onChange={(e) => setForm({ ...form, override_conflict: e.target.checked })} />
              <span>Override conflict (hanya administrator)</span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Menyimpan…' : 'Reserve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllocateDialog({ open, onOpenChange, onPick }) {
  const [plen, setPlen] = useState(30);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/network/ipam/allocate-available', { prefix_length: plen });
      setSuggestions(data.suggestions || []);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (open) search(); /* eslint-disable-next-line */ }, [open, plen]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Allocate Available Subnet</DialogTitle><DialogDescription>Sistem otomatis menyarankan subnet aligned yang masih bebas.</DialogDescription></DialogHeader>
        <div className="space-y-3 py-2">
          <F label="Prefix Length">
            <Select value={String(plen)} onValueChange={(v) => setPlen(Number(v))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{[25, 26, 27, 28, 29, 30, 31, 32].map((p) => <SelectItem key={p} value={String(p)}>{`/${p}`} — {Math.pow(2, 32 - p)} addresses</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Rekomendasi</div>
            {loading ? <Skeleton className="h-40" /> : suggestions.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-6">Tidak ada subnet /{plen} yang tersedia di keempat prefix.</div>
            ) : (
              <ul className="space-y-1.5">
                {suggestions.map((s, i) => (
                  <li key={i} className="flex items-center justify-between p-2 rounded border border-border bg-muted/30">
                    <div>
                      <div className="font-mono text-sm">{s.cidr}</div>
                      <div className="text-[10px] text-muted-foreground">Parent: {s.parent}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { onPick && onPick(s.cidr); navigator.clipboard?.writeText(s.cidr); toast.success('CIDR dicopy ke clipboard'); }}>Gunakan</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------- small building blocks ------- */
function Stat({ icon: Icon, label, value, loading, tone = 'slate', small = false }) {
  const tones = {
    slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
    rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
    emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
    fuchsia: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
  };
  return (
    <Card className="border-border">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
            <div className={cn('font-bold mt-0.5 tabular-nums', small ? 'text-xs truncate' : 'text-xl')} style={{ fontFamily: 'Manrope' }}>
              {loading ? <Skeleton className="h-5 w-14" /> : (value ?? 0)}
            </div>
          </div>
          <div className={cn('w-7 h-7 rounded-md border flex items-center justify-center shrink-0', tones[tone])}>
            <Icon className="w-3.5 h-3.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function MiniStat({ label, v, className }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums mt-0.5', className)}>{v ?? 0}</div>
    </div>
  );
}
function F({ label, children, full }) {
  return (
    <div className={cn('space-y-1', full && 'col-span-2')}>
      <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function I({ k, v }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className="text-xs mt-0.5">{v || '—'}</div>
    </div>
  );
}
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
