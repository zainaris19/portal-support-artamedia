import React from 'react';
import PartnerCategoryPage from './PartnerCategoryPage';

const columns = [
  { key: 'cid', label: 'CID', mono: true },
  { key: 'name', label: 'Provider', render: (r) => <span className="font-medium">{r.name}</span> },
  { key: 'service_name', label: 'Nama Layanan' },
  { key: 'capacity', label: 'Kapasitas' },
  { key: 'nodes', label: 'Node A → B', render: (r) => `${r.node_a || '-'} → ${r.node_b || '-'}` },
  { key: 'vlan', label: 'VLAN' },
];

// Metro-E Layer 2 - tanpa IP/gateway/routing
const fields = [
  { name: 'service_name', label: 'Nama Layanan', required: true, full: true },
  { name: 'capacity', label: 'Kapasitas', required: true },
  { name: 'vlan', label: 'VLAN' },
  { name: 'node_a', label: 'Node A', required: true },
  { name: 'port_a', label: 'Port Node A' },
  { name: 'node_b', label: 'Node B', required: true },
  { name: 'port_b', label: 'Port Node B' },
  { name: 'site_a', label: 'Lokasi A', full: true },
  { name: 'site_b', label: 'Lokasi B', full: true },
];

export default function MitraMetro() {
  return (
    <PartnerCategoryPage
      moduleKey="mitra-metro"
      category="Metro Ethernet"
      title="Mitra Metro Ethernet (Layer 2)"
      description="Point-to-point Layer 2 antar node dalam ring Metro-E provider."
      breadcrumb={[{ label: 'Mitra / Provider' }, { label: 'Metro Ethernet' }]}
      columns={columns}
      fields={fields}
    />
  );
}
