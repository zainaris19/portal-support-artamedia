import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Plus, Search, Download, Pencil, Trash2, ChevronLeft, ChevronRight, Waypoints, ArrowRight, Check, Cable } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import Breadcrumb from '@/components/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const CONN_TYPES = ['Fiber Single-Mode', 'Fiber Multi-Mode', 'Copper UTP', 'DAC (Direct Attach)', 'Coaxial'];
const STATUSES = ['Active', 'Planned', 'Maintenance', 'Retired'];
const ENDPOINT_TYPES = [
  { value: 'device', label: 'Device' },
  { value: 'patch_panel', label: 'Patch Panel' },
  { value: 'odf', label: 'ODF (Optical Distribution Frame)' },
  { value: 'cross_connect', label: 'Cross Connect' },
  { value: 'partner_rack', label: 'Partner Rack' },
];
export const CABLE_COLORS = [
  { value: '', label: '— none —', hex: 'transparent' },
  { value: 'yellow', label: 'Yellow (Single-Mode)', hex: '#eab308' },
  { value: 'orange', label: 'Orange (Multi-Mode OM1/OM2)', hex: '#f97316' },
  { value: 'aqua', label: 'Aqua (OM3/OM4)', hex: '#22d3ee' },
  { value: 'blue', label: 'Blue', hex: '#3b82f6' },
  { value: 'red', label: 'Red', hex: '#ef4444' },
  { value: 'green', label: 'Green', hex: '#10b981' },
  { value: 'gray', label: 'Gray', hex: '#94a3b8' },
  { value: 'black', label: 'Black', hex: '#0f172a' },
  { value: 'white', label: 'White', hex: '#f8fafc' },
  { value: 'violet', label: 'Violet', hex: '#a855f7' },
];
const MOD = 'interconnection';

const EMPTY = {
  source_type: 'device',
  source_rack_id: null, source_device: '', source_device_id: null, source_port: '', source_interface: '',
  dest_type: 'device',
  dest_rack: '', dest_rack_id: null, dest_device: '', dest_device_id: null, dest_port: '', dest_interface: '', dest_partner_id: null,
  connection_type: 'Fiber Single-Mode', cable_id: '', cable_label: '', cable_color: 'yellow', cable_length: '', install_date: '',
  status: 'Active', description: '',
};

