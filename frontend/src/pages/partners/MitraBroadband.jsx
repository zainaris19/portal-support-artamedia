import React from 'react';
import PartnerCategoryPage from './PartnerCategoryPage';

const columns = [
  { key: 'cid', label: 'CID', mono: true },
  { key: 'name', label: 'Provider ISP', render: (r) => <span className="font-medium">{r.name}</span> },
  { key: 'service_name', label: 'Nama Layanan' },
  { key: 'capacity', label: 'Kapasitas' },
  { key: 'atas_nama', label: 'Atas Nama' },
  { key: 'install_address', label: 'Alamat Instalasi', render: (r) => <span className="line-clamp-1">{r.install_address || '-'}</span> },
];

const fields = [
  { name: 'service_name', label: 'Nama Layanan', required: true, full: true },
  { name: 'install_address', label: 'Alamat Instalasi', type: 'textarea', full: true, rows: 2 },
  { name: 'atas_nama', label: 'Atas Nama Pelanggan', full: true },
  { name: 'capacity', label: 'Kapasitas / Bandwidth', required: true },
];

export default function MitraBroadband() {
  return (
    <PartnerCategoryPage
      moduleKey="mitra-broadband"
      category="Broadband"
      title="Mitra Broadband"
      description="Layanan broadband dari provider mitra untuk customer end-user."
      breadcrumb={[{ label: 'Mitra / Provider' }, { label: 'Broadband' }]}
      columns={columns}
      fields={fields}
    />
  );
}
