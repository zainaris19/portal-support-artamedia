import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Server, Plus, Plug, Trash2, Pencil, CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react';
import api, { formatApiError } from '@/lib/api';

const EMPTY = {
  name: '', location_id: '', vendor: '', model: '', host: '', protocol: 'telnet',
  port: 23, username: '', password: '', enable_password: '', timeout: 15,
  poll_interval: 300, enabled: true,
};

const EMPTY_PROFILE = {
  name: '', vendor: 'ZTE', model: 'C320', description: '',
  onu_type: '', vlan: '', tcont_profile: '', service_profile: '', command_template: '',
};

export default function OLTSettings() {
  const [items, setItems] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [delId, setDelId] = useState(null);

  // provisioning state
  const [provEnabled, setProvEnabled] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [profOpen, setProfOpen] = useState(false);
  const [profEditing, setProfEditing] = useState(null);
  const [profForm, setProfForm] = useState(EMPTY_PROFILE);
  const [profDelId, setProfDelId] = useState(null);

  const loadProv = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.get('/olt/provision/settings'), api.get('/olt/provision/profiles')]);
      setProvEnabled(!!s.data.enabled);
      setProfiles(p.data.items || []);
    } catch (e) { /* silent */ }
  }, []);
  useEffect(() => { loadProv(); }, [loadProv]);

  const toggleProv = async (v) => {
    setProvEnabled(v);
    try { await api.put('/olt/provision/settings', { enabled: v }); toast.success(v ? 'Provisioning diaktifkan' : 'Provisioning dinonaktifkan'); }
    catch (e) { setProvEnabled(!v); toast.error(formatApiError(e)); }
  };
  const openAddProf = () => { setProfEditing(null); setProfForm(EMPTY_PROFILE); setProfOpen(true); };
  const openEditProf = (p) => { setProfEditing(p); setProfForm({ ...EMPTY_PROFILE, ...p }); setProfOpen(true); };
  const saveProf = async () => {
    if (!profForm.name) return toast.error('Nama profile wajib diisi');
    try {
      if (profEditing) await api.put(`/olt/provision/profiles/${profEditing.id}`, profForm);
      else await api.post('/olt/provision/profiles', profForm);
      toast.success(profEditing ? 'Profile diperbarui' : 'Profile ditambahkan');
      setProfOpen(false); loadProv();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const doDelProf = async () => {
    try { await api.delete(`/olt/provision/profiles/${profDelId}`); toast.success('Profile dihapus'); setProfDelId(null); loadProv(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([api.get('/olt'), api.get('/olt/catalog')]);
      setItems(a.data.items || []);
      setCatalog(b.data.vendors || []);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const models = useMemo(() => {
    const v = catalog.find((c) => c.vendor === form.vendor);
    return v ? v.models : [];
  }, [catalog, form.vendor]);

  const openAdd = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (it) => {
    setEditing(it);
    setForm({ ...EMPTY, ...it, password: '', enable_password: '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.vendor || !form.model || !form.host) return toast.error('Nama, Vendor, Model, Host wajib diisi');
    setSaving(true);
    try {
      const payload = { ...form, port: Number(form.port), timeout: Number(form.timeout), poll_interval: Number(form.poll_interval) };
      if (editing) await api.put(`/olt/${editing.id}`, payload);
      else await api.post('/olt', payload);
      toast.success(editing ? 'OLT diperbarui' : 'OLT ditambahkan');
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  const testConn = async (id) => {
    setTestingId(id);
    try {
      const { data } = await api.post(`/olt/${id}/test-connection`);
      if (data.ok) toast.success(`${data.message || 'Terhubung'}${data.software_version ? ' · ' + data.software_version : ''}`);
      else toast.error(data.message || 'Gagal terhubung');
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setTestingId(null); }
  };

  const doDelete = async () => {
    try { await api.delete(`/olt/${delId}`); toast.success('OLT dihapus'); setDelId(null); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const modelImplemented = (m) => m && m.implemented;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Master Settings' }, { label: 'Integrations' }, { label: 'OLT' }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30"><Server className="w-4 h-4 text-sky-300" /></span>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>OLT Integrations</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Kelola credential & daftar OLT. Credential disimpan terenkripsi dan tidak pernah dikirim balik ke browser.</p>
        </div>
        <Button onClick={openAdd} data-testid="olt-add"><Plus className="w-4 h-4 mr-1.5" /> Add OLT</Button>
      </div>

      <Card className="border-border">
        <CardContent className="p-3">
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {['Name', 'Vendor', 'Model', 'Host', 'Protocol', 'Poll', 'Adapter', 'Enabled', 'Actions'].map((h) => (
                    <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (<TableRow><TableCell colSpan={9} className="text-center py-8 text-sm text-muted-foreground">Memuat…</TableCell></TableRow>)}
                {!loading && items.length === 0 && (<TableRow><TableCell colSpan={9} className="text-center py-10 text-sm text-muted-foreground">Belum ada OLT. Klik “Add OLT”.</TableCell></TableRow>)}
                {!loading && items.map((it) => (
                  <TableRow key={it.id} data-testid={`olt-row-${it.id}`}>
                    <TableCell className="text-sm font-medium">{it.name}</TableCell>
                    <TableCell className="text-xs">{it.vendor}</TableCell>
                    <TableCell className="text-xs">{it.model}</TableCell>
                    <TableCell className="text-xs font-mono">{it.host}:{it.port}</TableCell>
                    <TableCell className="text-xs uppercase">{it.protocol}</TableCell>
                    <TableCell className="text-xs tabular-nums">{it.poll_interval}s</TableCell>
                    <TableCell>{it.implemented ? <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">Ready</Badge> : <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">Coming Soon</Badge>}</TableCell>
                    <TableCell><span className={`text-xs ${it.enabled ? 'text-emerald-400' : 'text-muted-foreground'}`}>{it.enabled ? 'Yes' : 'No'}</span></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-8" disabled={!it.implemented || testingId === it.id} onClick={() => testConn(it.id)} data-testid={`olt-test-${it.id}`}>
                          {testingId === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
                          <span className="ml-1">Test</span>
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => openEdit(it)} data-testid={`olt-edit-${it.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 text-rose-400" onClick={() => setDelId(it.id)} data-testid={`olt-del-${it.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Provisioning */}
      <Card className="border-border" data-testid="olt-provision-card">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30"><Zap className="w-4 h-4 text-amber-300" /></span>
              <div>
                <div className="text-lg font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Provisioning</div>
                <p className="text-xs text-muted-foreground">Aktifkan write-command (authorize, reboot, rename, delete ONU) di OLT Management.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 border border-border rounded-md px-3 py-2">
              <span className={`text-sm font-medium ${provEnabled ? 'text-emerald-400' : 'text-muted-foreground'}`}>{provEnabled ? 'Aktif' : 'Nonaktif'}</span>
              <Switch checked={provEnabled} onCheckedChange={toggleProv} data-testid="olt-prov-toggle" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Provisioning Profiles <span className="text-muted-foreground font-normal">({profiles.length})</span></div>
            <Button size="sm" variant="outline" onClick={openAddProf} data-testid="olt-prof-add"><Plus className="w-4 h-4 mr-1.5" /> Add Profile</Button>
          </div>
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">{['Name', 'ONU Type', 'VLAN', 'TCONT', 'Template', 'Actions'].map((h) => <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {profiles.length === 0 && (<TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Belum ada profile. Profile mempercepat authorize ONU.</TableCell></TableRow>)}
                {profiles.map((p) => (
                  <TableRow key={p.id} data-testid={`olt-prof-row-${p.id}`}>
                    <TableCell className="text-sm font-medium">{p.name}</TableCell>
                    <TableCell className="text-xs">{p.onu_type || '—'}</TableCell>
                    <TableCell className="text-xs tabular-nums">{p.vlan || '—'}</TableCell>
                    <TableCell className="text-xs">{p.tcont_profile || '—'}</TableCell>
                    <TableCell className="text-xs">{p.command_template ? <Badge variant="outline" className="text-[10px]">Custom CLI</Badge> : <span className="text-muted-foreground">builtin</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => openEditProf(p)} data-testid={`olt-prof-edit-${p.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 text-rose-400" onClick={() => setProfDelId(p.id)} data-testid={`olt-prof-del-${p.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={profOpen} onOpenChange={setProfOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="olt-prof-form">
          <SheetHeader>
            <SheetTitle>{profEditing ? 'Edit Provisioning Profile' : 'Add Provisioning Profile'}</SheetTitle>
            <SheetDescription>Template dipakai saat Authorize ONU. Placeholder yang tersedia: <code className="text-[11px]">{'{pon} {onuid} {sn} {name} {vlan} {onu_type} {tcont_profile} {service_profile}'}</code></SheetDescription>
          </SheetHeader>
          <div className="space-y-3 mt-4">
            <Field label="Profile Name"><Input value={profForm.name} onChange={(e) => setProfForm({ ...profForm, name: e.target.value })} placeholder="Broadband 20M" data-testid="olt-prof-name" /></Field>
            <Field label="Description"><Input value={profForm.description || ''} onChange={(e) => setProfForm({ ...profForm, description: e.target.value })} data-testid="olt-prof-desc" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ONU Type"><Input value={profForm.onu_type || ''} onChange={(e) => setProfForm({ ...profForm, onu_type: e.target.value })} placeholder="ZTE-F660" data-testid="olt-prof-type" /></Field>
              <Field label="VLAN"><Input value={profForm.vlan || ''} onChange={(e) => setProfForm({ ...profForm, vlan: e.target.value })} placeholder="100" data-testid="olt-prof-vlan" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="TCONT Profile"><Input value={profForm.tcont_profile || ''} onChange={(e) => setProfForm({ ...profForm, tcont_profile: e.target.value })} placeholder="UP-20M" data-testid="olt-prof-tcont" /></Field>
              <Field label="Service Profile"><Input value={profForm.service_profile || ''} onChange={(e) => setProfForm({ ...profForm, service_profile: e.target.value })} data-testid="olt-prof-srv" /></Field>
            </div>
            <Field label="Custom CLI Template (opsional)">
              <Textarea rows={7} className="font-mono text-xs" value={profForm.command_template || ''} onChange={(e) => setProfForm({ ...profForm, command_template: e.target.value })}
                placeholder={'configure terminal\ninterface gpon-olt_{pon}\nonu {onuid} type {onu_type} sn {sn}\nexit\ninterface gpon-onu_{pon}:{onuid}\nname {name}\nservice-port 1 vport 1 user-vlan {vlan} vlan {vlan}\nexit\nend'}
                data-testid="olt-prof-template" />
            </Field>
            <p className="text-[11px] text-muted-foreground">Kosongkan template untuk memakai sequence builtin ZTE C320 dari field di atas.</p>
          </div>
          <SheetFooter className="mt-4">
            <Button variant="outline" onClick={() => setProfOpen(false)}>Batal</Button>
            <Button onClick={saveProf} data-testid="olt-prof-save">Simpan</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!profDelId} onOpenChange={(o) => !o && setProfDelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Profile?</AlertDialogTitle>
            <AlertDialogDescription>Profile provisioning ini akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doDelProf} data-testid="olt-prof-del-confirm">Ya, Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="olt-form">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit OLT' : 'Add OLT'}</SheetTitle>
            <SheetDescription>Credential dienkripsi di server. Kosongkan password saat edit bila tidak ingin mengubah.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 mt-4">
            <Field label="OLT Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="AMI-OLT-ZTEC320" data-testid="olt-f-name" /></Field>
            <Field label="Location / POP (Site ID)"><Input value={form.location_id || ''} onChange={(e) => setForm({ ...form, location_id: e.target.value })} placeholder="site id / nama POP" data-testid="olt-f-loc" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor">
                <Select value={form.vendor} onValueChange={(v) => setForm({ ...form, vendor: v, model: '' })}>
                  <SelectTrigger data-testid="olt-f-vendor"><SelectValue placeholder="Pilih vendor" /></SelectTrigger>
                  <SelectContent>{catalog.map((c) => <SelectItem key={c.vendor} value={c.vendor}>{c.vendor}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Model">
                <Select value={form.model} onValueChange={(v) => { const m = models.find((x) => x.model === v); setForm({ ...form, model: v, protocol: (m?.protocols?.[0]) || form.protocol, port: (m?.protocols?.[0] === 'ssh' ? 22 : 23) }); }}>
                  <SelectTrigger data-testid="olt-f-model"><SelectValue placeholder="Pilih model" /></SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.model} value={m.model} disabled={!modelImplemented(m)}>
                        {m.model}{!modelImplemented(m) ? ' — Coming Soon' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Management IP / Host"><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="10.0.0.1" data-testid="olt-f-host" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Protocol">
                <Select value={form.protocol} onValueChange={(v) => setForm({ ...form, protocol: v, port: v === 'ssh' ? 22 : 23 })}>
                  <SelectTrigger data-testid="olt-f-proto"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="telnet">Telnet</SelectItem><SelectItem value="ssh">SSH</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Port"><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} data-testid="olt-f-port" /></Field>
            </div>
            <Field label="Username"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="olt-f-user" /></Field>
            <Field label={editing ? 'Password (kosongkan = tetap)' : 'Password'}><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="olt-f-pass" /></Field>
            <Field label="Enable Password (opsional)"><Input type="password" value={form.enable_password} onChange={(e) => setForm({ ...form, enable_password: e.target.value })} data-testid="olt-f-enable" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Connection Timeout (s)"><Input type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: e.target.value })} data-testid="olt-f-timeout" /></Field>
              <Field label="Poll Interval (s)"><Input type="number" value={form.poll_interval} onChange={(e) => setForm({ ...form, poll_interval: e.target.value })} data-testid="olt-f-poll" /></Field>
            </div>
            <div className="flex items-center justify-between border border-border rounded-md px-3 py-2">
              <div><div className="text-sm font-medium">Enabled</div><div className="text-xs text-muted-foreground">Aktif untuk background polling</div></div>
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} data-testid="olt-f-enabled" />
            </div>
          </div>
          <SheetFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={save} disabled={saving} data-testid="olt-save">{saving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!delId} onOpenChange={(o) => !o && setDelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus OLT?</AlertDialogTitle>
            <AlertDialogDescription>Data credential & cache polling OLT ini akan dihapus. Tindakan tidak bisa dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doDelete} data-testid="olt-del-confirm">Ya, Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }) {
  return (<div><Label className="text-xs">{label}</Label><div className="mt-1">{children}</div></div>);
}
