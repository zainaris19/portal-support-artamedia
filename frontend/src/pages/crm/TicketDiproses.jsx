import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Eye, Wrench, ClipboardCheck, MapPin, Camera, User } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import { PriorityBadge, StatusBadge, TicketTypeBadge, PRIORITIES, TICKET_TYPES, TICKET_TYPE_LABEL, humanSeconds, durationSince, fmtLocal } from './helpdeskUtils';
import { useCounts } from '@/context/CountsContext';

const PAGE_SIZE = 15;

export default function TicketDiproses() {
  const { refresh: refreshCounts } = useCounts();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('all');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: 'DIPROSES', page, page_size: PAGE_SIZE };
      if (q) params.q = q;
      if (priority !== 'all') params.priority = priority;
      if (type !== 'all') params.ticket_type = type;
      const { data } = await api.get('/crm/tickets', { params });
      setItems(data.items || []); setTotal(data.total || 0);
      refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, [page, q, priority, type, refreshCounts]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 15000); return () => clearInterval(t); }, []);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'CRM Ticket Helpdesk' }, { label: 'Ticket Diproses' }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Ticket Diproses</h1>
          <p className="text-sm text-muted-foreground mt-1">Ticket yang sedang ditangani troubleshooter. Response &amp; execution time berjalan realtime.</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total diproses</div>
          <div className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'Manrope' }}>{total}</div>
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="diproses-search"
                placeholder="Cari ticket, customer, troubleshooter…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                className="pl-9 h-9"
              />
            </div>
            <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-40 h-9" data-testid="diproses-filter-priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Prioritas</SelectItem>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-44 h-9" data-testid="diproses-filter-type"><SelectValue placeholder="Jenis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Jenis</SelectItem>
                {TICKET_TYPES.map((tt) => <SelectItem key={tt} value={tt}>{TICKET_TYPE_LABEL[tt]}</SelectItem>)}
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
                <Wrench className="w-6 h-6 mx-auto mb-1 opacity-60" />
                Belum ada ticket dalam proses.
              </div>
            )}
            {!loading && items.map((t) => {
              const responseSec = t.processed_at && t.created_at
                ? Math.max(0, Math.floor((new Date(t.processed_at).getTime() - new Date(t.created_at).getTime()) / 1000))
                : null;
              const execSec = t.processed_at ? durationSince(t.processed_at) : null;
              return (
                <div
                  key={t.id}
                  className="border border-border rounded-lg p-3 bg-card active:bg-accent/40 transition-colors cursor-pointer"
                  data-testid={`diproses-card-${t.id}`}
                  onClick={() => nav(`/crm/tickets/${t.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5"><span className="font-mono text-[11px] font-semibold text-foreground">{t.ticket_number}</span><TicketTypeBadge value={t.ticket_type} /></div>
                      <div className="text-sm font-medium mt-0.5 truncate">{t.customer_name || '—'}</div>
                      {t.location && (
                        <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 shrink-0" />{t.location}
                        </div>
                      )}
                    </div>
                    <PriorityBadge value={t.priority} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Response</span>
                      <span className="font-mono tabular-nums">{humanSeconds(responseSec)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Execution</span>
                      <span className="font-mono tabular-nums text-sky-700 dark:text-sky-300">{humanSeconds(execSec)}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{t.troubleshooter_name || '—'}</span>
                    <span className="inline-flex items-center gap-1"><Camera className="w-3 h-3" />{t.progress_evidence_count || 0}</span>
                  </div>
                  <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="flex-1 h-8" onClick={() => nav(`/crm/tickets/${t.id}`)} data-testid={`diproses-mobile-detail-${t.id}`}>
                      <Eye className="w-3.5 h-3.5 mr-1" /> Detail
                    </Button>
                    <Button size="sm" className="flex-1 h-8" onClick={() => nav(`/crm/tickets/${t.id}?tab=progress`)} data-testid={`diproses-mobile-progress-${t.id}`}>
                      <ClipboardCheck className="w-3.5 h-3.5 mr-1" /> Progress
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Ticket</TableHead>
                  <TableHead className="text-xs">Customer / Lokasi</TableHead>
                  <TableHead className="text-xs">Mulai Proses</TableHead>
                  <TableHead className="text-xs">Response</TableHead>
                  <TableHead className="text-xs">Execution</TableHead>
                  <TableHead className="text-xs">Prioritas</TableHead>
                  <TableHead className="text-xs">Troubleshooter</TableHead>
                  <TableHead className="text-xs">Dokumentasi</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={10}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))}
                {!loading && items.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-sm text-muted-foreground">
                    <Wrench className="w-6 h-6 mx-auto mb-1 opacity-60" />
                    Belum ada ticket dalam proses.
                  </TableCell></TableRow>
                )}
                {!loading && items.map((t) => {
                  const responseSec = t.processed_at && t.created_at
                    ? Math.max(0, Math.floor((new Date(t.processed_at).getTime() - new Date(t.created_at).getTime()) / 1000))
                    : null;
                  const execSec = t.processed_at ? durationSince(t.processed_at) : null;
                  return (
                    <TableRow key={t.id} className="hover:bg-accent/40" data-testid={`diproses-row-${t.id}`}>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5"><span className="font-mono font-semibold">{t.ticket_number}</span><TicketTypeBadge value={t.ticket_type} /></div>
                        <div className="text-[10px] text-muted-foreground">{fmtLocal(t.created_at)}</div>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px]">
                        <div className="font-medium truncate">{t.customer_name || '—'}</div>
                        <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                          {t.location && <MapPin className="w-3 h-3 shrink-0" />}{t.location || '—'}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{fmtLocal(t.processed_at)}</TableCell>
                      <TableCell className="text-xs font-mono tabular-nums">{humanSeconds(responseSec)}</TableCell>
                      <TableCell className="text-xs font-mono tabular-nums text-sky-700 dark:text-sky-300">{humanSeconds(execSec)}</TableCell>
                      <TableCell><PriorityBadge value={t.priority} /></TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{t.troubleshooter_name || '—'}</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Camera className="w-3 h-3 text-muted-foreground" />
                          {t.progress_evidence_count || 0}
                        </span>
                      </TableCell>
                      <TableCell><StatusBadge value={t.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => nav(`/crm/tickets/${t.id}`)} data-testid={`diproses-detail-${t.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="sm" onClick={() => nav(`/crm/tickets/${t.id}?tab=progress`)} data-testid={`diproses-progress-${t.id}`}>
                            <ClipboardCheck className="w-4 h-4 mr-1" /> Progress
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>Menampilkan {items.length} dari {total} ticket dalam proses</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="diproses-page-prev">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="tabular-nums">Hal. {page} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid="diproses-page-next">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
