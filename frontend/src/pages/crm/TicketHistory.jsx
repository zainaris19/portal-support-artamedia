import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MessageSquare, PlayCircle, ClipboardCheck, Users, CheckCircle2,
  Camera, MapPin, Tag, Flag, User, Clock, Timer, AlertTriangle, Building2, Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import api, { formatApiError } from '@/lib/api';
import { StatusBadge, PriorityBadge, fmtLocal, humanSeconds } from './helpdeskUtils';
import { FileImage } from './components/FileImage';
import Lightbox from './components/Lightbox';

const COLOR = {
  rose: 'bg-rose-500/15 border-rose-500 text-rose-600 dark:text-rose-300',
  sky: 'bg-sky-500/15 border-sky-500 text-sky-600 dark:text-sky-300',
  violet: 'bg-violet-500/15 border-violet-500 text-violet-600 dark:text-violet-300',
  emerald: 'bg-emerald-500/15 border-emerald-500 text-emerald-600 dark:text-emerald-300',
};

export default function TicketHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null); // { files, index }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/crm/tickets/${id}`);
        if (alive) setTicket(data);
      } catch (e) {
        if (alive) setError(formatApiError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Memuat riwayat ticket…
      </div>
    );
  }
  if (error || !ticket) {
    return (
      <div className="max-w-lg mx-auto p-6 text-center space-y-3" data-testid="ticket-history-error">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <div className="text-sm text-muted-foreground">{error || 'Ticket tidak ditemukan.'}</div>
        <Button variant="outline" onClick={() => navigate('/crm/dashboard')}>Kembali</Button>
      </div>
    );
  }

  const t = ticket;
  const files = t.files || [];
  const initialFiles = files.filter((f) => f.evidence_type === 'CUSTOMER_INITIAL_EVIDENCE');
  const completionFiles = files.filter((f) => f.evidence_type === 'COMPLETION_EVIDENCE');
  const progressFiles = files.filter((f) => f.evidence_type === 'TECHNICIAN_PROGRESS');
  const allDocs = [...progressFiles, ...completionFiles];

  // Build a single chronological timeline
  const events = [];
  if (t.created_at) events.push({ at: t.created_at, title: 'Ticket dibuat', who: t.created_by_name, icon: MessageSquare, color: 'rose', files: initialFiles });
  if (t.processed_at) events.push({ at: t.processed_at, title: 'Ticket mulai diproses', who: t.processed_by_name, icon: PlayCircle, color: 'sky', note: t.troubleshooter_name ? `Troubleshooter: ${t.troubleshooter_name}` : null });
  (t.progress || []).forEach((p) => {
    events.push({
      at: p.at, title: `Progress: ${p.work_stage || '—'}`, who: p.user_name,
      icon: ClipboardCheck, color: 'sky', note: p.note,
      files: progressFiles.filter((f) => f.progress_id === p.id),
    });
  });
  (t.reassign_history || []).forEach((r) => {
    events.push({
      at: r.at, title: 'Troubleshooter dialihkan', who: r.by_name, icon: Users, color: 'violet',
      note: `${r.from_name || '—'} → ${r.to_name}${r.reason ? `\nAlasan: ${r.reason}` : ''}`,
    });
  });
  if (t.service_restored_at) events.push({ at: t.service_restored_at, title: 'Layanan kembali normal', who: '—', icon: CheckCircle2, color: 'emerald' });
  if (t.resolved_at) events.push({ at: t.resolved_at, title: 'Ticket SELESAI', who: t.resolved_by_name, icon: CheckCircle2, color: 'emerald', note: t.troubleshooter_name ? `Final troubleshooter: ${t.troubleshooter_name}` : null, files: completionFiles });
  events.sort((a, b) => new Date(a.at) - new Date(b.at));

  const openLb = (list, idx) => setLightbox({ files: list, index: idx });

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 space-y-4" data-testid="ticket-history-page">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/crm/tickets/${t.id}`)} data-testid="history-back-btn">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Detail
        </Button>
        <div className="text-xs text-muted-foreground">Riwayat Lengkap Ticket</div>
      </div>

      {/* Summary */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-lg font-bold tracking-tight" data-testid="history-ticket-number">{t.ticket_number}</div>
              <div className="text-sm text-muted-foreground">{t.customer_name}</div>
            </div>
            <div className="flex items-center gap-2">
              <PriorityBadge value={t.priority} />
              <StatusBadge value={t.status} />
            </div>
          </div>

          {t.description && (
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap border-l-2 border-border pl-3">{t.description}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
            <Info icon={Building2} label="Customer / PIC" value={`${t.customer_name || '—'}${t.pic_name ? ` · ${t.pic_name}` : ''}`} />
            <Info icon={MapPin} label="Lokasi" value={t.location} />
            <Info icon={Tag} label="Kategori" value={t.category_name} />
            <Info icon={Flag} label="Prioritas" value={t.priority} />
            <Info icon={User} label="Dibuat oleh" value={t.created_by_name} />
            <Info icon={User} label="Troubleshooter" value={t.troubleshooter_name} highlight />
          </div>
        </CardContent>
      </Card>

      {/* Timing */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Waktu & Durasi</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric icon={AlertTriangle} label="Mulai Gangguan" value={fmtLocal(t.outage_started_at)} small />
            <Metric icon={MessageSquare} label="Dibuat" value={fmtLocal(t.created_at)} small />
            <Metric icon={PlayCircle} label="Diproses" value={fmtLocal(t.processed_at)} small />
            <Metric icon={CheckCircle2} label="Selesai" value={fmtLocal(t.resolved_at)} small />
            <Metric icon={Clock} label="Response Time" value={humanSeconds(t.response_time_seconds)} />
            <Metric icon={Timer} label="Execution Time" value={humanSeconds(t.execution_time_seconds)} />
            <Metric icon={AlertTriangle} label="Downtime" value={humanSeconds(t.downtime_seconds)} />
            <Metric icon={Clock} label="Total Handling" value={humanSeconds(t.total_handling_seconds)} />
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Perjalanan Ticket</div>
          <ol className="relative border-l-2 border-border ml-3 space-y-5" data-testid="history-timeline">
            {events.map((e, i) => {
              const Icon = e.icon;
              return (
                <li key={i} className="pl-5 relative" data-testid={`history-event-${i}`}>
                  <span className={`absolute -left-[13px] top-0 w-6 h-6 rounded-full border flex items-center justify-center ${COLOR[e.color] || COLOR.sky}`}>
                    <Icon className="w-3 h-3" />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <div className="text-sm font-semibold">{e.title}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{fmtLocal(e.at)}</div>
                  </div>
                  {e.who && e.who !== '—' && <div className="text-xs text-muted-foreground mt-0.5">oleh {e.who}</div>}
                  {e.note && <div className="text-sm mt-1 whitespace-pre-wrap text-foreground/80">{e.note}</div>}
                  {e.files && e.files.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                      {e.files.map((f, fi) => (
                        <button key={f.id} onClick={() => openLb(e.files, fi)} className="block rounded-md overflow-hidden border border-border hover:ring-2 ring-primary/40 transition-all">
                          <FileImage ticketId={t.id} file={f} className="aspect-square w-full" testId={`history-photo-${i}-${fi}`} />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {/* Documentation gallery */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Dokumentasi Pekerjaan</div>
          {allDocs.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">Belum ada dokumentasi.</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="history-doc-gallery">
              {allDocs.map((f, i) => (
                <button key={f.id} onClick={() => openLb(allDocs, i)} className="block text-left group">
                  <div className="rounded-md overflow-hidden border border-border group-hover:ring-2 ring-primary/40 transition-all">
                    <FileImage ticketId={t.id} file={f} className="aspect-square w-full" testId={`history-doc-${i}`} />
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground truncate">
                    {f.work_stage || f.description || fmtLocal(f.uploaded_at)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {lightbox && (
        <Lightbox
          ticketId={t.id}
          files={lightbox.files}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onChangeIndex={(i) => setLightbox({ ...lightbox, index: i })}
        />
      )}
    </div>
  );
}

function Info({ icon: Icon, label, value, highlight }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-sm truncate ${highlight ? 'font-semibold text-primary' : ''}`}>{value || '—'}</div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, small }) {
  return (
    <div className="rounded-lg border border-border p-2.5 bg-muted/20">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={`mt-1 font-semibold ${small ? 'text-xs' : 'text-sm'}`}>{value}</div>
    </div>
  );
}
