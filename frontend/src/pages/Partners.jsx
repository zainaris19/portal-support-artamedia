import React, { useEffect, useState, useCallback } from 'react';
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
import { Plus, Search, Download, Pencil, Trash2, Eye, ChevronLeft, ChevronRight, Handshake } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import Breadcrumb from '@/components/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const STATUSES = ['Active', 'Suspended', 'Terminated', 'Pending'];
const MOD = 'partners';
const EMPTY = { name: '', service_type: '', capacity: '', location: '', provider_sid: '', pic_name: '', phone: '', email_support: '', ticket_noc: '', contract_start: '', contract_end: '', status: 'Active', notes: '' };

export default function Partners() {
  const { canWrite, canDelete } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const PAGE_SIZE_OPTIONS = [20, 50, 75, 100];

  const [openForm, setOpenForm] = useState(false);
  const [openView, setOpenView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [linkedCustomers, setLinkedCustomers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, sort_by: 'created_at', sort_dir: 'desc' };
      if (q) params.q = q;
      if (status !== 'all') params.status = status;
      const { data } = await api.get('/partners', { params });
      setItems(data.items || []); setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  }, [page, pageSize, q, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/customers', { params: { page_size: 200 } }).then(({ data }) => setCustomers(data.items || [])); }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const openCreate = () => { setEditing(null); setForm(EMPTY); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...EMPTY, ...row }); setErrors({}); setOpenForm(true); };
  const openDetail = async (row) => {
    setEditing(row);
    setOpenView(true);
    try {
      const { data } = await api.get('/customers', { params: { partner_id: row.id, page_size: 200 } });
      setLinkedCustomers(data.items || []);
    } catch { setLinkedCustomers([]); }
  };

  const validate = () => {
    const e = {};
    if (!form.name?.trim()) e.name = 'Nama mitra wajib';
    if (!form.service_type?.trim()) e.service_type = 'Jenis layanan wajib';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) { await api.put(`/partners/${editing.id}`, form); toast.success('Mitra diperbarui'); }
      else { await api.post('/partners', form); toast.success('Mitra ditambahkan'); }
      setOpenForm(false); load(); refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/partners/${deleteId}`); toast.success('Mitra dihapus'); setDeleteId(null); load(); refreshCounts(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const exportCsv = () => {
    const headers = ['Nama Mitra','Layanan','Kapasitas','Lokasi','SID Provider','PIC','Kontak','Email Support','Ticket NOC','Kontrak Mulai','Kontrak Berakhir','Status','Catatan'];
    const rows = items.map(i => [i.name,i.service_type,i.capacity,i.location,i.provider_sid,i.pic_name,i.phone,i.email_support,i.ticket_noc,i.contract_start,i.contract_end,i.status,i.notes].map(v => `"${(v ?? '').toString().replace(/"/g,'""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `partners-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url); toast.success('Data diekspor');
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Mitra / Provider' }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Mitra / Provider</h1>
          <p className="text-sm text-muted-foreground mt-1">Daftar mitra & upstream provider beserta kontrak dan pelanggan terkait.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid={CRUD.export(MOD)}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
          {canWrite && <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(MOD)}><Plus className="w-4 h-4 mr-1.5" /> Tambah Mitra</Button>}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid={CRUD.search(MOD)} placeholder="Cari nama mitra, layanan, PIC…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9 h-9" />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44 h-9" data-testid={CRUD.filterStatus(MOD)}><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table data-testid={CRUD.table(MOD)}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Nama Mitra</TableHead>
                  <TableHead className="text-xs">Layanan</TableHead>
                  <TableHead className="text-xs">Kapasitas</TableHead>
                  <TableHead className="text-xs">Lokasi</TableHead>
                  <TableHead className="text-xs">PIC</TableHead>
                  <TableHead className="text-xs">Kontrak</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
                {!loading && items.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">Belum ada mitra.</TableCell></TableRow>}
                {!loading && items.map((it) => (
                  <TableRow key={it.id} data-testid={CRUD.row(MOD, it.id)} className="hover:bg-accent/40">
                    <TableCell className="font-medium flex items-center gap-2"><Handshake className="w-3.5 h-3.5 text-primary" /> {it.name}</TableCell>
                    <TableCell>{it.service_type}</TableCell>
                    <TableCell>{it.capacity || '-'}</TableCell>
                    <TableCell className="text-sm">{it.location || '-'}</TableCell>
                    <TableCell className="text-sm">{it.pic_name || '-'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{it.contract_start || '-'} → {it.contract_end || '-'}</TableCell>
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

          <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
            <div>Menampilkan {items.length} dari {total}</div>
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

      {/* Form */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit Mitra' : 'Tambah Mitra'}</SheetTitle>
            <SheetDescription>Lengkapi profil mitra & kontrak.</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <F label="Nama Mitra *" full error={errors.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></F>
            <F label="Jenis Layanan *" error={errors.service_type}><Input value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })} placeholder="mis. Metro Ethernet" /></F>
            <F label="Kapasitas"><Input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="mis. 200 Mbps" /></F>
            <F label="Lokasi / Site" full><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></F>
            <F label="SID Provider" full><Input value={form.provider_sid} onChange={(e) => setForm({ ...form, provider_sid: e.target.value })} /></F>
            <F label="PIC"><Input value={form.pic_name} onChange={(e) => setForm({ ...form, pic_name: e.target.value })} /></F>
            <F label="Kontak / Telepon"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></F>
            <F label="Email Support" full><Input type="email" value={form.email_support} onChange={(e) => setForm({ ...form, email_support: e.target.value })} /></F>
            <F label="Nomor Tiket / NOC" full><Input value={form.ticket_noc} onChange={(e) => setForm({ ...form, ticket_noc: e.target.value })} /></F>
            <F label="Kontrak Mulai"><Input type="date" value={form.contract_start || ''} onChange={(e) => setForm({ ...form, contract_start: e.target.value })} /></F>
            <F label="Kontrak Berakhir"><Input type="date" value={form.contract_end || ''} onChange={(e) => setForm({ ...form, contract_end: e.target.value })} /></F>
            <F label="Status" full>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </F>
            <F label="Catatan" full><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></F>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={CRUD.cancelBtn(MOD)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={CRUD.saveBtn(MOD)}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Detail */}
      <Sheet open={openView} onOpenChange={setOpenView}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>Detail Mitra</SheetTitle></SheetHeader>
          {editing && (
            <div className="mt-4 space-y-2 text-sm">
              <I k="Nama" v={editing.name} />
              <I k="Jenis Layanan" v={editing.service_type} />
              <I k="Kapasitas" v={editing.capacity} />
              <I k="Lokasi" v={editing.location} />
              <I k="SID Provider" v={editing.provider_sid} />
              <I k="PIC" v={editing.pic_name} />
              <I k="Kontak" v={editing.phone} />
              <I k="Email Support" v={editing.email_support} />
              <I k="Nomor Tiket" v={editing.ticket_noc} />
              <I k="Masa Kontrak" v={`${editing.contract_start || '-'} → ${editing.contract_end || '-'}`} />
              <div className="pt-2"><StatusBadge value={editing.status} /></div>
              {editing.notes && <div className="pt-2 border-t border-border"><div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Catatan</div><div className="text-foreground">{editing.notes}</div></div>}

              <div className="pt-4 border-t border-border">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Pelanggan yang Menggunakan Layanan Ini</div>
                {linkedCustomers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Belum ada pelanggan terhubung.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {linkedCustomers.map(c => (
                      <li key={c.id} className="flex items-center justify-between p-2 rounded-md border border-border bg-muted/30">
                        <div>
                          <div className="text-sm font-medium">{c.company_name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{c.sid} · {c.category}</div>
                        </div>
                        <StatusBadge value={c.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus mitra ini?</AlertDialogTitle><AlertDialogDescription>Hubungan ke pelanggan akan tetap tersimpan sebagai referensi.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid={CRUD.confirmDelete(MOD)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
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
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-border">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="col-span-2 text-foreground break-words">{v || '-'}</div>
    </div>
  );
}
