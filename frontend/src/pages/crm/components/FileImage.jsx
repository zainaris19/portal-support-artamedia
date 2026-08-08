import React, { useEffect, useState } from 'react';
import { Loader2, FileText } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

// Cache of blob URLs keyed by "ticketId/fileId"
const CACHE = new Map();

/** Renders an image thumbnail authenticated via API (blob URL). For PDFs
 *  shows a document icon. */
export function FileImage({ ticketId, file, className, onClick, testId }) {
  const key = `${ticketId}/${file.id}`;
  const [src, setSrc] = useState(() => CACHE.get(key) || null);
  const [loading, setLoading] = useState(!CACHE.has(key));

  useEffect(() => {
    let cancelled = false;
    if (file.file_type !== 'image') { setLoading(false); return; }
    if (CACHE.has(key)) { setSrc(CACHE.get(key)); setLoading(false); return; }
    setLoading(true);
    api
      .get(`/crm/tickets/${ticketId}/files/${file.id}/content`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        const url = URL.createObjectURL(res.data);
        CACHE.set(key, url);
        setSrc(url);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [ticketId, file.id, file.file_type, key]);

  if (file.file_type !== 'image') {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={cn(
          'flex flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted/40 hover:bg-muted transition-colors',
          className,
        )}
      >
        <FileText className="w-6 h-6 text-muted-foreground" />
        <span className="text-[10px] font-mono truncate px-1 max-w-full">{file.original_file_name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn('relative overflow-hidden rounded-md border border-border bg-muted/30 group', className)}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute inset-0 m-auto" />}
      {src && (
        <img
          src={src}
          alt={file.original_file_name || 'attachment'}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
      )}
    </button>
  );
}

export async function downloadFile(ticketId, file) {
  const res = await api.get(`/crm/tickets/${ticketId}/files/${file.id}/content`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.original_file_name || file.file_name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
