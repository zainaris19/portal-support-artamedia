import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Eye, EyeOff, Radio, Activity, Database, HardDrive, Globe, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH } from '@/constants/testIds';
import { toast } from 'sonner';
import api from '@/lib/api';
import { defaultLandingPath } from '@/lib/roleAccess';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => localStorage.getItem('noc_last_email') || '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(() => !!localStorage.getItem('noc_last_email'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState(null);

  // Force dark theme on the login page for the enterprise look — restore on unmount
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    root.classList.add('dark');
    return () => { if (!wasDark) root.classList.remove('dark'); };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try { const { data } = await api.get('/health'); if (mounted) setHealth(data); }
      catch { if (mounted) setHealth({ api: false, database: false, storage: false, version: '—' }); }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const u = await login(email.trim(), password);
      if (remember) localStorage.setItem('noc_last_email', email.trim());
      else localStorage.removeItem('noc_last_email');
      toast.success('Selamat datang kembali');
      navigate(defaultLandingPath(u?.role), { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Login gagal';
      const message = typeof msg === 'string' ? msg : 'Login gagal';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const onForgot = (e) => {
    e.preventDefault();
    toast.info('Silakan hubungi administrator sistem untuk reset password.', { duration: 4000 });
  };

  return (
    <div className="min-h-screen w-full bg-[hsl(220,32%,8%)] text-slate-100 flex overflow-hidden">
      {/* ambient grid backdrop — only on the right panel now (left has photo) */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-[42%] opacity-[0.25]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      {/* soft warm highlight tying into sunset hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 88% 12%, rgba(251,146,60,0.06), transparent 40%), radial-gradient(circle at 78% 88%, rgba(59,130,246,0.08), transparent 55%)',
        }}
      />

      {/* LEFT — hero background + brand + headline */}
      <div className="hidden lg:flex flex-col justify-between relative z-10 w-[58%] p-12 xl:p-16 overflow-hidden">
        {/* hero image */}
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('/images/login-hero.png')` }}
        />
        {/* readability overlays — strong left, transparent right */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(4,10,22,0.92) 0%, rgba(4,10,22,0.78) 45%, rgba(4,10,22,0.55) 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(4,10,22,0.55) 0%, rgba(4,10,22,0) 25%, rgba(4,10,22,0) 70%, rgba(4,10,22,0.75) 100%)',
          }}
        />

        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/25 to-blue-500/5 border border-blue-400/40 flex items-center justify-center backdrop-blur-md">
            <Radio className="w-5 h-5 text-blue-300" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-300/80">Enterprise Portal</div>
            <div className="text-base font-semibold text-white drop-shadow-md" style={{ fontFamily: 'Manrope' }}>Artamedia Citra Telematika Indonesia</div>
          </div>
          <div className="ml-auto hidden xl:flex items-center gap-2 text-[11px] text-slate-300/80 backdrop-blur-sm bg-slate-950/30 border border-white/10 rounded-full px-3 py-1">
            <Globe className="w-3.5 h-3.5" /> Indonesia · Enterprise Network
          </div>
        </div>

        <div className="relative space-y-5 my-auto max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/15 border border-blue-400/40 text-blue-200 text-[11px] font-medium px-3 py-1 uppercase tracking-widest backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-300 animate-pulse" /> Network Operations Center
          </div>
          <h1
            className="text-5xl xl:text-6xl font-bold tracking-tight leading-[1.05] text-white"
            style={{ fontFamily: 'Manrope', textShadow: '0 2px 24px rgba(0,0,0,0.55)' }}
          >
            Portal Support <span className="text-blue-300">Artamedia</span>
          </h1>
          <p
            className="text-base xl:text-lg text-slate-200/95 leading-relaxed max-w-lg"
            style={{ textShadow: '0 2px 16px rgba(0,0,0,0.55)' }}
          >
            One Platform for Network Operations, Customer Services, Documentation, and Infrastructure Management.
          </p>
        </div>

        <div className="relative flex items-center justify-between text-[11px] text-slate-300/80">
          <div>© {new Date().getFullYear()} PT Artamedia Citra Telematika Indonesia · Internal Enterprise Platform</div>
          <div className="hidden xl:block">Restricted Access · Authorized Personnel Only</div>
        </div>
      </div>

      {/* RIGHT — login card */}
      <div className="flex-1 flex items-center justify-center relative z-10 p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <Radio className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Enterprise Portal</div>
              <div className="text-sm font-semibold leading-tight" style={{ fontFamily: 'Manrope' }}>Artamedia Citra Telematika Indonesia</div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-xl shadow-[0_25px_60px_-20px_rgba(0,0,0,0.6)] p-7 sm:p-8 slide-up">
            <div className="mb-7">
              <h2 className="text-[22px] font-semibold tracking-tight text-slate-50" style={{ fontFamily: 'Manrope' }}>
                Sign in to your account
              </h2>
              <p className="text-sm text-slate-400 mt-1.5">Use your Artamedia enterprise credentials to continue.</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  data-testid={AUTH.emailInput}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@artamedia.co.id"
                  className="h-11 bg-slate-950/60 border-slate-800 text-slate-100 placeholder:text-slate-600 focus-visible:ring-blue-500/40 focus-visible:border-blue-500/50"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    data-testid={AUTH.passwordInput}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-11 pr-10 bg-slate-950/60 border-slate-800 text-slate-100 placeholder:text-slate-600 focus-visible:ring-blue-500/40 focus-visible:border-blue-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 rounded transition-colors"
                    aria-label="Toggle password visibility"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    data-testid="login-remember-me"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="w-4 h-4 rounded border border-slate-700 bg-slate-950/60 grid place-items-center peer-checked:bg-blue-500 peer-checked:border-blue-500 transition-colors">
                    <svg className="w-2.5 h-2.5 text-white opacity-0 peer-checked/parent:opacity-100" viewBox="0 0 12 10" fill="none">
                      <path d="M1 5l3.5 3.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {remember && (
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 10" fill="none">
                        <path d="M1 5l3.5 3.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">Remember me</span>
                </label>
                <button
                  type="button"
                  onClick={onForgot}
                  data-testid="login-forgot-password"
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Forgot password?
                </button>
              </div>

              {error && (
                <div
                  data-testid={AUTH.errorMsg}
                  className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2"
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                data-testid={AUTH.submitBtn}
                disabled={loading}
                className="w-full h-11 mt-2 bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (<span className="inline-flex items-center gap-2">Sign in <ArrowRight className="w-4 h-4" /></span>)}
              </Button>
            </form>

            {/* System Status */}
            <div className="mt-8 pt-6 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">System Status</div>
                <div className="text-[10px] text-slate-600 font-mono">v{health?.version || '—'}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatusPill icon={Activity} label="API" ok={!!health?.api} />
                <StatusPill icon={Database} label="Database" ok={!!health?.database} />
                <StatusPill icon={HardDrive} label="Storage" ok={!!health?.storage} />
              </div>
            </div>
          </div>

          <div className="mt-6 text-center text-[11px] text-slate-500">
            Protected by role-based access · Session encrypted with JWT
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ icon: Icon, label, ok }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-800/80 bg-slate-950/40 px-2.5 py-2">
      <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider leading-none">{label}</div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] animate-pulse' : 'bg-rose-500'}`} />
          <span className={`text-[11px] font-medium ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>{ok ? 'Online' : 'Offline'}</span>
        </div>
      </div>
    </div>
  );
}
