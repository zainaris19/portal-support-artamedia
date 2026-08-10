import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function BA() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-ba"
      category="BA"
      title="Berita Acara"
      description="Berita Acara instalasi, penerimaan, dan pekerjaan."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Berita Acara' }]}
    />
  );
}
