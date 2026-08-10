import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Zap, Eye, Power, Trash2, Pencil, Terminal, Loader2, ShieldAlert } from 'lucide-react';
import api, { formatApiError } from '@/lib/api';

// Shared hook: provisioning feature flag + reusable profiles
export function useProvisioning(oltId) {
  const [enabled, setEnabled] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const reload = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        api.get('/olt/provision/settings'),
        api.get('/olt/provision/profiles'),
      ]);
      setEnabled(!!s.data.enabled);
      setProfiles(p.data.items || []);
    } catch (_) { /* silent */ }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { enabled, profiles, reload };
}

function CommandPreview({ result }) {
  if (!result) return null;
  const ok = result.ok;
  return (
    <div className="mt-3 space-y-2" data-testid="prov-result">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline" className={ok ? 'border-emerald-500/40 text-emerald-300' : 'border-rose-500/40 text-rose-300'}>
          {result.dry_run ? 'PREVIEW' : ok ? 'SUCCESS' : 'FAILED'}
        </Badge>
        {result.error && <span className="text-rose-400 truncate" title={result.error}>{result.error}</span>}
      </div>
      {!!(result.commands || []).length && (
        <pre className="text-[11px] font-mono bg-black/40 border border-border rounded-md p-2 overflow-x-auto whitespace-pre-wrap" data-testid="prov-commands">{result.commands.join('\n')}</pre>
      )}
      {result.output && (
        <pre className="text-[11px] font-mono bg-black/40 border border-border rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-52">{result.output}</pre>
      )}
    </div>
  );
}

