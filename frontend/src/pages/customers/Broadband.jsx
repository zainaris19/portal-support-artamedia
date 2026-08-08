import React from 'react';
import CustomerCategoryPage from './CustomerCategoryPage';

const columns = [
  { key: 'sid', label: 'SID', mono: true, render: (r) => r.sid },
  { key: 'company_name', label: 'Pelanggan', render: (r) => <span className="font-medium">{r.company_name}</span> },
  { key: 'package_name', label: 'Paket' },
  { key: 'bandwidth', label: 'Bandwidth' },
  { key: 'odp_olt_pop', label: 'ODP / OLT / POP' },
  { key: 'vlan', label: 'VLAN' },
];

const fields = [
  { name: 'package_name', label: 'Paket', required: true },
  { name: 'bandwidth', label: 'Bandwidth', required: true },
  { name: 'address', label: 'Alamat', type: 'textarea', full: true, rows: 2 },
  { name: 'location', label: 'Lokasi / Kota' },
  { name: 'odp_olt_pop', label: 'ODP / OLT / POP' },
  { name: 'vlan', label: 'VLAN' },
  { name: 'pppoe_username', label: 'Username PPPoE', full: true },
  { name: 'ip_public', label: 'IP Publik (opsional)', full: true },
];

export default function Broadband() {
  return (
    <CustomerCategoryPage
      moduleKey="broadband"
      title="Pelanggan Broadband"
      description="Layanan internet retail berbasis PPPoE, ODP, OLT, dan POP."
      category="Broadband"
      breadcrumb={[{ label: 'Data Pelanggan' }, { label: 'Broadband' }]}
      columns={columns}
      fields={fields}
    />
  );
}
