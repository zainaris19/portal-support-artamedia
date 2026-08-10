import React from 'react';
import CustomerCategoryPage from './CustomerCategoryPage';

const columns = [
  { key: 'sid', label: 'SID', mono: true, render: (r) => r.sid },
  { key: 'company_name', label: 'Pelanggan', render: (r) => <span className="font-medium">{r.company_name}</span> },
  { key: 'capacity', label: 'Kapasitas' },
  { key: 'node_a', label: 'Node A' },
  { key: 'node_b', label: 'Node B' },
  { key: 'vlan', label: 'VLAN' },
  { key: 'provider', label: 'Provider' },
];

// Metro-E fokus Layer 2, tanpa IP/gateway/routing
const fields = [
  { name: 'capacity', label: 'Kapasitas', required: true },
  { name: 'node_a', label: 'Node A', required: true },
  { name: 'port_a', label: 'Port Node A' },
  { name: 'node_b', label: 'Node B', required: true },
  { name: 'port_b', label: 'Port Node B' },
  { name: 'vlan', label: 'VLAN' },
  { name: 'provider', label: 'Provider' },
];

export default function MetroEthernet() {
  return (
    <CustomerCategoryPage
      moduleKey="metro-ethernet"
      title="Pelanggan Metro Ethernet"
      description="Koneksi Layer-2 antar node dalam ring Metro-E."
      category="Metro Ethernet"
      breadcrumb={[{ label: 'Data Pelanggan' }, { label: 'Metro Ethernet' }]}
      columns={columns}
      fields={fields}
    />
  );
}
