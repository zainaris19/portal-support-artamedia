import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function BACustomer() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-ba-customer"
      category="BA"
      scope="customer"
      title="Berita Acara — Customer"
      description="Berita Acara instalasi, penerimaan, dan pekerjaan pelanggan."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Berita Acara' }, { label: 'Customer' }]}
    />
  );
}
