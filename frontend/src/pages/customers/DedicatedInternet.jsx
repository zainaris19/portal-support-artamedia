import React from 'react';
import CustomerCategoryPage from './CustomerCategoryPage';

const columns = [
  { key: 'sid', label: 'SID', mono: true, render: (r) => r.sid },
  { key: 'company_name', label: 'Pelanggan', render: (r) => <span className="font-medium">{r.company_name}</span> },
  { key: 'bandwidth', label: 'Bandwidth' },
  { key: 'sla', label: 'SLA' },
  { key: 'ip_public', label: 'IP Publik', mono: true },
  { key: 'pop', label: 'POP' },
];

const fields = [
  { name: 'bandwidth', label: 'Bandwidth', required: true },
  { name: 'sla', label: 'SLA', required: true },
  { name: 'address', label: 'Alamat / Site', type: 'textarea', full: true, rows: 2 },
  { name: 'pop', label: 'POP' },
  { name: 'vlan', label: 'VLAN' },
  { name: 'ip_public', label: 'IP Publik' },
  { name: 'subnet_prefix', label: 'Subnet / Prefix' },
  { name: 'gateway', label: 'Gateway' },
  { name: 'routing', label: 'Routing', type: 'select', options: ['Static', 'BGP', 'OSPF', 'MPLS'] },
  { name: 'asn', label: 'ASN (opsional)' },
];

export default function DedicatedInternet() {
  return (
    <CustomerCategoryPage
      moduleKey="dedicated"
      title="Pelanggan Dedicated Internet"
      description="Layanan enterprise dedicated internet dengan SLA, IP publik, dan multi-provider bundling."
      category="Dedicated Internet"
      breadcrumb={[{ label: 'Data Pelanggan' }, { label: 'Dedicated Internet' }]}
      columns={columns}
      fields={fields}
      showConnectedServices
    />
  );
}
