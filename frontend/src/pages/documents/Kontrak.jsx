import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function Kontrak() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-kontrak"
      category="Kontrak"
      title="Kontrak"
      description="Kontrak kerjasama pelanggan & mitra."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Kontrak' }]}
    />
  );
}
