import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ShieldCheck, Clock, CheckCircle2, Loader2, AlertTriangle, MapPin, Wrench,
  FileText, Image as ImageIcon, User, Radio, ExternalLink,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATUS = {
  MASUK: { label: 'OPEN', color: '#dc2626', bg: '#fef2f2', ring: '#fecaca', step: 0 },
  DIPROSES: { label: 'IN PROGRESS', color: '#d97706', bg: '#fffbeb', ring: '#fde68a', step: 1 },
  SELESAI: { label: 'RESOLVED', color: '#059669', bg: '#ecfdf5', ring: '#a7f3d0', step: 2 },
};

function fmt(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

// Robust image detection: trust file_type, but fall back to mime/extension so
// photos uploaded with a generic content-type still render as previews.
function isImg(f) {
  if (!f) return false;
  if (f.file_type === 'image') return true;
  if ((f.mime_type || '').startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.original_file_name || '');
}

export default function PublicTracking() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/track/${token}`);
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.detail || 'Tracking link tidak valid'); }
        setData(await r.json());
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [token]);

  if (loading) {
    return (
      <div style={pageBg} className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> Memuat status ticket…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={pageBg} className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md text-center">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-slate-800">Link Tidak Valid</h1>
          <p className="text-sm text-slate-500 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const st = STATUS[data.status] || STATUS.MASUK;
  const docsUrl = (u) => `${process.env.REACT_APP_BACKEND_URL}${u}`;

  return (
    <div style={pageBg} className="h-screen overflow-y-auto" data-testid="public-tracking-page">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-5 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)' }}>
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold">Ticket Tracking</div>
            <div className="font-bold text-slate-800 leading-tight">{data.company}</div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
        {/* Status card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6" data-testid="track-status-card">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs text-slate-400 font-medium">Nomor Ticket</div>
              <div className="text-2xl font-extrabold text-slate-800 tracking-tight font-mono">{data.ticket_number}</div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold border" style={{ color: st.color, background: st.bg, borderColor: st.ring }} data-testid="track-status-badge">
              <span className="w-2 h-2 rounded-full" style={{ background: st.color }} /> {st.label}
            </span>
          </div>

          {/* progress steps */}
          <div className="mt-6 flex items-center">
            {['Diterima', 'Ditangani', 'Selesai'].map((label, i) => {
              const active = i <= st.step;
              return (
                <React.Fragment key={label}>
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: active ? st.color : '#e2e8f0' }}>
                      {i < st.step || data.status === 'SELESAI' ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                    </div>
                    <span className={`text-[11px] font-medium ${active ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
                  </div>
                  {i < 2 && <div className="flex-1 h-0.5 mx-1 rounded" style={{ background: i < st.step ? st.color : '#e2e8f0' }} />}
                </React.Fragment>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mt-6 text-sm">
            <Info label="Pelanggan" value={data.customer_name} />
            <Info label="Layanan" value={data.service_name} />
            <Info label="Prioritas" value={data.priority} />
            <Info label="Teknisi" value={data.technician_name} icon={Wrench} />
            <Info label="Lokasi" value={data.location} icon={MapPin} />
            <Info label="Dibuat" value={fmt(data.created_at)} icon={Clock} />
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 text-sm">
            <div className="text-xs text-slate-400 font-medium mb-1">Deskripsi Gangguan</div>
            <p className="text-slate-700 whitespace-pre-wrap">{data.problem}</p>
          </div>
        </div>

        {/* Timeline */}
        <Section title="Timeline Penanganan" icon={Clock}>
          {data.timeline.length === 0 ? <Empty text="Belum ada aktivitas." /> : (
            <ol className="relative border-l-2 border-slate-100 ml-2 space-y-4" data-testid="track-timeline">
              {data.timeline.map((t, i) => (
                <li key={i} className="ml-5">
                  <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
                  <div className="text-sm font-medium text-slate-700">{t.label}</div>
                  <div className="text-xs text-slate-400">{fmt(t.at)}</div>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* Progress notes */}
        <Section title="Catatan Teknisi" icon={Wrench}>
          {data.progress.length === 0 ? <Empty text="Belum ada catatan progres." /> : (
            <div className="space-y-3" data-testid="track-progress">
              {data.progress.map((p, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-4 bg-slate-50/60">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded px-2 py-0.5">{p.work_stage || 'Progress'}</span>
                    <span className="text-xs text-slate-400">{fmt(p.at)}</span>
                  </div>
                  {p.note && <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{p.note}</p>}
                  {p.action_taken && <p className="text-xs text-slate-500 mt-1"><b>Tindakan:</b> {p.action_taken}</p>}
                  {p.condition_after && <p className="text-xs text-slate-500 mt-1"><b>Kondisi setelah:</b> {p.condition_after}</p>}
                  {p.files && p.files.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3" data-testid={`track-progress-photos-${i}`}>
                      {p.files.map((f) => (
                        isImg(f) ? (
                          <button key={f.id} onClick={() => setLightbox(docsUrl(f.url))} className="group relative rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-100">
                            <img src={docsUrl(f.url)} alt={f.original_file_name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                          </button>
                        ) : (
                          <a key={f.id} href={docsUrl(f.url)} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 p-3 flex flex-col items-center justify-center gap-1 aspect-square bg-white hover:border-blue-300 transition-colors">
                            <FileText className="w-6 h-6 text-red-500" />
                            <span className="text-[10px] text-slate-600 text-center truncate w-full">{f.original_file_name}</span>
                          </a>
                        )
                      ))}
                    </div>
                  )}
                  {p.technician && <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1"><User className="w-3 h-3" />{p.technician}</p>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Documentation */}
        <Section title="Dokumentasi" icon={ImageIcon}>
          {data.documentation.length === 0 ? <Empty text="Belum ada dokumentasi." /> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="track-documentation">
              {data.documentation.map((f) => (
                isImg(f) ? (
                  <button key={f.id} onClick={() => setLightbox(docsUrl(f.url))} className="group relative rounded-xl overflow-hidden border border-slate-200 aspect-square bg-slate-100">
                    <img src={docsUrl(f.url)} alt={f.original_file_name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                    <span className="absolute bottom-0 inset-x-0 text-[10px] text-white bg-black/50 px-2 py-1 truncate">{f.description || f.evidence_type}</span>
                  </button>
                ) : (
                  <a key={f.id} href={docsUrl(f.url)} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 p-4 flex flex-col items-center justify-center gap-2 aspect-square bg-white hover:border-blue-300 transition-colors">
                    <FileText className="w-8 h-8 text-red-500" />
                    <span className="text-[11px] text-slate-600 text-center truncate w-full">{f.original_file_name}</span>
                    <span className="text-[10px] text-blue-500 inline-flex items-center gap-1">Buka <ExternalLink className="w-3 h-3" /></span>
                  </a>
                )
              ))}
            </div>
          )}
        </Section>

        {/* Completion */}
        {data.completion && (
          <Section title="Ringkasan Penyelesaian" icon={CheckCircle2} tint="#059669">
            <div className="space-y-2 text-sm" data-testid="track-completion">
              <Info label="Akar Masalah" value={data.completion.root_cause || '-'} block />
              <Info label="Tindakan" value={data.completion.action_taken || '-'} block />
              <Info label="Solusi Akhir" value={data.completion.final_solution || '-'} block />
              <Info label="Status Layanan" value={data.completion.service_final_status || '-'} />
              <Info label="Layanan Pulih" value={fmt(data.completion.service_restored_at)} />
            </div>
          </Section>
        )}

        <div className="text-center text-xs text-slate-400 pt-2 pb-8 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Halaman ini hanya untuk memantau status ticket · {data.company}
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="dokumentasi" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

const pageBg = { background: '#f1f5f9', fontFamily: 'ui-sans-serif, system-ui, sans-serif' };

function Section({ title, icon: Icon, tint = '#1d4ed8', children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4" style={{ color: tint }} />
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Info({ label, value, icon: Icon, block }) {
  return (
    <div className={block ? '' : ''}>
      <div className="text-xs text-slate-400 font-medium flex items-center gap-1">{Icon && <Icon className="w-3 h-3" />}{label}</div>
      <div className="text-slate-700 font-medium mt-0.5 whitespace-pre-wrap">{value || '-'}</div>
    </div>
  );
}

function Empty({ text }) {
  return <div className="text-sm text-slate-400 py-2">{text}</div>;
}
