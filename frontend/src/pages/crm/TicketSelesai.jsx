import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Eye, CheckCircle2, MapPin, User, RotateCcw, Trash2 } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import { PriorityBadge, StatusBadge, PRIORITIES, humanSeconds, fmtLocal } from './helpdeskUtils';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';

const PAGE_SIZE = 15;

export default function TicketSelesai() {
  const { hasRole } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('all');
  const [page, setPage] = useState(1);

  const canReopen = hasRole('admin', 'supervisor');
  const isAdmin = hasRole('admin');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: 'SELESAI', page, page_size: PAGE_SIZE };
      if (q) params.q = q;
      if (priority !== 'all') params.priority = priority;
      const { data } = await api.get('/crm/tickets', { params });
      setItems(data.items || []); setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, [page, q, priority]);

  useEffect(() => { load(); }, [load]);

  const reopen = async (t) => {
    if (!window.confirm(`Buka kembali ticket ${t.ticket_number}?`)) return;
    try {
      await api.post(`/crm/tickets/${t.id}/reopen`);
      toast.success('Ticket dibuka kembali');
      refreshCounts(); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const del = async (t) => {
    if (!window.confirm(`Hapus permanen ticket ${t.ticket_number}? Semua dokumentasi & data ticket akan dihapus dan tidak dapat dikembalikan.`)) return;
    try {
      await api.delete(`/crm/tickets/${t.id}`);
      toast.success('Ticket dihapus permanen');
      refreshCounts(); load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'CRM Ticket Helpdesk' }, { label: 'Ticket Selesai' }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Ticket Selesai</h1>
          <p className="text-sm text-muted-foreground mt-1">Ticket yang telah diselesaikan lengkap dengan perhitungan waktu, root cause, dan dokumentasi.</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total selesai</div>
          <div className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'Manrope' }}>{total}</div>
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="selesai-search"
                placeholder="Cari ticket, customer, root cause…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                className="pl-9 h-9"
              />
            </div>
            <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-40 h-9" data-testid="selesai-filter-priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Prioritas</SelectItem>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Mobile card list — <md */}
          <div className="md:hidden space-y-2">
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
            {!loading && items.length === 0 && (
              <div className="text-center py-10 text-sm text-muted-foreground border border-border rounded-md">
                <CheckCircle2 className="w-6 h-6 mx-auto mb-1 opacity-60" />
                Belum ada ticket selesai.
              </div>
            )}
            {!loading && items.map((t) => (
              <div
                key={t.id}
                className="border border-border rounded-lg p-3 bg-card active:bg-accent/40 transition-colors cursor-pointer"
                data-testid={`selesai-card-${t.id}`}
                onClick={() => nav(`/crm/tickets/${t.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] font-semibold text-foreground">{t.ticket_number}</div>
                    <div className="text-sm font-medium mt-0.5 truncate">{t.customer_name || '—'}</div>
                    {t.location && (
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 shrink-0" />{t.location}
                      </div>
                    )}
                  </div>
                  <PriorityBadge value={t.priority} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Response</span>
                    <span className="font-mono tabular-nums">{humanSeconds(t.response_time_seconds)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Execution</span>
                    <span className="font-mono tabular-nums">{humanSeconds(t.execution_time_seconds)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Total</span>
                    <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-300">{humanSeconds(t.total_handling_seconds)}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-x-3 flex-wrap text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{t.troubleshooter_name || '—'}</span>
                  <span>{fmtLocal(t.resolved_at)}</span>
                </div>
                <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" className="flex-1 h-8" onClick={() => nav(`/crm/tickets/${t.id}`)} data-testid={`selesai-mobile-detail-${t.id}`}>
                    <Eye className="w-3.5 h-3.5 mr-1" /> Detail
                  </Button>
                  {canReopen && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => reopen(t)} data-testid={`selesai-mobile-reopen-${t.id}`}>
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {isAdmin && (
                    <Button size="sm" variant="outline" className="h-8 text-rose-600 border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30" onClick={() => del(t)} data-testid={`selesai-mobile-delete-${t.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Ticket</TableHead>
                  <TableHead className="text-xs">Customer / Lokasi</TableHead>
                  <TableHead className="text-xs">Resolved</TableHead>
                  <TableHead className="text-xs">Response</TableHead>
                  <TableHead className="text-xs">Execution</TableHead>
                  <TableHead className="text-xs">Downtime</TableHead>
                  <TableHead className="text-xs">Total Handling</TableHead>
                  <TableHead className="text-xs">Prioritas</TableHead>
                  <TableHead className="text-xs">Troubleshooter</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={11}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))}
                {!loading && items.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center py-10 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-6 h-6 mx-auto mb-1 opacity-60" />
                    Belum ada ticket selesai.
                  </TableCell></TableRow>
                )}
                {!loading && items.map((t) => (
                  <TableRow key={t.id} className="hover:bg-accent/40" data-testid={`selesai-row-${t.id}`}>
                    <TableCell className="text-xs">
                      <div className="font-mono font-semibold">{t.ticket_number}</div>
                      <div className="text-[10px] text-muted-foreground">{fmtLocal(t.created_at)}</div>
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px]">
                      <div className="font-medium truncate">{t.customer_name || '—'}</div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                        {t.location && <MapPin className="w-3 h-3 shrink-0" />}{t.location || '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{fmtLocal(t.resolved_at)}</TableCell>
                    <TableCell className="text-xs font-mono tabular-nums">{humanSeconds(t.response_time_seconds)}</TableCell>
                    <TableCell className="text-xs font-mono tabular-nums">{humanSeconds(t.execution_time_seconds)}</TableCell>
                    <TableCell className="text-xs font-mono tabular-nums">{humanSeconds(t.downtime_seconds)}</TableCell>
                    <TableCell className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-300">{humanSeconds(t.total_handling_seconds)}</TableCell>
                    <TableCell><PriorityBadge value={t.priority} /></TableCell>
                    <TableCell className="text-xs">
                      <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{t.troubleshooter_name || '—'}</span>
                    </TableCell>
                    <TableCell><StatusBadge value={t.status} /></TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => nav(`/crm/tickets/${t.id}`)} data-testid={`selesai-detail-${t.id}`}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canReopen && (
                          <Button size="sm" variant="outline" onClick={() => reopen(t)} data-testid={`selesai-reopen-${t.id}`}>
                            <RotateCcw className="w-4 h-4 mr-1" /> Reopen
                          </Button>
                        )}
                        {isAdmin && (
                          <Button size="sm" variant="outline" className="text-rose-600 border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30" onClick={() => del(t)} data-testid={`selesai-delete-${t.id}`}>
                            <Trash2 className="w-4 h-4 mr-1" /> Hapus
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>Menampilkan {items.length} dari {total} ticket selesai</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="selesai-page-prev">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="tabular-nums">Hal. {page} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid="selesai-page-next">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
