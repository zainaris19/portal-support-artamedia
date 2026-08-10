import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'supervisor', label: 'Supervisor NOC' },
  { value: 'engineer', label: 'NOC Engineer' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'admin_router', label: 'Admin Router' },
  { value: 'operational', label: 'Operational' },
  { value: 'teknisi', label: 'Teknisi Lapangan' },
];
const MOD = 'users';

export default function Users() {
  const { user: current } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'viewer', active: true });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/users');
      setItems(data);
    } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ email: '', password: '', name: '', role: 'viewer', active: true }); setErrors({}); setOpenForm(true); };
  const openEdit = (row) => { setEditing(row); setForm({ email: row.email, password: '', name: row.name, role: row.role, active: row.active !== false }); setErrors({}); setOpenForm(true); };

  const validate = () => {
    const e = {};
    if (!editing) {
      if (!form.email) e.email = 'Email wajib';
      if (!form.password) e.password = 'Password wajib';
    }
    if (!form.name) e.name = 'Nama wajib';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        const payload = { name: form.name, role: form.role, active: form.active };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${editing.id}`, payload);
        toast.success('User diperbarui');
      } else {
        await api.post('/users', { email: form.email, password: form.password, name: form.name, role: form.role });
        toast.success('User ditambahkan');
      }
      setOpenForm(false); load();
    } catch (err) { toast.error(formatApiError(err)); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    try { await api.delete(`/users/${deleteId}`); toast.success('User dihapus'); setDeleteId(null); load(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>User & Hak Akses</h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola akun pengguna dan role-based access control.</p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid={CRUD.addBtn(MOD)}><Plus className="w-4 h-4 mr-1.5" /> Tambah User</Button>
      </div>

      <Card className="border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table data-testid={CRUD.table(MOD)}>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Nama</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Role</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Dibuat</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)}
                {!loading && items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">Belum ada user.</TableCell></TableRow>}
                {!loading && items.map((u) => (
                  <TableRow key={u.id} data-testid={CRUD.row(MOD, u.id)} className="hover:bg-accent/40">
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="font-mono text-xs">{u.email}</TableCell>
                    <TableCell><span className="text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{ROLES.find(r => r.value === u.role)?.label || u.role}</span></TableCell>
                    <TableCell>
                      <span className={cn('text-xs px-2 py-0.5 rounded-md border',
                        u.active === false ? 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30' : 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
                      )}>{u.active === false ? 'Nonaktif' : 'Aktif'}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(u)} data-testid={CRUD.editBtn(MOD, u.id)}><Pencil className="w-4 h-4" /></Button>
                        {u.id !== current?.id && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={() => setDeleteId(u.id)} data-testid={CRUD.deleteBtn(MOD, u.id)}><Trash2 className="w-4 h-4" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit User' : 'Tambah User'}</DialogTitle>
            <DialogDescription>Kelola akun & role pengguna sistem.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nama</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {errors.name && <div className="text-xs text-rose-600 dark:text-rose-400">{errors.name}</div>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
              <Input type="email" disabled={!!editing} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              {errors.email && <div className="text-xs text-rose-600 dark:text-rose-400">{errors.email}</div>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Password {editing && '(kosongkan jika tidak diubah)'}
              </Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              {errors.password && <div className="text-xs text-rose-600 dark:text-rose-400">{errors.password}</div>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {editing && (
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <div className="text-sm font-medium">Status Aktif</div>
                  <div className="text-xs text-muted-foreground">Nonaktifkan untuk mencabut akses login</div>
                </div>
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)} data-testid={CRUD.cancelBtn(MOD)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid={CRUD.saveBtn(MOD)}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus user ini?</AlertDialogTitle><AlertDialogDescription>User akan kehilangan akses ke sistem.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid={CRUD.confirmDelete(MOD)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
