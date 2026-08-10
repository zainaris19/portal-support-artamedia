import React from 'react';
import OperationsLog, { STATUSES, PRIORITIES } from '@/components/OperationsLog';

const TYPES = ['Planned', 'Emergency'];

const EMPTY = {
  title: '',
  customer_id: null,
  site: '',
  scheduled_start: new Date().toISOString().slice(0, 16),
  scheduled_end: '',
  type: 'Planned',
  description: '',
  status: 'Open',
  priority: 'Medium',
};

const columns = [
  { key: 'title', label: 'Judul', render: (r) => <span className="font-medium">{r.title}</span> },
  { key: 'type', label: 'Tipe', render: (r) => <span className={`text-xs px-2 py-0.5 rounded-md border ${r.type === 'Emergency' ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30' : 'bg-primary/10 text-primary border-primary/20'}`}>{r.type}</span> },
  { key: 'customer_id', label: 'Pelanggan', render: (r, cmap) => cmap[r.customer_id] || (r.site || '-') },
  { key: 'scheduled_start', label: 'Jadwal Mulai', mono: true, render: (r) => r.scheduled_start ? new Date(r.scheduled_start).toLocaleString() : '-' },
  { key: 'priority', label: 'Prioritas', type: 'priority' },
  { key: 'status', label: 'Status', type: 'status' },
];

const formFields = [
  { name: 'title', label: 'Judul Maintenance', required: true, full: true },
  { name: 'customer_id', label: 'Pelanggan', type: 'customer', full: true },
  { name: 'site', label: 'Site / Lokasi' },
  { name: 'type', label: 'Tipe', type: 'select', options: TYPES },
  { name: 'scheduled_start', label: 'Jadwal Mulai', type: 'datetime-local', required: true },
  { name: 'scheduled_end', label: 'Jadwal Selesai', type: 'datetime-local' },
  { name: 'status', label: 'Status', type: 'select', options: STATUSES },
  { name: 'priority', label: 'Prioritas', type: 'select', options: PRIORITIES },
  { name: 'description', label: 'Deskripsi', type: 'textarea', full: true, rows: 3 },
];

export default function Maintenance() {
  return (
    <OperationsLog
      moduleKey="maintenances"
      title="Maintenance Log"
      description="Catatan pekerjaan maintenance terencana dan darurat."
      endpoint="maintenances"
      columns={columns}
      empty={EMPTY}
      formFields={formFields}
    />
  );
}
