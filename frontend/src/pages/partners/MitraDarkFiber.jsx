import React from 'react';
import PartnerCategoryPage from './PartnerCategoryPage';

const columns = [
  { key: 'cid', label: 'CID', mono: true },
  { key: 'name', label: 'Provider', render: (r) => <span className="font-medium">{r.name}</span> },
  { key: 'service_name', label: 'Nama Jalur' },
  { key: 'sites', label: 'Lokasi A → B', render: (r) => `${r.site_a || '-'} → ${r.site_b || '-'}` },
  { key: 'cores', label: 'Core', render: (r) => `${r.cores_used || 0} / ${r.cores_total || 0}` },
  { key: 'length_km', label: 'Panjang (km)' },
];

const fields = [
  { name: 'service_name', label: 'Nama Jalur', required: true, full: true },
  { name: 'site_a', label: 'Lokasi A', required: true },
  { name: 'site_b', label: 'Lokasi B', required: true },
  { name: 'cores_total', label: 'Jumlah Core', type: 'number' },
  { name: 'cores_used', label: 'Core Digunakan', type: 'number' },
  { name: 'length_km', label: 'Panjang Jalur (km)', type: 'number' },
  { name: 'odf_a', label: 'ODF A' },
  { name: 'odf_b', label: 'ODF B' },
  { name: 'initial_attenuation', label: 'Redaman Awal (dB)', full: true },
];

export default function MitraDarkFiber() {
  return (
    <PartnerCategoryPage
      moduleKey="mitra-dark-fiber"
      category="Dark Fiber"
      title="Mitra Dark Fiber"
      description="Jalur serat gelap dari provider antar lokasi."
      breadcrumb={[{ label: 'Mitra / Provider' }, { label: 'Dark Fiber' }]}
      columns={columns}
      fields={fields}
    />
  );
}
