import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  Search, ChevronLeft, ChevronRight, Eye, Edit, Copy, CheckCircle2, RotateCcw,
  Trash2, Plus, Download, Printer, FileSpreadsheet, ClipboardList, AlertTriangle,
} from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import {
  SHIFT_CODES, SHIFT_HOURS, HANDOVER_STATUSES, CASE_STATUSES, PRIORITIES,
  HandoverStatusBadge, CaseStatusBadge, CasePriorityBadge, fmtDate, fmtDateTime,
} from './handoverUtils';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';

const PAGE_SIZE = 15;

export default function DataShiftHandover() {
  const nav = useNavigate();
  const { hasRole, isAdmin } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const isSupervisor = hasRole('admin', 'supervisor');

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    q: '', shift_code: 'all', status: 'all', case_status: 'all', priority: 'all',
    date_from: '', date_to: '',
  });
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [workerFilter, setWorkerFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: PAGE_SIZE };
      if (filters.q) params.q = filters.q;
      if (filters.shift_code !== 'all') params.shift_code = filters.shift_code;
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.case_status !== 'all') params.case_status = filters.case_status;
      if (filters.priority !== 'all') params.priority = filters.priority;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (workerFilter !== 'all') params.worker_id = workerFilter;
      const { data } = await api.get('/ops/handovers', { params });
      setItems(data.items || []); setTotal(data.total || 0);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, [page, filters, workerFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/ops/handovers/stats').then(({ data }) => setStats(data)).catch(() => {});
    api.get('/crm/technicians').then(({ data }) => setTechnicians(data || [])).catch(() => {});
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const del = async (h) => {
    if (!window.confirm(`Hapus handover ${h.handover_number}? Aksi ini tidak dapat dibatalkan.`)) return;
    try { await api.delete(`/ops/handovers/${h.id}`); toast.success('Handover dihapus'); refreshCounts(); load(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const duplicate = async (h) => {
    // Cast to new draft with same cases (no attachments)
    try {
      const payload = {
        handover_date: h.handover_date,
        shift_code: h.shift_code,
        receiver_id: null, receiver_name: '',
        general_notes: (h.general_notes || '') + ' (duplicated)',
        cases: (h.cases || []).map((c) => ({
          customer_id: c.customer_id || null, customer_name: c.customer_name || '',
          location: c.location || '', category: c.category || '',
          ticket_id: c.ticket_id || null, ticket_number: c.ticket_number || null,
          case_detail: c.case_detail || '', action_taken: c.action_taken || '',
          current_condition: c.current_condition || '', next_action: c.next_action || '',
          assigned_pic: c.assigned_pic || '', priority: c.priority || 'Medium',
          status: c.status || 'Open',
          follow_up_at: c.follow_up_at || null,
          previous_case_id: null, carry_over_count: 0,
          attachment_ids: [],
        })),
      };
      const { data } = await api.post('/ops/handovers', payload);
      toast.success(`Draft ${data.handover_number} dibuat dari duplikasi`);
      nav(`/operations/shift-handover/edit/${data.id}`);
    } catch (err) { toast.error(formatApiError(err)); }
  };

  // ---- Export helpers ----
  const rowsForExport = useMemo(() => items.map((h) => ({
    Nomor: h.handover_number,
    Tanggal: h.handover_date,
    Shift: h.shift_code,
    Petugas: h.worker_name,
    Penerima: h.receiver_name || '',
    Case: h.total_cases,
    Open: h.open_cases,
    Critical: h.critical_cases,
    Status: h.status,
    'Submitted At': h.submitted_at || '',
  })), [items]);

  const exportCSV = () => {
    if (!rowsForExport.length) return toast.info('Tidak ada data');
    const header = Object.keys(rowsForExport[0]);
    const csv = [
      header.join(','),
      ...rowsForExport.map((r) => header.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `handovers-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  const exportExcel = () => {
    // Simple .xls (HTML table wrapped) — opens cleanly in Excel
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${Object.keys(rowsForExport[0] || {}).map((k) => `<th>${k}</th>`).join('')}</tr></thead><tbody>${rowsForExport.map((r) => `<tr>${Object.values(r).map((v) => `<td>${String(v ?? '').replace(/</g, '&lt;')}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    downloadBlob(new Blob([html], { type: 'application/vnd.ms-excel' }), `handovers-${new Date().toISOString().slice(0, 10)}.xls`);
  };
  const exportPDF = () => window.print();

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Operasional NOC' }, { label: 'Data Shift Handover' }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Data Shift Handover NOC</h1>
          <p className="text-sm text-muted-foreground mt-1">Rekap serah terima shift beserta case dan handover status.</p>
        </div>
        <Button onClick={() => nav('/operations/shift-handover/new')} data-testid="data-handover-create">
          <Plus className="w-4 h-4 mr-1.5" /> Buat Handover
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 print:hidden">
        <StatCard label="Hari ini" value={stats?.today} />
        <StatCard label="Belum Diterima" value={stats?.pending_accept} tone="amber" />
        <StatCard label="Open Case" value={stats?.open_cases} tone="rose" />
        <StatCard label="Critical Open" value={stats?.critical_open} tone="rose" />
        <StatCard label="Waiting Vendor" value={stats?.waiting_vendor} tone="amber" />
        <StatCard label="Carry Over ≥ 2" value={stats?.long_carry_over} tone="amber" />
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-2 print:hidden">
            <div className="lg:col-span-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9 h-9" placeholder="Cari nomor, petugas, ticket…" value={filters.q}
                  onChange={(e) => { setFilters({ ...filters, q: e.target.value }); setPage(1); }}
                  data-testid="data-search"
                />
              </div>
            </div>
            <Select value={filters.shift_code} onValueChange={(v) => { setFilters({ ...filters, shift_code: v }); setPage(1); }}>
              <SelectTrigger className="h-9" data-testid="data-filter-shift"><SelectValue placeholder="Shift" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua Shift</SelectItem>{SHIFT_CODES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => { setFilters({ ...filters, status: v }); setPage(1); }}>
              <SelectTrigger className="h-9" data-testid="data-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua Status</SelectItem>{HANDOVER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={workerFilter} onValueChange={(v) => { setWorkerFilter(v); setPage(1); }}>
              <SelectTrigger className="h-9" data-testid="data-filter-worker"><SelectValue placeholder="Petugas" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua Petugas</SelectItem>{technicians.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.case_status} onValueChange={(v) => { setFilters({ ...filters, case_status: v }); setPage(1); }}>
              <SelectTrigger className="h-9" data-testid="data-filter-case-status"><SelectValue placeholder="Status Case" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua Case</SelectItem>{CASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="date" className="h-9" value={filters.date_from} onChange={(e) => { setFilters({ ...filters, date_from: e.target.value }); setPage(1); }} data-testid="data-filter-from" />
            <Input type="date" className="h-9" value={filters.date_to} onChange={(e) => { setFilters({ ...filters, date_to: e.target.value }); setPage(1); }} data-testid="data-filter-to" />
            <Select value={filters.priority} onValueChange={(v) => { setFilters({ ...filters, priority: v }); setPage(1); }}>
              <SelectTrigger className="h-9" data-testid="data-filter-priority"><SelectValue placeholder="Prioritas" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua Prioritas</SelectItem>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {/* Export bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <div className="text-xs text-muted-foreground">Menampilkan {items.length} dari {total} handover</div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={exportCSV} data-testid="export-csv"><Download className="w-3.5 h-3.5 mr-1" /> CSV</Button>
              <Button size="sm" variant="outline" onClick={exportExcel} data-testid="export-excel"><FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Excel</Button>
              <Button size="sm" variant="outline" onClick={exportPDF} data-testid="export-print"><Printer className="w-3.5 h-3.5 mr-1" /> Print / PDF</Button>
            </div>
          </div>

          {/* Table (desktop) */}
          <div className="hidden md:block border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Handover</TableHead>
                  <TableHead className="text-xs">Tanggal</TableHead>
                  <TableHead className="text-xs">Shift</TableHead>
                  <TableHead className="text-xs">Petugas</TableHead>
                  <TableHead className="text-xs">Penerima</TableHead>
                  <TableHead className="text-xs text-right">Case</TableHead>
                  <TableHead className="text-xs text-right">Open</TableHead>
                  <TableHead className="text-xs text-right">Critical</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Submit</TableHead>
                  <TableHead className="text-xs text-right print:hidden">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={11}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))}
                {!loading && items.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center py-10 text-sm text-muted-foreground">
                    <ClipboardList className="w-6 h-6 mx-auto mb-1 opacity-60" />
                    Belum ada data handover.
                  </TableCell></TableRow>
                )}
                {!loading && items.map((h) => (
                  <TableRow key={h.id} className="hover:bg-accent/40" data-testid={`data-row-${h.id}`}>
                    <TableCell className="text-xs">
                      <div className="font-mono font-semibold">{h.handover_number}</div>
                      <div className="text-[10px] text-muted-foreground">{fmtDateTime(h.created_at)}</div>
                    </TableCell>
                    <TableCell className="text-xs">{fmtDate(h.handover_date)}</TableCell>
                    <TableCell className="text-xs font-mono">{h.shift_code}<div className="text-[10px] text-muted-foreground">{h.shift_start}-{h.shift_end}</div></TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">{h.worker_name}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">{h.receiver_name || '—'}</TableCell>
                    <TableCell className="text-xs text-right font-mono tabular-nums">{h.total_cases}</TableCell>
                    <TableCell className="text-xs text-right font-mono tabular-nums">{h.open_cases || 0}</TableCell>
                    <TableCell className="text-xs text-right font-mono tabular-nums">
                      {h.critical_cases > 0 ? (
                        <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
                          <AlertTriangle className="w-3 h-3" /> {h.critical_cases}
                        </span>
                      ) : (h.critical_cases || 0)}
                    </TableCell>
                    <TableCell><HandoverStatusBadge value={h.status} /></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{fmtDateTime(h.submitted_at)}</TableCell>
                    <TableCell className="text-right print:hidden">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => nav(`/operations/shift-handover/${h.id}`)} data-testid={`data-view-${h.id}`}><Eye className="w-4 h-4" /></Button>
                        {['Draft', 'Returned'].includes(h.status) || isSupervisor ? (
                          <Button size="sm" variant="ghost" onClick={() => nav(`/operations/shift-handover/edit/${h.id}`)} data-testid={`data-edit-${h.id}`}><Edit className="w-4 h-4" /></Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => duplicate(h)} data-testid={`data-duplicate-${h.id}`}><Copy className="w-4 h-4" /></Button>
                        {isAdmin && (
                          <Button size="sm" variant="ghost" onClick={() => del(h)} data-testid={`data-delete-${h.id}`}><Trash2 className="w-4 h-4" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Card list (mobile) */}
          <ul className="md:hidden space-y-2">
            {loading && Array.from({ length: 3 }).map((_, i) => <li key={i}><Skeleton className="h-24 w-full" /></li>)}
            {!loading && items.map((h) => (
              <li key={h.id} className="border border-border rounded-md p-3 space-y-1.5" data-testid={`data-mobile-${h.id}`} onClick={() => nav(`/operations/shift-handover/${h.id}`)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono font-semibold text-sm">{h.handover_number}</div>
                  <HandoverStatusBadge value={h.status} />
                </div>
                <div className="text-xs text-muted-foreground">{fmtDate(h.handover_date)} · Shift {h.shift_code}</div>
                <div className="text-xs">{h.worker_name} → {h.receiver_name || 'belum ditentukan'}</div>
                <div className="flex flex-wrap gap-2 text-[11px] font-mono text-muted-foreground">
                  <span>{h.total_cases} case</span><span>·</span>
                  <span>{h.open_cases || 0} open</span>
                  {h.critical_cases > 0 && <><span>·</span><span className="text-rose-700 dark:text-rose-300 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{h.critical_cases} critical</span></>}
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          <div className="flex items-center justify-end gap-2 text-xs print:hidden">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="data-page-prev"><ChevronLeft className="w-4 h-4" /></Button>
            <span className="tabular-nums">Hal. {page} / {pageCount}</span>
            <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} data-testid="data-page-next"><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-700 dark:text-slate-300',
    rose: 'text-rose-700 dark:text-rose-300',
    sky: 'text-sky-700 dark:text-sky-300',
    amber: 'text-amber-700 dark:text-amber-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
  };
  return (
    <Card className="border-border"><CardContent className="p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${tones[tone] || tones.slate}`} style={{ fontFamily: 'Manrope' }}>{value ?? 0}</div>
    </CardContent></Card>
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
