import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import Breadcrumb from '@/components/Breadcrumb';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, LineChart, Line, PieChart, Pie, Cell, Legend, CartesianGrid } from 'recharts';
import { Inbox, Wrench, CheckCircle2, TrendingUp, Layers, Users, Clock, Ticket } from 'lucide-react';
import api, { formatApiError } from '@/lib/api';
import { toast } from 'sonner';
import { humanSeconds } from './helpdeskUtils';
import { cn } from '@/lib/utils';

const STATUS_COLORS = { MASUK: '#e11d48', DIPROSES: '#0284c7', SELESAI: '#10b981' };
const PRIO_COLORS = { Critical: '#e11d48', High: '#ea580c', Medium: '#0284c7', Low: '#64748b' };
const SRC_COLORS = ['#0ea5e9', '#8b5cf6', '#f97316', '#10b981', '#f59e0b', '#64748b'];

export default function CRMHelpdeskDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/crm/stats')
      .then(({ data }) => setStats(data))
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const bs = stats?.by_status || {};

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'CRM Ticket Helpdesk' }, { label: 'Dashboard CRM' }]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Dashboard CRM</h1>
        <p className="text-sm text-muted-foreground mt-1">Ringkasan operasional ticket helpdesk NOC.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Ticket} label="Total Ticket" value={stats?.total} loading={loading} tone="slate" />
        <StatCard icon={Inbox} label="Masuk" value={bs.MASUK} loading={loading} tone="rose" />
        <StatCard icon={Wrench} label="Diproses" value={bs.DIPROSES} loading={loading} tone="sky" />
        <StatCard icon={CheckCircle2} label="Selesai" value={bs.SELESAI} loading={loading} tone="emerald" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TimeCard icon={Clock} label="Avg Response" value={humanSeconds(stats?.avg_response_seconds)} loading={loading} />
        <TimeCard icon={Clock} label="Avg Execution" value={humanSeconds(stats?.avg_execution_seconds)} loading={loading} />
        <TimeCard icon={Clock} label="Avg Total Handling" value={humanSeconds(stats?.avg_total_seconds)} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border-border lg:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary" />
              <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>Ticket Trend — 14 hari</div>
            </div>
            {loading ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats?.trend || []}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" stroke="#0284c7" strokeWidth={2} dot={{ r: 3 }} name="Ticket dibuat" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-primary" />
              <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>Prioritas</div>
            </div>
            {loading ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(stats?.by_priority || {}).map(([name, value]) => ({ name, value }))}
                      dataKey="value" nameKey="name"
                      innerRadius={40} outerRadius={70} paddingAngle={2}
                    >
                      {Object.keys(stats?.by_priority || {}).map((k, i) => (
                        <Cell key={i} fill={PRIO_COLORS[k] || '#64748b'} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-primary" />
              <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>Sumber Laporan</div>
            </div>
            {loading ? <Skeleton className="h-56 w-full" /> : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={Object.entries(stats?.by_report_source || {}).map(([name, value]) => ({ name, value }))}
                    margin={{ left: -10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {Object.keys(stats?.by_report_source || {}).map((_, i) => (
                        <Cell key={i} fill={SRC_COLORS[i % SRC_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-primary" />
              <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>Top Troubleshooter</div>
            </div>
            {loading ? <Skeleton className="h-56 w-full" /> : (
              (stats?.top_troubleshooters || []).length === 0 ? (
                <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">Belum ada data</div>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(stats?.top_troubleshooters || []).map((t, i) => (
                    <li key={t.name} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5 last:border-none">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-primary/10 border border-primary/30 text-primary text-[11px] font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="truncate">{t.name}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground text-xs">{t.count} ticket</span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, loading, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
    rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
    sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
    emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  };
  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold mt-1 tabular-nums" style={{ fontFamily: 'Manrope' }}>
              {loading ? <Skeleton className="h-7 w-14" /> : (value ?? 0)}
            </div>
          </div>
          <div className={cn('w-9 h-9 rounded-md border flex items-center justify-center shrink-0', tones[tone])}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TimeCard({ icon: Icon, label, value, loading }) {
  return (
    <Card className="border-border">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-md border border-border bg-muted/40 flex items-center justify-center"><Icon className="w-4 h-4 text-muted-foreground" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="text-base font-bold font-mono tabular-nums" style={{ fontFamily: 'Manrope' }}>
            {loading ? <Skeleton className="h-5 w-20" /> : value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
