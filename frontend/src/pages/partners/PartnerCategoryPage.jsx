import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Search, Download, Pencil, Trash2, Eye, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import Breadcrumb from '@/components/Breadcrumb';
import ProviderFilter from '@/components/ProviderFilter';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const STATUSES = ['Active', 'Suspended', 'Terminated', 'Pending'];

/**
 * Props:
 *  - moduleKey: 'mitra-broadband', ...
 *  - category: 'Broadband' | 'Dedicated Internet' | 'Metro Ethernet' | 'Dark Fiber' | 'Cross Connect'
 *  - title, description, breadcrumb
 *  - columns: [{key, label, mono, render}]
 *  - fields: [{name, label, type?, options?, required?, full?}]
 */
export default function PartnerCategoryPage({
  moduleKey, category, title, description, breadcrumb, columns, fields,
}) {
  const { canWrite, canDelete } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const PAGE_SIZE_OPTIONS = [20, 50, 75, 100];

  const [openForm, setOpenForm] = useState(false);
  const [openView, setOpenView] = useState(false);
  const [openCustomers, setOpenCustomers] = useState(false);
  const [editing, setEditing] = useState(null);
  const [linked, setLinked] = useState([]);
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const empty = useMemo(() => {
    const base = { category, cid: '', status: 'Active', pic_name: '', phone: '', helpdesk: '', email_support: '', contract_start: '', contract_end: '', contract_period: '', notes: '' };
    fields.forEach((f) => { if (!(f.name in base)) base[f.name] = f.default ?? ''; });
    return base;
  }, [category, fields]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, category, sort_by: 'created_at', sort_dir: 'desc' };
      if (q) params.q = q;
      if (status !== 'all') params.status = status;
      const { data } = await api.get('/partners', { params });
      setItems(data.items || []); setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  }, [page, pageSize, q, status, category]);

  useEffect(() => { load(); }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const filteredItems = useMemo(() => {
    if (providerFilter === 'all') return items;
    return items.filter((it) => it.name === providerFilter);
  }, [items, providerFilter]);

  const openCreate = () => { setEditing(null); setForm(empty); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...empty, ...row }); setErrors({}); setOpenForm(true); };
  const openDetail = (row) => { setEditing(row); setOpenView(true); };

  const openLihatCustomer = async (row) => {
    setEditing(row);
    setOpenCustomers(true);
    setLinkedLoading(true);
    try {
      const { data } = await api.get('/customers', { params: { partner_id: row.id, page_size: 200 } });
      setLinked(data.items || []);
    } catch { setLinked([]); } finally { setLinkedLoading(false); }
  };

  const validate = () => {
    const e = {};
    if (!form.name?.trim()) e.name = 'Nama provider wajib';
    fields.forEach((f) => { if (f.required && !String(form[f.name] ?? '').trim()) e[f.name] = `${f.label} wajib`; });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = { ...form, category };
      if (editing) { await api.put(`/partners/${editing.id}`, payload); toast.success('Mitra diperbarui'); }
      else { await api.post('/partners', payload); toast.success('Mitra ditambahkan'); }
      setOpenForm(false); load(); refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/partners/${deleteId}`); toast.success('Mitra dihapus'); setDeleteId(null); load(); refreshCounts(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const exportCsv = () => {
    const headers = ['CID', 'Provider', ...fields.map(f => f.label), 'Status', 'Aktivasi', 'Masa Kontrak', 'PIC', 'Helpdesk', 'Email Support', 'Catatan'];
    const rows = items.map(i => {
      const base = [i.cid, i.name, ...fields.map(f => i[f.name] ?? ''), i.status, i.contract_start, i.contract_period, i.pic_name, i.helpdesk, i.email_support, i.notes];
      return base.map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',');
    });
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${moduleKey}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url); toast.success('Data diekspor');
  };

  const renderField = (f) => {
    const val = form[f.name] ?? '';
    if (f.type === 'textarea') return <Textarea rows={f.rows || 3} value={val} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />;
    if (f.type === 'select') return (
      <Select value={val || ''} onValueChange={(v) => setForm({ ...form, [f.name]: v })}>
        <SelectTrigger><SelectValue placeholder="Pilih…" /></SelectTrigger>
        <SelectContent>{f.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    );
    return <Input type={f.type || 'text'} value={val} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />;
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={breadcrumb} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid={CRUD.export(moduleKey)}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
          {canWrite && <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(moduleKey)}><Plus className="w-4 h-4 mr-1.5" /> Tambah Mitra</Button>}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid={CRUD.search(moduleKey)} placeholder="Cari CID, provider, layanan…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9 h-9" />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44 h-9" data-testid={CRUD.filterStatus(moduleKey)}><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <ProviderFilter
            items={items}
            getProvider={(it) => it.name || null}
            value={providerFilter}
            onChange={setProviderFilter}
            testKey={moduleKey}
          />

          <div className="border border-border rounded-md overflow-x-auto">
            <Table data-testid={CRUD.table(moduleKey)}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {columns.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => <TableRow key={i}><TableCell colSpan={columns.length + 2}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
                {!loading && filteredItems.length === 0 && <TableRow><TableCell colSpan={columns.length + 2} className="text-center py-10 text-sm text-muted-foreground">Belum ada mitra di kategori ini.</TableCell></TableRow>}
                {!loading && filteredItems.map((it) => (
                  <TableRow key={it.id} data-testid={CRUD.row(moduleKey, it.id)} className="hover:bg-accent/40">
                    {columns.map(c => (
                      <TableCell key={c.key} className={cn('text-sm', c.mono && 'font-mono text-xs')}>
                        {c.render ? c.render(it) : (it[c.key] || '-')}
                      </TableCell>
                    ))}
                    <TableCell><StatusBadge value={it.status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="outline" className="h-8 px-2" onClick={() => openLihatCustomer(it)} data-testid={`${moduleKey}-customers-${it.id}`}><Users className="w-3.5 h-3.5 mr-1" /> Customer</Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openDetail(it)} data-testid={CRUD.viewBtn(moduleKey, it.id)}><Eye className="w-4 h-4" /></Button>
                        {canWrite && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(it)} data-testid={CRUD.editBtn(moduleKey, it.id)}><Pencil className="w-4 h-4" /></Button>}
                        {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => setDeleteId(it.id)} data-testid={CRUD.deleteBtn(moduleKey, it.id)}><Trash2 className="w-4 h-4" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
            <div>Menampilkan {filteredItems.length} dari {total} mitra{providerFilter !== 'all' ? ' (difilter)' : ''}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-widest">Tampilkan</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                >
                  <SelectTrigger className="h-8 w-[84px]" data-testid={`${moduleKey}-page-size`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)} data-testid={`${moduleKey}-page-size-${n}`}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] uppercase tracking-widest">data</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid={CRUD.pagePrev(moduleKey)}><ChevronLeft className="w-4 h-4" /></Button>
                <span className="tabular-nums">Hal. {page} / {pageCount}</span>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid={CRUD.pageNext(moduleKey)}><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit' : 'Tambah'} — {title}</SheetTitle>
            <SheetDescription>Kategori: <span className="font-medium text-foreground">{category}</span></SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <F label="CID *" error={errors.cid}><Input value={form.cid || ''} onChange={(e) => setForm({ ...form, cid: e.target.value })} placeholder="Circuit ID dari provider" /></F>
            <F label="Nama Provider *" error={errors.name}><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></F>
            {fields.map((f) => (
              <F key={f.name} label={`${f.label}${f.required ? ' *' : ''}`} full={f.full} error={errors[f.name]}>
                {renderField(f)}
              </F>
            ))}
            <F label="Status">
              <Select value={form.status || 'Active'} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </F>
            <F label="Tanggal Aktivasi"><Input type="date" value={form.contract_start || ''} onChange={(e) => setForm({ ...form, contract_start: e.target.value })} /></F>
            <F label="Kontrak Berakhir"><Input type="date" value={form.contract_end || ''} onChange={(e) => setForm({ ...form, contract_end: e.target.value })} /></F>
            <F label="Masa Kontrak"><Input value={form.contract_period || ''} onChange={(e) => setForm({ ...form, contract_period: e.target.value })} placeholder="mis. 36 bulan" /></F>
            <F label="PIC Provider"><Input value={form.pic_name || ''} onChange={(e) => setForm({ ...form, pic_name: e.target.value })} /></F>
            <F label="Nomor Helpdesk"><Input value={form.helpdesk || ''} onChange={(e) => setForm({ ...form, helpdesk: e.target.value })} /></F>
            <F label="Email Support" full><Input type="email" value={form.email_support || ''} onChange={(e) => setForm({ ...form, email_support: e.target.value })} /></F>
            <F label="Catatan" full><Textarea rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></F>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={CRUD.cancelBtn(moduleKey)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={CRUD.saveBtn(moduleKey)}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Detail */}
      <Sheet open={openView} onOpenChange={setOpenView}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>Detail Mitra</SheetTitle></SheetHeader>
          {editing && (
            <div className="mt-4 space-y-2 text-sm">
              <I k="CID" v={<span className="font-mono">{editing.cid || '-'}</span>} />
              <I k="Provider" v={editing.name} />
              <I k="Kategori" v={category} />
              {fields.map((f) => <I key={f.name} k={f.label} v={editing[f.name] || '-'} />)}
              <I k="Tanggal Aktivasi" v={editing.contract_start || '-'} />
              <I k="Kontrak Berakhir" v={editing.contract_end || '-'} />
              <I k="Masa Kontrak" v={editing.contract_period || '-'} />
              <I k="PIC Provider" v={editing.pic_name || '-'} />
              <I k="Nomor Helpdesk" v={editing.helpdesk || '-'} />
              <I k="Email Support" v={editing.email_support || '-'} />
              <I k="Catatan" v={editing.notes || '-'} />
              <div className="pt-2"><StatusBadge value={editing.status} /></div>
              <div className="pt-3">
                <Button size="sm" variant="outline" onClick={() => { setOpenView(false); openLihatCustomer(editing); }}>
                  <Users className="w-4 h-4 mr-1.5" /> Lihat Customer
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Lihat Customer dialog */}
      <Dialog open={openCustomers} onOpenChange={setOpenCustomers}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Customer yang menggunakan layanan ini</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="text-sm mt-2 space-y-3">
              <div className="p-3 rounded-md bg-muted/40 border border-border">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Mitra</div>
                <div className="font-medium">{editing.name} <span className="text-muted-foreground font-mono text-xs">· CID {editing.cid || '-'}</span></div>
                <div className="text-xs text-muted-foreground mt-0.5">{category} · {editing.capacity || '-'}</div>
              </div>
              {linkedLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : linked.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">Belum ada customer yang menggunakan layanan ini.</div>
              ) : (
                <ul className="space-y-2">
                  {linked.map((c) => (
                    <li key={c.id} className="p-3 rounded-md border border-border flex items-center justify-between">
                      <div>
                        <div className="font-medium">{c.company_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{c.sid} · {c.category}</div>
                      </div>
                      <StatusBadge value={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus mitra ini?</AlertDialogTitle><AlertDialogDescription>Hubungan dengan customer akan tetap tersimpan sebagai referensi.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid={CRUD.confirmDelete(moduleKey)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
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
function I({ k, v }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-border last:border-0">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="col-span-2 text-foreground break-words">{v}</div>
    </div>
  );
}
