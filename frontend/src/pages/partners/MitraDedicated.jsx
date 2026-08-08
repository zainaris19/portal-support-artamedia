import React from 'react';
import PartnerCategoryPage from './PartnerCategoryPage';

const columns = [
  { key: 'cid', label: 'CID', mono: true },
  { key: 'name', label: 'Provider ISP', render: (r) => <span className="font-medium">{r.name}</span> },
  { key: 'service_name', label: 'Nama Layanan' },
  { key: 'capacity', label: 'Kapasitas' },
  { key: 'ip_public', label: 'IP Publik', mono: true },
  { key: 'vlan', label: 'VLAN' },
];

const fields = [
  { name: 'service_name', label: 'Nama Layanan', required: true, full: true },
  { name: 'install_address', label: 'Alamat Instalasi', type: 'textarea', full: true, rows: 2 },
  { name: 'atas_nama', label: 'Atas Nama', full: true },
  { name: 'capacity', label: 'Kapasitas', required: true },
  { name: 'ip_public', label: 'IP Publik dari Provider' },
  { name: 'prefix', label: 'Prefix / Subnet' },
  { name: 'gateway', label: 'Gateway' },
  { name: 'asn', label: 'ASN (opsional)' },
  { name: 'vlan', label: 'VLAN' },
];

export default function MitraDedicated() {
  return (
    <PartnerCategoryPage
      moduleKey="mitra-dedicated"
      category="Dedicated Internet"
      title="Mitra Dedicated Internet"
      description="Layanan dedicated internet berbasis IP publik dari upstream provider."
      breadcrumb={[{ label: 'Mitra / Provider' }, { label: 'Dedicated Internet' }]}
      columns={columns}
      fields={fields}
    />
  );
}
