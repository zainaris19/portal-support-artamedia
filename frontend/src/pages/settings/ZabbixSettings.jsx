import React, { useEffect, useState } from 'react';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Activity, Save, Play, Eye, EyeOff, CheckCircle2, XCircle, Info } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export default function ZabbixSettings() {
  const { isAdmin } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ url: '', api_token: '', verify_ssl: true, timeout: 15 });
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/zabbix/config');
      setCfg(data);
      setForm((f) => ({ ...f, url: data.url || '', verify_ssl: data.verify_ssl, timeout: data.timeout || 15 }));
    } catch (e) {
      toast.error('Gagal memuat konfigurasi');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.url) { toast.error('URL Zabbix harus diisi'); return; }
    setSaving(true);
    try {
      const payload = {
        url: form.url,
        verify_ssl: form.verify_ssl,
        timeout: Number(form.timeout) || 15,
      };
      if (form.api_token) payload.api_token = form.api_token;
      const { data } = await api.put('/zabbix/config', payload);
      setCfg(data);
      setForm((f) => ({ ...f, api_token: '' }));
      toast.success('Konfigurasi Zabbix tersimpan');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/zabbix/test-connection');
      setTestResult(data);
      if (data.ok) toast.success(data.message);
      else toast.error(data.message);
      await load();
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Settings' }, { label: 'Monitoring Integration' }, { label: 'Zabbix' }]} />

      <Card className="border-border/70">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                  <Activity className="w-4 h-4 text-emerald-300" />
                </span>
                <h1 className="text-xl font-semibold" style={{ fontFamily: 'Manrope' }}>
                  Zabbix Monitoring Integration
                </h1>
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                Portal Support hanya menjadi viewer — histori metric (traffic, CPU, memory, temperature, availability) dibaca via Zabbix API 7.0 JSON-RPC. Token disimpan terenkripsi (Fernet) di server dan tidak pernah dikirim ke frontend.
              </p>
            </div>
            <StatusBadge cfg={cfg} />
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Memuat konfigurasi…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Zabbix URL" required>
                  <input
                    className="input-base"
                    placeholder="https://nms.example.com"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    data-testid="zabbix-url-input"
                    disabled={!isAdmin}
                  />
                  <div className="text-[11px] text-muted-foreground mt-1">
                    URL root Zabbix — `/api_jsonrpc.php` ditambah otomatis.
                  </div>
                </Field>

                <Field label={`API Token ${cfg?.configured ? '(kosongkan untuk mempertahankan)' : ''}`}
                       required={!cfg?.configured}>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      className="input-base pr-9"
                      placeholder={cfg?.configured ? `${cfg.token_masked || '••••'} · isi baru untuk mengganti` : 'Zabbix API token (Users → API tokens)'}
                      value={form.api_token}
                      onChange={(e) => setForm({ ...form, api_token: e.target.value })}
                      data-testid="zabbix-token-input"
                      disabled={!isAdmin}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowToken((v) => !v)}
                      tabIndex={-1}
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Buat di Zabbix: <span className="font-mono">Users → API tokens</span>. Gunakan Bearer authentication (Zabbix 5.4+).
                  </div>
                </Field>

                <Field label="Verify SSL">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.verify_ssl}
                      onChange={(e) => setForm({ ...form, verify_ssl: e.target.checked })}
                      data-testid="zabbix-verify-ssl"
                      disabled={!isAdmin}
                    />
                    <span>Aktifkan verifikasi sertifikat TLS (rekomendasi produksi)</span>
                  </label>
                </Field>

                <Field label="Request Timeout (detik)">
                  <input
                    type="number"
                    min={3}
                    max={120}
                    className="input-base"
                    value={form.timeout}
                    onChange={(e) => setForm({ ...form, timeout: e.target.value })}
                    data-testid="zabbix-timeout"
                    disabled={!isAdmin}
                  />
                </Field>
              </div>

              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
                  <Button onClick={save} disabled={saving} data-testid="btn-save-zabbix">
                    <Save className="w-4 h-4 mr-1" /> {saving ? 'Menyimpan…' : 'Simpan Konfigurasi'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={testConnection}
                    disabled={testing || !cfg?.configured}
                    data-testid="btn-test-zabbix"
                    title={!cfg?.configured ? 'Simpan konfigurasi dulu' : 'Test connectivity ke Zabbix API'}
                  >
                    <Play className="w-4 h-4 mr-1" /> {testing ? 'Testing…' : 'Test Connection'}
                  </Button>
                </div>
              )}

              {testResult && (
                <div className={`rounded-md p-3 text-sm border ${testResult.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`}>
                  <div className="flex items-center gap-2">
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    <span className="font-semibold">{testResult.ok ? 'Connected' : 'Connection failed'}</span>
                  </div>
                  <div className="font-mono text-[12px] mt-1 whitespace-pre-wrap">{testResult.message}</div>
                </div>
              )}

              <div className="rounded-md p-3 text-xs border border-border/60 bg-muted/30 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-300" />
                <div className="space-y-1">
                  <div><b>Cara pakai per-device:</b> buka detail device di rack, edit field <span className="font-mono">Zabbix Host</span>. Portal akan mencocokkan nama host di Zabbix dan menampilkan graph di panel bawah panel visualisasi.</div>
                  <div className="text-muted-foreground">Data source: <span className="font-mono">history.get</span> untuk range ≤ 24 jam, <span className="font-mono">trend.get</span> untuk 7/30 hari (sesuai rekomendasi Zabbix).</div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <style>{`
        .input-base {
          width: 100%; padding: 0.5rem 0.75rem; font-size: 13px;
          border-radius: 6px; border: 1px solid hsl(var(--border));
          background: hsl(var(--background)); color: hsl(var(--foreground));
          font-family: ui-monospace, monospace;
        }
        .input-base:focus { outline: 2px solid transparent; box-shadow: 0 0 0 2px hsl(var(--ring) / 0.4); }
        .input-base:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

function StatusBadge({ cfg }) {
  if (!cfg?.configured) {
    return (
      <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-md border border-border/60 text-muted-foreground bg-muted/40">
        NOT CONFIGURED
      </span>
    );
  }
  if (cfg.last_test_ok === true) {
    return (
      <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 inline-flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        CONNECTED {cfg.last_test_version && `· v${cfg.last_test_version}`}
      </span>
    );
  }
  if (cfg.last_test_ok === false) {
    return (
      <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-200">
        ERROR
      </span>
    );
  }
  return (
    <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200">
      UNTESTED
    </span>
  );
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
