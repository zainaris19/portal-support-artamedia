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
import Breadcrumb from '@/components/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const MAX_SIZE = 5 * 1024 * 1024;

export default function DocumentCategoryPage({ moduleKey, category, scope, title, description, breadcrumb }) {
  const { canWrite, canDelete } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [partners, setPartners] = useState([]);

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const EMPTY = { title: '', category, scope: scope || 'customer', doc_number: '', doc_date: '', valid_from: '', valid_until: '', customer_id: null, partner_id: null, status: 'Active', description: '', file_name: null, file_type: null, file_size: null, file_base64: null };

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
      const params = { page, page_size: pageSize, category };
      if (scope) params.scope = scope;
      if (q) params.q = q;
      const { data } = await api.get('/documents', { params });
      setItems(data.items || []); setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  }, [page, q, category, scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/customers', { params: { page_size: 200 } }).then(({ data }) => setCustomers(data.items || []));
    api.get('/partners', { params: { page_size: 200 } }).then(({ data }) => setPartners(data.items || []));
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const cmap = Object.fromEntries(customers.map(c => [c.id, c]));
  const pmap = Object.fromEntries(partners.map(p => [p.id, p]));

  const openCreate = () => { setEditing(null); setForm(EMPTY); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...EMPTY, ...row, customer_id: row.customer_id || null, partner_id: row.partner_id || null }); setErrors({}); setOpenForm(true); };

  const onFile = async (file) => {
    if (!file) return;
    if (file.size > MAX_SIZE) { toast.error('Ukuran file maksimum 5MB'); return; }
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    setForm((f) => ({ ...f, file_name: file.name, file_type: file.type, file_size: file.size, file_base64: b64 }));
  };

  const validate = () => {
    const e = {};
    if (!form.title?.trim()) e.title = 'Judul wajib';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = { ...form, category, scope: scope || form.scope || 'customer', customer_id: form.customer_id || null, partner_id: form.partner_id || null };
      if (editing) { await api.put(`/documents/${editing.id}`, payload); toast.success('Dokumen diperbarui'); }
      else { await api.post('/documents', payload); toast.success('Dokumen ditambahkan'); }
      setOpenForm(false); load(); refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/documents/${deleteId}`); toast.success('Dokumen dihapus'); setDeleteId(null); load(); refreshCounts(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const download = (doc) => {
    if (!doc.file_base64) { toast.error('Tidak ada file terlampir'); return; }
    const a = document.createElement('a'); a.href = doc.file_base64; a.download = doc.file_name || `${doc.title}.bin`; a.click();
  };

  const exportCsv = () => {
    const headers = ['Judul','No Dokumen','Tgl Dokumen','Berlaku Dari','Kedaluwarsa','Pelanggan','SID Pelanggan','Provider Pelanggan','Alamat Pelanggan','Mitra','CID Mitra','Status','Deskripsi'];
    const rows = items.map(i => {
      const c = cmap[i.customer_id];
      const p = pmap[i.partner_id];
      const cProvider = c?.partner_id ? pmap[c.partner_id]?.name : '';
      return [i.title,i.doc_number,i.doc_date,i.valid_from,i.valid_until,c?.company_name||'-',c?.sid||'-',cProvider||'-',c?.address||'-',p?.name||'-',p?.cid||'-',i.status,i.description]
        .map(v => `"${(v ?? '').toString().replace(/"/g,'""')}"`).join(',');
    });
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${moduleKey}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url); toast.success('Data diekspor');
  };

  const isExpired = (d) => d && new Date(d) < new Date();

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
          {canWrite && <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(moduleKey)}><Plus className="w-4 h-4 mr-1.5" /> Tambah Dokumen</Button>}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input data-testid={CRUD.search(moduleKey)} placeholder="Cari judul atau nomor dokumen…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9 h-9" />
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table data-testid={CRUD.table(moduleKey)}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Judul</TableHead>
                  <TableHead className="text-xs">No. Dokumen</TableHead>
                  <TableHead className="text-xs">Pelanggan</TableHead>
                  <TableHead className="text-xs">Mitra</TableHead>
                  <TableHead className="text-xs">Kedaluwarsa</TableHead>
                  <TableHead className="text-xs">File</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
                {!loading && items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Belum ada dokumen di kategori ini.</TableCell></TableRow>}
                {!loading && items.map((it) => (
                  <TableRow key={it.id} data-testid={CRUD.row(moduleKey, it.id)} className="hover:bg-accent/40">
                    <TableCell className="font-medium max-w-xs truncate">{it.title}</TableCell>
                    <TableCell className="font-mono text-xs">{it.doc_number || '-'}</TableCell>
                    <TableCell className="text-sm">
                      {cmap[it.customer_id] ? (
                        <div className="flex flex-col leading-tight max-w-[260px]">
                          <span className="font-medium text-foreground">{cmap[it.customer_id].company_name}</span>
                          {(() => {
                            const c = cmap[it.customer_id];
                            const prov = c.partner_id ? pmap[c.partner_id] : null;
                            return prov ? (
                              <span className="text-[10px] font-mono text-muted-foreground">
                                {prov.name}{prov.cid ? ` · CID ${prov.cid}` : ''}
                              </span>
                            ) : null;
                          })()}
                          {cmap[it.customer_id].address && (
                            <span className="text-[10px] font-mono text-muted-foreground truncate" title={cmap[it.customer_id].address}>
                              {cmap[it.customer_id].address}
                            </span>
                          )}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {pmap[it.partner_id] ? (
                        <div className="flex flex-col leading-tight max-w-[260px]">
                          <span className="font-medium text-foreground">{pmap[it.partner_id].name}</span>
                          {pmap[it.partner_id].cid && (
                            <span className="text-[10px] font-mono text-muted-foreground">CID {pmap[it.partner_id].cid}</span>
                          )}
                          {pmap[it.partner_id].install_address && (
                            <span className="text-[10px] font-mono text-muted-foreground truncate" title={pmap[it.partner_id].install_address}>
                              {pmap[it.partner_id].install_address}
                            </span>
                          )}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-sm">{it.valid_until ? <span className={cn(isExpired(it.valid_until) ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-foreground')}>{it.valid_until}</span> : '-'}</TableCell>
                    <TableCell>{it.file_name ? <FileText className="w-4 h-4 text-primary" /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setPreviewDoc(it)} data-testid={CRUD.viewBtn(moduleKey, it.id)}><Eye className="w-4 h-4" /></Button>
                        {it.file_base64 && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => download(it)}><FileDown className="w-4 h-4" /></Button>}
                        {canWrite && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(it)} data-testid={CRUD.editBtn(moduleKey, it.id)}><Pencil className="w-4 h-4" /></Button>}
                        {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => setDeleteId(it.id)} data-testid={CRUD.deleteBtn(moduleKey, it.id)}><Trash2 className="w-4 h-4" /></Button>}
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
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid={CRUD.pagePrev(moduleKey)}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="tabular-nums">Hal. {page} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid={CRUD.pageNext(moduleKey)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit Dokumen' : 'Tambah Dokumen'}</SheetTitle>
            <SheetDescription>Kategori: <span className="font-medium text-foreground">{category}</span></SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <F label="Judul *" full error={errors.title}><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></F>
            <F label="No. Dokumen"><Input value={form.doc_number} onChange={(e) => setForm({ ...form, doc_number: e.target.value })} /></F>
            <F label="Status">
              <Select value={form.status || 'Active'} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Active','Draft','Expired','Archived'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Tanggal Dokumen"><Input type="date" value={form.doc_date || ''} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></F>
            <F label="Berlaku Dari"><Input type="date" value={form.valid_from || ''} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></F>
            <F label="Kedaluwarsa" full><Input type="date" value={form.valid_until || ''} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></F>
            <F label="Pelanggan Terkait" full>
              <Select value={form.customer_id || 'none'} onValueChange={(v) => setForm({ ...form, customer_id: v === 'none' ? null : v })}>
                <SelectTrigger><SelectValue placeholder={scope === 'provider' ? 'Opsional' : 'Pilih pelanggan (opsional)'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak terhubung —</SelectItem>
                  {customers.map(c => {
                    const prov = c.partner_id ? pmap[c.partner_id] : null;
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex flex-col leading-tight py-0.5">
                          <span className="text-sm font-medium">
                            {c.company_name}
                            {c.sid && <span className="text-[11px] text-muted-foreground font-mono"> · SID {c.sid}</span>}
                          </span>
                          {prov && (
                            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[420px]">
                              {prov.name}{prov.cid ? ` · CID ${prov.cid}` : ''}
                            </span>
                          )}
                          {c.address && (
                            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[420px]">
                              {c.address}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </F>
            <F label={scope === 'provider' ? 'Mitra / Provider Terkait *' : 'Mitra Terkait'} full>
              <Select value={form.partner_id || 'none'} onValueChange={(v) => setForm({ ...form, partner_id: v === 'none' ? null : v })}>
                <SelectTrigger><SelectValue placeholder={scope === 'provider' ? 'Pilih provider' : 'Pilih mitra (opsional)'} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak terhubung —</SelectItem>
                  {partners.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex flex-col leading-tight py-0.5">
                        <span className="text-sm font-medium">
                          {p.name}
                          {p.cid && <span className="text-[11px] text-muted-foreground font-mono"> · CID {p.cid}</span>}
                        </span>
                        {p.install_address && (
                          <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[420px]">
                            {p.install_address}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </F>
            <F label="Deskripsi / Catatan" full><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></F>
            <F label="File (max 5MB)" full>
              <label>
                <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid={`${moduleKey}-file-input`} />
                <div className="cursor-pointer border border-dashed border-border rounded-md px-3 py-4 text-center text-sm text-muted-foreground hover:bg-accent/40 transition-colors">
                  <Upload className="w-4 h-4 mx-auto mb-1" />
                  {form.file_name ? <span className="text-foreground">{form.file_name}</span> : 'Klik untuk memilih file'}
                  {form.file_size && <div className="text-xs mt-0.5">{(form.file_size / 1024).toFixed(1)} KB</div>}
                </div>
              </label>
            </F>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={CRUD.cancelBtn(moduleKey)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={CRUD.saveBtn(moduleKey)}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Preview */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{previewDoc?.title}</DialogTitle></DialogHeader>
          {previewDoc && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <I k="No. Dokumen" v={previewDoc.doc_number || '-'} />
                <I k="Tgl Dokumen" v={previewDoc.doc_date || '-'} />
                <I k="Berlaku Dari" v={previewDoc.valid_from || '-'} />
                <I k="Kedaluwarsa" v={previewDoc.valid_until || '-'} />
                <I k="Pelanggan" v={(() => {
                  const c = cmap[previewDoc.customer_id];
                  if (!c) return '-';
                  const prov = c.partner_id ? pmap[c.partner_id] : null;
                  const parts = [c.company_name];
                  if (c.sid) parts.push(`SID ${c.sid}`);
                  if (prov) parts.push(`${prov.name}${prov.cid ? ' · CID ' + prov.cid : ''}`);
                  if (c.address) parts.push(c.address);
                  return parts.join(' · ');
                })()} />
                <I k="Mitra" v={pmap[previewDoc.partner_id] ? `${pmap[previewDoc.partner_id].name}${pmap[previewDoc.partner_id].cid ? ' · CID ' + pmap[previewDoc.partner_id].cid : ''}` : '-'} />
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
                    <div className="p-4 rounded-md border border-border bg-muted/40 text-sm text-muted-foreground">Preview tidak tersedia. Silakan unduh.</div>
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
  return (<div><div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div><div className="text-sm mt-0.5">{v}</div></div>);
}
