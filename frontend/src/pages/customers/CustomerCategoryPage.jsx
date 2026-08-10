// Reusable Category-based CRUD page for Customer categories & similar.
// Backed by /api/customers with category filter, but each category has its own field set.
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
import { Plus, Search, Download, Pencil, Trash2, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import Breadcrumb from '@/components/Breadcrumb';
import ProviderFilter from '@/components/ProviderFilter';
import ConnectedServices from '@/components/ConnectedServices';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const SERVICE_STATUSES = ['Active', 'Suspended', 'Terminated', 'Pending'];

/**
 * Props:
 *  - moduleKey: e.g. 'broadband'
 *  - title, description
 *  - category: 'Broadband' | 'Dedicated Internet' | ...  (sent to backend as ?category)
 *  - breadcrumb: [{ label, to }]
 *  - columns: array of { key, label, mono, render }
 *  - fields: array of { name, label, type?, options?, required?, full?, rows? }
 *  - showPartner: boolean — include partner dropdown
 */
export default function CustomerCategoryPage({
  moduleKey, title, description, category, breadcrumb, columns, fields, showPartner = true, showProviderFilter = true, showConnectedServices = false,
}) {
  const { canWrite, canDelete } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [partners, setPartners] = useState([]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const PAGE_SIZE_OPTIONS = [20, 50, 75, 100];

  const [openForm, setOpenForm] = useState(false);
  const [openView, setOpenView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const empty = useMemo(() => {
    const base = { category, status: 'Active', partner_id: null, connected_services: [] };
    fields.forEach((f) => { if (!(f.name in base)) base[f.name] = f.default ?? ''; });
    return base;
  }, [category, fields]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, category, sort_by: sortBy, sort_dir: sortDir };
      if (q) params.q = q;
      if (status !== 'all') params.status = status;
      const { data } = await api.get('/customers', { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  }, [page, pageSize, sortBy, sortDir, q, status, category]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (showPartner) api.get('/partners', { params: { page_size: 200 } }).then(({ data }) => setPartners(data.items || []));
  }, [showPartner]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pmap = Object.fromEntries(partners.map((p) => [p.id, p]));

  // Client-side provider filter — includes connected_services providers too
  const filteredItems = useMemo(() => {
    if (providerFilter === 'all') return items;
    if (providerFilter === '__none__') {
      return items.filter((it) => {
        const primary = it.partner_id ? pmap[it.partner_id]?.name : null;
        const linked = (it.connected_services || []).some((cs) => cs.partner_id && pmap[cs.partner_id]?.name);
        return !primary && !linked;
      });
    }
    return items.filter((it) => {
      const primary = it.partner_id ? pmap[it.partner_id]?.name : null;
      if (primary === providerFilter) return true;
      return (it.connected_services || []).some((cs) => cs.partner_id && pmap[cs.partner_id]?.name === providerFilter);
    });
  }, [items, providerFilter, pmap]);

  const getPrimaryProvider = (it) => (it.partner_id && pmap[it.partner_id]?.name) || null;

  const openCreate = () => { setEditing(null); setForm(empty); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...empty, ...row, partner_id: row.partner_id || null }); setErrors({}); setOpenForm(true); };
  const openDetail = (row) => { setEditing(row); setOpenView(true); };

  const validate = () => {
    const e = {};
    fields.forEach((f) => { if (f.required && !String(form[f.name] ?? '').trim()) e[f.name] = `${f.label} wajib`; });
    if (!form.sid?.trim()) e.sid = 'SID wajib';
    if (!form.company_name?.trim()) e.company_name = 'Nama pelanggan wajib';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = { ...form, category, partner_id: form.partner_id || null };
      if (editing) { await api.put(`/customers/${editing.id}`, payload); toast.success('Pelanggan diperbarui'); }
      else { await api.post('/customers', payload); toast.success('Pelanggan ditambahkan'); }
      setOpenForm(false); load(); refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/customers/${deleteId}`); toast.success('Pelanggan dihapus'); setDeleteId(null); load(); refreshCounts(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const exportCsv = () => {
    const headers = ['SID', 'Pelanggan', ...fields.map(f => f.label), 'Status', 'Aktivasi', 'PIC', 'Kontak', 'Email', 'Catatan'];
    const rows = items.map(i => {
      const base = [i.sid, i.company_name, ...fields.map(f => i[f.name] ?? ''), i.status, i.activation_date, i.pic_name, i.phone, i.email, i.notes];
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
    if (f.type === 'number') return <Input type="number" value={val} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />;
    if (f.type === 'date') return <Input type="date" value={val || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />;
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
          {canWrite && <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(moduleKey)}><Plus className="w-4 h-4 mr-1.5" /> Tambah</Button>}
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid={CRUD.search(moduleKey)} placeholder="Cari SID, nama, PIC…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="pl-9 h-9" />
            </div>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-44 h-9" data-testid={CRUD.filterStatus(moduleKey)}><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {SERVICE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {showProviderFilter && (
            <ProviderFilter
              items={items}
              getProvider={getPrimaryProvider}
              value={providerFilter}
              onChange={setProviderFilter}
              testKey={moduleKey}
            />
          )}

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
                {loading && Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={columns.length + 2}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
                {!loading && filteredItems.length === 0 && <TableRow><TableCell colSpan={columns.length + 2} className="text-center py-10 text-sm text-muted-foreground">Belum ada data.</TableCell></TableRow>}
                {!loading && filteredItems.map((it) => (
                  <TableRow key={it.id} data-testid={CRUD.row(moduleKey, it.id)} className="hover:bg-accent/40">
                    {columns.map(c => (
                      <TableCell key={c.key} className={cn('text-sm', c.mono && 'font-mono text-xs')}>
                        {c.render ? c.render(it, pmap) : (it[c.key] || '-')}
                      </TableCell>
                    ))}
                    <TableCell><StatusBadge value={it.status} /></TableCell>
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

          <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
            <div>Menampilkan {filteredItems.length} dari {total} data{providerFilter !== 'all' ? ' (difilter)' : ''}</div>
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
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit' : 'Tambah'} — {title}</SheetTitle>
            <SheetDescription>Kategori: <span className="font-medium text-foreground">{category}</span></SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <FormField label="SID *" error={errors.sid}><Input value={form.sid || ''} onChange={(e) => setForm({ ...form, sid: e.target.value })} /></FormField>
            <FormField label="Status">
              <Select value={form.status || 'Active'} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SERVICE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField label="Nama Pelanggan *" className="col-span-2" error={errors.company_name}><Input value={form.company_name || ''} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></FormField>
            {fields.map((f) => (
              <FormField key={f.name} label={`${f.label}${f.required ? ' *' : ''}`} className={f.full ? 'col-span-2' : ''} error={errors[f.name]}>
                {renderField(f)}
              </FormField>
            ))}
            <FormField label="Tanggal Aktivasi"><Input type="date" value={form.activation_date || ''} onChange={(e) => setForm({ ...form, activation_date: e.target.value })} /></FormField>
            <FormField label="PIC"><Input value={form.pic_name || ''} onChange={(e) => setForm({ ...form, pic_name: e.target.value })} /></FormField>
            <FormField label="Telepon"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
            <FormField label="Email"><Input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
            {showPartner && (
              <FormField label="Mitra / Provider" className="col-span-2">
                <Select value={form.partner_id || 'none'} onValueChange={(v) => setForm({ ...form, partner_id: v === 'none' ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih mitra (opsional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tidak terhubung —</SelectItem>
                    {partners.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <div className="flex flex-col leading-tight py-0.5">
                          <span className="text-sm font-medium">{p.name} <span className="text-[11px] text-muted-foreground font-mono">· CID {p.cid || '-'}</span></span>
                          {p.install_address && <span className="text-[10px] text-muted-foreground truncate max-w-[420px]">{p.install_address}</span>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            {showConnectedServices && (
              <div className="col-span-2 pt-2 border-t border-border">
                <ConnectedServices
                  value={form.connected_services || []}
                  onChange={(list) => setForm({ ...form, connected_services: list })}
                  partners={partners}
                />
              </div>
            )}
            <FormField label="Catatan" className="col-span-2"><Textarea rows={3} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
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
          <SheetHeader><SheetTitle>Detail Pelanggan</SheetTitle></SheetHeader>
          {editing && (
            <div className="mt-4 space-y-2 text-sm">
              <Info k="SID" v={editing.sid} />
              <Info k="Pelanggan" v={editing.company_name} />
              <Info k="Kategori" v={category} />
              {fields.map((f) => <Info key={f.name} k={f.label} v={editing[f.name] || '-'} />)}
              <Info k="Aktivasi" v={editing.activation_date || '-'} />
              <Info k="PIC" v={editing.pic_name || '-'} />
              <Info k="Telepon" v={editing.phone || '-'} />
              <Info k="Email" v={editing.email || '-'} />
              {showPartner && (
                <>
                  <div className="pt-2 border-t border-border">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Mitra yang Digunakan</div>
                    {editing.partner_id && pmap[editing.partner_id] ? (
                      <div className="p-3 rounded-md border border-border bg-muted/30 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{pmap[editing.partner_id].name}</div>
                          <StatusBadge value={pmap[editing.partner_id].status} />
                        </div>
                        {pmap[editing.partner_id].install_address && (
                          <div className="text-[11px] text-muted-foreground italic border-l-2 border-primary/40 pl-2">
                            📍 {pmap[editing.partner_id].install_address}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <div><span className="text-muted-foreground">CID: </span><span className="font-mono">{pmap[editing.partner_id].cid || '-'}</span></div>
                          <div><span className="text-muted-foreground">Layanan: </span>{pmap[editing.partner_id].service_name || '-'}</div>
                          <div><span className="text-muted-foreground">Kapasitas: </span>{pmap[editing.partner_id].capacity || '-'}</div>
                          <div><span className="text-muted-foreground">Kontrak: </span>{pmap[editing.partner_id].contract_start || '-'} → {pmap[editing.partner_id].contract_end || '-'}</div>
                          <div><span className="text-muted-foreground">PIC: </span>{pmap[editing.partner_id].pic_name || '-'}</div>
                          <div><span className="text-muted-foreground">Helpdesk: </span>{pmap[editing.partner_id].helpdesk || '-'}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground py-2">Belum terhubung ke mitra manapun.</div>
                    )}
                  </div>
                </>
              )}
              <Info k="Catatan" v={editing.notes || '-'} />
              {showConnectedServices && Array.isArray(editing.connected_services) && editing.connected_services.length > 0 && (
                <div className="pt-3 border-t border-border">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Connected Services ({editing.connected_services.length})</div>
                  <ul className="space-y-2">
                    {editing.connected_services.map((cs, i) => (
                      <li key={i} className="p-2.5 rounded-md border border-border bg-muted/30 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{cs.name || '-'}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">{cs.category || '-'}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                          <div><span className="text-muted-foreground">Kapasitas: </span>{cs.capacity || '-'}</div>
                          <div><span className="text-muted-foreground">Source: </span>{cs.source === 'partner' ? <span className="font-mono">CID {cs.cid || '-'}</span> : 'manual'}</div>
                          {cs.description && <div className="col-span-2 text-muted-foreground">{cs.description}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="pt-2"><StatusBadge value={editing.status} /></div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus pelanggan ini?</AlertDialogTitle><AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid={CRUD.confirmDelete(moduleKey)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FormField({ label, children, className, error }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  );
}
function Info({ k, v }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-border last:border-0">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="col-span-2 text-foreground break-words">{v}</div>
    </div>
  );
}
