import React, { useEffect, useState, useCallback } from 'react';
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
import { Plus, Search, Download, Pencil, Trash2, Eye, ChevronLeft, ChevronRight, FileText, FileDown, Upload } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const CATEGORIES = ['BA', 'SLA', 'Kontrak', 'Topologi', 'Lainnya'];
const MOD = 'documents';
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const EMPTY = {
  title: '', category: 'BA', doc_number: '', doc_date: '', valid_from: '', valid_until: '',
  customer_id: null, description: '', file_name: null, file_type: null, file_size: null, file_base64: null,
};

export default function Documents() {
  const { canWrite, canDelete } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);

  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [openForm, setOpenForm] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize };
      if (q) params.q = q;
      if (category !== 'all') params.category = category;
      const { data } = await api.get('/documents', { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  }, [page, q, category]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/customers', { params: { page_size: 200 } }).then(({ data }) => setCustomers(data.items || [])); }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const openCreate = () => { setEditing(null); setForm(EMPTY); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...EMPTY, ...row, customer_id: row.customer_id || null }); setErrors({}); setOpenForm(true); };

  const validate = () => {
    const e = {};
    if (!form.title?.trim()) e.title = 'Judul wajib';
    if (!form.category) e.category = 'Kategori wajib';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onFile = async (file) => {
    if (!file) return;
    if (file.size > MAX_SIZE) { toast.error('Ukuran file maksimum 5MB'); return; }
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    setForm((f) => ({ ...f, file_name: file.name, file_type: file.type, file_size: file.size, file_base64: b64 }));
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = { ...form, customer_id: form.customer_id || null };
      if (editing) { await api.put(`/documents/${editing.id}`, payload); toast.success('Dokumen diperbarui'); }
      else { await api.post('/documents', payload); toast.success('Dokumen ditambahkan'); }
      setOpenForm(false); load();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/documents/${deleteId}`); toast.success('Dokumen dihapus'); setDeleteId(null); load(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const download = (doc) => {
    if (!doc.file_base64) { toast.error('Tidak ada file terlampir'); return; }
    const a = document.createElement('a');
    a.href = doc.file_base64;
    a.download = doc.file_name || `${doc.title}.bin`;
    a.click();
  };

  const exportCsv = () => {
    const headers = ['Judul','Kategori','No Dokumen','Tgl Dokumen','Berlaku Dari','Kedaluwarsa','Pelanggan','Deskripsi'];
    const cmap = Object.fromEntries(customers.map(c => [c.id, c.company_name]));
    const rows = items.map(i => [i.title,i.category,i.doc_number,i.doc_date,i.valid_from,i.valid_until,cmap[i.customer_id]||'-',i.description].map(v => `"${(v??'').toString().replace(/"/g,'""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `documents-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url); toast.success('Data diekspor');
  };

  const cmap = Object.fromEntries(customers.map(c => [c.id, c.company_name]));
  const isExpired = (d) => d && new Date(d) < new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Dokumen & Arsip</h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola BA, SLA, kontrak, topologi, dan dokumen teknis lainnya.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid={CRUD.export(MOD)}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
          {canWrite && <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(MOD)}><Plus className="w-4 h-4 mr-1.5" /> Tambah Dokumen</Button>}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid={CRUD.search(MOD)} placeholder="Cari judul atau nomor dokumen…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9 h-9" />
            </div>
            <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44 h-9" data-testid={CRUD.filterCategory(MOD)}><SelectValue placeholder="Kategori" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kategori</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table data-testid={CRUD.table(MOD)}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Judul</TableHead>
                  <TableHead className="text-xs">Kategori</TableHead>
                  <TableHead className="text-xs">No. Dokumen</TableHead>
                  <TableHead className="text-xs">Pelanggan</TableHead>
                  <TableHead className="text-xs">Kedaluwarsa</TableHead>
                  <TableHead className="text-xs">File</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
                {!loading && items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Belum ada dokumen.</TableCell></TableRow>}
                {!loading && items.map((it) => (
                  <TableRow key={it.id} data-testid={CRUD.row(MOD, it.id)} className="hover:bg-accent/40">
                    <TableCell className="font-medium max-w-xs truncate">{it.title}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{it.category}</span></TableCell>
                    <TableCell className="font-mono text-xs">{it.doc_number || '-'}</TableCell>
                    <TableCell className="text-sm">{cmap[it.customer_id] || '-'}</TableCell>
                    <TableCell className="text-sm">
                      {it.valid_until ? (
                        <span className={cn(isExpired(it.valid_until) ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-foreground')}>{it.valid_until}</span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{it.file_name ? <FileText className="w-4 h-4 text-primary" /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setPreviewDoc(it)} data-testid={CRUD.viewBtn(MOD, it.id)}><Eye className="w-4 h-4" /></Button>
                        {it.file_base64 && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => download(it)}><FileDown className="w-4 h-4" /></Button>}
                        {canWrite && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(it)} data-testid={CRUD.editBtn(MOD, it.id)}><Pencil className="w-4 h-4" /></Button>}
                        {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => setDeleteId(it.id)} data-testid={CRUD.deleteBtn(MOD, it.id)}><Trash2 className="w-4 h-4" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>Menampilkan {items.length} dari {total} dokumen</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid={CRUD.pagePrev(MOD)}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="tabular-nums">Hal. {page} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid={CRUD.pageNext(MOD)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Sheet */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit Dokumen' : 'Tambah Dokumen'}</SheetTitle>
            <SheetDescription>Lengkapi metadata dokumen dan unggah file bila ada.</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <Field label="Judul" className="col-span-2" error={errors.title}><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Kategori" error={errors.category}><Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="No. Dokumen"><Input value={form.doc_number} onChange={(e) => setForm({ ...form, doc_number: e.target.value })} /></Field>
            <Field label="Tanggal Dokumen"><Input type="date" value={form.doc_date || ''} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
            <Field label="Berlaku Dari"><Input type="date" value={form.valid_from || ''} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
            <Field label="Kedaluwarsa" className="col-span-2"><Input type="date" value={form.valid_until || ''} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></Field>
            <Field label="Pelanggan" className="col-span-2">
              <Select value={form.customer_id || 'none'} onValueChange={(v) => setForm({ ...form, customer_id: v === 'none' ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Pilih pelanggan (opsional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak terhubung —</SelectItem>
                  {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name} ({c.sid})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Deskripsi" className="col-span-2"><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="File (max 5MB)" className="col-span-2">
              <div className="flex items-center gap-2">
                <label className="flex-1">
                  <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="documents-file-input" />
                  <div className="cursor-pointer border border-dashed border-border rounded-md px-3 py-4 text-center text-sm text-muted-foreground hover:bg-accent/40 transition-colors">
                    <Upload className="w-4 h-4 mx-auto mb-1" />
                    {form.file_name ? <span className="text-foreground">{form.file_name}</span> : 'Klik untuk memilih file'}
                    {form.file_size && <div className="text-xs mt-0.5">{(form.file_size / 1024).toFixed(1)} KB</div>}
                  </div>
                </label>
              </div>
            </Field>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={CRUD.cancelBtn(MOD)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={CRUD.saveBtn(MOD)}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Preview Dialog */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{previewDoc?.title}</DialogTitle></DialogHeader>
          {previewDoc && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Info k="Kategori" v={previewDoc.category} />
                <Info k="No. Dokumen" v={previewDoc.doc_number || '-'} />
                <Info k="Tgl Dokumen" v={previewDoc.doc_date || '-'} />
                <Info k="Berlaku Dari" v={previewDoc.valid_from || '-'} />
                <Info k="Kedaluwarsa" v={previewDoc.valid_until || '-'} />
                <Info k="Pelanggan" v={cmap[previewDoc.customer_id] || '-'} />
              </div>
              {previewDoc.description && <div className="pt-2 border-t border-border"><div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Deskripsi</div><div className="text-foreground">{previewDoc.description}</div></div>}
              {previewDoc.file_base64 && (
                <div className="pt-2 border-t border-border">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Preview</div>
                  {previewDoc.file_type?.startsWith('image/') ? (
                    <img src={previewDoc.file_base64} alt="preview" className="max-h-96 rounded-md border border-border" />
                  ) : previewDoc.file_type === 'application/pdf' ? (
                    <iframe title="pdf" src={previewDoc.file_base64} className="w-full h-96 border border-border rounded-md" />
                  ) : (
                    <div className="p-4 rounded-md border border-border bg-muted/40 text-sm text-muted-foreground">
                      Preview tidak tersedia untuk tipe ini. Silakan unduh.
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={() => download(previewDoc)} className="mt-3"><FileDown className="w-4 h-4 mr-1.5" /> Unduh</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus dokumen ini?</AlertDialogTitle><AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid={CRUD.confirmDelete(MOD)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
function Info({ k, v }) {
  return (<div><div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div><div className="text-sm mt-0.5">{v}</div></div>);
}
