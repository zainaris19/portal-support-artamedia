import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function SLAProvider() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-sla-provider"
      category="SLA"
      scope="provider"
      title="SLA — Provider"
      description="Komitmen SLA dari mitra / provider."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'SLA' }, { label: 'Provider' }]}
    />
  );
}
