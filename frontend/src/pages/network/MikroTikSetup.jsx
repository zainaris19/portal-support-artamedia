import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Router, Plus, Pencil, Trash2, RefreshCw, Zap, ShieldCheck, ShieldOff, CheckCircle2, XCircle, AlertCircle, Play, Clock, Server, Info } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import Breadcrumb from '@/components/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

const AUTO_SYNC_OPTIONS = [
  { value: 'manual', label: 'Manual only' },
  { value: '5m', label: 'Every 5 minutes' },
  { value: '15m', label: 'Every 15 minutes' },
  { value: '30m', label: 'Every 30 minutes' },
  { value: '1h', label: 'Every 1 hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: 'daily', label: 'Daily' },
];

const MOD = 'mikrotik';

const EMPTY = {
  name: '', host: '', api_port: 8728, username: '', password: '',
  ssl_enabled: false, verify_ssl: false, routing_table: 'main',
  status: 'Active', description: '', auto_sync: 'manual',
};

export default function MikroTikSetup() {
  const { canWrite, canDelete } = useAuth();
  const [routers, setRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [syncingId, setSyncingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/network/routers'); setRouters(data || []); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpenForm(true); };
  const openEdit = (r) => { setEditing(r); setForm({ ...EMPTY, ...r, password: '' }); setOpenForm(true); };

  const save = async () => {
    if (!form.name?.trim() || !form.host?.trim() || !form.username?.trim()) { toast.error('Nama, Host, dan Username wajib'); return; }
    if (!editing && !form.password) { toast.error('Password wajib saat membuat router baru'); return; }
    setSaving(true);
    try {
      const payload = { ...form, api_port: Number(form.api_port) || 8728 };
      if (editing && !payload.password) delete payload.password;
      if (editing) await api.put(`/network/routers/${editing.id}`, payload);
      else await api.post('/network/routers', payload);
      toast.success('Konfigurasi tersimpan');
      setOpenForm(false); load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  const testConn = async (r) => {
    setTestingId(r.id);
    try {
      const { data } = await api.post(`/network/routers/${r.id}/test`);
      if (data.ok) toast.success(`Terhubung — ${data.identity || 'MikroTik'} (${data.version || 'v?'})`);
      else toast.error(`Gagal: ${data.error}`);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setTestingId(null); }
  };

  const syncNow = async (r) => {
    setSyncingId(r.id);
    try {
      const { data } = await api.post(`/network/routers/${r.id}/sync`);
      if (data.ok) toast.success(`Sync sukses — ${data.routes_processed} routes (${data.added} baru, ${data.updated} update)`);
      else toast.error(`Sync gagal: ${data.error}`);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSyncingId(null); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/network/routers/${deleteId}`); toast.success('Router dihapus'); setDeleteId(null); load(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'MikroTik Setup' }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>MikroTik Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola koneksi ke MikroTik RouterOS v7 via RouterOS API (default port 8728, atau 8729 untuk API-SSL). Password dienkripsi (AES/Fernet) dan tidak pernah dikirim balik ke frontend.</p>
        </div>
        {canWrite && <Button size="sm" onClick={openCreate} data-testid={`${MOD}-add-button`}><Plus className="w-4 h-4 mr-1.5" /> Tambah Router</Button>}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      ) : routers.length === 0 ? (
        <Card className="border-border"><CardContent className="p-10 text-center text-sm text-muted-foreground">
          <Router className="w-8 h-8 mx-auto mb-2 opacity-60" />
          Belum ada router terdaftar. Klik "Tambah Router" untuk mulai.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {routers.map((r) => {
            const statusStyle = r.connection_status === 'Connected'
              ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300'
              : r.connection_status === 'Error'
                ? 'bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300'
                : 'bg-slate-500/10 text-slate-700 border-slate-500/30 dark:text-slate-300';
            return (
              <Card key={r.id} className="border-border">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-base" style={{ fontFamily: 'Manrope' }}>{r.name}</span>
                        <span className={cn('text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border', statusStyle)}>{r.connection_status}</span>
                        {r.ssl_enabled && <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/10">API-SSL</span>}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">{r.host}:{r.api_port} · user {r.username}</div>
                      {r.description && <div className="text-xs mt-1">{r.description}</div>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {canWrite && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)} data-testid={`${MOD}-edit-${r.id}`}><Pencil className="w-4 h-4" /></Button>}
                      {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => setDeleteId(r.id)} data-testid={`${MOD}-delete-${r.id}`}><Trash2 className="w-4 h-4" /></Button>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <I k="Identity" v={r.router_identity || '—'} />
                    <I k="RouterOS" v={r.routeros_version || '—'} />
                    <I k="Routing Table" v={r.routing_table} />
                    <I k="Auto Sync" v={AUTO_SYNC_OPTIONS.find(o => o.value === r.auto_sync)?.label || 'Manual'} />
                    <I k="Last Success" v={fmtDate(r.last_success_at)} />
                    <I k="Last Failure" v={fmtDate(r.last_failure_at)} />
                    <div className="col-span-2">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Routes Retrieved</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="font-mono tabular-nums font-medium">{r.routes_count}</span>
                        <span className="text-muted-foreground">from Artamedia prefixes</span>
                      </div>
                    </div>
                    {r.last_error && (
                      <div className="col-span-2 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-1.5 p-2 rounded border border-rose-500/30 bg-rose-500/10">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span className="break-all">{r.last_error}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    {canWrite && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => testConn(r)} disabled={testingId === r.id} data-testid={`${MOD}-test-${r.id}`}>
                          <Zap className={cn('w-3.5 h-3.5 mr-1.5', testingId === r.id && 'animate-pulse')} /> Test Connection
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => syncNow(r)} disabled={syncingId === r.id} data-testid={`${MOD}-sync-${r.id}`}>
                          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', syncingId === r.id && 'animate-spin')} /> Sync Routes Now
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Form Sheet */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit Router' : 'Tambah Router'}</SheetTitle>
            <SheetDescription>Kredensial dienkripsi dengan AES/Fernet. Gunakan MikroTik API user dengan akses read-only.</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <F label="Router Name *" full><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="mis. Core Router JKT-01" /></F>
            <F label="Host / IP Address *"><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="mis. 192.168.88.1" /></F>
            <F label="API Port *"><Input type="number" value={form.api_port} onChange={(e) => setForm({ ...form, api_port: e.target.value })} placeholder="8728" /></F>
            <F label="Username *"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="api-readonly" autoComplete="off" /></F>
            <F label={`Password ${editing ? '(kosongkan jika tidak berubah)' : '*'}`}><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></F>
            <F label="Routing Table"><Input value={form.routing_table} onChange={(e) => setForm({ ...form, routing_table: e.target.value })} placeholder="main" /></F>
            <F label="Auto Sync">
              <Select value={form.auto_sync} onValueChange={(v) => setForm({ ...form, auto_sync: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AUTO_SYNC_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </F>
            <F label="Status">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </F>
            <div className="col-span-2 flex items-center justify-between p-3 rounded-md border border-border bg-muted/30">
              <div>
                <div className="text-sm font-medium">API-SSL Enabled (TLS)</div>
                <div className="text-xs text-muted-foreground">Aktifkan bila router menggunakan API-SSL (port 8729). Default API plain-text di port 8728.</div>
              </div>
              <Switch checked={form.ssl_enabled} onCheckedChange={(v) => setForm({ ...form, ssl_enabled: v })} />
            </div>
            <div className="col-span-2 flex items-center justify-between p-3 rounded-md border border-border bg-muted/30">
              <div>
                <div className="text-sm font-medium">Verify SSL Certificate</div>
                <div className="text-xs text-muted-foreground">Nonaktifkan bila router menggunakan self-signed cert</div>
              </div>
              <Switch checked={form.verify_ssl} onCheckedChange={(v) => setForm({ ...form, verify_ssl: v })} />
            </div>
            <F label="Description" full><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></F>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={`${MOD}-save-button`}>{saving ? 'Menyimpan…' : 'Save Configuration'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus router ini?</AlertDialogTitle><AlertDialogDescription>Semua route terkait akan dihapus dari IPAM. Reservasi manual tetap tersimpan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function F({ label, children, full }) {
  return (
    <div className={cn('space-y-1.5', full && 'col-span-2')}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function I({ k, v }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className="text-xs mt-0.5 truncate">{v}</div>
    </div>
  );
}
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
