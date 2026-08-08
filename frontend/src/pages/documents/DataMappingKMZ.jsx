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
import { Plus, Search, Pencil, Trash2, Eye, ChevronLeft, ChevronRight, Upload, FileDown, Map as MapIcon, MapPin, FileArchive } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import Breadcrumb from '@/components/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { cn } from '@/lib/utils';

const MOD = 'kmz-mapping';
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB per file
const PAGE_SIZE_OPTIONS = [20, 50, 75, 100];

const EMPTY = {
  name: '', description: '', region: '', version: '',
  notes: '', upload_date: new Date().toISOString().slice(0, 10), files: [],
};

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function DataMappingKMZ() {
  const { canWrite, canDelete, user } = useAuth();
  const { refresh: refreshCounts } = useCounts();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [openForm, setOpenForm] = useState(false);
  const [openDetail, setOpenDetail] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteMappingId, setDeleteMappingId] = useState(null);
  const [deleteFileTarget, setDeleteFileTarget] = useState(null); // { mid, fid, name }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize };
      if (q) params.q = q;
      const { data } = await api.get('/kmz-mappings', { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q]);

  useEffect(() => { load(); }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const regions = useMemo(() => {
    const set = new Map();
    items.forEach((m) => {
      const r = (m.region || '').trim();
      if (!r) return;
      set.set(r, (set.get(r) || 0) + 1);
    });
    return Array.from(set.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const filteredItems = useMemo(() => {
    if (regionFilter === 'all') return items;
    if (regionFilter === '__none__') return items.filter((m) => !m.region);
    return items.filter((m) => (m.region || '') === regionFilter);
  }, [items, regionFilter]);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, files: [] }); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...EMPTY, ...row, files: row.files || [] }); setErrors({}); setOpenForm(true); };
  const openView = (row) => { setEditing(row); setOpenDetail(true); };

  const validate = () => {
    const e = {};
    if (!form.name?.trim()) e.name = 'Nama Mapping wajib diisi';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildPayload = () => ({
    name: form.name?.trim() || '',
    description: form.description || '',
    region: form.region || '',
    version: form.version || '',
    notes: form.notes || '',
    upload_date: form.upload_date || new Date().toISOString().slice(0, 10),
    files: editing ? undefined : (form.files || []).map((f) => ({ ...f, uploaded_by: f.uploaded_by || user?.email })),
  });

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      let mappingId;
      const payload = buildPayload();
      if (editing) {
        // preserve existing files on update; files are managed via dedicated endpoints
        const { files, ...rest } = payload;
        await api.put(`/kmz-mappings/${editing.id}`, { ...rest, files: editing.files || [] });
        mappingId = editing.id;
        toast.success('Data mapping diperbarui');
      } else {
        // Create mapping first (without files), then upload each file so audit fields get set
        const createBody = { ...payload, files: [] };
        const { data: created } = await api.post('/kmz-mappings', createBody);
        mappingId = created.id;
        for (const f of form.files || []) {
          try {
            await api.post(`/kmz-mappings/${mappingId}/files`, {
              name: f.name, size: f.size, type: f.type, base64: f.base64, notes: f.notes || '',
            });
          } catch (err) {
            toast.error(`Gagal upload ${f.name}: ${formatApiError(err)}`);
          }
        }
        toast.success('Data mapping ditambahkan');
      }
      setOpenForm(false);
      load();
      refreshCounts();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const uploadFilesToMapping = async (mid, filesList) => {
    setUploading(true);
    let okCount = 0;
    try {
      for (const file of Array.from(filesList || [])) {
        if (file.size > MAX_SIZE) {
          toast.error(`${file.name}: melebihi 25MB, dilewati`);
          continue;
        }
        const b64 = await readFileAsDataURL(file);
        try {
          const { data } = await api.post(`/kmz-mappings/${mid}/files`, {
            name: file.name, size: file.size, type: file.type || 'application/vnd.google-earth.kmz', base64: b64, notes: '',
          });
          okCount += 1;
          // Update editing/detail state in place
          setEditing((prev) => (prev && prev.id === mid ? data : prev));
          setItems((prev) => prev.map((m) => (m.id === mid ? data : m)));
        } catch (err) {
          toast.error(`Gagal upload ${file.name}: ${formatApiError(err)}`);
        }
      }
      if (okCount > 0) toast.success(`${okCount} file berhasil diupload`);
    } finally {
      setUploading(false);
    }
  };

  const pickAndUploadForExisting = async (mid, fileList) => {
    if (!fileList || fileList.length === 0) return;
    await uploadFilesToMapping(mid, fileList);
    refreshCounts();
  };

  const handleFormFilesAdd = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    // If we are editing an existing mapping, upload directly to backend so it persists per file.
    if (editing?.id) {
      await pickAndUploadForExisting(editing.id, fileList);
      // sync form.files with editing.files
      setForm((f) => ({ ...f, files: editing?.files || f.files || [] }));
      return;
    }
    // Otherwise, stage locally on the form until save creates the mapping.
    const staged = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_SIZE) { toast.error(`${file.name}: melebihi 25MB, dilewati`); continue; }
      const b64 = await readFileAsDataURL(file);
      staged.push({
        id: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name, size: file.size, type: file.type || 'application/vnd.google-earth.kmz',
        base64: b64, uploaded_at: new Date().toISOString(), uploaded_by: user?.email, notes: '', staged: true,
      });
    }
    setForm((f) => ({ ...f, files: [...(f.files || []), ...staged] }));
  };

  const removeStagedFile = (fid) => {
    setForm((f) => ({ ...f, files: (f.files || []).filter((x) => x.id !== fid) }));
  };

  const confirmDeleteFile = async () => {
    if (!deleteFileTarget) return;
    const { mid, fid } = deleteFileTarget;
    try {
      const { data } = await api.delete(`/kmz-mappings/${mid}/files/${fid}`);
      setEditing((prev) => (prev && prev.id === mid ? data : prev));
      setItems((prev) => prev.map((m) => (m.id === mid ? data : m)));
      setForm((f) => ({ ...f, files: (data.files || []) }));
      toast.success('File dihapus');
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setDeleteFileTarget(null);
    }
  };

  const confirmDeleteMapping = async () => {
    try {
      await api.delete(`/kmz-mappings/${deleteMappingId}`);
      toast.success('Data mapping dihapus');
      setDeleteMappingId(null);
      load();
      refreshCounts();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const downloadFile = (file) => {
    if (!file?.base64) { toast.error('File tidak tersedia'); return; }
    const a = document.createElement('a');
    a.href = file.base64;
    a.download = file.name || 'mapping.kmz';
    a.click();
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Dokumen & Arsip' }, { label: 'Data Mapping (KMZ)' }]} />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Data Mapping (KMZ)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Repositori file KMZ jaringan. Satu data mapping dapat menampung beberapa file KMZ (revisi &amp; penambahan).
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={openCreate} data-testid={`${MOD}-add-button`}>
            <Plus className="w-4 h-4 mr-1.5" /> Tambah Data Mapping
          </Button>
        )}
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid={`${MOD}-search`}
                placeholder="Cari nama mapping, wilayah, versi…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                className="pl-9 h-9"
              />
            </div>
            <Select value={regionFilter} onValueChange={(v) => { setRegionFilter(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-56 h-9" data-testid={`${MOD}-filter-region`}>
                <MapPin className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Semua Wilayah" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Wilayah · {items.length}</SelectItem>
                {regions.map(([name, cnt]) => (
                  <SelectItem key={name} value={name}>{name} · {cnt}</SelectItem>
                ))}
                {items.some((m) => !m.region) && (
                  <SelectItem value="__none__">Tanpa Wilayah</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table data-testid={`${MOD}-table`}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Nama Mapping</TableHead>
                  <TableHead className="text-xs">Wilayah</TableHead>
                  <TableHead className="text-xs">Versi</TableHead>
                  <TableHead className="text-xs text-center">Jumlah File</TableHead>
                  <TableHead className="text-xs">Upload Date</TableHead>
                  <TableHead className="text-xs">Uploaded By</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))}
                {!loading && filteredItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                      Belum ada data mapping. Klik "Tambah Data Mapping" untuk mulai.
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filteredItems.map((m) => (
                  <TableRow key={m.id} data-testid={`${MOD}-row-${m.id}`} className="hover:bg-accent/40">
                    <TableCell className="font-medium max-w-xs truncate">
                      <div className="flex items-center gap-2">
                        <MapIcon className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate">{m.name}</span>
                      </div>
                      {m.description && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{m.description}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{m.region || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{m.version || '—'}</TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium">
                        <FileArchive className="w-3 h-3" /> {(m.files || []).length}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{m.upload_date || m.created_at?.slice(0, 10) || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.created_by || '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openView(m)} data-testid={`${MOD}-view-${m.id}`}><Eye className="w-4 h-4" /></Button>
                        {canWrite && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(m)} data-testid={`${MOD}-edit-${m.id}`}><Pencil className="w-4 h-4" /></Button>}
                        {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => setDeleteMappingId(m.id)} data-testid={`${MOD}-delete-${m.id}`}><Trash2 className="w-4 h-4" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
            <div>Menampilkan {filteredItems.length} dari {total} data{regionFilter !== 'all' ? ' (difilter)' : ''}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-widest">Tampilkan</span>
                <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
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
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid={`${MOD}-page-prev`}><ChevronLeft className="w-4 h-4" /></Button>
                <span className="tabular-nums">Hal. {page} / {pageCount}</span>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid={`${MOD}-page-next`}><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form Sheet (Create / Edit) */}
      <Sheet open={openForm} onOpenChange={(o) => { if (!o) { setEditing(null); } setOpenForm(o); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit Data Mapping' : 'Tambah Data Mapping'}</SheetTitle>
            <SheetDescription>
              Simpan metadata mapping dan unggah beberapa file KMZ. File dapat ditambahkan / dihapus setelah data dibuat.
            </SheetDescription>
          </SheetHeader>

          <div className="grid grid-cols-2 gap-3 py-4">
            <Field label="Nama Mapping *" full error={errors.name}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid={`${MOD}-form-name`} />
            </Field>
            <Field label="Wilayah / Region">
              <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="mis. Jakarta Selatan" data-testid={`${MOD}-form-region`} />
            </Field>
            <Field label="Versi / Revisi">
              <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="mis. v1.2 · Rev 3" data-testid={`${MOD}-form-version`} />
            </Field>
            <Field label="Tanggal Upload">
              <Input type="date" value={form.upload_date || ''} onChange={(e) => setForm({ ...form, upload_date: e.target.value })} data-testid={`${MOD}-form-upload-date`} />
            </Field>
            <Field label="Uploaded By">
              <Input value={editing?.created_by || user?.email || ''} disabled className="bg-muted/40" />
            </Field>
            <Field label="Deskripsi" full>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid={`${MOD}-form-description`} />
            </Field>
            <Field label="Catatan" full>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid={`${MOD}-form-notes`} />
            </Field>

            <div className="col-span-2 pt-2 border-t border-border">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                File KMZ (multiple upload, max 25MB / file)
              </Label>
              <label className="mt-2 block">
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".kmz,application/vnd.google-earth.kmz,application/octet-stream"
                  onChange={(e) => { handleFormFilesAdd(e.target.files); e.target.value = ''; }}
                  data-testid={`${MOD}-form-file-input`}
                  disabled={uploading}
                />
                <div className={cn(
                  'cursor-pointer border-2 border-dashed border-border rounded-md px-4 py-6 text-center text-sm transition-colors',
                  'hover:bg-accent/40 hover:border-primary/50',
                  uploading && 'opacity-60 cursor-wait'
                )}>
                  <Upload className="w-5 h-5 mx-auto mb-1.5 text-primary" />
                  <div className="text-foreground font-medium">
                    {uploading ? 'Uploading…' : 'Klik untuk pilih file .kmz'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Bisa pilih beberapa file sekaligus. {editing ? 'File akan diupload segera.' : 'File akan diunggah setelah data disimpan.'}
                  </div>
                </div>
              </label>

              {(form.files || []).length > 0 && (
                <div className="mt-3 space-y-1.5" data-testid={`${MOD}-form-files-list`}>
                  {(form.files || []).map((f) => (
                    <div key={f.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30">
                      <FileArchive className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{f.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatSize(f.size)}
                          {f.staged && <span className="ml-2 text-amber-600 dark:text-amber-400">· Belum tersimpan</span>}
                          {f.uploaded_at && !f.staged && <span className="ml-2">· {String(f.uploaded_at).slice(0, 10)}</span>}
                        </div>
                      </div>
                      {f.base64 && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => downloadFile(f)} data-testid={`${MOD}-form-download-${f.id}`}>
                          <FileDown className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-rose-600 hover:text-rose-700"
                        data-testid={`${MOD}-form-remove-${f.id}`}
                        onClick={() => {
                          if (f.staged || !editing?.id) {
                            removeStagedFile(f.id);
                          } else {
                            setDeleteFileTarget({ mid: editing.id, fid: f.id, name: f.name });
                          }
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={`${MOD}-form-cancel`}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={`${MOD}-form-save`}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Detail Dialog */}
      <Dialog open={openDetail} onOpenChange={(o) => { if (!o) setEditing(null); setOpenDetail(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapIcon className="w-5 h-5 text-primary" /> {editing?.name}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Info k="Wilayah" v={editing.region || '—'} />
                <Info k="Versi / Revisi" v={editing.version || '—'} />
                <Info k="Tanggal Upload" v={editing.upload_date || editing.created_at?.slice(0, 10) || '—'} />
                <Info k="Uploaded By" v={editing.created_by || '—'} />
              </div>
              {editing.description && (
                <div className="pt-2 border-t border-border">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Deskripsi</div>
                  <div className="text-foreground">{editing.description}</div>
                </div>
              )}
              {editing.notes && (
                <div className="pt-2 border-t border-border">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Catatan</div>
                  <div className="text-foreground whitespace-pre-line">{editing.notes}</div>
                </div>
              )}

              <div className="pt-3 border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    File KMZ ({(editing.files || []).length})
                  </div>
                  {canWrite && (
                    <label>
                      <input
                        type="file"
                        className="hidden"
                        multiple
                        accept=".kmz,application/vnd.google-earth.kmz,application/octet-stream"
                        onChange={(e) => { pickAndUploadForExisting(editing.id, e.target.files); e.target.value = ''; }}
                        data-testid={`${MOD}-detail-file-input`}
                        disabled={uploading}
                      />
                      <span className={cn('inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-border cursor-pointer hover:bg-accent transition-colors', uploading && 'opacity-60 cursor-wait')}>
                        <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : 'Tambah File'}
                      </span>
                    </label>
                  )}
                </div>
                {(editing.files || []).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-md">
                    Belum ada file KMZ.
                  </div>
                ) : (
                  <ul className="space-y-1.5" data-testid={`${MOD}-detail-files-list`}>
                    {(editing.files || []).map((f) => (
                      <li key={f.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
                        <FileArchive className="w-4 h-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{f.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatSize(f.size)}
                            {f.uploaded_at && <span> · {String(f.uploaded_at).slice(0, 10)}</span>}
                            {f.uploaded_by && <span> · oleh {f.uploaded_by}</span>}
                          </div>
                        </div>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => downloadFile(f)} data-testid={`${MOD}-detail-download-${f.id}`}>
                          <FileDown className="w-4 h-4" />
                        </Button>
                        {canDelete && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-rose-600 hover:text-rose-700"
                            onClick={() => setDeleteFileTarget({ mid: editing.id, fid: f.id, name: f.name })}
                            data-testid={`${MOD}-detail-remove-${f.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Mapping Confirm */}
      <AlertDialog open={!!deleteMappingId} onOpenChange={(o) => !o && setDeleteMappingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus data mapping ini?</AlertDialogTitle>
            <AlertDialogDescription>Semua file KMZ yang terlampir akan ikut terhapus. Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteMapping} data-testid={`${MOD}-confirm-delete`} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Single File Confirm */}
      <AlertDialog open={!!deleteFileTarget} onOpenChange={(o) => !o && setDeleteFileTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus file ini?</AlertDialogTitle>
            <AlertDialogDescription>File <span className="font-mono">{deleteFileTarget?.name}</span> akan dihapus dari data mapping, namun mapping tetap tersimpan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteFile} data-testid={`${MOD}-confirm-delete-file`} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus File</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children, full, error }) {
  return (
    <div className={cn('space-y-1.5', full && 'col-span-2')}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  );
}

function Info({ k, v }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="text-sm mt-0.5">{v}</div>
    </div>
  );
}
