import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function SO() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-so"
      category="SO"
      title="Service Order"
      description="Dokumen Service Order dari pelanggan / mitra."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Service Order' }]}
    />
  );
}
