// Reusable Operations Log page (Shift Handover, Incident, Maintenance)
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
import { Plus, Search, Download, Pencil, Trash2, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge';
import { useAuth } from '@/context/AuthContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const STATUSES = ['Open', 'Monitoring', 'Pending', 'Resolved'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

export default function OperationsLog({ moduleKey, title, description, endpoint, columns, empty, formFields }) {
  const { canWrite, canDelete } = useAuth();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [openForm, setOpenForm] = useState(false);
  const [openView, setOpenView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, sort_by: 'created_at', sort_dir: 'desc' };
      if (q) params.q = q;
      if (status !== 'all') params.status = status;
      const { data } = await api.get(`/${endpoint}`, { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  }, [page, q, status, endpoint]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/customers', { params: { page_size: 200 } }).then(({ data }) => setCustomers(data.items || [])); }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const cmap = Object.fromEntries(customers.map(c => [c.id, c.company_name]));

  const openCreate = () => { setEditing(null); setForm(empty); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...empty, ...row, customer_id: row.customer_id || null }); setErrors({}); setOpenForm(true); };
  const openDetail = (row) => { setEditing(row); setOpenView(true); };

  const validate = () => {
    const e = {};
    formFields.forEach((f) => {
      if (f.required && !form[f.name]?.toString().trim?.()) e[f.name] = `${f.label} wajib`;
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = { ...form, customer_id: form.customer_id || null };
      if (editing) { await api.put(`/${endpoint}/${editing.id}`, payload); toast.success('Diperbarui'); }
      else { await api.post(`/${endpoint}`, payload); toast.success('Ditambahkan'); }
      setOpenForm(false); load();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/${endpoint}/${deleteId}`); toast.success('Dihapus'); setDeleteId(null); load(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const exportCsv = () => {
    const cols = columns.map(c => c.label);
    const rows = items.map(i => columns.map(c => {
      const v = c.render ? c.render(i, cmap) : i[c.key];
      return `"${(v ?? '').toString().replace(/"/g, '""')}"`;
    }).join(','));
    const csv = [cols.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${moduleKey}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url); toast.success('Data diekspor');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid={CRUD.export(moduleKey)}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
          {canWrite && <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(moduleKey)}><Plus className="w-4 h-4 mr-1.5" /> Tambah</Button>}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid={CRUD.search(moduleKey)} placeholder="Cari…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9 h-9" />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44 h-9" data-testid={CRUD.filterStatus(moduleKey)}><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table data-testid={CRUD.table(moduleKey)}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {columns.map((c) => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={columns.length + 1}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
                {!loading && items.length === 0 && <TableRow><TableCell colSpan={columns.length + 1} className="text-center py-10 text-sm text-muted-foreground">Tidak ada data.</TableCell></TableRow>}
                {!loading && items.map((it) => (
                  <TableRow key={it.id} data-testid={CRUD.row(moduleKey, it.id)} className="hover:bg-accent/40">
                    {columns.map((c) => (
                      <TableCell key={c.key} className={cn('text-sm', c.mono && 'font-mono text-xs')}>
                        {c.type === 'status' ? <StatusBadge value={it[c.key]} /> :
                         c.type === 'priority' ? <PriorityBadge value={it[c.key]} /> :
                         c.render ? c.render(it, cmap) : (it[c.key] || '-')}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
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

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>Menampilkan {items.length} dari {total}</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid={CRUD.pagePrev(moduleKey)}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="tabular-nums">Hal. {page} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid={CRUD.pageNext(moduleKey)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Sheet */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit' : 'Tambah'} — {title}</SheetTitle>
            <SheetDescription>Isi detail catatan operasional.</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            {formFields.map((f) => (
              <div key={f.name} className={cn('space-y-1.5', f.full && 'col-span-2')}>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{f.label}{f.required && ' *'}</Label>
                {f.type === 'textarea' ? (
                  <Textarea rows={f.rows || 3} value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
                ) : f.type === 'select' ? (
                  <Select value={form[f.name] || ''} onValueChange={(v) => setForm({ ...form, [f.name]: v })}>
                    <SelectTrigger><SelectValue placeholder="Pilih…" /></SelectTrigger>
                    <SelectContent>
                      {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : f.type === 'customer' ? (
                  <Select value={form[f.name] || 'none'} onValueChange={(v) => setForm({ ...form, [f.name]: v === 'none' ? null : v })}>
                    <SelectTrigger><SelectValue placeholder="Pilih pelanggan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Tidak terhubung —</SelectItem>
                      {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name} ({c.sid})</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type={f.type || 'text'} value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
                )}
                {errors[f.name] && <div className="text-xs text-rose-600 dark:text-rose-400">{errors[f.name]}</div>}
              </div>
            ))}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={CRUD.cancelBtn(moduleKey)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={CRUD.saveBtn(moduleKey)}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Detail */}
      <Sheet open={openView} onOpenChange={setOpenView}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Detail</SheetTitle></SheetHeader>
          {editing && (
            <div className="mt-4 space-y-2 text-sm">
              {formFields.map((f) => (
                <div key={f.name} className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{f.label}</div>
                  <div className="col-span-2 text-foreground break-words">
                    {f.type === 'customer' ? (cmap[editing[f.name]] || '-') :
                     (editing[f.name] === 'Open' || editing[f.name] === 'Monitoring' || editing[f.name] === 'Pending' || editing[f.name] === 'Resolved') ? <StatusBadge value={editing[f.name]} /> :
                     (editing[f.name] === 'Low' || editing[f.name] === 'Medium' || editing[f.name] === 'High' || editing[f.name] === 'Critical') ? <PriorityBadge value={editing[f.name]} /> :
                     (editing[f.name] || '-')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus catatan ini?</AlertDialogTitle><AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid={CRUD.confirmDelete(moduleKey)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { STATUSES, PRIORITIES };
