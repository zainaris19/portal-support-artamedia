import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function SLACustomer() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-sla-customer"
      category="SLA"
      scope="customer"
      title="SLA — Customer"
      description="Komitmen SLA layanan per pelanggan."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'SLA' }, { label: 'Customer' }]}
    />
  );
}