// Authorize / register an unconfigured ONU
export function AuthorizeSheet({ oltId, open, onClose, prefill, profiles, onDone }) {
  const EMPTY = { profile_id: '', pon: '', onu_id: '', sn: '', name: '', onu_type: '', vlan: '', tcont_profile: '', service_profile: '', command_template: '', customer_name: '' };
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setForm({ ...EMPTY, pon: prefill?.pon || '', sn: prefill?.serial_number || '' });
    }
  }, [open]); // eslint-disable-line

  const applyProfile = (pid) => {
    const p = profiles.find((x) => x.id === pid);
    setForm((f) => ({
      ...f, profile_id: pid,
      onu_type: p?.onu_type || f.onu_type, vlan: p?.vlan || f.vlan,
      tcont_profile: p?.tcont_profile || f.tcont_profile,
      service_profile: p?.service_profile || f.service_profile,
      command_template: p?.command_template || f.command_template,
    }));
  };

  const run = async (dry) => {
    if (!form.pon || !form.onu_id || !form.sn) return toast.error('PON, ONU ID, dan Serial Number wajib diisi');
    setBusy(true);
    try {
      const payload = { ...form, dry_run: dry, profile_id: form.profile_id || null };
      const { data } = await api.post(`/olt/${oltId}/provision/authorize`, payload);
      setResult(data);
      if (dry) toast.message('Preview perintah CLI dibuat');
      else if (data.ok) { toast.success('ONU berhasil di-provision'); onDone?.(); }
      else toast.error(data.error || 'Provisioning gagal');
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="olt-authorize-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-300" /> Authorize / Provision ONU</SheetTitle>
          <SheetDescription>Daftarkan ONU unconfigured ke OLT. Gunakan <b>Preview</b> untuk melihat perintah CLI sebelum dijalankan ke perangkat.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 mt-4">
          <div><Label className="text-xs">Provisioning Profile</Label>
            <Select value={form.profile_id} onValueChange={applyProfile}>
              <SelectTrigger className="mt-1" data-testid="authz-profile"><SelectValue placeholder={profiles.length ? 'Pilih profile (opsional)' : 'Belum ada profile'} /></SelectTrigger>
              <SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="PON *"><Input value={form.pon} onChange={(e) => setForm({ ...form, pon: e.target.value })} placeholder="1/1/1" data-testid="authz-pon" /></F>
            <F label="ONU ID *"><Input value={form.onu_id} onChange={(e) => setForm({ ...form, onu_id: e.target.value })} placeholder="5" data-testid="authz-onuid" /></F>
          </div>
          <F label="Serial Number *"><Input value={form.sn} onChange={(e) => setForm({ ...form, sn: e.target.value })} placeholder="ZTEGCxxxxxxx" data-testid="authz-sn" /></F>
          <div className="grid grid-cols-2 gap-3">
            <F label="ONU Type"><Input value={form.onu_type} onChange={(e) => setForm({ ...form, onu_type: e.target.value })} placeholder="ZTE-F660" data-testid="authz-type" /></F>
            <F label="VLAN"><Input value={form.vlan} onChange={(e) => setForm({ ...form, vlan: e.target.value })} placeholder="100" data-testid="authz-vlan" /></F>
          </div>
          <F label="Name / Description"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="nama pelanggan / service" data-testid="authz-name" /></F>
          <div className="grid grid-cols-2 gap-3">
            <F label="TCONT Profile"><Input value={form.tcont_profile} onChange={(e) => setForm({ ...form, tcont_profile: e.target.value })} placeholder="UP-20M" data-testid="authz-tcont" /></F>
            <F label="Service Profile"><Input value={form.service_profile} onChange={(e) => setForm({ ...form, service_profile: e.target.value })} data-testid="authz-srv" /></F>
          </div>
          <F label="Customer Mapping (opsional)"><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="nama customer untuk auto-map" data-testid="authz-cust" /></F>
          <CommandPreview result={result} />
        </div>
        <SheetFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={() => run(true)} disabled={busy} data-testid="authz-preview"><Eye className="w-4 h-4 mr-1.5" /> Preview</Button>
          <Button onClick={() => run(false)} disabled={busy} className="bg-amber-600 hover:bg-amber-700" data-testid="authz-run">
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Zap className="w-4 h-4 mr-1.5" />} Provision
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Reboot / Rename / Delete actions for an existing ONU (shown in ONU detail drawer)
export function ProvisionActionsBar({ oltId, onuIndex, currentName, canWrite, canDelete, onDone }) {
  const [name, setName] = useState(currentName || '');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null); // 'reboot' | 'delete'
  const [result, setResult] = useState(null);
  useEffect(() => { setName(currentName || ''); }, [currentName]);

  const doRename = async () => {
    if (!name.trim()) return toast.error('Nama tidak boleh kosong');
    setBusy('rename');
    try {
      const { data } = await api.post(`/olt/${oltId}/onu/${encodeURIComponent(onuIndex)}/rename`, { name });
      setResult(data);
      if (data.ok) { toast.success('Nama ONU diperbarui'); onDone?.(); } else toast.error(data.error || 'Gagal rename');
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(''); }
  };
  const doReboot = async () => {
    setBusy('reboot'); setConfirm(null);
    try {
      const { data } = await api.post(`/olt/${oltId}/onu/${encodeURIComponent(onuIndex)}/reboot`);
      setResult(data);
      if (data.ok) toast.success('Perintah reboot dikirim'); else toast.error(data.error || 'Gagal reboot');
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(''); }
  };
  const doDelete = async () => {
    setBusy('delete'); setConfirm(null);
    try {
      const { data } = await api.delete(`/olt/${oltId}/onu/${encodeURIComponent(onuIndex)}/provision`);
      setResult(data);
      if (data.ok) { toast.success('ONU dihapus dari OLT'); onDone?.(); } else toast.error(data.error || 'Gagal hapus');
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(''); }
  };

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" data-testid="olt-onu-provision">
      <div className="flex items-center gap-2 mb-2"><Terminal className="w-4 h-4 text-amber-300" /><div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>Provisioning</div><Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">WRITE</Badge></div>
      {canWrite ? (
        <>
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label className="text-xs">Rename ONU</Label>
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="nama baru" data-testid="prov-rename-input" /></div>
            <Button size="sm" variant="outline" onClick={doRename} disabled={busy === 'rename'} data-testid="prov-rename-btn"><Pencil className="w-3.5 h-3.5 mr-1" /> Simpan</Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Button size="sm" variant="outline" className="border-sky-500/40 text-sky-300" onClick={() => setConfirm('reboot')} disabled={busy === 'reboot'} data-testid="prov-reboot-btn"><Power className="w-3.5 h-3.5 mr-1" /> Reboot ONU</Button>
            {canDelete && <Button size="sm" variant="outline" className="border-rose-500/40 text-rose-300" onClick={() => setConfirm('delete')} disabled={busy === 'delete'} data-testid="prov-delete-btn"><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete ONU</Button>}
          </div>
          <CommandPreview result={result} />
        </>
      ) : (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Anda tidak memiliki izin provisioning.</div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'delete' ? 'Hapus ONU dari OLT?' : 'Reboot ONU?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'delete'
                ? `Perintah delete ONU akan dieksekusi untuk ${onuIndex}. Layanan pelanggan akan terputus. Lanjutkan?`
                : `ONU ${onuIndex} akan direboot. Koneksi pelanggan terputus sesaat. Lanjutkan?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className={confirm === 'delete' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-sky-600 hover:bg-sky-700'}
              onClick={confirm === 'delete' ? doDelete : doReboot} data-testid="prov-confirm">
              {confirm === 'delete' ? 'Ya, Hapus' : 'Ya, Reboot'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function F({ label, children }) {
  return (<div><Label className="text-xs">{label}</Label><div className="mt-1">{children}</div></div>);
}
