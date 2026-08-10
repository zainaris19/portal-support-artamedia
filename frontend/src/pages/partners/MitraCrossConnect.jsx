import React from 'react';
import PartnerCategoryPage from './PartnerCategoryPage';

const columns = [
  { key: 'cid', label: 'CID', mono: true },
  { key: 'name', label: 'Provider', render: (r) => <span className="font-medium">{r.name}</span> },
  { key: 'datacenter', label: 'Datacenter' },
  { key: 'capacity', label: 'Kapasitas' },
  { key: 'src', label: 'Rack Src → Dst', render: (r) => `${r.rack_source || '-'} → ${r.rack_destination || '-'}` },
  { key: 'connector_type', label: 'Konektor' },
];

const fields = [
  { name: 'datacenter', label: 'Datacenter', required: true, full: true },
  { name: 'capacity', label: 'Kapasitas', required: true },
  { name: 'connector_type', label: 'Jenis Konektor', type: 'select', options: ['LC', 'SC', 'FC', 'RJ45', 'MPO', 'ST'] },
  { name: 'rack_source', label: 'Rack Source' },
  { name: 'device_source', label: 'Device Source' },
  { name: 'port_source', label: 'Port Source' },
  { name: 'rack_destination', label: 'Rack Destination' },
  { name: 'device_destination', label: 'Device Destination' },
  { name: 'port_destination', label: 'Port Destination' },
];

export default function MitraCrossConnect() {
  return (
    <PartnerCategoryPage
      moduleKey="mitra-cross-connect"
      category="Cross Connect"
      title="Mitra Cross Connect"
      description="Layanan cross connect antar rack/device di datacenter provider."
      breadcrumb={[{ label: 'Mitra / Provider' }, { label: 'Cross Connect' }]}
      columns={columns}
      fields={fields}
    />
  );
}
