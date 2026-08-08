import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Search, Download, Pencil, Trash2, Eye, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { useAuth } from '@/context/AuthContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const CATEGORIES = ['Broadband', 'Dedicated Internet', 'Cross Connect', 'Dark Fiber', 'Metro Ethernet'];
const STATUSES = ['Active', 'Suspended', 'Terminated', 'Pending'];
const MOD = 'customers';

const EMPTY = {
  sid: '', company_name: '', service_name: '', category: 'Broadband', location: '', address: '',
  bandwidth: '', ip_address: '', vlan: '', provider: '', pic_name: '', phone: '', email: '',
  activation_date: '', status: 'Active', notes: '',
};

export default function Customers() {
  const { canWrite, canDelete } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const PAGE_SIZE_OPTIONS = [20, 50, 75, 100];

  const [openForm, setOpenForm] = useState(false);
  const [openView, setOpenView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir };
      if (q) params.q = q;
      if (category !== 'all') params.category = category;
      if (status !== 'all') params.status = status;
      const { data } = await api.get('/customers', { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortBy, sortDir, q, category, status]);

  useEffect(() => { load(); }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const openCreate = () => { setEditing(null); setForm(EMPTY); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...EMPTY, ...row }); setErrors({}); setOpenForm(true); };
  const openDetail = (row) => { setEditing(row); setOpenView(true); };

  const validate = () => {
    const e = {};
    if (!form.sid?.trim()) e.sid = 'SID wajib';
    if (!form.company_name?.trim()) e.company_name = 'Nama perusahaan wajib';
    if (!form.service_name?.trim()) e.service_name = 'Nama layanan wajib';
    if (!form.category) e.category = 'Kategori wajib';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Email tidak valid';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/customers/${editing.id}`, form);
        toast.success('Pelanggan diperbarui');
      } else {
        await api.post('/customers', form);
        toast.success('Pelanggan ditambahkan');
      }
      setOpenForm(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/customers/${deleteId}`);
      toast.success('Pelanggan dihapus');
      setDeleteId(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('asc'); }
  };

  const exportCsv = () => {
    const headers = ['SID','Perusahaan','Layanan','Kategori','Lokasi','Bandwidth','IP Address','VLAN','Provider','PIC','Telepon','Email','Aktivasi','Status','Catatan'];
    const rows = items.map(i => [i.sid,i.company_name,i.service_name,i.category,i.location,i.bandwidth,i.ip_address,i.vlan,i.provider,i.pic_name,i.phone,i.email,i.activation_date,i.status,i.notes].map(v => `"${(v??'').toString().replace(/"/g,'""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `customers-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Data diekspor');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Data Pelanggan</h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola data pelanggan berdasarkan kategori layanan.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid={CRUD.export(MOD)}>
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
          {canWrite && (
            <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(MOD)}>
              <Plus className="w-4 h-4 mr-1.5" /> Tambah Pelanggan
            </Button>
          )}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <Tabs value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <TabsList data-testid={CRUD.filterCategory(MOD)} className="flex-wrap h-auto">
              <TabsTrigger value="all">Semua</TabsTrigger>
              {CATEGORIES.map((c) => <TabsTrigger key={c} value={c}>{c}</TabsTrigger>)}
            </TabsList>
          </Tabs>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid={CRUD.search(MOD)}
                placeholder="Cari SID, nama, PIC, IP…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                className="pl-9 h-9"
              />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44 h-9" data-testid={CRUD.filterStatus(MOD)}><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <Table data-testid={CRUD.table(MOD)}>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <SortableHead label="SID" col="sid" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Perusahaan" col="company_name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    <TableHead className="text-xs">Layanan</TableHead>
                    <TableHead className="text-xs">Kategori</TableHead>
                    <TableHead className="text-xs">Bandwidth</TableHead>
                    <TableHead className="text-xs">Lokasi</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                  ))}
                  {!loading && items.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data.</TableCell></TableRow>
                  )}
                  {!loading && items.map((it) => (
                    <TableRow key={it.id} data-testid={CRUD.row(MOD, it.id)} className="hover:bg-accent/40">
                      <TableCell className="font-mono text-xs">{it.sid}</TableCell>
                      <TableCell className="font-medium">{it.company_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{it.service_name}</TableCell>
                      <TableCell><span className="text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{it.category}</span></TableCell>
                      <TableCell className="text-sm">{it.bandwidth || '-'}</TableCell>
                      <TableCell className="text-sm">{it.location || '-'}</TableCell>
                      <TableCell><StatusBadge value={it.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openDetail(it)} data-testid={CRUD.viewBtn(MOD, it.id)}><Eye className="w-4 h-4" /></Button>
                          {canWrite && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(it)} data-testid={CRUD.editBtn(MOD, it.id)}><Pencil className="w-4 h-4" /></Button>}
                          {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => setDeleteId(it.id)} data-testid={CRUD.deleteBtn(MOD, it.id)}><Trash2 className="w-4 h-4" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
            <div>Menampilkan {items.length} dari {total} data</div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-widest">Tampilkan</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                >
                  <SelectTrigger className="h-8 w-[84px]" data-testid={`${MOD}-page-size`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)} data-testid={`${MOD}-page-size-${n}`}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] uppercase tracking-widest">data</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid={CRUD.pagePrev(MOD)}><ChevronLeft className="w-4 h-4" /></Button>
                <span className="tabular-nums">Hal. {page} / {pageCount}</span>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid={CRUD.pageNext(MOD)}><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Sheet */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit Pelanggan' : 'Tambah Pelanggan'}</SheetTitle>
            <SheetDescription>Isi detail pelanggan dengan lengkap.</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <Field label="SID / Customer ID" error={errors.sid}><Input value={form.sid} onChange={(e) => setForm({ ...form, sid: e.target.value })} /></Field>
            <Field label="Status"><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Nama Perusahaan" className="col-span-2" error={errors.company_name}><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
            <Field label="Nama Layanan" error={errors.service_name}><Input value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} /></Field>
            <Field label="Kategori" error={errors.category}><Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Lokasi / Site"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="Bandwidth"><Input value={form.bandwidth} onChange={(e) => setForm({ ...form, bandwidth: e.target.value })} /></Field>
            <Field label="Alamat" className="col-span-2"><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="IP Address"><Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} /></Field>
            <Field label="VLAN"><Input value={form.vlan} onChange={(e) => setForm({ ...form, vlan: e.target.value })} /></Field>
            <Field label="Provider"><Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></Field>
            <Field label="Tanggal Aktivasi"><Input type="date" value={form.activation_date || ''} onChange={(e) => setForm({ ...form, activation_date: e.target.value })} /></Field>
            <Field label="Nama PIC"><Input value={form.pic_name} onChange={(e) => setForm({ ...form, pic_name: e.target.value })} /></Field>
            <Field label="Telepon"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email" className="col-span-2" error={errors.email}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Catatan Teknis" className="col-span-2"><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={CRUD.cancelBtn(MOD)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={CRUD.saveBtn(MOD)}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Detail Sheet */}
      <Sheet open={openView} onOpenChange={setOpenView}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Detail Pelanggan</SheetTitle></SheetHeader>
          {editing && (
            <div className="mt-4 space-y-3 text-sm">
              {[
                ['SID', editing.sid], ['Perusahaan', editing.company_name], ['Layanan', editing.service_name],
                ['Kategori', editing.category], ['Bandwidth', editing.bandwidth], ['Lokasi', editing.location],
                ['Alamat', editing.address], ['IP Address', editing.ip_address], ['VLAN', editing.vlan],
                ['Provider', editing.provider], ['Aktivasi', editing.activation_date], ['PIC', editing.pic_name],
                ['Telepon', editing.phone], ['Email', editing.email], ['Catatan', editing.notes],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
                  <div className="col-span-2 text-foreground break-words">{v || '-'}</div>
                </div>
              ))}
              <div className="grid grid-cols-3 gap-2 py-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="col-span-2"><StatusBadge value={editing.status} /></div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pelanggan ini?</AlertDialogTitle>
            <AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid={CRUD.confirmDelete(MOD)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortableHead({ label, col, sortBy, sortDir, onSort }) {
  return (
    <TableHead className="text-xs">
      <button onClick={() => onSort(col)} className={cn('inline-flex items-center gap-1 hover:text-foreground', sortBy === col && 'text-foreground')}>
        {label} <ArrowUpDown className="w-3 h-3 opacity-60" />
        {sortBy === col && <span className="text-[10px]">({sortDir})</span>}
      </button>
    </TableHead>
  );
}

function Field({ label, children, className, error }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  );
}
