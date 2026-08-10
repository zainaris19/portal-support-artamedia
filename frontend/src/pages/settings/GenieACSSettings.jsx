import React, { useEffect, useState } from 'react';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Router as RouterIcon, Save, Play, Eye, EyeOff, CheckCircle2, XCircle, Info, Layers,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export default function GenieACSSettings() {
  const { isAdmin } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [form, setForm] = useState({
    host: '', port: 7557, username: '', password: '', verify_ssl: true, enabled: true,
    timeout: 15, cluster_prefix: 'CLUSTER:', cluster_mode: 'prefix', manual_cluster_tags: '',
    online_max_min: 10, warning_max_min: 30,
  });

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/genieacs/config');
      setCfg(data);
      setForm((f) => ({
        ...f, host: data.host || '', port: data.port || 7557, username: data.username || '',
        verify_ssl: data.verify_ssl, enabled: data.enabled, timeout: data.timeout || 15,
        cluster_prefix: data.cluster_prefix || 'CLUSTER:', cluster_mode: data.cluster_mode || 'prefix',
        manual_cluster_tags: (data.manual_cluster_tags || []).join(', '),
        online_max_min: data.online_max_min || 10, warning_max_min: data.warning_max_min || 30,
      }));
    } catch (e) { toast.error('Gagal memuat konfigurasi'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.host.trim()) { toast.error('GenieACS Host/URL wajib diisi'); return; }
    setSaving(true);
    try {
      const payload = {
        host: form.host.trim(), port: Number(form.port) || 7557,
        verify_ssl: form.verify_ssl, enabled: form.enabled, timeout: Number(form.timeout) || 15,
        cluster_prefix: form.cluster_prefix || 'CLUSTER:', cluster_mode: form.cluster_mode,
        manual_cluster_tags: form.manual_cluster_tags.split(',').map((s) => s.trim()).filter(Boolean),
        online_max_min: Number(form.online_max_min) || 10,
        warning_max_min: Number(form.warning_max_min) || 30,
        username: form.username.trim() || null,
      };
      if (form.password) payload.password = form.password;
      const { data } = await api.put('/genieacs/config', payload);
      setCfg(data);
      setForm((f) => ({ ...f, password: '' }));
      toast.success('Konfigurasi GenieACS tersimpan');
    } catch (e) { toast.error(e.response?.data?.detail || 'Gagal menyimpan'); }
    finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data } = await api.post('/genieacs/test-connection');
      setTestResult(data);
      if (data.ok) toast.success(data.message); else toast.error(data.message);
      await load();
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setTestResult({ ok: false, message: msg }); toast.error(msg);
    } finally { setTesting(false); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Settings' }, { label: 'Integrations' }, { label: 'GenieACS' }]} />

      <Card className="border-border/70">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30">
                  <RouterIcon className="w-4 h-4 text-sky-300" />
                </span>
                <h1 className="text-xl font-semibold" style={{ fontFamily: 'Manrope' }}>GenieACS Integration</h1>
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                Portal Support hanya menjadi integration layer ke GenieACS existing melalui NBI API.
                Credential disimpan terenkripsi (Fernet) di server dan tidak pernah dikirim ke frontend.
              </p>
            </div>
            <StatusBadge cfg={cfg} />
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Memuat konfigurasi…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="GenieACS NBI URL / Host" required>
                  <input className="input-base" placeholder="http://103.103.147.46 atau host NBI"
                    value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })}
                    data-testid="genieacs-host-input" disabled={!isAdmin} />
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Isi host/URL NBI (bukan URL web UI). Skema default http; gunakan https:// bila NBI di belakang TLS.
                  </div>
                </Field>
                <Field label="NBI Port" required>
                  <input type="number" className="input-base" value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    data-testid="genieacs-port-input" disabled={!isAdmin} />
                  <div className="text-[11px] text-muted-foreground mt-1">Default NBI GenieACS: 7557</div>
                </Field>
                <Field label="Username (opsional)">
                  <input className="input-base" placeholder="kosongkan jika NBI tanpa auth"
                    value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                    data-testid="genieacs-username-input" disabled={!isAdmin} />
                </Field>
                <Field label={`Password (opsional) ${cfg?.password_set ? '· kosongkan untuk mempertahankan' : ''}`}>
                  <div className="relative">
                    <input type={showPwd ? 'text' : 'password'} className="input-base pr-9"
                      placeholder={cfg?.password_set ? '•••••• · isi baru untuk mengganti' : 'password NBI (opsional)'}
                      value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                      data-testid="genieacs-password-input" disabled={!isAdmin} />
                    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPwd((v) => !v)} tabIndex={-1}>
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </Field>
                <Field label="SSL Verify">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.verify_ssl}
                      onChange={(e) => setForm({ ...form, verify_ssl: e.target.checked })}
                      data-testid="genieacs-verify-ssl" disabled={!isAdmin} />
                    <span>Verifikasi sertifikat TLS (aktifkan bila NBI pakai https)</span>
                  </label>
                </Field>
                <Field label="Enable Integration">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.enabled}
                      onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                      data-testid="genieacs-enabled" disabled={!isAdmin} />
                    <span>Aktifkan integrasi GenieACS</span>
                  </label>
                </Field>
                <Field label="Request Timeout (detik)">
                  <input type="number" min={3} max={120} className="input-base" value={form.timeout}
                    onChange={(e) => setForm({ ...form, timeout: e.target.value })}
                    data-testid="genieacs-timeout" disabled={!isAdmin} />
                </Field>
              </div>

              {/* Status thresholds */}
              <div className="border-t border-border/60 pt-4">
                <div className="text-sm font-semibold mb-2" style={{ fontFamily: 'Manrope' }}>Status Threshold (Last Inform)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Online ≤ (menit)">
                    <input type="number" min={1} className="input-base" value={form.online_max_min}
                      onChange={(e) => setForm({ ...form, online_max_min: e.target.value })}
                      data-testid="genieacs-online-min" disabled={!isAdmin} />
                  </Field>
                  <Field label="Warning ≤ (menit) · di atas ini = Offline">
                    <input type="number" min={1} className="input-base" value={form.warning_max_min}
                      onChange={(e) => setForm({ ...form, warning_max_min: e.target.value })}
                      data-testid="genieacs-warning-min" disabled={!isAdmin} />
                  </Field>
                </div>
              </div>

              {/* Cluster mapping */}
              <div className="border-t border-border/60 pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>Cluster Mapping</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Mode">
                    <select className="input-base" value={form.cluster_mode}
                      onChange={(e) => setForm({ ...form, cluster_mode: e.target.value })}
                      data-testid="genieacs-cluster-mode" disabled={!isAdmin}>
                      <option value="prefix">Prefix Mode</option>
                      <option value="manual">Manual Tag Selection</option>
                    </select>
                  </Field>
                  {form.cluster_mode === 'prefix' ? (
                    <Field label="Cluster Tag Prefix">
                      <input className="input-base" value={form.cluster_prefix}
                        onChange={(e) => setForm({ ...form, cluster_prefix: e.target.value })}
                        data-testid="genieacs-cluster-prefix" disabled={!isAdmin} />
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Semua tag berawalan ini dianggap cluster. Contoh <span className="font-mono">CLUSTER:PANGKALPINANG</span> → <b>Pangkalpinang</b>. Prefix tidak ditampilkan ke user.
                      </div>
                    </Field>
                  ) : (
                    <Field label="Manual Cluster Tags (pisahkan koma)">
                      <input className="input-base" placeholder="PANGKALPINANG, CILEGON, PALEMBANG"
                        value={form.manual_cluster_tags}
                        onChange={(e) => setForm({ ...form, manual_cluster_tags: e.target.value })}
                        data-testid="genieacs-manual-tags" disabled={!isAdmin} />
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Hanya tag ini yang dianggap cluster. Tag lain (VIP, OLT-01, dll) diabaikan.
                      </div>
                    </Field>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
                  <Button onClick={save} disabled={saving} data-testid="btn-save-genieacs">
                    <Save className="w-4 h-4 mr-1" /> {saving ? 'Menyimpan…' : 'Simpan Konfigurasi'}
                  </Button>
                  <Button variant="secondary" onClick={testConnection} disabled={testing || !cfg?.configured}
                    data-testid="btn-test-genieacs" title={!cfg?.configured ? 'Simpan konfigurasi dulu' : 'Test koneksi NBI'}>
                    <Play className="w-4 h-4 mr-1" /> {testing ? 'Testing…' : 'Test Connection'}
                  </Button>
                </div>
              )}

              {testResult && (
                <div className={`rounded-md p-3 text-sm border ${testResult.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/40 bg-rose-500/10 text-rose-300'}`}
                  data-testid="genieacs-test-result">
                  <div className="flex items-center gap-2">
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    <span className="font-semibold">{testResult.ok ? 'Connected' : 'Connection failed'}</span>
                  </div>
                  <div className="font-mono text-[12px] mt-1 whitespace-pre-wrap">{testResult.message}</div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <InfoLine label="Last Successful Connection" value={fmtDate(cfg?.last_success_at)} />
                <InfoLine label="Last Test" value={cfg?.last_test_at ? `${fmtDate(cfg.last_test_at)} · ${cfg.last_test_ok ? 'OK' : 'FAIL'}` : '—'} />
                <InfoLine label="Last Error" value={cfg?.last_test_ok === false ? (cfg?.last_test_message || '—') : '—'} full />
              </div>

              <div className="rounded-md p-3 text-xs border border-border/60 bg-muted/30 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-300" />
                <div>Halaman <b>Network → GenieACS</b> membaca tag GenieACS untuk membentuk Cluster otomatis. Semua koneksi ke GenieACS hanya lewat backend Portal Support.</div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <style>{`
        .input-base { width:100%; padding:0.5rem 0.75rem; font-size:13px; border-radius:6px;
          border:1px solid hsl(var(--border)); background:hsl(var(--background)); color:hsl(var(--foreground));
          font-family: ui-monospace, monospace; }
        .input-base:focus { outline:2px solid transparent; box-shadow:0 0 0 2px hsl(var(--ring)/0.4); }
        .input-base:disabled { opacity:0.6; cursor:not-allowed; }
      `}</style>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

function InfoLine({ label, value, full }) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className="mt-0.5 font-mono break-words">{value || '—'}</div>
    </div>
  );
}

function StatusBadge({ cfg }) {
  if (!cfg?.configured) return <Pill cls="border-border/60 text-muted-foreground bg-muted/40">NOT CONFIGURED</Pill>;
  if (!cfg?.enabled) return <Pill cls="border-amber-500/40 bg-amber-500/10 text-amber-300">DISABLED</Pill>;
  if (cfg.last_test_ok === true) return <Pill cls="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1 inline-block" />CONNECTED</Pill>;
  if (cfg.last_test_ok === false) return <Pill cls="border-rose-500/40 bg-rose-500/10 text-rose-300">ERROR</Pill>;
  return <Pill cls="border-amber-500/40 bg-amber-500/10 text-amber-300">UNTESTED</Pill>;
}
function Pill({ cls, children }) {
  return <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-md border inline-flex items-center ${cls}`}>{children}</span>;
}
function Field({ label, children, required }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground mb-1.5">
        {label} {required && <span className="text-rose-400">*</span>}
      </div>
      {children}
    </div>
  );
}
