import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Eye, PlayCircle, Camera, Inbox, MapPin } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import { PriorityBadge, StatusBadge, TicketTypeBadge, PRIORITIES, REPORT_SOURCES, TICKET_TYPES, TICKET_TYPE_LABEL, humanSeconds, durationSince, fmtLocal } from './helpdeskUtils';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';

const PAGE_SIZE = 15;

export default function TicketMasuk() {
  const { canWrite } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('all');
  const [source, setSource] = useState('all');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [nowTick, setNowTick] = useState(0);
  const [confirmProcess, setConfirmProcess] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: 'MASUK', page, page_size: PAGE_SIZE };
      if (q) params.q = q;
      if (priority !== 'all') params.priority = priority;
      if (type !== 'all') params.ticket_type = type;
      const { data } = await api.get('/crm/tickets', { params });
      let list = data.items || [];
      if (source !== 'all') list = list.filter((t) => t.report_source === source);
      setItems(list); setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, [page, q, priority, source, type]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const process = async (t) => {
    try {
      await api.post(`/crm/tickets/${t.id}/process`);
      toast.success(`${t.ticket_number} diproses`);
      setConfirmProcess(null);
      refreshCounts();
      nav(`/crm/diproses`);
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'CRM Ticket Helpdesk' }, { label: 'Ticket Masuk' }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Ticket Masuk</h1>
          <p className="text-sm text-muted-foreground mt-1">Ticket baru yang menunggu untuk diproses oleh troubleshooter.</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total masuk</div>
          <div className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'Manrope' }}>{total}</div>
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="masuk-search"
                placeholder="Cari ticket, customer, lokasi, kategori…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                className="pl-9 h-9"
              />
            </div>
            <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-40 h-9" data-testid="masuk-filter-priority"><SelectValue placeholder="Prioritas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Prioritas</SelectItem>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-44 h-9" data-testid="masuk-filter-type"><SelectValue placeholder="Jenis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Jenis</SelectItem>
                {TICKET_TYPES.map((tt) => <SelectItem key={tt} value={tt}>{TICKET_TYPE_LABEL[tt]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-40 h-9" data-testid="masuk-filter-source"><SelectValue placeholder="Sumber" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Sumber</SelectItem>
                {REPORT_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                <Inbox className="w-6 h-6 mx-auto mb-1 opacity-60" />
                Belum ada ticket masuk.
              </div>
            )}
            {!loading && items.map((t) => {
              const dur = durationSince(t.created_at);
              return (
                <div
                  key={t.id}
                  className="border border-border rounded-lg p-3 bg-card active:bg-accent/40 transition-colors cursor-pointer"
                  data-testid={`masuk-card-${t.id}`}
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
                  <div className="mt-2 flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Camera className="w-3 h-3" />{t.initial_evidence_count || 0}</span>
                    <span className="font-mono tabular-nums">{humanSeconds(dur)}</span>
                    <span className="truncate">{t.report_source}</span>
                    {t.category_name && <span className="truncate">· {t.category_name}</span>}
                  </div>
                  {canWrite && (
                    <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" className="flex-1 h-8" onClick={() => nav(`/crm/tickets/${t.id}`)} data-testid={`masuk-mobile-detail-${t.id}`}>
                        <Eye className="w-3.5 h-3.5 mr-1" /> Detail
                      </Button>
                      <Button size="sm" className="flex-1 h-8" onClick={() => setConfirmProcess(t)} data-testid={`masuk-mobile-process-${t.id}`}>
                        <PlayCircle className="w-3.5 h-3.5 mr-1" /> Proses
                      </Button>
                    </div>
                  )}
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
                  <TableHead className="text-xs">Kategori</TableHead>
                  <TableHead className="text-xs">Prioritas</TableHead>
                  <TableHead className="text-xs">Sumber</TableHead>
                  <TableHead className="text-xs">Evidence</TableHead>
                  <TableHead className="text-xs">Durasi</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))}
                {!loading && items.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-sm text-muted-foreground">
                    <Inbox className="w-6 h-6 mx-auto mb-1 opacity-60" />
                    Belum ada ticket masuk.
                  </TableCell></TableRow>
                )}
                {!loading && items.map((t) => {
                  const dur = durationSince(t.created_at);
                  return (
                    <TableRow key={t.id} className="hover:bg-accent/40" data-testid={`masuk-row-${t.id}`}>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5"><span className="font-mono font-semibold">{t.ticket_number}</span><TicketTypeBadge value={t.ticket_type} /></div>
                        <div className="text-[10px] text-muted-foreground">{fmtLocal(t.created_at)}</div>
                      </TableCell>
                      <TableCell className="text-sm max-w-[220px]">
                        <div className="font-medium truncate">{t.customer_name || '—'}</div>
                        <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                          {t.location && <MapPin className="w-3 h-3 shrink-0" />}
                          {t.location || '—'}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{t.category_name || '—'}</TableCell>
                      <TableCell><PriorityBadge value={t.priority} /></TableCell>
                      <TableCell className="text-xs">{t.report_source}</TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Camera className="w-3 h-3 text-muted-foreground" />
                          {t.initial_evidence_count || 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-mono tabular-nums">{humanSeconds(dur)}</TableCell>
                      <TableCell><StatusBadge value={t.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => nav(`/crm/tickets/${t.id}`)} data-testid={`masuk-detail-${t.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canWrite && (
                            <Button size="sm" onClick={() => setConfirmProcess(t)} data-testid={`masuk-process-${t.id}`}>
                              <PlayCircle className="w-4 h-4 mr-1" /> Proses
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

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>Menampilkan {items.length} dari {total} ticket masuk</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="masuk-page-prev">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="tabular-nums">Hal. {page} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid="masuk-page-next">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmProcess} onOpenChange={(o) => !o && setConfirmProcess(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Proses ticket {confirmProcess?.ticket_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anda akan menjadi troubleshooter untuk ticket ini. Waktu mulai proses akan dicatat oleh server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => process(confirmProcess)} data-testid="masuk-process-confirm">Mulai Proses</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
