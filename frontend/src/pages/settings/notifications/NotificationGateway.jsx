import React, { useEffect, useState } from 'react';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  BellRing, Save, Plug, Eye, EyeOff, CheckCircle2, XCircle, Send, ShieldCheck, Info, Mail, MessageSquare,
} from 'lucide-react';
import api, { formatApiError } from '@/lib/api';

export default function NotificationGateway() {
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState(null);
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({
    provider: 'fonnte', api_url: 'https://api.fonnte.com', api_token: '',
    sender: '', default_group: '', country_code: '62', enabled: false, public_base_url: '',
    smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_security: 'tls', smtp_username: '',
    smtp_password: '', from_email: '', from_name: 'Artamedia', internal_email: '', subject_prefix: '[Artamedia]',
  });
  const [showToken, setShowToken] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [tsTarget, setTsTarget] = useState('');
  const [tsMsg, setTsMsg] = useState('Tes koneksi Notification Center — PT Artamedia.');
  const [sending, setSending] = useState(false);

  const isEmail = form.provider === 'email';

  const load = async () => {
    setLoading(true);
    try {
      const [{ data }, prov] = await Promise.all([
        api.get('/notifications/settings'),
        api.get('/notifications/providers').catch(() => ({ data: { providers: [] } })),
      ]);
      setCfg(data);
      setProviders(prov.data.providers || []);
      setForm((f) => ({
        ...f,
        provider: data.provider || 'fonnte',
        api_url: data.api_url || 'https://api.fonnte.com',
        sender: data.sender || '',
        default_group: data.default_group || '',
        country_code: data.country_code || '62',
        enabled: !!data.enabled,
        public_base_url: data.public_base_url || '',
        smtp_host: data.smtp_host || 'smtp.gmail.com',
        smtp_port: data.smtp_port || 587,
        smtp_security: data.smtp_security || 'tls',
        smtp_username: data.smtp_username || '',
        from_email: data.from_email || '',
        from_name: data.from_name || 'Artamedia',
        internal_email: data.internal_email || '',
        subject_prefix: data.subject_prefix || '[Artamedia]',
        api_token: '', smtp_password: '',
      }));
    } catch (e) {
      toast.error('Gagal memuat konfigurasi');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        provider: form.provider, api_url: form.api_url, sender: form.sender,
        default_group: form.default_group, country_code: form.country_code,
        enabled: form.enabled, public_base_url: form.public_base_url,
        smtp_host: form.smtp_host, smtp_port: Number(form.smtp_port) || 587,
        smtp_security: form.smtp_security, smtp_username: form.smtp_username,
        from_email: form.from_email, from_name: form.from_name,
        internal_email: form.internal_email, subject_prefix: form.subject_prefix,
      };
      if (form.api_token) payload.api_token = form.api_token;
      if (form.smtp_password) payload.smtp_password = form.smtp_password;
      const { data } = await api.put('/notifications/settings', payload);
      setCfg(data);
      setForm((f) => ({ ...f, api_token: '', smtp_password: '' }));
      toast.success('Konfigurasi Notification Gateway tersimpan');
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data } = await api.post('/notifications/test');
      setTestResult(data);
      if (data.connected) toast.success('Provider terhubung');
      else toast.warning(data.detail || 'Provider belum terhubung');
    } catch (e) {
      setTestResult({ connected: false, detail: formatApiError(e) });
      toast.error(formatApiError(e));
    } finally { setTesting(false); }
  };

  const testSend = async () => {
    if (!tsTarget) { toast.error(isEmail ? 'Isi email tujuan' : 'Isi nomor/grup tujuan'); return; }
    setSending(true);
    try {
      const { data } = await api.post('/notifications/test-send', { target: tsTarget, message: tsMsg });
      if (data.status === 'sent') toast.success('Pesan tes terkirim');
      else toast.warning(`Status: ${data.status}${data.detail ? ' — ' + data.detail : ''}`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setSending(false); }
  };

  if (loading) return <div className="p-6 text-muted-foreground">Memuat…</div>;

  const set = (k, v) => setForm({ ...form, [k]: v });

  return (
    <div className="space-y-6" data-testid="notification-gateway-page">
      <Breadcrumb items={[{ label: 'Settings' }, { label: 'Notification Center' }, { label: 'Notification Gateway' }]} />

      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <BellRing className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold">Notification Gateway</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Pilih penyedia notifikasi (WhatsApp / Email) untuk seluruh pesan keluar. Kredensial disimpan aman di server dan tidak pernah dikirim ke browser.</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-muted/30">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <div>
                <div className="text-sm font-medium">Status Notifikasi</div>
                <div className="text-xs text-muted-foreground">Aktifkan agar seluruh event CRM mengirim notifikasi otomatis.</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold ${form.enabled ? 'text-emerald-500' : 'text-muted-foreground'}`}>{form.enabled ? 'AKTIF' : 'NONAKTIF'}</span>
              <Switch data-testid="notif-enabled-switch" checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
            </div>
          </div>

          <div className="space-y-1.5 max-w-md">
            <Label>Provider Aktif</Label>
            <Select value={form.provider} onValueChange={(v) => set('provider', v)}>
              <SelectTrigger data-testid="notif-provider-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(providers.length ? providers : [{ value: 'fonnte', label: 'Fonnte (WhatsApp)', available: true }]).map((p) => (
                  <SelectItem key={p.value} value={p.value} disabled={!p.available}>
                    {p.label}{!p.available ? ' — segera hadir' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ---- WhatsApp (Fonnte) fields ---- */}
          {!isEmail && (
            <div className="space-y-5 rounded-lg border border-border p-4" data-testid="notif-wa-fields">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><MessageSquare className="w-4 h-4 text-emerald-500" /> Konfigurasi WhatsApp (Fonnte)</div>
              <div className="grid md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <Label>API URL</Label>
                  <Input data-testid="wa-apiurl-input" value={form.api_url} onChange={(e) => set('api_url', e.target.value)} placeholder="https://api.fonnte.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>Country Code</Label>
                  <Input data-testid="wa-country-input" value={form.country_code} onChange={(e) => set('country_code', e.target.value)} placeholder="62" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>API Token {cfg?.token_configured && <span className="text-xs text-emerald-500 ml-2">● tersimpan ({cfg.token_masked})</span>}</Label>
                  <div className="relative">
                    <Input data-testid="wa-token-input" type={showToken ? 'text' : 'password'} value={form.api_token} onChange={(e) => set('api_token', e.target.value)} placeholder={cfg?.token_configured ? 'Kosongkan untuk tetap memakai token tersimpan' : 'Tempel Fonnte device token di sini'} />
                    <button type="button" onClick={() => setShowToken((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Sender (nomor WhatsApp device)</Label>
                  <Input data-testid="wa-sender-input" value={form.sender} onChange={(e) => set('sender', e.target.value)} placeholder="628xxxxxxxxxx" />
                </div>
                <div className="space-y-1.5">
                  <Label>Default Internal Group (ID grup WhatsApp)</Label>
                  <Input data-testid="wa-group-input" value={form.default_group} onChange={(e) => set('default_group', e.target.value)} placeholder="120363xxxxxxxxxxxx@g.us" />
                </div>
              </div>
            </div>
          )}

          {/* ---- Email (SMTP) fields ---- */}
          {isEmail && (
            <div className="space-y-5 rounded-lg border border-border p-4" data-testid="notif-email-fields">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Mail className="w-4 h-4 text-blue-500" /> Konfigurasi Email (SMTP / Gmail)</div>
              <div className="grid md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <Label>SMTP Host</Label>
                  <Input data-testid="email-host-input" value={form.smtp_host} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input data-testid="email-port-input" type="number" value={form.smtp_port} onChange={(e) => set('smtp_port', e.target.value)} placeholder="587" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Security</Label>
                    <Select value={form.smtp_security} onValueChange={(v) => set('smtp_security', v)}>
                      <SelectTrigger data-testid="email-security-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tls">STARTTLS (587)</SelectItem>
                        <SelectItem value="ssl">SSL (465)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Username (alamat Gmail)</Label>
                  <Input data-testid="email-username-input" value={form.smtp_username} onChange={(e) => set('smtp_username', e.target.value)} placeholder="akun@gmail.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>App Password {cfg?.smtp_password_configured && <span className="text-xs text-emerald-500 ml-2">● tersimpan</span>}</Label>
                  <div className="relative">
                    <Input data-testid="email-password-input" type={showPass ? 'text' : 'password'} value={form.smtp_password} onChange={(e) => set('smtp_password', e.target.value)} placeholder={cfg?.smtp_password_configured ? 'Kosongkan untuk tetap memakai sandi tersimpan' : 'App Password 16 digit dari Google'} />
                    <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>From Email</Label>
                  <Input data-testid="email-fromemail-input" value={form.from_email} onChange={(e) => set('from_email', e.target.value)} placeholder="noc@artamedia.co.id" />
                </div>
                <div className="space-y-1.5">
                  <Label>From Name</Label>
                  <Input data-testid="email-fromname-input" value={form.from_name} onChange={(e) => set('from_name', e.target.value)} placeholder="NOC Artamedia" />
                </div>
                <div className="space-y-1.5">
                  <Label>Email Tim Internal (tujuan grup internal)</Label>
                  <Input data-testid="email-internal-input" value={form.internal_email} onChange={(e) => set('internal_email', e.target.value)} placeholder="team-noc@artamedia.co.id" />
                </div>
                <div className="space-y-1.5">
                  <Label>Subject Prefix</Label>
                  <Input data-testid="email-subject-input" value={form.subject_prefix} onChange={(e) => set('subject_prefix', e.target.value)} placeholder="[Artamedia]" />
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md bg-blue-500/5 border border-blue-500/20 p-3">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-500" />
                <span>Gmail membutuhkan <b>2-Step Verification aktif</b> lalu buat <b>App Password</b> (16 digit) di akun Google — gunakan itu, bukan kata sandi login biasa. Email customer diambil dari kolom kontak PIC (bila berformat email) atau data pelanggan.</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Public Base URL (untuk link tracking)</Label>
            <Input data-testid="notif-baseurl-input" value={form.public_base_url} onChange={(e) => set('public_base_url', e.target.value)} placeholder="https://portal.artamedia.co.id" />
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button data-testid="notif-save-btn" onClick={save} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />{saving ? 'Menyimpan…' : 'Simpan Konfigurasi'}
            </Button>
            <Button data-testid="notif-test-btn" variant="outline" onClick={testConnection} disabled={testing}>
              <Plug className="w-4 h-4 mr-2" />{testing ? 'Menguji…' : 'Test Connection'}
            </Button>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${testResult.connected ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600' : 'border-red-500/30 bg-red-500/5 text-red-600'}`} data-testid="notif-test-result">
              {testResult.connected ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
              <div>
                <div className="font-medium">{testResult.connected ? 'Terhubung' : 'Belum terhubung'}</div>
                <div className="text-xs opacity-80">
                  {testResult.device_status && <span>status: {testResult.device_status} · </span>}
                  {testResult.quota != null && <span>quota: {testResult.quota} · </span>}
                  {testResult.detail || ''}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Send className="w-4 h-4 text-primary" /> Kirim Pesan Tes</div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{isEmail ? 'Email Tujuan' : 'Nomor / Group ID Tujuan'}</Label>
              <Input data-testid="notif-testsend-target" value={tsTarget} onChange={(e) => setTsTarget(e.target.value)} placeholder={isEmail ? 'tujuan@email.com' : '08123456789 atau 1203..@g.us'} />
            </div>
          </div>
          <Textarea data-testid="notif-testsend-message" value={tsMsg} onChange={(e) => setTsMsg(e.target.value)} rows={3} />
          <Button data-testid="notif-testsend-btn" onClick={testSend} disabled={sending} variant="secondary">
            <Send className="w-4 h-4 mr-2" />{sending ? 'Mengirim…' : 'Kirim Tes'}
          </Button>
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Aktifkan status notifikasi & simpan kredensial agar pesan benar-benar terkirim. Bila nonaktif, percobaan kirim akan tercatat sebagai <b>skipped</b> di Delivery Logs.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
