import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  ArrowLeft, PlayCircle, CheckCircle2, Camera, Clock, Trash2, User, Users,
  MapPin, Calendar, MessageSquare, ClipboardCheck, ShieldAlert, Activity,
  History, RotateCcw, AlertOctagon, Download, FileText, ChevronRight, Info,
} from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import { PriorityBadge, StatusBadge, humanSeconds, durationSince, fmtLocal, PRIORITIES, WORK_STAGES } from './helpdeskUtils';
import UploadZone from './components/UploadZone';
import { FileImage, downloadFile } from './components/FileImage';
import Lightbox from './components/Lightbox';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { cn } from '@/lib/utils';

export default function TicketDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { user, hasRole, canWrite } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(sp.get('tab') || 'overview');
  const [users, setUsers] = useState([]);
  const [openProgress, setOpenProgress] = useState(false);
  const [openResolve, setOpenResolve] = useState(false);
  const [openReassign, setOpenReassign] = useState(false);
  const [confirmProcess, setConfirmProcess] = useState(false);
  const [lightboxState, setLightboxState] = useState(null); // { files, index }
  const [nowTick, setNowTick] = useState(0);

  const isSupervisor = hasRole('admin', 'supervisor');
  const isAdmin = hasRole('admin');
  // Reassign is allowed for Administrator OR the current troubleshooter (holder)
  // of THIS ticket. Enforced again server-side.
  const canReassign = isAdmin || (!!user?.id && !!ticket && ticket.troubleshooter_id === user.id);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/crm/tickets/${id}`);
      setTicket(data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { const t = setInterval(() => setNowTick((n) => n + 1), 15000); return () => clearInterval(t); }, []);
  useEffect(() => { if (canReassign) api.get('/crm/technicians').then(({ data }) => setUsers(data || [])).catch(() => {}); }, [canReassign]);

  const changeTab = (v) => { setTab(v); setSp((prev) => { const p = new URLSearchParams(prev); p.set('tab', v); return p; }); };

  const doProcess = async () => {
    try {
      await api.post(`/crm/tickets/${id}/process`);
      toast.success('Ticket masuk ke DIPROSES');
      setConfirmProcess(false); refreshCounts(); reload();
      changeTab('progress');
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const doReassign = async (payload) => {
    try {
      await api.post(`/crm/tickets/${id}/reassign`, payload);
      toast.success('Troubleshooter dialihkan');
      setOpenReassign(false); reload();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const onFilesUploaded = (files) => { reload(); };

  const openLightbox = (files, index) => setLightboxState({ files, index });

  if (loading && !ticket) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
  if (!ticket) return <div className="text-center text-muted-foreground py-10">Ticket tidak ditemukan.</div>;

  const initialFiles = (ticket.files || []).filter((f) => f.evidence_type === 'CUSTOMER_INITIAL_EVIDENCE');
  const progressFiles = (ticket.files || []).filter((f) => f.evidence_type === 'TECHNICIAN_PROGRESS');
  const completionFiles = (ticket.files || []).filter((f) => f.evidence_type === 'COMPLETION_EVIDENCE');
  const otherFiles = (ticket.files || []).filter((f) => f.evidence_type === 'GENERAL_ATTACHMENT');

  const respSec = ticket.processed_at && ticket.created_at
    ? Math.max(0, Math.floor((new Date(ticket.processed_at).getTime() - new Date(ticket.created_at).getTime()) / 1000))
    : null;
  const execSec = ticket.status === 'SELESAI'
    ? ticket.execution_time_seconds
    : (ticket.processed_at ? durationSince(ticket.processed_at) : null);
  const totalSec = ticket.status === 'SELESAI'
    ? ticket.total_handling_seconds
    : durationSince(ticket.created_at);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[
        { label: 'CRM Ticket Helpdesk' },
        { label: 'Detail', to: null },
      ]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => nav(-1)} data-testid="detail-back">
              <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
            </Button>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight font-mono">{ticket.ticket_number}</h1>
            <StatusBadge value={ticket.status} />
            <PriorityBadge value={ticket.priority} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {ticket.customer_name} · {ticket.location || '—'} · dibuat {fmtLocal(ticket.created_at)} oleh {ticket.created_by_name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ticket.status === 'MASUK' && canWrite && (
            <Button onClick={() => setConfirmProcess(true)} data-testid="detail-btn-process">
              <PlayCircle className="w-4 h-4 mr-1.5" /> Proses Ticket
            </Button>
          )}
          {ticket.status === 'DIPROSES' && canWrite && (
            <>
              <Button variant="outline" onClick={() => setOpenProgress(true)} data-testid="detail-btn-add-progress">
                <ClipboardCheck className="w-4 h-4 mr-1.5" /> Tambah Progress
              </Button>
              {canReassign && (
                <Button variant="outline" onClick={() => setOpenReassign(true)} data-testid="detail-btn-reassign">
                  <Users className="w-4 h-4 mr-1.5" /> Alihkan
                </Button>
              )}
              <Button onClick={() => setOpenResolve(true)} data-testid="detail-btn-resolve">
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> Selesaikan
              </Button>
            </>
          )}
          {ticket.status === 'SELESAI' && isSupervisor && (
            <Button variant="outline" onClick={async () => {
              if (!window.confirm('Buka kembali ticket ini?')) return;
              try { await api.post(`/crm/tickets/${id}/reopen`); toast.success('Ticket dibuka kembali'); reload(); } catch (err) { toast.error(formatApiError(err)); }
            }} data-testid="detail-btn-reopen">
              <RotateCcw className="w-4 h-4 mr-1.5" /> Reopen
            </Button>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPI icon={Clock} label="Response Time" value={humanSeconds(respSec)} />
        <KPI icon={Activity} label="Execution Time" value={humanSeconds(execSec)} accent={ticket.status === 'DIPROSES' ? 'sky' : undefined} />
        <KPI icon={Clock} label="Downtime" value={humanSeconds(ticket.downtime_seconds)} />
        <KPI icon={Clock} label="Total Handling" value={humanSeconds(totalSec)} accent={ticket.status === 'SELESAI' ? 'emerald' : undefined} />
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className="w-full sm:w-auto flex flex-wrap justify-start">
          <TabsTrigger value="overview" data-testid="detail-tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="progress" data-testid="detail-tab-progress">Progress ({(ticket.progress || []).length})</TabsTrigger>
          <TabsTrigger value="evidence" data-testid="detail-tab-evidence">Dokumentasi</TabsTrigger>
          <TabsTrigger value="timeline" data-testid="detail-tab-timeline">Timeline</TabsTrigger>
          <TabsTrigger value="audit" data-testid="detail-tab-audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3 mt-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InfoCard title="Informasi Gangguan" icon={AlertOctagon}>
              <InfoRow label="Ticket #" value={<span className="font-mono">{ticket.ticket_number}</span>} />
              <InfoRow label="Customer" value={ticket.customer_name || '—'} />
              <InfoRow label="Lokasi / Site" value={ticket.location || '—'} />
              <InfoRow label="Kategori" value={ticket.category_name || '—'} />
              <InfoRow label="Prioritas" value={<PriorityBadge value={ticket.priority} />} />
              <InfoRow label="Sumber Laporan" value={ticket.report_source} />
              <InfoRow label="Waktu Mulai Gangguan" value={fmtLocal(ticket.outage_started_at)} />
              <InfoRow label="Deskripsi" value={<span className="whitespace-pre-wrap text-sm">{ticket.description || '—'}</span>} vertical />
            </InfoCard>

            <InfoCard title="PIC & Troubleshooter" icon={Users}>
              <InfoRow label="PIC Customer" value={ticket.pic_name || '—'} />
              <InfoRow label="Kontak PIC" value={ticket.pic_contact || '—'} />
              <InfoRow label="Created By" value={`${ticket.created_by_name || '—'} · ${fmtLocal(ticket.created_at)}`} />
              <InfoRow label="Diproses Oleh" value={ticket.processed_by_name ? `${ticket.processed_by_name} · ${fmtLocal(ticket.processed_at)}` : '—'} />
              <InfoRow label="Troubleshooter" value={ticket.troubleshooter_name || '—'} />
              {ticket.resolved_at && (
                <InfoRow label="Selesai Oleh" value={`${ticket.resolved_by_name} · ${fmtLocal(ticket.resolved_at)}`} />
              )}
              {(ticket.reassign_history || []).length > 0 && (
                <div className="pt-2 border-t border-border/50 mt-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Riwayat Pengalihan</div>
                  <ul className="space-y-1 text-xs">
                    {ticket.reassign_history.map((r) => (
                      <li key={r.id} className="flex items-start gap-2">
                        <History className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <div><span className="line-through text-muted-foreground">{r.from_name || '—'}</span> → <span className="font-medium">{r.to_name}</span></div>
                          <div className="text-[10px] text-muted-foreground">{fmtLocal(r.at)} · oleh {r.by_name} {r.reason && `· ${r.reason}`}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </InfoCard>
          </div>

          <AcsSnapshot customerId={ticket.customer_id} />

          {ticket.status === 'SELESAI' && (
            <InfoCard title="Penyelesaian" icon={CheckCircle2}>
              <InfoRow label="Root Cause" value={<span className="whitespace-pre-wrap">{ticket.root_cause || '—'}</span>} vertical />
              <InfoRow label="Tindakan Troubleshooting" value={<span className="whitespace-pre-wrap">{ticket.action_taken || '—'}</span>} vertical />
              <InfoRow label="Solusi Akhir" value={<span className="whitespace-pre-wrap">{ticket.final_solution || '—'}</span>} vertical />
              <InfoRow label="Layanan Normal Kembali" value={fmtLocal(ticket.service_restored_at)} />
              <InfoRow label="Status Akhir Layanan" value={ticket.service_final_status || 'Normal'} />
              <InfoRow label="Catatan Penyelesaian" value={<span className="whitespace-pre-wrap">{ticket.closing_notes || '—'}</span>} vertical />
              {ticket.completion_override && (
                <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                  <div className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
                    <ShieldAlert className="w-3.5 h-3.5" /> Override dokumentasi
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Oleh {ticket.completion_override.by_name} · {fmtLocal(ticket.completion_override.at)}<br />
                    Alasan: {ticket.completion_override.reason}
                  </div>
                </div>
              )}
            </InfoCard>
          )}

          <InfoCard title="Evidence Awal Pelanggan" icon={Camera} extra={
            ticket.initial_evidence_note && <span className="text-xs text-muted-foreground italic">{ticket.initial_evidence_note}</span>
          }>
            <Gallery
              ticketId={id}
              files={initialFiles}
              onOpen={(idx) => openLightbox(initialFiles, idx)}
              onDeleted={reload}
              emptyText="Belum ada evidence awal (opsional)."
              testKey="initial"
            />
            {ticket.status === 'MASUK' && canWrite && (
              <div className="mt-3">
                <UploadZone
                  ticketId={id}
                  evidenceType="CUSTOMER_INITIAL_EVIDENCE"
                  description={ticket.initial_evidence_note}
                  testKey="initial-upload"
                  onUploaded={onFilesUploaded}
                />
              </div>
            )}
          </InfoCard>
        </TabsContent>

        <TabsContent value="progress" className="space-y-3 mt-3">
          <InfoCard title="Progress Pengerjaan Teknisi" icon={ClipboardCheck} extra={
            ticket.status === 'DIPROSES' && canWrite && (
              <Button size="sm" onClick={() => setOpenProgress(true)} data-testid="progress-tab-add">
                <ClipboardCheck className="w-4 h-4 mr-1" /> Tambah Progress
              </Button>
            )
          }>
            {(ticket.progress || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Belum ada progress. Klik tombol "Tambah Progress" untuk memulai.
              </div>
            ) : (
              <ol className="space-y-3">
                {ticket.progress.map((p, i) => {
                  const pFiles = progressFiles.filter((f) => f.progress_id === p.id);
                  return (
                    <li key={p.id} className="relative pl-6">
                      <span className="absolute left-0 top-1 w-4 h-4 rounded-full bg-sky-500/20 border border-sky-500/60 flex items-center justify-center text-[10px] font-bold text-sky-700 dark:text-sky-300">
                        {i + 1}
                      </span>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">{p.user_name}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-mono text-muted-foreground">{fmtLocal(p.at)}</span>
                        <span className="ml-1 px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 text-[10px] font-medium">{p.work_stage}</span>
                      </div>
                      <div className="mt-1 text-sm whitespace-pre-wrap">{p.note}</div>
                      {(p.condition_before || p.action_taken || p.condition_after) && (
                        <div className="mt-1.5 grid grid-cols-1 md:grid-cols-3 gap-1.5 text-[11px]">
                          {p.condition_before && <MiniBox label="Sebelum" value={p.condition_before} />}
                          {p.action_taken && <MiniBox label="Tindakan" value={p.action_taken} />}
                          {p.condition_after && <MiniBox label="Sesudah" value={p.condition_after} />}
                        </div>
                      )}
                      {p.latitude != null && p.longitude != null && (
                        <div className="text-[10px] text-muted-foreground mt-1 inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                        </div>
                      )}
                      {pFiles.length > 0 && (
                        <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                          {pFiles.map((f, fi) => (
                            <FileImage
                              key={f.id}
                              ticketId={id}
                              file={f}
                              className="aspect-square"
                              onClick={() => openLightbox(pFiles, fi)}
                              testId={`progress-file-${p.id}-${fi}`}
                            />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </InfoCard>
        </TabsContent>

        <TabsContent value="evidence" className="space-y-3 mt-3">
          <InfoCard title="Dokumentasi Selesai" icon={CheckCircle2}>
            <Gallery ticketId={id} files={completionFiles} onOpen={(i) => openLightbox(completionFiles, i)} onDeleted={reload} emptyText="Belum ada dokumentasi selesai." testKey="completion" />
          </InfoCard>
          <InfoCard title="Dokumentasi Teknisi (Semua Progress)" icon={Camera}>
            <Gallery ticketId={id} files={progressFiles} onOpen={(i) => openLightbox(progressFiles, i)} onDeleted={reload} emptyText="Belum ada dokumentasi teknisi." testKey="progress" />
          </InfoCard>
          {otherFiles.length > 0 && (
            <InfoCard title="Lampiran Lain" icon={FileText}>
              <Gallery ticketId={id} files={otherFiles} onOpen={(i) => openLightbox(otherFiles, i)} onDeleted={reload} emptyText="—" testKey="other" />
            </InfoCard>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-3">
          <InfoCard title="Timeline Ticket" icon={Activity}>
            <Timeline ticket={ticket} />
          </InfoCard>
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <InfoCard title="Audit Log" icon={Info}>
            <ul className="space-y-1.5 text-xs">
              {(ticket.audit_log || []).map((a) => (
                <li key={a.id} className="grid grid-cols-[100px_1fr] gap-3 pb-1.5 border-b border-border/30 last:border-none">
                  <div className="font-mono text-muted-foreground text-[10px]">{fmtLocal(a.at)}</div>
                  <div>
                    <span className="font-semibold text-primary">{a.action}</span>
                    <span className="text-muted-foreground"> · {a.actor_name || 'system'} ({a.role})</span>
                    {a.meta && Object.keys(a.meta).length > 0 && (
                      <pre className="mt-0.5 text-[10px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 overflow-x-auto">{JSON.stringify(a.meta)}</pre>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </InfoCard>
        </TabsContent>
      </Tabs>

      {/* Sheets */}
      <ProgressSheet
        open={openProgress} onOpenChange={setOpenProgress}
        ticketId={id} onSaved={reload}
      />
      <ResolveSheet
        open={openResolve} onOpenChange={setOpenResolve}
        ticketId={id} ticket={ticket} isSupervisor={isSupervisor}
        onSaved={() => { setOpenResolve(false); refreshCounts(); reload(); }}
      />
      <ReassignSheet
        open={openReassign} onOpenChange={setOpenReassign}
        ticket={ticket} users={users}
        onSaved={doReassign}
      />

      <AlertDialog open={confirmProcess} onOpenChange={setConfirmProcess}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Proses ticket {ticket.ticket_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anda akan menjadi troubleshooter. Waktu mulai proses akan dicatat sekarang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doProcess} data-testid="detail-process-confirm">Ya, Proses</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {lightboxState && (
        <Lightbox
          ticketId={id}
          files={lightboxState.files}
          index={lightboxState.index}
          onClose={() => setLightboxState(null)}
          onChangeIndex={(i) => setLightboxState({ ...lightboxState, index: i })}
        />
      )}
    </div>
  );
}

function KPI({ icon: Icon, label, value, accent }) {
  const cls = accent === 'sky' ? 'text-sky-700 dark:text-sky-300'
    : accent === 'emerald' ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-foreground';
  return (
    <Card className="border-border">
      <CardContent className="p-3 flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className={cn('text-base font-bold font-mono tabular-nums', cls)}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoCard({ title, icon: Icon, children, extra }) {
  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>{title}</div>
          </div>
          {extra}
        </div>
        <div className="space-y-1.5">{children}</div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value, vertical }) {
  if (vertical) return (
    <div className="text-sm">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="text-xs text-muted-foreground min-w-[140px] pt-0.5">{label}</div>
      <div className="flex-1">{value}</div>
    </div>
  );
}

function MiniBox({ label, value }) {
  return (
    <div className="rounded border border-border/60 bg-muted/30 p-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className="whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function Gallery({ ticketId, files, onOpen, onDeleted, emptyText, testKey }) {
  const { user, hasRole } = useAuth();
  const isSupervisor = hasRole('admin', 'supervisor');
  if (!files || files.length === 0) return <div className="text-sm text-muted-foreground italic">{emptyText}</div>;
  const delFile = async (f) => {
    if (!window.confirm(`Hapus ${f.original_file_name}?`)) return;
    try { await api.delete(`/crm/tickets/${ticketId}/files/${f.id}`); toast.success('File dihapus'); onDeleted?.(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
      {files.map((f, i) => (
        <div key={f.id} className="relative group">
          <FileImage
            ticketId={ticketId}
            file={f}
            className="aspect-square w-full"
            onClick={() => onOpen(i)}
            testId={`${testKey}-file-${i}`}
          />
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {f.description || f.work_stage || fmtLocal(f.uploaded_at).slice(0, 10)}
          </div>
          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="w-6 h-6 rounded bg-black/60 text-white flex items-center justify-center hover:bg-black" onClick={() => downloadFile(ticketId, f)}>
              <Download className="w-3 h-3" />
            </button>
            {(isSupervisor || f.uploaded_by_id === user?.id) && (
              <button className="w-6 h-6 rounded bg-rose-600 text-white flex items-center justify-center hover:bg-rose-700" onClick={() => delFile(f)}>
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ ticket }) {
  const events = [];
  if (ticket.created_at) events.push({ at: ticket.created_at, title: 'Ticket dibuat', who: ticket.created_by_name, icon: MessageSquare, color: 'rose' });
  (ticket.files || []).filter((f) => f.evidence_type === 'CUSTOMER_INITIAL_EVIDENCE').forEach((f) => {
    events.push({ at: f.uploaded_at, title: 'Evidence awal ditambahkan', who: f.uploaded_by_name, icon: Camera, color: 'rose', note: f.original_file_name });
  });
  if (ticket.processed_at) events.push({ at: ticket.processed_at, title: 'Ticket mulai diproses', who: ticket.processed_by_name, icon: PlayCircle, color: 'sky' });
  (ticket.progress || []).forEach((p) => {
    events.push({ at: p.at, title: `Progress: ${p.work_stage}`, who: p.user_name, icon: ClipboardCheck, color: 'sky', note: p.note });
  });
  (ticket.reassign_history || []).forEach((r) => {
    events.push({ at: r.at, title: 'Troubleshooter dialihkan', who: r.by_name, icon: Users, color: 'violet', note: `${r.from_name || '—'} → ${r.to_name}${r.reason ? ` · Alasan: ${r.reason}` : ''}` });
  });
  if (ticket.service_restored_at) events.push({ at: ticket.service_restored_at, title: 'Layanan kembali normal', who: '—', icon: CheckCircle2, color: 'emerald' });
  (ticket.files || []).filter((f) => f.evidence_type === 'COMPLETION_EVIDENCE').forEach((f) => {
    events.push({ at: f.uploaded_at, title: 'Dokumentasi selesai diunggah', who: f.uploaded_by_name, icon: Camera, color: 'emerald', note: f.original_file_name });
  });
  if (ticket.resolved_at) events.push({ at: ticket.resolved_at, title: 'Ticket diselesaikan', who: ticket.resolved_by_name, icon: CheckCircle2, color: 'emerald' });
  events.sort((a, b) => new Date(a.at) - new Date(b.at));

  const colorMap = {
    rose: 'bg-rose-500/20 border-rose-500 text-rose-700 dark:text-rose-300',
    sky: 'bg-sky-500/20 border-sky-500 text-sky-700 dark:text-sky-300',
    emerald: 'bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300',
    violet: 'bg-violet-500/20 border-violet-500 text-violet-700 dark:text-violet-300',
  };
  return (
    <ol className="relative border-l-2 border-border ml-2 pl-4 space-y-3">
      {events.map((e, i) => {
        const Icon = e.icon || Activity;
        return (
          <li key={i} className="relative">
            <span className={cn('absolute -left-[26px] top-0 w-5 h-5 rounded-full border-2 flex items-center justify-center', colorMap[e.color])}>
              <Icon className="w-2.5 h-2.5" />
            </span>
            <div className="text-sm font-medium">{e.title}</div>
            <div className="text-[11px] text-muted-foreground font-mono">{fmtLocal(e.at)} · {e.who}</div>
            {e.note && <div className="text-xs mt-0.5 whitespace-pre-wrap">{e.note}</div>}
          </li>
        );
      })}
    </ol>
  );
}

function ProgressSheet({ open, onOpenChange, ticketId, onSaved }) {
  const [form, setForm] = useState({ note: '', work_stage: 'Pengerjaan', condition_before: '', action_taken: '', condition_after: '' });
  const [saving, setSaving] = useState(false);
  const [uploadedIds, setUploadedIds] = useState([]);
  const [gps, setGps] = useState(null);

  useEffect(() => {
    if (!open) { setForm({ note: '', work_stage: 'Pengerjaan', condition_before: '', action_taken: '', condition_after: '' }); setUploadedIds([]); setGps(null); }
  }, [open]);

  const submit = async () => {
    if (!form.note.trim()) return toast.error('Catatan progress wajib diisi');
    setSaving(true);
    try {
      await api.post(`/crm/tickets/${ticketId}/progress`, { ...form, latitude: gps?.lat, longitude: gps?.lng, file_ids: uploadedIds });
      toast.success('Progress ditambahkan');
      onOpenChange(false); onSaved?.();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="progress-sheet">
        <SheetHeader>
          <SheetTitle>Tambah Progress Pengerjaan</SheetTitle>
          <SheetDescription>Catat perkembangan troubleshooting. Foto dapat diunggah dulu, lalu tersimpan bersama progress.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 mt-4">
          <F label="Tahap Pekerjaan">
            <Select value={form.work_stage} onValueChange={(v) => setForm({ ...form, work_stage: v })}>
              <SelectTrigger data-testid="progress-stage"><SelectValue /></SelectTrigger>
              <SelectContent>{WORK_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Catatan Progress *">
            <Textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Contoh: cek link A ke B, terdeteksi loss 20% di segment X…" data-testid="progress-note" />
          </F>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <F label="Kondisi Sebelum"><Textarea rows={2} value={form.condition_before} onChange={(e) => setForm({ ...form, condition_before: e.target.value })} placeholder="mis. RX -30 dBm" /></F>
            <F label="Tindakan"><Textarea rows={2} value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} placeholder="mis. cleaning konektor" /></F>
            <F label="Kondisi Sesudah"><Textarea rows={2} value={form.condition_after} onChange={(e) => setForm({ ...form, condition_after: e.target.value })} placeholder="mis. RX -12 dBm" /></F>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Foto Dokumentasi</div>
            <UploadZone
              ticketId={ticketId}
              evidenceType="GENERAL_ATTACHMENT"
              workStage={form.work_stage}
              testKey="progress-upload"
              onUploaded={(items) => setUploadedIds((prev) => [...prev, ...items.map((x) => x.id)])}
            />
            {uploadedIds.length > 0 && <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5">{uploadedIds.length} file akan dilampirkan ke progress ini</div>}
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            if (!navigator.geolocation) return toast.error('GPS tidak tersedia');
            navigator.geolocation.getCurrentPosition(
              (p) => { setGps({ lat: p.coords.latitude, lng: p.coords.longitude }); toast.success('Lokasi ditambahkan'); },
              () => toast.error('Gagal ambil lokasi'),
            );
          }} data-testid="progress-gps">
            <MapPin className="w-4 h-4 mr-1.5" /> {gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'Tambahkan lokasi GPS'}
          </Button>
        </div>
        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving} data-testid="progress-submit">{saving ? 'Menyimpan…' : 'Simpan Progress'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ResolveSheet({ open, onOpenChange, ticketId, ticket, isSupervisor, onSaved }) {
  const [form, setForm] = useState({
    root_cause: '', action_taken: '', final_solution: '',
    service_restored_at: '', service_final_status: 'Normal', closing_notes: '',
    override_reason: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploadedIds, setUploadedIds] = useState([]);
  const [category, setCategory] = useState(null);

  useEffect(() => {
    if (!open) {
      setForm({ root_cause: '', action_taken: '', final_solution: '', service_restored_at: '', service_final_status: 'Normal', closing_notes: '', override_reason: '' });
      setUploadedIds([]);
      return;
    }
    // Prefill from ticket
    setForm((f) => ({
      ...f,
      root_cause: ticket.root_cause || '',
      action_taken: ticket.action_taken || '',
    }));
    if (ticket.category_id) {
      api.get('/crm/categories').then(({ data }) => {
        const c = (Array.isArray(data) ? data : []).find((x) => x.id === ticket.category_id);
        setCategory(c || null);
      }).catch(() => {});
    } else {
      setCategory(null);
    }
  }, [open, ticket]);

  const requiresEvidence = category ? category.requires_completion_evidence !== false : true;
  const existingCompletion = (ticket.files || []).filter((f) => f.evidence_type === 'COMPLETION_EVIDENCE').length;
  const totalEvidence = existingCompletion + uploadedIds.length;
  const needOverride = requiresEvidence && totalEvidence === 0;

  const submit = async () => {
    if (!form.root_cause.trim()) return toast.error('Root cause wajib diisi');
    if (!form.action_taken.trim()) return toast.error('Tindakan troubleshooting wajib diisi');
    if (!form.final_solution.trim()) return toast.error('Solusi akhir wajib diisi');
    if (needOverride && !isSupervisor) return toast.error('Minimal 1 dokumentasi selesai wajib atau minta supervisor untuk override');
    if (needOverride && (!form.override_reason || form.override_reason.trim().length < 3)) return toast.error('Alasan override wajib diisi');
    setSaving(true);
    try {
      await api.post(`/crm/tickets/${ticketId}/resolve`, {
        ...form,
        service_restored_at: form.service_restored_at ? new Date(form.service_restored_at).toISOString() : null,
        completion_file_ids: uploadedIds,
        override_reason: needOverride ? form.override_reason : null,
      });
      toast.success('Ticket diselesaikan');
      onSaved?.();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="resolve-sheet">
        <SheetHeader>
          <SheetTitle>Selesaikan Ticket</SheetTitle>
          <SheetDescription>Isi root cause, tindakan, dan solusi. Waktu penyelesaian dicatat oleh server.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <F label="Root Cause *" full>
            <Textarea rows={2} value={form.root_cause} onChange={(e) => setForm({ ...form, root_cause: e.target.value })} placeholder="Penyebab utama gangguan" data-testid="resolve-root-cause" />
          </F>
          <F label="Tindakan Troubleshooting *" full>
            <Textarea rows={2} value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} placeholder="Langkah-langkah yang dilakukan" data-testid="resolve-action" />
          </F>
          <F label="Solusi Akhir *" full>
            <Textarea rows={2} value={form.final_solution} onChange={(e) => setForm({ ...form, final_solution: e.target.value })} placeholder="Solusi definitif yang diterapkan" data-testid="resolve-solution" />
          </F>
          <F label="Waktu Layanan Kembali Normal">
            <Input type="datetime-local" value={form.service_restored_at} onChange={(e) => setForm({ ...form, service_restored_at: e.target.value })} data-testid="resolve-restore-time" />
          </F>
          <F label="Status Akhir Layanan">
            <Select value={form.service_final_status} onValueChange={(v) => setForm({ ...form, service_final_status: v })}>
              <SelectTrigger data-testid="resolve-service-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Normal">Normal</SelectItem>
                <SelectItem value="Degraded">Degraded</SelectItem>
                <SelectItem value="Workaround">Workaround</SelectItem>
              </SelectContent>
            </Select>
          </F>
          <F label="Catatan Penyelesaian" full>
            <Textarea rows={2} value={form.closing_notes} onChange={(e) => setForm({ ...form, closing_notes: e.target.value })} placeholder="Catatan tambahan (opsional)" />
          </F>
        </div>

        <div className="mt-4">
          <div className="text-sm font-semibold mb-1.5" style={{ fontFamily: 'Manrope' }}>Dokumentasi Selesai</div>
          <div className="text-xs text-muted-foreground mb-2">
            {requiresEvidence
              ? `Kategori "${ticket.category_name || 'default'}" mewajibkan minimal 1 dokumentasi.`
              : `Kategori "${ticket.category_name}" tidak mewajibkan dokumentasi selesai.`}
            {' '}Existing: <span className="font-semibold">{existingCompletion}</span>, akan ditambah: <span className="font-semibold">{uploadedIds.length}</span>.
          </div>
          <UploadZone
            ticketId={ticketId}
            evidenceType="COMPLETION_EVIDENCE"
            testKey="resolve-upload"
            onUploaded={(items) => setUploadedIds((prev) => [...prev, ...items.map((x) => x.id)])}
          />
        </div>

        {needOverride && (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> Override Dokumentasi Wajib</div>
            <p className="text-xs text-muted-foreground mt-1">
              {isSupervisor
                ? 'Sebagai supervisor/admin Anda dapat menyelesaikan tanpa dokumentasi. Wajib isi alasan.'
                : 'Anda BUKAN supervisor. Minta supervisor untuk melakukan resolve, atau unggah minimal 1 dokumentasi selesai di atas.'}
            </p>
            {isSupervisor && (
              <Textarea
                rows={2} className="mt-2"
                value={form.override_reason} onChange={(e) => setForm({ ...form, override_reason: e.target.value })}
                placeholder="Alasan override (min. 3 karakter)"
                data-testid="resolve-override-reason"
              />
            )}
          </div>
        )}
        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving} data-testid="resolve-submit">{saving ? 'Menyimpan…' : 'Selesaikan Ticket'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const REASSIGN_ROLE_LABEL = { engineer: 'NOC Engineer', teknisi: 'Teknisi Lapangan' };

function ReassignSheet({ open, onOpenChange, ticket, users, onSaved }) {
  const [uid, setUid] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (!open) { setUid(''); setReason(''); } }, [open]);
  const submit = () => {
    const u = users.find((x) => x.id === uid);
    if (!u) return toast.error('Pilih troubleshooter baru');
    onSaved?.({ new_troubleshooter_id: u.id, new_troubleshooter_name: u.name, reason });
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md" data-testid="reassign-sheet">
        <SheetHeader>
          <SheetTitle>Alihkan Troubleshooter</SheetTitle>
          <SheetDescription>Riwayat pengalihan tetap tersimpan pada audit log.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <F label="Troubleshooter Sebelumnya">
            <Input value={ticket.troubleshooter_name || '—'} disabled />
          </F>
          <F label="Troubleshooter Baru *">
            <Select value={uid} onValueChange={setUid}>
              <SelectTrigger data-testid="reassign-user"><SelectValue placeholder="Pilih user" /></SelectTrigger>
              <SelectContent>
                {users.filter((u) => u.active !== false && ['engineer', 'teknisi'].includes(u.role) && u.id !== ticket.troubleshooter_id).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name} · {REASSIGN_ROLE_LABEL[u.role] || u.role}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Alasan">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan pengalihan (opsional tapi disarankan)" data-testid="reassign-reason" />
          </F>
        </div>
        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} data-testid="reassign-submit">Alihkan</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function F({ label, full, children }) {
  return (
    <div className={full ? 'md:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ACS Snapshot — non-intrusive troubleshooting aid, only renders when a mapped
// GenieACS device is found for this ticket's customer.
function AcsSnapshot({ customerId }) {
  const [snap, setSnap] = useState(null);
  useEffect(() => {
    let on = true;
    if (!customerId) { setSnap(null); return; }
    api.get('/genieacs/snapshot', { params: { customer_id: customerId } })
      .then(({ data }) => { if (on) setSnap(data); })
      .catch(() => { if (on) setSnap(null); });
    return () => { on = false; };
  }, [customerId]);
  if (!snap || !snap.matched) return null;
  const statusCls = snap.status === 'Online' ? 'text-emerald-500' : snap.status === 'Warning' ? 'text-amber-500' : snap.status === 'Offline' ? 'text-rose-500' : 'text-muted-foreground';
  return (
    <InfoCard title="ACS Monitoring (GenieACS)" icon={Activity} extra={<span className={cn('text-xs font-semibold', statusCls)}>{snap.status}</span>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm">
        <MiniKV k="Cluster" v={snap.cluster ? snap.cluster.toLowerCase().replace(/(^|[\s\-_/])([a-z0-9])/g, (m, s, c) => s + c.toUpperCase()) : null} />
        <MiniKV k="Model" v={snap.model} />
        <MiniKV k="Serial" v={snap.serial} mono />
        <MiniKV k="WAN IP" v={snap.wan_ip} mono />
        <MiniKV k="RX Optical" v={snap.rx_optical != null ? `${snap.rx_optical.toFixed(1)} dBm` : '—'} />
        <MiniKV k="WiFi Client" v={snap.wifi_clients ?? 0} />
        <MiniKV k="Last Inform" v={snap.last_inform ? fmtLocal(snap.last_inform) : '—'} />
        <MiniKV k="Active Fault" v={snap.active_fault ? 'YA' : 'Tidak'} highlight={snap.active_fault} />
      </div>
    </InfoCard>
  );
}
function MiniKV({ k, v, mono, highlight }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{k}</div>
      <div className={cn('mt-0.5', mono && 'font-mono', highlight && 'text-rose-500 font-semibold')}>{v ?? '—'}</div>
    </div>
  );
}
