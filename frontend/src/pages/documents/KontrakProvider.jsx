import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function KontrakProvider() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-kontrak-provider"
      category="Kontrak"
      scope="provider"
      title="Kontrak — Mitra"
      description="Kontrak dengan mitra / provider layanan."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Kontrak' }, { label: 'Mitra' }]}
    />
  );
}
