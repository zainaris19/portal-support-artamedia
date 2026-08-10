import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { downloadFile } from './FileImage';

export default function Lightbox({ ticketId, files, index, onClose, onChangeIndex }) {
  const file = files?.[index];
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!file) return;
    if (file.file_type !== 'image') { setSrc(null); return; }
    let cancel = false;
    api.get(`/crm/tickets/${ticketId}/files/${file.id}/content`, { responseType: 'blob' })
      .then((r) => { if (!cancel) setSrc(URL.createObjectURL(r.data)); });
    return () => { cancel = true; };
  }, [ticketId, file]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onChangeIndex(index - 1);
      if (e.key === 'ArrowRight' && index < files.length - 1) onChangeIndex(index + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, files, onClose, onChangeIndex]);

  if (!file) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col"
      data-testid="ticket-lightbox"
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm truncate max-w-[70%]">
          <div className="font-mono">{file.original_file_name}</div>
          <div className="text-[10px] opacity-80">{file.evidence_type} · {file.uploaded_by_name} · {file.description || '—'}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => downloadFile(ticketId, file)} data-testid="lightbox-download">
            <Download className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose} data-testid="lightbox-close">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center px-4 pb-4 relative" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full p-2"
            onClick={() => onChangeIndex(index - 1)}
            data-testid="lightbox-prev"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {file.file_type === 'image' && src ? (
          <img src={src} alt={file.original_file_name || 'attachment'} className="max-h-full max-w-full object-contain rounded" />
        ) : (
          <div className="text-white text-center">
            <div className="text-lg font-semibold mb-2">{file.original_file_name}</div>
            <Button variant="secondary" onClick={() => downloadFile(ticketId, file)}>Download file</Button>
          </div>
        )}
        {index < files.length - 1 && (
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full p-2"
            onClick={() => onChangeIndex(index + 1)}
            data-testid="lightbox-next"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>
  );
}
