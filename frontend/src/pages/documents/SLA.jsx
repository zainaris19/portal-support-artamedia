import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function SLA() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-sla"
      category="SLA"
      title="Service Level Agreement"
      description="Komitmen SLA layanan per pelanggan / mitra."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'SLA' }]}
    />
  );
}
