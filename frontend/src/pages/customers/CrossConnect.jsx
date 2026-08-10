import React from 'react';
import CustomerCategoryPage from './CustomerCategoryPage';

const columns = [
  { key: 'sid', label: 'SID', mono: true, render: (r) => r.sid },
  { key: 'company_name', label: 'Pelanggan', render: (r) => <span className="font-medium">{r.company_name}</span> },
  { key: 'datacenter', label: 'Datacenter' },
  { key: 'capacity', label: 'Kapasitas' },
  { key: 'rack_source', label: 'Rack Src → Dst', render: (r) => `${r.rack_source || '-'} → ${r.rack_destination || '-'}` },
  { key: 'connector_type', label: 'Konektor' },
];

const fields = [
  { name: 'datacenter', label: 'Datacenter', required: true },
  { name: 'capacity', label: 'Kapasitas', required: true },
  { name: 'rack_source', label: 'Rack Source' },
  { name: 'port_source', label: 'Device / Port Source' },
  { name: 'rack_destination', label: 'Rack Destination' },
  { name: 'port_destination', label: 'Device / Port Destination' },
  { name: 'connector_type', label: 'Jenis Konektor', type: 'select', options: ['LC', 'SC', 'FC', 'RJ45', 'MPO', 'ST'] },
  { name: 'provider', label: 'Provider' },
];

export default function CrossConnect() {
  return (
    <CustomerCategoryPage
      moduleKey="cross-connect"
      title="Pelanggan Cross Connect"
      description="Layanan cross connect antar rack / device di datacenter."
      category="Cross Connect"
      breadcrumb={[{ label: 'Data Pelanggan' }, { label: 'Cross Connect' }]}
      columns={columns}
      fields={fields}
    />
  );
}
