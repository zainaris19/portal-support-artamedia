import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, CheckCircle2, RotateCcw, Edit, Copy, Printer, Layers,
  Info, Ticket, MapPin, Camera, User, Clock, ShieldCheck, ClipboardList,
  ExternalLink, FileText,
} from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import {
  SHIFT_HOURS, HandoverStatusBadge, CaseStatusBadge, CasePriorityBadge, CarryOverBadge,
  fmtDate, fmtDateTime,
} from './handoverUtils';
import { cn } from '@/lib/utils';

export default function ShiftHandoverDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, hasRole, isAdmin } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const isSupervisor = hasRole('admin', 'supervisor');

  const [h, setH] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openReturn, setOpenReturn] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [openAccept, setOpenAccept] = useState(false);
  const [receiverNotes, setReceiverNotes] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get(`/ops/handovers/${id}`); setH(data); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  if (loading && !h) return (
    <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /></div>
  );
  if (!h) return <div className="text-center text-muted-foreground py-10">Handover tidak ditemukan.</div>;

  const submit = async () => {
    if (!window.confirm(`Submit handover ${h.handover_number}?`)) return;
    try { await api.post(`/ops/handovers/${h.id}/submit`); toast.success('Handover di-submit'); refreshCounts(); reload(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const doReview = async () => {
    try { await api.post(`/ops/handovers/${h.id}/review`); toast.success('Direview'); reload(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  const doAccept = async () => {
    try {
      await api.post(`/ops/handovers/${h.id}/accept`, { receiver_notes: receiverNotes });
      toast.success('Handover diterima');
      setOpenAccept(false); refreshCounts(); reload();
    } catch (err) { toast.error(formatApiError(err)); }
  };
  const doReturn = async () => {
    if (returnReason.trim().length < 3) return toast.error('Alasan pengembalian wajib (min. 3 karakter)');
    try {
      await api.post(`/ops/handovers/${h.id}/return`, { return_reason: returnReason.trim() });
      toast.success('Handover dikembalikan');
      setOpenReturn(false); setReturnReason(''); refreshCounts(); reload();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const canEdit = isSupervisor || (['Draft', 'Returned'].includes(h.status) && h.worker_id === user?.id);
  const canSubmit = ['Draft', 'Returned'].includes(h.status) && (h.worker_id === user?.id || isSupervisor);
  const canAccept = ['Submitted', 'Reviewed'].includes(h.status) && (h.receiver_id === user?.id || isSupervisor);
  const canReview = h.status === 'Submitted' && isSupervisor;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[
        { label: 'Operasional NOC' },
        { label: 'Data Shift Handover', to: '/operations/shift-handover' },
        { label: h.handover_number },
      ]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => nav(-1)} data-testid="hd-back"><ArrowLeft className="w-4 h-4 mr-1" /> Kembali</Button>
            <h1 className="text-xl md:text-2xl font-bold font-mono tracking-tight">{h.handover_number}</h1>
            <HandoverStatusBadge value={h.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {fmtDate(h.handover_date)} · Shift {h.shift_code} ({SHIFT_HOURS[h.shift_code]}) · Petugas <span className="font-medium text-foreground">{h.worker_name}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {canEdit && <Button variant="outline" onClick={() => nav(`/operations/shift-handover/edit/${h.id}`)} data-testid="hd-edit"><Edit className="w-4 h-4 mr-1.5" /> Edit</Button>}
          {canSubmit && <Button onClick={submit} data-testid="hd-submit"><Send className="w-4 h-4 mr-1.5" /> Submit</Button>}
          {canReview && <Button variant="outline" onClick={doReview} data-testid="hd-review"><ShieldCheck className="w-4 h-4 mr-1.5" /> Review</Button>}
          {canAccept && <Button variant="outline" onClick={() => setOpenAccept(true)} data-testid="hd-accept"><CheckCircle2 className="w-4 h-4 mr-1.5" /> Accept</Button>}
          {canAccept && <Button variant="outline" onClick={() => setOpenReturn(true)} data-testid="hd-return"><RotateCcw className="w-4 h-4 mr-1.5" /> Return</Button>}
          <Button variant="outline" onClick={() => window.print()} data-testid="hd-print"><Printer className="w-4 h-4 mr-1.5" /> Print</Button>
        </div>
      </div>

      {h.status === 'Returned' && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-3 text-sm">
            <div className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300 mb-0.5"><Info className="w-3.5 h-3.5" /> Handover Dikembalikan</div>
            <div className="text-muted-foreground">
              Oleh {h.returned_by} · {fmtDateTime(h.returned_at)} — Alasan: {h.return_reason}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Kpi label="Total Case" value={h.total_cases} />
        <Kpi label="Open" value={h.open_cases} tone="rose" />
        <Kpi label="Monitoring" value={h.monitoring_cases} tone="sky" />
        <Kpi label="Waiting" value={h.waiting_cases} tone="amber" />
        <Kpi label="Resolved" value={h.resolved_cases} tone="emerald" />
        <Kpi label="Critical" value={h.critical_cases} tone="rose" />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" data-testid="hd-tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="cases" data-testid="hd-tab-cases">Case ({(h.cases || []).length})</TabsTrigger>
          <TabsTrigger value="audit" data-testid="hd-tab-audit">Activity Log ({(h.activity_logs || []).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3 mt-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="border-border"><CardContent className="p-4">
              <Section title="Informasi Shift" icon={ClipboardList}>
                <InfoRow label="Nomor Handover" value={<span className="font-mono">{h.handover_number}</span>} />
                <InfoRow label="Tanggal" value={fmtDate(h.handover_date)} />
                <InfoRow label="Shift" value={<>{h.shift_code} — {h.shift_start} → {h.shift_end}</>} />
                <InfoRow label="Petugas Pembuat" value={h.worker_name} />
                <InfoRow label="Penerima Shift" value={h.receiver_name || '—'} />
                <InfoRow label="Status" value={<HandoverStatusBadge value={h.status} />} />
                <InfoRow label="Dibuat" value={fmtDateTime(h.created_at)} />
                <InfoRow label="Submitted" value={h.submitted_at ? `${fmtDateTime(h.submitted_at)} — ${h.submitted_by}` : '—'} />
                <InfoRow label="Diterima" value={h.accepted_at ? `${fmtDateTime(h.accepted_at)} — ${h.accepted_by}` : '—'} />
              </Section>
            </CardContent></Card>
            <Card className="border-border"><CardContent className="p-4">
              <Section title="Catatan" icon={FileText}>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Catatan Umum Shift</div>
                <div className="text-sm mt-1 whitespace-pre-wrap border border-border rounded p-2 bg-muted/20 min-h-[3em]">
                  {h.general_notes || <span className="italic text-muted-foreground">—</span>}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mt-3">Catatan Penerima Shift</div>
                <div className="text-sm mt-1 whitespace-pre-wrap border border-border rounded p-2 bg-muted/20 min-h-[3em]">
                  {h.receiver_notes || <span className="italic text-muted-foreground">—</span>}
                </div>
                {h.edit_history?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Edit History (Supervisor Override)</div>
                    <ul className="text-xs mt-1 space-y-1">
                      {h.edit_history.map((e) => (
                        <li key={e.id} className="border border-border rounded p-1.5 bg-muted/20">
                          <div className="font-medium">{e.by_name} · {fmtDateTime(e.at)}</div>
                          <div className="text-muted-foreground">Fields: {(e.changed_fields || []).join(', ')} — {e.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>
            </CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="cases" className="mt-3 space-y-3">
          {(h.cases || []).length === 0 && <div className="text-sm text-muted-foreground text-center py-8">Tidak ada case.</div>}
          {(h.cases || []).map((c, i) => (
            <Card key={c.id} className="border-border">
              <CardContent className="p-4 space-y-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold w-6 text-center bg-muted rounded px-1">#{i + 1}</span>
                      <span className="text-sm font-semibold">{c.customer_name || c.location || '—'}</span>
                      {c.ticket_number && (
                        <a href={`/crm/tickets/${c.ticket_id}`} className="text-xs font-mono text-primary inline-flex items-center gap-1 hover:underline">
                          <Ticket className="w-3 h-3" /> {c.ticket_number} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {c.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.location}</span>}
                      {c.category && <span> · {c.category}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <CasePriorityBadge value={c.priority} />
                    <CaseStatusBadge value={c.status} />
                    {c.carry_over_count > 0 && <CarryOverBadge count={c.carry_over_count} />}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <MiniField label="Detail Case" value={c.case_detail} />
                  <MiniField label="Action Taken" value={c.action_taken} />
                  <MiniField label="Current Condition" value={c.current_condition} />
                  <MiniField label="Next Action" value={c.next_action} />
                  <MiniField label="PIC" value={c.assigned_pic} />
                  <MiniField label="Target Follow-up" value={c.follow_up_at ? fmtDateTime(c.follow_up_at) : '—'} />
                </div>
                {c.attachment_ids?.length > 0 && (
                  <CaseFilesInline handoverId={h.id} caseId={c.id} />
                )}
                <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Update terakhir {fmtDateTime(c.updated_at)} oleh {c.updated_by}</div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <Card className="border-border"><CardContent className="p-4">
            <ol className="relative border-l-2 border-border ml-2 pl-4 space-y-2.5">
              {(h.activity_logs || []).map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[26px] top-1 w-5 h-5 rounded-full bg-primary/15 border-2 border-primary flex items-center justify-center">
                    <User className="w-2.5 h-2.5 text-primary" />
                  </span>
                  <div className="text-sm font-medium">{a.action}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{fmtDateTime(a.timestamp)} · {a.user_name} ({a.user_role})</div>
                  {a.description && <div className="text-xs mt-0.5 whitespace-pre-wrap">{a.description}</div>}
                </li>
              ))}
            </ol>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={openAccept} onOpenChange={setOpenAccept}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terima Handover</AlertDialogTitle>
            <AlertDialogDescription>Menyatakan bahwa Anda telah membaca dan siap melanjutkan pekerjaan dari shift ini.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea rows={3} value={receiverNotes} onChange={(e) => setReceiverNotes(e.target.value)} placeholder="Catatan penerima (opsional)" data-testid="hd-accept-notes" />
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doAccept} data-testid="hd-accept-confirm">Terima</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={openReturn} onOpenChange={setOpenReturn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kembalikan Handover</AlertDialogTitle>
            <AlertDialogDescription>Alasan pengembalian wajib diisi. Pembuat dapat mengedit lagi setelah dikembalikan.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea rows={3} value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Alasan pengembalian…" data-testid="hd-return-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doReturn} data-testid="hd-return-confirm">Kembalikan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kpi({ label, value, tone = 'slate' }) {
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

function Section({ title, icon: Icon, children }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-primary" />
        <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>{title}</div>
      </div>
      <div className="space-y-1.5">{children}</div>
    </>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="text-xs text-muted-foreground min-w-[130px] pt-0.5">{label}</div>
      <div className="flex-1">{value}</div>
    </div>
  );
}
function MiniField({ label, value }) {
  return (
    <div className="border border-border/60 rounded p-1.5 bg-muted/20">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className="whitespace-pre-wrap min-h-[1.2em]">{value || <span className="italic text-muted-foreground">—</span>}</div>
    </div>
  );
}

function CaseFilesInline({ handoverId, caseId }) {
  const [files, setFiles] = useState([]);
  useEffect(() => {
    api.get(`/ops/handovers/${handoverId}/files`).then(({ data }) => setFiles((data || []).filter((f) => f.case_id === caseId)));
  }, [handoverId, caseId]);
  if (!files.length) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Lampiran ({files.length})</div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
        {files.map((f) => (
          <li key={f.id} className="border border-border rounded p-1.5 text-xs bg-muted/20 flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono flex-1">{f.original_file_name}</span>
            <a href={`${process.env.REACT_APP_BACKEND_URL}${f.file_url}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              <ExternalLink className="w-3 h-3" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