export default function MyInterconnection() {
  const { canWrite, canDelete } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [racks, setRacks] = useState([]);
  const [devices, setDevices] = useState([]);
  const [partners, setPartners] = useState([]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sourceRackId, setSourceRackId] = useState('all');
  const [allItems, setAllItems] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const rmap = useMemo(() => Object.fromEntries(racks.map((r) => [r.id, r])), [racks]);
  const pmap = useMemo(() => Object.fromEntries(partners.map((p) => [p.id, p])), [partners]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize };
      if (q) params.q = q;
      if (status !== 'all') params.status = status;
      if (sourceRackId !== 'all') params.source_rack_id = sourceRackId;
      const { data } = await api.get('/interconnections', { params });
      setItems(data.items || []); setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  }, [page, q, status, sourceRackId]);

  const loadAll = useCallback(async () => {
    try {
      const { data } = await api.get('/interconnections', { params: { page: 1, page_size: 1000 } });
      setAllItems(data.items || []);
    } catch (err) { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAll(); }, [loadAll, items]);
  useEffect(() => {
    api.get('/racks', { params: { page_size: 500 } }).then(({ data }) => setRacks(data.items || []));
    api.get('/devices', { params: { page_size: 1000 } }).then(({ data }) => setDevices(data.items || []));
    api.get('/partners', { params: { page_size: 500 } }).then(({ data }) => setPartners(data.items || []));
  }, []);

  const sourceSummary = useMemo(() => {
    const map = new Map();
    for (const it of allItems) {
      const rid = it.source_rack_id;
      if (!rid) continue;
      if (!map.has(rid)) map.set(rid, { rack_id: rid, count: 0, devices: new Map() });
      const entry = map.get(rid);
      entry.count += 1;
      const dev = (it.source_device || '').trim();
      if (dev) entry.devices.set(dev, (entry.devices.get(dev) || 0) + 1);
    }
    const arr = Array.from(map.values()).map((e) => ({
      rack_id: e.rack_id,
      rack: rmap[e.rack_id] || null,
      count: e.count,
      topDevice: [...e.devices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      deviceCount: e.devices.size,
    }));
    arr.sort((a, b) => b.count - a.count);
    return arr;
  }, [allItems, rmap]);

  const totalCables = allItems.length;

  const devicesByRack = (rackId) => devices.filter((d) => d.rack_id === rackId);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const openCreate = () => { setEditing(null); setForm(EMPTY); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...EMPTY, ...row }); setErrors({}); setOpenForm(true); };

  const validate = () => {
    const e = {};
    if (!form.source_rack_id) e.source_rack_id = 'Source rack wajib';
    if (!form.dest_rack?.trim()) e.dest_rack = 'Destination rack wajib';
    if (!form.connection_type) e.connection_type = 'Tipe wajib';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) { await api.put(`/interconnections/${editing.id}`, form); toast.success('Interconnection diperbarui'); }
      else { await api.post('/interconnections', form); toast.success('Interconnection ditambahkan'); }
      setOpenForm(false); load(); refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/interconnections/${deleteId}`); toast.success('Interconnection dihapus'); setDeleteId(null); load(); refreshCounts(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const exportCsv = () => {
    const headers = ['Cable Label', 'Cable ID', 'Color', 'Length', 'Install Date', 'Src Type', 'Source Rack', 'Source Device', 'Source Port', 'Dst Type', 'Dest Rack', 'Dest Device', 'Dest Port', 'Tipe', 'Status', 'Deskripsi'];
    const rows = items.map((i) => [
      i.cable_label || '-', i.cable_id || '-', i.cable_color || '-', i.cable_length || '-', i.install_date || '-',
      i.source_type || 'device', rmap[i.source_rack_id]?.name || '-', i.source_device, i.source_port,
      i.dest_type || 'device', i.dest_rack || pmap[i.dest_partner_id]?.name || rmap[i.dest_rack_id]?.name || '-', i.dest_device, i.dest_port,
      i.connection_type, i.status, i.description,
    ].map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `cables-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url); toast.success('Data diekspor');
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'My DataCenter' }, { label: 'Cable Connection Management' }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Cable Connection Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Kabel interkoneksi lengkap: Device ↔ Device, Device ↔ Patch Panel, Patch Panel ↔ ODF, ODF ↔ Cross Connect, dan Cross Connect ↔ Partner Rack. Warna, panjang, dan tanggal install semua tercatat.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid={CRUD.export(MOD)}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
          {canWrite && <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(MOD)}><Plus className="w-4 h-4 mr-1.5" /> Tambah Cable</Button>}
        </div>
      </div>

      {/* Source A Summary / Filter */}
      <div className="space-y-2" data-testid="source-a-summary">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Source A · Rack Milik Anda ({sourceSummary.length} rack · {totalCables} cable)
          </div>
          {sourceRackId !== 'all' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => { setSourceRackId('all'); setPage(1); }}
              data-testid="source-a-filter-clear"
            >
              Reset filter
            </Button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => { setSourceRackId('all'); setPage(1); }}
            data-testid="source-a-filter-all"
            className={cn(
              'shrink-0 min-w-[140px] rounded-lg border px-3 py-2 text-left transition-colors',
              sourceRackId === 'all'
                ? 'border-primary bg-primary/10'
                : 'border-border bg-muted/30 hover:bg-muted/50',
            )}
          >
            <div className="text-[9px] uppercase tracking-widest font-mono text-muted-foreground">Semua</div>
            <div className="mt-0.5 text-sm font-semibold truncate">All Source</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-lg font-bold tabular-nums">{totalCables}</span>
              <span className="text-[10px] text-muted-foreground">cable</span>
            </div>
          </button>
          {sourceSummary.map((s) => {
            const active = sourceRackId === s.rack_id;
            const rackName = s.rack?.name || 'Unknown rack';
            const dcRoom = [s.rack?.datacenter, s.rack?.room].filter(Boolean).join(' · ');
            return (
              <button
                key={s.rack_id}
                type="button"
                onClick={() => { setSourceRackId(active ? 'all' : s.rack_id); setPage(1); }}
                data-testid={`source-a-filter-${s.rack_id}`}
                title={`${rackName}${dcRoom ? ' · ' + dcRoom : ''}`}
                className={cn(
                  'shrink-0 min-w-[220px] max-w-[280px] rounded-lg border px-3 py-2 text-left transition-colors',
                  active
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-muted/30 hover:bg-muted/50',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <EndpointBadge type="device" />
                  <div className="text-sm font-semibold truncate">{rackName}</div>
                </div>
                {dcRoom && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{dcRoom}</div>
                )}
                {s.topDevice && (
                  <div className="mt-1 text-[11px] font-mono text-muted-foreground truncate">
                    {s.topDevice}{s.deviceCount > 1 ? ` +${s.deviceCount - 1}` : ''}
                  </div>
                )}
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-lg font-bold tabular-nums text-foreground">{s.count}</span>
                  <span className="text-[10px] text-muted-foreground">cable</span>
                </div>
              </button>
            );
          })}
          {sourceSummary.length === 0 && (
            <div className="text-xs text-muted-foreground italic px-2 py-3">Belum ada source rack tercatat.</div>
          )}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid={CRUD.search(MOD)} placeholder="Cari cable id, device, port, tipe…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9 h-9" />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44 h-9" data-testid={CRUD.filterStatus(MOD)}><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table data-testid={CRUD.table(MOD)}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs w-24">Cable</TableHead>
                  <TableHead className="text-xs">Source (A)</TableHead>
                  <TableHead className="text-xs w-6"></TableHead>
                  <TableHead className="text-xs">Destination (B)</TableHead>
                  <TableHead className="text-xs">Type / Length</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
                {!loading && items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                  <Cable className="w-6 h-6 mx-auto mb-1 opacity-60" />
                  Belum ada cable connection tercatat.
                </TableCell></TableRow>}
                {!loading && items.map((it) => {
                  const color = (CABLE_COLORS.find((c) => c.value === it.cable_color) || CABLE_COLORS[0]).hex;
                  return (
                  <TableRow key={it.id} data-testid={CRUD.row(MOD, it.id)} className="hover:bg-accent/40">
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-6 rounded-sm border border-border shrink-0" style={{ background: color }} title={it.cable_color || 'no color'} data-testid={`cable-color-swatch-${it.id}`} />
                        <div className="min-w-0">
                          <div className="font-mono font-semibold truncate">{it.cable_label || it.cable_id || '—'}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{it.install_date || '—'}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium flex items-center gap-1.5">
                        <EndpointBadge type={it.source_type || 'device'} />
                        <span className="truncate">{rmap[it.source_rack_id]?.name || '—'}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">{it.source_device || '-'} : {it.source_port || it.source_interface || '-'}</div>
                    </TableCell>
                    <TableCell><ArrowRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium flex items-center gap-1.5">
                        <EndpointBadge type={it.dest_type || 'device'} />
                        <span className="truncate">{it.dest_rack || pmap[it.dest_partner_id]?.name || rmap[it.dest_rack_id]?.name || '—'}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">{it.dest_device || '-'} : {it.dest_port || it.dest_interface || '-'}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{it.connection_type || '-'}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{it.cable_length || ''}</div>
                    </TableCell>
                    <TableCell><StatusBadge value={it.status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        {canWrite && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(it)} data-testid={CRUD.editBtn(MOD, it.id)}><Pencil className="w-4 h-4" /></Button>}
                        {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => setDeleteId(it.id)} data-testid={CRUD.deleteBtn(MOD, it.id)}><Trash2 className="w-4 h-4" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );})}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>Menampilkan {items.length} dari {total} interconnection</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid={CRUD.pagePrev(MOD)}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="tabular-nums">Hal. {page} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid={CRUD.pageNext(MOD)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit Cable Connection' : 'Tambah Cable Connection'}</SheetTitle>
            <SheetDescription>Hubungkan interface apapun: Device → Device, Device → Patch Panel, Patch Panel → ODF, ODF → Cross Connect, Cross Connect → Partner Rack.</SheetDescription>
          </SheetHeader>

          {/* Cable metadata */}
          <div className="mt-4 rounded-lg border border-border/70 bg-muted/30 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-2 flex items-center gap-1.5">
              <Cable className="w-3 h-3" /> Cable metadata
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <F label="Cable Label"><Input value={form.cable_label || form.cable_id} onChange={(e) => setForm({ ...form, cable_label: e.target.value })} placeholder="mis. A12-B04-01" data-testid="cable-label-input" /></F>
              <F label="Cable ID"><Input value={form.cable_id} onChange={(e) => setForm({ ...form, cable_id: e.target.value })} placeholder="mis. XC-A12-B04-001" /></F>
              <F label="Length"><Input value={form.cable_length} onChange={(e) => setForm({ ...form, cable_length: e.target.value })} placeholder="mis. 3m / 150cm" data-testid="cable-length-input" /></F>
              <F label="Cable Color">
                <Select value={form.cable_color || ''} onValueChange={(v) => setForm({ ...form, cable_color: v })}>
                  <SelectTrigger data-testid="cable-color-select"><SelectValue placeholder="— pilih warna —" /></SelectTrigger>
                  <SelectContent>
                    {CABLE_COLORS.map((c) => (
                      <SelectItem key={c.value || 'none'} value={c.value || 'none'}>
                        <span className="inline-flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border border-border" style={{ background: c.hex }} />
                          {c.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </F>
              <F label="Install Date"><Input type="date" value={form.install_date || ''} onChange={(e) => setForm({ ...form, install_date: e.target.value })} data-testid="cable-install-date" /></F>
              <F label="Status">
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Connection Type *" full error={errors.connection_type}>
                <Select value={form.connection_type} onValueChange={(v) => setForm({ ...form, connection_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih tipe" /></SelectTrigger>
                  <SelectContent>{CONN_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </F>
            </div>
          </div>

          {/* Endpoints */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Source endpoint */}
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">A · Source Endpoint</div>
              <F label="Endpoint Type">
                <Select value={form.source_type} onValueChange={(v) => setForm({ ...form, source_type: v })}>
                  <SelectTrigger data-testid="source-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{ENDPOINT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label={endpointLabels(form.source_type).rackLabel + (form.source_type === 'device' ? ' *' : '')} error={errors.source_rack_id}>
                <RackPicker value={form.source_rack_id} onChange={(id) => setForm({ ...form, source_rack_id: id, source_device: '', source_device_id: null, source_port: '' })} racks={racks} testKey="src-rack" />
              </F>
              <F label={endpointLabels(form.source_type).deviceLabel}>
                <DevicePicker rackId={form.source_rack_id} devices={devicesByRack(form.source_rack_id)} value={form.source_device} onChange={(name, id) => setForm({ ...form, source_device: name, source_device_id: id || null })} />
              </F>
              <F label={endpointLabels(form.source_type).portLabel}>
                <Input value={form.source_port} placeholder={endpointLabels(form.source_type).portPh} onChange={(e) => setForm({ ...form, source_port: e.target.value, source_interface: e.target.value })} data-testid="source-port-input" />
              </F>
            </div>

            {/* Destination endpoint */}
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">B · Destination Endpoint</div>
              <F label="Endpoint Type">
                <Select value={form.dest_type} onValueChange={(v) => setForm({ ...form, dest_type: v, dest_partner_id: v === 'partner_rack' ? form.dest_partner_id : null })}>
                  <SelectTrigger data-testid="dest-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{ENDPOINT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              {form.dest_type === 'partner_rack' ? (
                <F label="Partner *" error={errors.dest_rack}>
                  <Select value={form.dest_partner_id || ''} onValueChange={(v) => {
                    const p = partners.find((x) => x.id === v);
                    setForm({ ...form, dest_partner_id: v, dest_rack: p?.name ? `${p.name} Rack` : form.dest_rack });
                  }}>
                    <SelectTrigger data-testid="dest-partner-select"><SelectValue placeholder="Pilih partner…" /></SelectTrigger>
                    <SelectContent>{partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} {p.category ? `· ${p.category}` : ''}</SelectItem>)}</SelectContent>
                  </Select>
                </F>
              ) : (
                <F label={endpointLabels(form.dest_type).rackLabel + ' *'} error={errors.dest_rack}>
                  <Input value={form.dest_rack} placeholder={endpointLabels(form.dest_type).rackPh} onChange={(e) => setForm({ ...form, dest_rack: e.target.value })} data-testid="dst-rack-input" />
                </F>
              )}
              <F label={endpointLabels(form.dest_type).deviceLabel}>
                <Input value={form.dest_device} placeholder={endpointLabels(form.dest_type).devicePh} onChange={(e) => setForm({ ...form, dest_device: e.target.value })} />
              </F>
              <F label={endpointLabels(form.dest_type).portLabel}>
                <Input value={form.dest_port} placeholder={endpointLabels(form.dest_type).portPh} onChange={(e) => setForm({ ...form, dest_port: e.target.value, dest_interface: e.target.value })} data-testid="dest-port-input" />
              </F>
            </div>
          </div>

          <div className="mt-4">
            <F label="Deskripsi / Notes" full><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Catatan / fungsi link ini" /></F>
          </div>

          <SheetFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={CRUD.cancelBtn(MOD)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={CRUD.saveBtn(MOD)}>{saving ? 'Menyimpan…' : 'Simpan Cable'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus interconnection ini?</AlertDialogTitle><AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid={CRUD.confirmDelete(MOD)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RackPicker({ value, onChange, racks, testKey }) {
  const [open, setOpen] = useState(false);
  const current = racks.find((r) => r.id === value);
  // Group by datacenter
  const grouped = useMemo(() => {
    const g = {};
    racks.forEach((r) => {
      const key = r.datacenter || 'Lainnya';
      if (!g[key]) g[key] = [];
      g[key].push(r);
    });
    return g;
  }, [racks]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline" role="combobox" data-testid={`${testKey}-picker`}
          className="w-full justify-between h-9 font-normal text-left"
        >
          {current ? (
            <span className="truncate"><span className="font-medium">{current.name}</span> <span className="text-muted-foreground text-xs">· {current.datacenter} · {current.capacity_u}U</span></span>
          ) : (
            <span className="text-muted-foreground">Pilih rack…</span>
          )}
          <Waypoints className="w-4 h-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari nama rack, datacenter…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Rack tidak ditemukan.</CommandEmpty>
            {Object.entries(grouped).map(([dc, list]) => (
              <CommandGroup key={dc} heading={dc}>
                {list.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`${r.name} ${r.number} ${r.datacenter} ${r.room}`}
                    onSelect={() => { onChange(r.id); setOpen(false); }}
                  >
                    {value === r.id ? <Check className="w-3.5 h-3.5 mr-2 text-primary" /> : <span className="w-3.5 mr-2" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate font-medium">{r.name} <span className="text-muted-foreground font-mono text-[10px]">· {r.number}</span></div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.room} · {r.capacity_u}U · {r.status}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DevicePicker({ rackId, devices, value, onChange }) {
  if (!rackId) return <Input value={value} onChange={(e) => onChange(e.target.value, null)} placeholder="Pilih rack dahulu" disabled />;
  if (devices.length === 0) return <Input value={value} onChange={(e) => onChange(e.target.value, null)} placeholder="Ketik nama device manual" />;
  return (
    <Select value={value || '__manual__'} onValueChange={(v) => {
      if (v === '__manual__') return onChange('', null);
      const d = devices.find((x) => x.name === v);
      onChange(v, d?.id || null);
    }}>
      <SelectTrigger><SelectValue placeholder="Pilih device" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__manual__">— Ketik manual —</SelectItem>
        {devices.map((d) => <SelectItem key={d.id} value={d.name}>{d.name} · U{d.position_u}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function endpointLabels(type) {
  switch (type) {
    case 'patch_panel':
      return { rackLabel: 'Patch Panel Location', rackPh: 'mis. Rack A12', deviceLabel: 'Patch Panel Name', devicePh: 'mis. PP-A12-01', portLabel: 'Patch Port', portPh: 'mis. Port 12' };
    case 'odf':
      return { rackLabel: 'ODF Location', rackPh: 'mis. MMR Room 2', deviceLabel: 'ODF Name', devicePh: 'mis. ODF-MMR-01', portLabel: 'ODF Port', portPh: 'mis. Tray 3 / Port 24' };
    case 'cross_connect':
      return { rackLabel: 'Cross Connect Location', rackPh: 'mis. MMR / Meet-Me Room', deviceLabel: 'XC Reference', devicePh: 'mis. XC-2024-045', portLabel: 'XC Port', portPh: 'mis. J-08' };
    case 'partner_rack':
      return { rackLabel: 'Partner Rack', rackPh: 'akan diisi otomatis', deviceLabel: 'Partner Device', devicePh: 'mis. Router Provider', portLabel: 'Partner Port', portPh: 'mis. Te1/1' };
    default:
      return { rackLabel: 'Rack', rackPh: 'Rack tujuan', deviceLabel: 'Device', devicePh: 'mis. Switch A', portLabel: 'Interface / Port', portPh: 'mis. Gi0/1, Eth1/24' };
  }
}

function EndpointBadge({ type }) {
  const map = {
    device: { label: 'Device', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
    patch_panel: { label: 'PP', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
    odf: { label: 'ODF', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    cross_connect: { label: 'XC', cls: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
    partner_rack: { label: 'Partner', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  };
  const m = map[type] || map.device;
  return <span className={cn('text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded border font-mono', m.cls)}>{m.label}</span>;
}

function F({ label, children, full, error }) {
  return (
    <div className={cn('space-y-1.5', full && 'col-span-2')}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  );
}
