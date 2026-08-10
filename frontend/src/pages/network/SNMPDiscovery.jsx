import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Search, Wifi, Zap, PlugZap, Cpu, MemoryStick, Thermometer, PowerOff, PlayCircle, Settings2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import Breadcrumb from '@/components/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

const VERSIONS = ['v1', 'v2c', 'v3'];
const AUTH_PROTOS = ['noAuth', 'MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512'];
const PRIV_PROTOS = ['noPriv', 'DES', 'AES', 'AES192', 'AES256'];

const EMPTY = {
  host: '', port: 161, version: 'v2c',
  community: '', v3_username: '', v3_auth_protocol: 'SHA', v3_auth_password: '',
  v3_priv_protocol: 'AES', v3_priv_password: '',
  poll_interval_minutes: 5, enabled: true, timeout_seconds: 5,
};

export default function SNMPDiscovery() {
  const { canWrite } = useAuth();
  const [devices, setDevices] = useState([]);
  const [configs, setConfigs] = useState({}); // device_id -> config
  const [telemetry, setTelemetry] = useState({}); // device_id -> latest telemetry summary
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [globalStatus, setGlobalStatus] = useState(null);

  const [openForm, setOpenForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [devs, status] = await Promise.all([
        api.get('/devices', { params: { page_size: 500 } }),
        api.get('/snmp/status'),
      ]);
      const items = devs.data.items || [];
      setDevices(items);
      setGlobalStatus(status.data);
      // Fetch configs + telemetry per device in parallel (bounded)
      const cfgs = {};
      const tel = {};
      await Promise.all(items.map(async (d) => {
        try {
          const [c, t] = await Promise.all([
            api.get(`/snmp/devices/${d.id}/config`),
            api.get(`/snmp/devices/${d.id}/telemetry`),
          ]);
          cfgs[d.id] = c.data;
          tel[d.id] = t.data;
        } catch { /* ignore */ }
      }));
      setConfigs(cfgs);
      setTelemetry(tel);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => devices.filter((d) => {
    if (!q) return true;
    const s = `${d.name} ${d.hostname} ${d.brand} ${d.model} ${configs[d.id]?.host || ''}`.toLowerCase();
    return s.includes(q.toLowerCase());
  }), [devices, configs, q]);

  const openConfig = (device) => {
    setEditingDevice(device);
    const existing = configs[device.id];
    setForm({
      ...EMPTY,
      host: existing?.host || device.ip_management?.split('/')[0] || '',
      port: existing?.port || 161,
      version: existing?.version || 'v2c',
      poll_interval_minutes: existing?.poll_interval_minutes || 5,
      enabled: existing?.enabled ?? true,
      timeout_seconds: existing?.timeout_seconds || 5,
      v3_username: existing?.v3_username || '',
      v3_auth_protocol: existing?.v3_auth_protocol || 'SHA',
      v3_priv_protocol: existing?.v3_priv_protocol || 'AES',
      // secrets are never returned by the API; leave blank so we don't wipe them
      community: '',
      v3_auth_password: '',
      v3_priv_password: '',
    });
    setOpenForm(true);
  };

  const save = async () => {
    if (!editingDevice) return;
    setSaving(true);
    try {
      const payload = { ...form };
      // Never send empty strings for optional secrets
      if (!payload.community) delete payload.community;
      if (!payload.v3_auth_password) delete payload.v3_auth_password;
      if (!payload.v3_priv_password) delete payload.v3_priv_password;
      await api.put(`/snmp/devices/${editingDevice.id}/config`, payload);
      toast.success('SNMP config disimpan');
      setOpenForm(false);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  const triggerSync = async (device) => {
    toast.info(`Sync SNMP ${device.name}…`);
    try {
      const { data } = await api.post(`/snmp/devices/${device.id}/sync`);
      if (data.ok) toast.success(`${device.name}: sync sukses (${data.telemetry?.interfaces?.length || 0} interfaces)`);
      else toast.warning(`${device.name}: ${data.telemetry?.last_error || 'sync gagal'}`);
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const removeConfig = async (device) => {
    if (!window.confirm(`Hapus SNMP config untuk ${device.name}?`)) return;
    try {
      await api.delete(`/snmp/devices/${device.id}/config`);
      toast.success('SNMP config dihapus');
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'SNMP Discovery' }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>SNMP Device Discovery</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            SNMP hanya mensinkronkan <span className="font-semibold text-foreground">informasi dinamis</span> (hostname, firmware, interfaces, port status, traffic, CPU, memory, temperature, PSU). Data infrastruktur manual tetap sebagai <span className="font-semibold text-foreground">source of truth</span>. Jika SNMP tidak tersedia atau device tidak dapat dihubungi, tampilan Rack Explorer tetap menggunakan data manual.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {globalStatus && (
            <div className="inline-flex items-center gap-3 rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs" data-testid="snmp-global-status">
              <span className={cn('flex items-center gap-1.5', globalStatus.snmp_available ? 'text-emerald-400' : 'text-rose-400')}>
                <span className={cn('w-2 h-2 rounded-full', globalStatus.snmp_available ? 'bg-emerald-500' : 'bg-rose-500')} />
                {globalStatus.snmp_available ? 'Engine online' : 'Engine offline'}
              </span>
              <span className="text-muted-foreground">Configured: <span className="text-foreground font-semibold">{globalStatus.configured_devices}</span></span>
              <span className="text-muted-foreground">Last OK: <span className="text-foreground font-semibold">{globalStatus.successful_last_syncs}</span></span>
            </div>
          )}
        </div>
      </div>

      <Card className="border-border/70">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Cari device, host, brand…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 h-9" data-testid="snmp-search" />
          </div>

          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Device</TableHead>
                  <TableHead className="text-xs">SNMP Host</TableHead>
                  <TableHead className="text-xs">Version</TableHead>
                  <TableHead className="text-xs">Interval</TableHead>
                  <TableHead className="text-xs">Last Sync</TableHead>
                  <TableHead className="text-xs">Metrics</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>)}
                {!loading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                    <Wifi className="w-6 h-6 mx-auto mb-1 opacity-60" />
                    Tidak ada device yang cocok.
                  </TableCell></TableRow>
                )}
                {!loading && filtered.map((d) => {
                  const cfg = configs[d.id];
                  const tel = telemetry[d.id];
                  const configured = cfg?.has_credentials;
                  const enabled = cfg?.enabled;
                  const okState = tel?.sync_ok;
                  return (
                    <TableRow key={d.id} className="hover:bg-accent/40" data-testid={`snmp-row-${d.id}`}>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            'w-1.5 h-1.5 rounded-full shrink-0',
                            !configured ? 'bg-slate-500' :
                            !enabled ? 'bg-amber-500' :
                            okState === true ? 'bg-emerald-500 animate-pulse' :
                            okState === false ? 'bg-rose-500' : 'bg-slate-500',
                          )} />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{d.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate font-mono">{d.brand} {d.model}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{cfg?.host || <span className="text-muted-foreground italic">not configured</span>}</TableCell>
                      <TableCell className="text-xs">{cfg?.version || '—'}</TableCell>
                      <TableCell className="text-xs">{cfg?.poll_interval_minutes ? `${cfg.poll_interval_minutes}m` : '—'}</TableCell>
                      <TableCell className="text-xs">
                        {cfg?.last_sync_at ? (
                          <div>
                            <div className={cn('font-mono', cfg.last_sync_ok ? 'text-emerald-400' : 'text-rose-400')}>
                              {cfg.last_sync_ok ? 'OK' : 'FAIL'}
                            </div>
                            <div className="text-[10px] text-muted-foreground">{fmtRel(cfg.last_sync_at)}</div>
                          </div>
                        ) : <span className="text-muted-foreground italic">never</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {tel?.sync_ok ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <Metric icon={PlugZap} label={`${tel.interfaces?.length || 0} if`} />
                            {tel.cpu_percent != null && <Metric icon={Cpu} label={`${Math.round(tel.cpu_percent)}%`} tone={tel.cpu_percent > 80 ? 'warn' : 'ok'} />}
                            {tel.memory_percent != null && <Metric icon={MemoryStick} label={`${Math.round(tel.memory_percent)}%`} tone={tel.memory_percent > 85 ? 'warn' : 'ok'} />}
                            {tel.temperature_c != null && <Metric icon={Thermometer} label={`${tel.temperature_c}°C`} tone={tel.temperature_c > 65 ? 'warn' : 'ok'} />}
                          </div>
                        ) : cfg?.last_error ? (
                          <span className="text-[10px] font-mono text-rose-400 truncate max-w-[240px] block" title={cfg.last_error}>{cfg.last_error}</span>
                        ) : <span className="text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          {configured && (
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => triggerSync(d)} title="Sync now" data-testid={`snmp-sync-${d.id}`}>
                              <PlayCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canWrite && (
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openConfig(d)} data-testid={`snmp-config-${d.id}`}>
                              <Settings2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {configured && canWrite && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-rose-500 hover:text-rose-400" onClick={() => removeConfig(d)}>
                              <PowerOff className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Config form */}
      <Sheet open={openForm} onOpenChange={setOpenForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>SNMP · {editingDevice?.name}</SheetTitle>
            <SheetDescription>Konfigurasi endpoint SNMP untuk sinkronisasi telemetri live. Password dienkripsi dengan Fernet.</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <Field label="SNMP Host *" full>
              <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="mis. 10.99.0.1" data-testid="snmp-host" />
            </Field>
            <Field label="Port">
              <Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value || 161) })} />
            </Field>
            <Field label="Version">
              <Select value={form.version} onValueChange={(v) => setForm({ ...form, version: v })}>
                <SelectTrigger data-testid="snmp-version"><SelectValue /></SelectTrigger>
                <SelectContent>{VERSIONS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {form.version !== 'v3' ? (
              <Field label="Community" full>
                <Input type="password" placeholder="kosongkan untuk pertahankan yang lama" value={form.community} onChange={(e) => setForm({ ...form, community: e.target.value })} data-testid="snmp-community" />
              </Field>
            ) : (
              <>
                <Field label="v3 Username" full>
                  <Input value={form.v3_username} onChange={(e) => setForm({ ...form, v3_username: e.target.value })} />
                </Field>
                <Field label="Auth Protocol">
                  <Select value={form.v3_auth_protocol} onValueChange={(v) => setForm({ ...form, v3_auth_protocol: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{AUTH_PROTOS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Auth Password">
                  <Input type="password" placeholder="kosongkan untuk pertahankan" value={form.v3_auth_password} onChange={(e) => setForm({ ...form, v3_auth_password: e.target.value })} />
                </Field>
                <Field label="Priv Protocol">
                  <Select value={form.v3_priv_protocol} onValueChange={(v) => setForm({ ...form, v3_priv_protocol: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIV_PROTOS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Priv Password">
                  <Input type="password" placeholder="kosongkan untuk pertahankan" value={form.v3_priv_password} onChange={(e) => setForm({ ...form, v3_priv_password: e.target.value })} />
                </Field>
              </>
            )}
            <Field label="Poll Interval (menit)">
              <Input type="number" value={form.poll_interval_minutes} onChange={(e) => setForm({ ...form, poll_interval_minutes: Number(e.target.value || 0) })} />
              <p className="text-[10px] text-muted-foreground mt-1">0 = hanya manual sync</p>
            </Field>
            <Field label="Timeout (detik)">
              <Input type="number" value={form.timeout_seconds} onChange={(e) => setForm({ ...form, timeout_seconds: Number(e.target.value || 5) })} />
            </Field>
            <Field label="Enabled" full>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} data-testid="snmp-enabled" />
                <span className="text-sm text-muted-foreground">{form.enabled ? 'Auto-polling aktif' : 'Non-aktif (manual sync only)'}</span>
              </div>
            </Field>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Batal</Button>
            <Button onClick={save} disabled={saving || !form.host} data-testid="snmp-save">{saving ? 'Menyimpan…' : 'Simpan SNMP'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Metric({ icon: Icon, label, tone = 'ok' }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border',
      tone === 'warn' ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
    )}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={cn('space-y-1.5', full && 'col-span-2')}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function fmtRel(iso) {
  try {
    const t = new Date(iso).getTime();
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return iso; }
}
