import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function KontrakCustomer() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-kontrak-customer"
      category="Kontrak"
      scope="customer"
      title="Kontrak — Customer"
      description="Kontrak kerjasama dengan pelanggan."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Kontrak' }, { label: 'Customer' }]}
    />
  );
}
