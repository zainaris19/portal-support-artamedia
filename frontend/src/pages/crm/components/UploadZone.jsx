import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { UploadCloud, X, Camera, Image as ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import api, { formatApiError } from '@/lib/api';

const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

/** Reusable file upload zone with drag+drop, camera capture, and image
 *  compression for oversized JPEG/PNG. Uploads via POST /crm/tickets/:id/files.
 *
 *  Props:
 *    ticketId      required
 *    evidenceType  CUSTOMER_INITIAL_EVIDENCE | TECHNICIAN_PROGRESS | COMPLETION_EVIDENCE | GENERAL_ATTACHMENT
 *    workStage     free-text label used when evidenceType=TECHNICIAN_PROGRESS
 *    description   optional label sent as metadata
 *    onUploaded    (files[]) => void  — full metadata list from response
 *    testKey       string prefix for data-testid
 */
export default function UploadZone({ ticketId, evidenceType = 'GENERAL_ATTACHMENT', workStage = '', description = '', onUploaded, testKey = 'upload' }) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState([]); // File[]
  const fileInput = useRef(null);
  const cameraInput = useRef(null);

  const openPicker = () => fileInput.current?.click();
  const openCamera = () => cameraInput.current?.click();

  const addFiles = (list) => {
    const arr = Array.from(list).filter((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        toast.error(`${f.name}: format tidak diizinkan (harus JPG/PNG/WEBP/PDF)`);
        return false;
      }
      if (f.size > MAX_SIZE) {
        toast.error(`${f.name}: melebihi 20 MB`);
        return false;
      }
      return true;
    });
    setPending((prev) => [...prev, ...arr]);
  };

  const removePending = (idx) => {
    setPending((prev) => prev.filter((_, i) => i !== idx));
  };

  const compressImage = async (file) => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    if (file.size < 500 * 1024) return file; // <500KB no compression
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = URL.createObjectURL(file);
      });
      const MAX_DIM = 1920;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) { height = Math.round((height * MAX_DIM) / width); width = MAX_DIM; }
        else { width = Math.round((width * MAX_DIM) / height); height = MAX_DIM; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) return file;
      URL.revokeObjectURL(img.src);
      return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
    } catch { return file; }
  };

  const upload = async () => {
    if (!pending.length) return;
    setBusy(true); setProgress(0);
    try {
      const fd = new FormData();
      for (const f of pending) {
        const c = await compressImage(f);
        fd.append('files', c, c.name);
      }
      fd.append('evidence_type', evidenceType);
      fd.append('description', description || '');
      fd.append('work_stage', workStage || '');
      // Optional GPS
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((res) => {
            navigator.geolocation.getCurrentPosition(
              (p) => res(p), () => res(null), { timeout: 3000, maximumAge: 60000 }
            );
          });
          if (pos) {
            fd.append('latitude', String(pos.coords.latitude));
            fd.append('longitude', String(pos.coords.longitude));
          }
        } catch {}
      }
      const { data } = await api.post(`/crm/tickets/${ticketId}/files`, fd, {
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded * 100) / e.total)),
      });
      toast.success(`${data.items.length} file terunggah`);
      setPending([]);
      onUploaded?.(data.items);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally { setBusy(false); setProgress(0); }
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        className={cn(
          'rounded-lg border-2 border-dashed p-4 sm:p-5 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
        )}
        data-testid={`${testKey}-dropzone`}
      >
        <UploadCloud className="w-6 h-6 mx-auto text-muted-foreground mb-1.5" />
        <div className="text-xs text-muted-foreground mb-2">
          Seret & lepas file di sini, atau
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openPicker} data-testid={`${testKey}-pick`}>
            <ImageIcon className="w-3.5 h-3.5 mr-1.5" /> Pilih dari galeri
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={openCamera} data-testid={`${testKey}-camera`}>
            <Camera className="w-3.5 h-3.5 mr-1.5" /> Kamera
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground mt-2">JPG · PNG · WEBP · PDF · max 20 MB / file</div>
        <input
          ref={fileInput} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,image/*,application/pdf"
          className="hidden" onChange={(e) => addFiles(e.target.files)}
        />
        <input
          ref={cameraInput} type="file" accept="image/*" capture="environment"
          className="hidden" onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {pending.length > 0 && (
        <div className="rounded-md border border-border bg-muted/20 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Antrian ({pending.length})</div>
            <Button
              type="button" size="sm" onClick={upload} disabled={busy}
              data-testid={`${testKey}-submit`}
            >
              {busy ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Mengunggah… {progress}%</> : `Unggah ${pending.length} file`}
            </Button>
          </div>
          <ul className="text-xs space-y-1">
            {pending.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2 bg-background border border-border rounded px-2 py-1">
                <span className="truncate font-mono">{f.name}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{(f.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button" onClick={() => removePending(i)}
                  className="text-rose-500 hover:text-rose-700"
                  data-testid={`${testKey}-remove-${i}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
