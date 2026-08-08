import React from 'react';
import CustomerCategoryPage from './CustomerCategoryPage';

const columns = [
  { key: 'sid', label: 'SID', mono: true, render: (r) => r.sid },
  { key: 'company_name', label: 'Pelanggan', render: (r) => <span className="font-medium">{r.company_name}</span> },
  { key: 'site_a', label: 'Lokasi A' },
  { key: 'site_b', label: 'Lokasi B' },
  { key: 'cores', label: 'Core Digunakan', render: (r) => `${r.cores_used || 0} / ${r.cores_total || 0}` },
  { key: 'length_km', label: 'Panjang (km)' },
];

const fields = [
  { name: 'site_a', label: 'Lokasi A', required: true },
  { name: 'site_b', label: 'Lokasi B', required: true },
  { name: 'cores_used', label: 'Core Digunakan', type: 'number' },
  { name: 'cores_total', label: 'Total Core', type: 'number' },
  { name: 'length_km', label: 'Panjang Jalur (km)', type: 'number' },
  { name: 'handhole_odf', label: 'Titik Handhole / ODF', full: true },
  { name: 'initial_attenuation', label: 'Redaman Awal (dB)', full: true },
];

export default function DarkFiber() {
  return (
    <CustomerCategoryPage
      moduleKey="dark-fiber"
      title="Pelanggan Dark Fiber"
      description="Layanan serat gelap point-to-point antar lokasi."
      category="Dark Fiber"
      breadcrumb={[{ label: 'Data Pelanggan' }, { label: 'Dark Fiber' }]}
      columns={columns}
      fields={fields}
    />
  );
}
