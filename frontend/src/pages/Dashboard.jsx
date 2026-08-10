import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, FileText, AlertOctagon, Wrench, ClipboardList, Loader2, TrendingUp, Clock } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/StatusBadge';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { DASHBOARD } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const CATEGORY_COLORS = ['#3B82F6', '#0EA5E9', '#14B8A6', '#8B5CF6', '#F59E0B'];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let m = true;
    api.get('/dashboard/stats').then(({ data }) => { if (m) { setStats(data); setLoading(false); } }).catch(() => setLoading(false));
    return () => { m = false; };
  }, []);

  const statCards = stats
    ? [
        { key: 'customers', label: 'Total Pelanggan', value: stats.total_customers, sub: `${stats.active_customers} aktif`, icon: Users, to: '/customers/broadband', color: 'text-primary' },
        { key: 'partners', label: 'Mitra / Provider', value: stats.total_partners || 0, sub: 'Terhubung ke pelanggan', icon: Users, to: '/partners', color: 'text-indigo-600 dark:text-indigo-400' },
        { key: 'documents', label: 'Dokumen & Arsip', value: stats.total_documents, sub: 'Semua kategori', icon: FileText, to: '/documents/ba', color: 'text-sky-600 dark:text-sky-400' },
        { key: 'racks', label: 'Rack & Device', value: `${stats.total_racks || 0} / ${stats.total_devices || 0}`, sub: 'Rack · Perangkat', icon: FileText, to: '/documents/rack-device', color: 'text-teal-600 dark:text-teal-400' },
        { key: 'incidents', label: 'Incident Aktif', value: stats.active_incidents, sub: `${stats.total_incidents} total`, icon: AlertOctagon, to: '/operations/incidents', color: 'text-rose-600 dark:text-rose-400' },
        { key: 'maintenances', label: 'Maintenance Aktif', value: stats.active_maintenances, sub: 'Terjadwal & darurat', icon: Wrench, to: '/operations/maintenances', color: 'text-amber-600 dark:text-amber-400' },
        { key: 'shifts', label: 'Shift Handover', value: stats.total_shifts, sub: 'Total catatan', icon: ClipboardList, to: '/operations/shift-handover', color: 'text-emerald-600 dark:text-emerald-400' },
      ]
    : [];

  const catData = stats ? Object.entries(stats.customers_by_category).map(([k, v]) => ({ name: k, value: v })) : [];
  const statusData = stats ? Object.entries(stats.status_breakdown).map(([k, v]) => ({ name: k, value: v })) : [];

  return (
    <div data-testid={DASHBOARD.root} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: 'Manrope' }}>Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Ringkasan operasional Network Operation Center.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        {loading && Array.from({ length: 7 }).map((_, i) => (
          <Card key={i} className="border-border"><CardContent className="p-4 space-y-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-20" /></CardContent></Card>
        ))}
        {statCards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              onClick={() => navigate(c.to)}
              data-testid={DASHBOARD.statCard(c.key)}
              className="text-left group"
            >
              <Card className="border-border transition-colors group-hover:border-primary/40 group-hover:bg-accent/30 h-full">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</div>
                    <Icon className={cn('w-4 h-4', c.color)} strokeWidth={2} />
                  </div>
                  <div className="text-2xl font-bold text-foreground tabular-nums" style={{ fontFamily: 'Manrope' }}>{c.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border" data-testid={DASHBOARD.chart}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Pelanggan per Kategori Layanan</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              {loading ? <Skeleton className="w-full h-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={catData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} allowDecimals={false} />
                    <Tooltip cursor={{ fill: 'hsl(var(--accent))', opacity: 0.4 }} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Status Incident</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              {loading ? <Skeleton className="w-full h-full" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                      {statusData.map((_, i) => <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card className="border-border" data-testid={DASHBOARD.recent}>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Aktivitas Terbaru</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : stats?.recent?.length ? (
            <ul className="divide-y divide-border">
              {stats.recent.map((r) => (
                <li key={`${r.type}-${r.id}`} className="px-4 py-3 flex items-center justify-between gap-3 text-sm hover:bg-accent/40 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground w-24 shrink-0">{r.type}</span>
                    <span className="truncate text-foreground">{r.title}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {r.status && <StatusBadge value={r.status} />}
                    <span className="text-xs text-muted-foreground hidden sm:block">{r.at ? new Date(r.at).toLocaleString() : ''}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">Belum ada aktivitas.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
