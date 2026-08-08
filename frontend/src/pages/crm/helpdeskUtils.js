// Shared helpers for CRM Ticket Helpdesk
import React from 'react';
import { cn } from '@/lib/utils';

export const HELPDESK_STATUSES = ['MASUK', 'DIPROSES', 'SELESAI'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const REPORT_SOURCES = ['WhatsApp', 'Telepon', 'Email', 'Monitoring', 'Internal', 'Lainnya'];
export const WORK_STAGES = [
  'Survey lokasi', 'Pemeriksaan awal', 'Pengerjaan',
  'Penggantian perangkat', 'Perbaikan kabel', 'Pengujian',
  'Koordinasi pihak ketiga', 'Lainnya',
];

export const STATUS_STYLE = {
  MASUK: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40',
  DIPROSES: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/40',
  SELESAI: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
};

export const PRIO_STYLE = {
  Low: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/40',
  Medium: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/40',
  High: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40',
  Critical: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

export function StatusBadge({ value }) {
  const cls = STATUS_STYLE[value] || STATUS_STYLE.MASUK;
  return (
    <span
      data-testid={`ticket-status-${value}`}
      className={cn('inline-flex items-center px-2 py-0.5 text-[11px] font-semibold border rounded-md tracking-wide', cls)}
    >
      {value}
    </span>
  );
}

export function PriorityBadge({ value }) {
  const cls = PRIO_STYLE[value] || PRIO_STYLE.Medium;
  return (
    <span
      data-testid={`ticket-priority-${value}`}
      className={cn('inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded-md', cls)}
    >
      {value}
    </span>
  );
}

/** "2h 15m", "3d 04h", etc. */
export function humanSeconds(sec) {
  if (sec == null || Number.isNaN(sec)) return '—';
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function durationSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 1000);
}

export function fmtLocal(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    });
  } catch { return iso; }
}

export function apiFileUrl(url) {
  // "/api/crm/tickets/{tid}/files/{fid}/content" — prefix with backend URL
  if (!url) return '';
  const backend = process.env.REACT_APP_BACKEND_URL || '';
  return `${backend}${url}`;
}

/** Attach the current bearer token to a file URL as a query token if needed.
 * FileResponse endpoint is protected — but the browser can't send Authorization on <img src>.
 * Solution: we fetch via api and create blob url in-component (see components/FileImage). */
