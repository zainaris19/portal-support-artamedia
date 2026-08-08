// Shared helpers for Shift Handover module
import React from 'react';
import { cn } from '@/lib/utils';

export const SHIFT_CODES = ['R1', 'R2', 'R3'];
export const SHIFT_HOURS = {
  R1: '07:00 – 15:00 WIB',
  R2: '15:00 – 23:00 WIB',
  R3: '23:00 – 07:00 WIB (+1)',
};
export const HANDOVER_STATUSES = ['Draft', 'Submitted', 'Reviewed', 'Accepted', 'Returned'];
export const CASE_STATUSES = [
  'Open', 'Monitoring', 'Waiting Customer', 'Waiting Vendor',
  'Waiting Internal', 'Escalated', 'Resolved', 'Closed',
];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const CARRY_OVER_ALLOWED = new Set(['Open', 'Monitoring', 'Waiting Customer', 'Waiting Vendor', 'Waiting Internal', 'Escalated']);

const HSTYLE = {
  Draft: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/40',
  Submitted: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/40',
  Reviewed: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/40',
  Accepted: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  Returned: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40',
};

const CSTYLE = {
  Open: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40',
  Monitoring: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/40',
  'Waiting Customer': 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/40',
  'Waiting Vendor': 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40',
  'Waiting Internal': 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/40',
  Escalated: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/40',
  Resolved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  Closed: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/40',
};

const PSTYLE = {
  Low: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/40',
  Medium: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/40',
  High: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40',
  Critical: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

export function HandoverStatusBadge({ value }) {
  return <span data-testid={`handover-status-${value}`} className={cn('inline-flex items-center px-2 py-0.5 text-[10px] font-semibold border rounded-md tracking-wide', HSTYLE[value] || HSTYLE.Draft)}>{value}</span>;
}
export function CaseStatusBadge({ value }) {
  return <span data-testid={`case-status-${value}`} className={cn('inline-flex items-center px-2 py-0.5 text-[10px] font-medium border rounded-md', CSTYLE[value] || CSTYLE.Open)}>{value}</span>;
}
export function CasePriorityBadge({ value }) {
  return <span data-testid={`case-priority-${value}`} className={cn('inline-flex items-center px-2 py-0.5 text-[10px] font-medium border rounded-md', PSTYLE[value] || PSTYLE.Medium)}>{value}</span>;
}

export function CarryOverBadge({ count }) {
  if (!count) return null;
  const tone = count >= 3 ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/50'
    : count === 2 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/50'
    : 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/40';
  return (
    <span data-testid={`case-carry-${count}`} className={cn('inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold border rounded-md', tone)}>
      Carry Over {count} Shift{count > 1 ? 's' : ''}
    </span>
  );
}

export function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }); }
  catch { return iso; }
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }); }
  catch { return iso; }
}
export function jktToday() {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}
