import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function BAProvider() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-ba-provider"
      category="BA"
      scope="provider"
      title="Berita Acara — Mitra"
      description="Berita Acara instalasi dan pekerjaan dari mitra / provider."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Berita Acara' }, { label: 'Mitra' }]}
    />
  );
}
