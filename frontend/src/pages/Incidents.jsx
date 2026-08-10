import React from 'react';
import OperationsLog, { STATUSES, PRIORITIES } from '@/components/OperationsLog';

const EMPTY = {
  title: '',
  customer_id: null,
  site: '',
  started_at: new Date().toISOString().slice(0, 16),
  resolved_at: '',
  description: '',
  root_cause: '',
  action_taken: '',
  status: 'Open',
  priority: 'Medium',
};

const columns = [
  { key: 'title', label: 'Judul Incident', render: (r) => <span className="font-medium">{r.title}</span> },
  { key: 'customer_id', label: 'Pelanggan', render: (r, cmap) => cmap[r.customer_id] || (r.site || '-') },
  { key: 'started_at', label: 'Mulai', mono: true, render: (r) => r.started_at ? new Date(r.started_at).toLocaleString() : '-' },
  { key: 'priority', label: 'Prioritas', type: 'priority' },
  { key: 'status', label: 'Status', type: 'status' },
];

const formFields = [
  { name: 'title', label: 'Judul Incident', required: true, full: true },
  { name: 'customer_id', label: 'Pelanggan', type: 'customer', full: true },
  { name: 'site', label: 'Site / Lokasi' },
  { name: 'started_at', label: 'Waktu Mulai', type: 'datetime-local', required: true },
  { name: 'resolved_at', label: 'Waktu Selesai', type: 'datetime-local' },
  { name: 'status', label: 'Status', type: 'select', options: STATUSES },
  { name: 'priority', label: 'Prioritas', type: 'select', options: PRIORITIES },
  { name: 'description', label: 'Deskripsi', type: 'textarea', full: true, rows: 3 },
  { name: 'root_cause', label: 'Root Cause', type: 'textarea', full: true, rows: 2 },
  { name: 'action_taken', label: 'Tindakan', type: 'textarea', full: true, rows: 3 },
];

export default function Incidents() {
  return (
    <OperationsLog
      moduleKey="incidents"
      title="Incident Log"
      description="Catatan insiden operasional jaringan."
      endpoint="incidents"
      columns={columns}
      empty={EMPTY}
      formFields={formFields}
    />
  );
}
