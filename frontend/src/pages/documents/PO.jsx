import React from 'react';
import DocumentCategoryPage from './DocumentCategoryPage';

export default function PO() {
  return (
    <DocumentCategoryPage
      moduleKey="doc-po"
      category="PO"
      title="Purchase Order"
      description="Dokumen PO pembelian & pengadaan."
      breadcrumb={[{ label: 'Dokumen & Arsip' }, { label: 'Purchase Order' }]}
    />
  );
}
