import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function Teknis() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-teknis"
      category="Teknis"
      title="Dokumen Teknis"
      description="Topologi jaringan, konfigurasi, dan dokumen teknis lainnya."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Dokumen Teknis' }]}
    />
  );
}
