import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Boxes, Plus, Upload, Trash2, Save, Edit, Copy, ArrowLeft, Crosshair, X,
  ImageOff, Info, LayoutGrid,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

const BACKEND = process.env.REACT_APP_BACKEND_URL || '';

const PORT_TYPES = [
  'RJ45', 'SFP', 'SFP+', 'SFP28', 'QSFP', 'QSFP+', 'QSFP28', 'QSFP-DD',
  '10GE', '25GE', '40GE', '100GE', '400GE', 'CONSOLE', 'MGMT', 'USB', 'POWER', 'STACK', 'OTHER',
];

/** List page — shows every registered template with actions */
export default function DeviceTemplateManager() {
  const { isAdmin } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTpl, setNewTpl] = useState({ vendor: '', model: '', description: '', match_patterns: '' });
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/device-templates');
      setTemplates(data.items || []);
    } catch (e) {
      toast.error('Gagal memuat template');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const createTemplate = async () => {
    if (!newTpl.vendor || !newTpl.model) { toast.error('Vendor dan Model wajib diisi'); return; }
    try {
      const body = {
        vendor: newTpl.vendor,
        model: newTpl.model,
        description: newTpl.description,
        height_u: 1,
        ports: [],
        match_patterns: newTpl.match_patterns.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const { data } = await api.post('/device-templates', body);
      toast.success('Template dibuat. Silakan upload PNG dan mapping port.');
      setShowCreate(false);
      setNewTpl({ vendor: '', model: '', description: '', match_patterns: '' });
      navigate(`/settings/device-templates/${data.id}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal membuat template');
    }
  };

  const removeTemplate = async (t) => {
    if (!window.confirm(`Hapus template "${t.vendor} ${t.model}"? Device yang memakai template ini akan otomatis fallback ke tampilan generik.`)) return;
    try {
      await api.delete(`/device-templates/${t.id}`);
      toast.success('Template dihapus');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal menghapus');
    }
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Settings' }, { label: 'Device Templates' }]} />

      <Card className="border-border/70">
        <CardContent className="p-6">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30">
                  <Boxes className="w-4 h-4 text-sky-300" />
                </span>
                <h1 className="text-xl font-semibold" style={{ fontFamily: 'Manrope' }}>
                  Device Template Engine
                </h1>
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Satu template mewakili satu model perangkat (Vendor, Model, gambar front panel PNG, mapping port berbasis persentase, tipe port, dan SNMP ifIndex). Untuk menambah model baru cukup: upload PNG, mapping port dengan klik, simpan template — tanpa mengubah source code.
              </p>
            </div>
            {isAdmin && (
              <Button onClick={() => setShowCreate((v) => !v)} data-testid="btn-new-template">
                <Plus className="w-4 h-4 mr-1" /> New Template
              </Button>
            )}
          </div>

          {showCreate && (
            <div className="mt-4 rounded-lg border border-border/60 p-4 grid grid-cols-1 md:grid-cols-2 gap-3 bg-muted/30" data-testid="new-template-form">
              <FormLine label="Vendor *">
                <Input value={newTpl.vendor} onChange={(e) => setNewTpl({ ...newTpl, vendor: e.target.value })} placeholder="MikroTik / Cisco / Huawei…" />
              </FormLine>
              <FormLine label="Model *">
                <Input value={newTpl.model} onChange={(e) => setNewTpl({ ...newTpl, model: e.target.value })} placeholder="CRS354-48G-4S+2Q+ …" />
              </FormLine>
              <FormLine label="Description" full>
                <Input value={newTpl.description} onChange={(e) => setNewTpl({ ...newTpl, description: e.target.value })} placeholder="48x GbE + 4x SFP+ + 2x QSFP+" />
              </FormLine>
              <FormLine label="Match patterns (comma-separated)" full>
                <Input value={newTpl.match_patterns} onChange={(e) => setNewTpl({ ...newTpl, match_patterns: e.target.value })} placeholder="CRS354, CRS354-48G, MikroTik-CRS354" />
                <div className="text-[11px] text-muted-foreground mt-1">Substring yang dicocokkan dengan brand+model device (case-insensitive, tanpa simbol).</div>
              </FormLine>
              <div className="md:col-span-2 flex gap-2">
                <Button onClick={createTemplate}>Create</Button>
                <Button variant="ghost" onClick={() => setShowCreate(false)}>Batal</Button>
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {loading ? (
              <div className="col-span-full text-sm text-muted-foreground">Memuat…</div>
            ) : templates.length === 0 ? (
              <div className="col-span-full text-sm text-muted-foreground">Belum ada template.</div>
            ) : templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                canEdit={isAdmin}
                onEdit={() => navigate(`/settings/device-templates/${t.id}`)}
                onDelete={() => removeTemplate(t)}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateCard({ template, canEdit, onEdit, onDelete }) {
  const imgUrl = template.image_filename
    ? `${BACKEND}/api/device-templates/${template.id}/image`
    : null;
  return (
    <div className="rounded-lg border border-border/60 bg-slate-950/40 overflow-hidden flex flex-col" data-testid={`tpl-card-${template.id}`}>
      <div className="relative bg-slate-900/60 aspect-[9/1] flex items-center justify-center">
        {imgUrl ? (
          <img src={imgUrl} alt={template.model} className="max-w-full max-h-full object-contain" />
        ) : (
          <div className="text-muted-foreground text-xs flex items-center gap-1"><ImageOff className="w-3 h-3" /> No image</div>
        )}
        {template.is_default && (
          <span className="absolute top-1.5 left-1.5 text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300">DEFAULT</span>
        )}
      </div>
      <div className="p-3 flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm truncate">{template.vendor} <span className="text-muted-foreground font-normal">·</span> {template.model}</div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border/60">{template.ports?.length || 0} ports</span>
        </div>
        {template.description && <div className="text-xs text-muted-foreground truncate">{template.description}</div>}
        {template.match_patterns?.length > 0 && (
          <div className="text-[10px] font-mono text-muted-foreground truncate">match: {template.match_patterns.join(' · ')}</div>
        )}
      </div>
      <div className="p-3 pt-0 flex items-center justify-between gap-2">
        <Button size="sm" variant="secondary" onClick={onEdit} data-testid={`btn-edit-${template.id}`}>
          <Edit className="w-3.5 h-3.5 mr-1" /> {canEdit ? 'Edit / Map Ports' : 'View'}
        </Button>
        {canEdit && !template.is_default && (
          <Button size="sm" variant="ghost" onClick={onDelete} title="Hapus template">
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Editor page — port mapping mode (click on image to place ports) */
export function DeviceTemplateEditor() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [mappingMode, setMappingMode] = useState(false);
  const [tool, setTool] = useState({ type: 'RJ45', width: 1.2, height: 25, autoNumber: true });
  const [nextIdCounter, setNextIdCounter] = useState(1);
  const [selectedPortId, setSelectedPortId] = useState(null);
  const imgRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/device-templates/${id}`);
      setTemplate(data);
    } catch {
      toast.error('Template tidak ditemukan');
      navigate('/settings/device-templates');
    } finally { setLoading(false); }
  }, [id, navigate]);
  useEffect(() => { load(); }, [load]);

  const imgUrl = template?.image_filename ? `${BACKEND}/api/device-templates/${id}/image?t=${template.updated_at}` : null;

  const onImageClick = (e) => {
    if (!mappingMode || !isAdmin) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100 - tool.width / 2;
    const y = ((e.clientY - rect.top) / rect.height) * 100 - tool.height / 2;
    const num = tool.autoNumber ? nextIdCounter : null;
    const idBase = tool.type.toLowerCase().replace(/[^a-z0-9]/g, '');
    const portId = tool.autoNumber ? `${idBase}${num}` : `${idBase}${Date.now().toString(36)}`;
    const newPort = {
      id: portId,
      label: tool.autoNumber ? String(num) : '',
      type: tool.type,
      number: tool.autoNumber ? num : null,
      x: Math.max(0, Math.min(100 - tool.width, x)),
      y: Math.max(0, Math.min(100 - tool.height, y)),
      width: tool.width,
      height: tool.height,
      if_index: tool.autoNumber ? num : null,
      if_name_hint: '',
    };
    setTemplate((t) => ({ ...t, ports: [...(t.ports || []), newPort] }));
    setNextIdCounter((n) => n + 1);
    setSelectedPortId(portId);
    setDirty(true);
  };

  const updatePort = (pid, patch) => {
    setTemplate((t) => ({
      ...t,
      ports: t.ports.map((p) => (p.id === pid ? { ...p, ...patch } : p)),
    }));
    setDirty(true);
  };
  const removePort = (pid) => {
    setTemplate((t) => ({ ...t, ports: t.ports.filter((p) => p.id !== pid) }));
    setSelectedPortId(null);
    setDirty(true);
  };
  const clearAllPorts = () => {
    if (!window.confirm('Hapus semua port mapping?')) return;
    setTemplate((t) => ({ ...t, ports: [] }));
    setSelectedPortId(null);
    setDirty(true);
  };

  const save = async () => {
    try {
      const body = {
        vendor: template.vendor, model: template.model,
        description: template.description || '',
        height_u: template.height_u || 1,
        image_filename: template.image_filename || null,
        ports: template.ports || [],
        match_patterns: template.match_patterns || [],
      };
      await api.put(`/device-templates/${id}`, body);
      toast.success('Template tersimpan');
      setDirty(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal menyimpan');
    }
  };

  const uploadImage = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/device-templates/${id}/image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('PNG di-upload');
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Upload gagal');
    }
  };

  const selected = template?.ports?.find((p) => p.id === selectedPortId);

  if (loading || !template) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[
        { label: 'Settings' },
        { label: 'Device Templates', to: '/settings/device-templates' },
        { label: `${template.vendor} · ${template.model}` },
      ]} />

      <Card className="border-border/70">
        <CardContent className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => navigate('/settings/device-templates')}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <h2 className="text-lg font-semibold" style={{ fontFamily: 'Manrope' }}>
                  {template.vendor} · {template.model}
                </h2>
                {template.is_default && <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300">DEFAULT</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <>
                  <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                    <input type="file" accept="image/png" className="hidden" onChange={(e) => uploadImage(e.target.files?.[0])} data-testid="upload-png" />
                    <span className="px-3 py-1.5 rounded-md border border-border/60 bg-background hover:bg-accent inline-flex items-center gap-1">
                      <Upload className="w-3.5 h-3.5" /> Upload PNG
                    </span>
                  </label>
                  <Button variant={mappingMode ? 'default' : 'secondary'} size="sm" onClick={() => setMappingMode((v) => !v)} data-testid="btn-mapping-mode">
                    <Crosshair className="w-4 h-4 mr-1" />
                    {mappingMode ? 'Exit Mapping Mode' : 'Mapping Mode'}
                  </Button>
                  <Button size="sm" onClick={save} disabled={!dirty} data-testid="btn-save-template">
                    <Save className="w-4 h-4 mr-1" /> Save {dirty && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Toolbar mapping */}
          {mappingMode && isAdmin && (
            <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-3 space-y-2" data-testid="mapping-toolbar">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-semibold text-sky-200">Mapping Mode aktif</span>
                <span className="text-muted-foreground">— klik di gambar untuk menambah port. Drag box hasil untuk memindahkan posisi. Klik port existing untuk edit.</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Field small label="Port Type">
                  <select className="input-small" value={tool.type} onChange={(e) => setTool({ ...tool, type: e.target.value })}>
                    {PORT_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field small label="Width %"><input type="number" step="0.1" className="input-small w-16" value={tool.width} onChange={(e) => setTool({ ...tool, width: Number(e.target.value) })} /></Field>
                <Field small label="Height %"><input type="number" step="0.5" className="input-small w-16" value={tool.height} onChange={(e) => setTool({ ...tool, height: Number(e.target.value) })} /></Field>
                <Field small label="Auto-number">
                  <input type="checkbox" checked={tool.autoNumber} onChange={(e) => setTool({ ...tool, autoNumber: e.target.checked })} />
                </Field>
                {tool.autoNumber && <Field small label="Next #"><input type="number" className="input-small w-16" value={nextIdCounter} onChange={(e) => setNextIdCounter(Number(e.target.value))} /></Field>}
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={clearAllPorts}><Trash2 className="w-3.5 h-3.5 mr-1" /> Clear all</Button>
              </div>
            </div>
          )}

          {/* Image + overlay */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <div className="relative rounded-lg border border-border/60 overflow-auto bg-slate-950/40" data-testid="template-canvas">
              {imgUrl ? (
                <div className="relative inline-block min-w-full">
                  <img
                    ref={imgRef}
                    src={imgUrl}
                    alt={template.model}
                    className={cn('block max-w-full select-none', mappingMode && 'cursor-crosshair')}
                    onClick={onImageClick}
                    draggable={false}
                    style={{ minWidth: 1000 }}
                  />
                  {template.ports?.map((p) => (
                    <PortHandle
                      key={p.id}
                      port={p}
                      selected={selectedPortId === p.id}
                      editable={mappingMode && isAdmin}
                      containerRef={imgRef}
                      onSelect={() => setSelectedPortId(p.id)}
                      onMove={(patch) => updatePort(p.id, patch)}
                    />
                  ))}
                </div>
              ) : (
                <div className="aspect-[9/1] flex items-center justify-center text-sm text-muted-foreground">
                  Belum ada PNG. Klik <b className="mx-1">Upload PNG</b> di atas.
                </div>
              )}
            </div>

            {/* Selected port editor */}
            <div className="rounded-lg border border-border/60 bg-slate-950/40 p-3 space-y-3 min-h-[300px]">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                  {selected ? 'Edit Port' : 'Port List'}
                </div>
                <span className="text-[10px] text-muted-foreground">{template.ports?.length || 0} ports</span>
              </div>

              {selected ? (
                <div className="space-y-2 text-sm">
                  <FormLine small label="Interface ID">
                    <Input value={selected.id} onChange={(e) => updatePort(selected.id, { id: e.target.value })} className="font-mono text-[13px]" />
                  </FormLine>
                  <FormLine small label="Label">
                    <Input value={selected.label} onChange={(e) => updatePort(selected.id, { label: e.target.value })} />
                  </FormLine>
                  <FormLine small label="Type">
                    <select className="input-small w-full" value={selected.type} onChange={(e) => updatePort(selected.id, { type: e.target.value })}>
                      {PORT_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </FormLine>
                  <div className="grid grid-cols-2 gap-2">
                    <FormLine small label="Number"><Input type="number" value={selected.number ?? ''} onChange={(e) => updatePort(selected.id, { number: e.target.value ? Number(e.target.value) : null })} /></FormLine>
                    <FormLine small label="SNMP ifIndex"><Input type="number" value={selected.if_index ?? ''} onChange={(e) => updatePort(selected.id, { if_index: e.target.value ? Number(e.target.value) : null })} /></FormLine>
                  </div>
                  <FormLine small label="SNMP name hint">
                    <Input value={selected.if_name_hint || ''} onChange={(e) => updatePort(selected.id, { if_name_hint: e.target.value })} placeholder="ether1 / sfp-sfpplus1 / 10GE1/0/1" />
                  </FormLine>
                  <div className="grid grid-cols-4 gap-2">
                    <FormLine small label="x%"><Input type="number" step="0.1" value={selected.x.toFixed(2)} onChange={(e) => updatePort(selected.id, { x: Number(e.target.value) })} /></FormLine>
                    <FormLine small label="y%"><Input type="number" step="0.1" value={selected.y.toFixed(2)} onChange={(e) => updatePort(selected.id, { y: Number(e.target.value) })} /></FormLine>
                    <FormLine small label="w%"><Input type="number" step="0.1" value={selected.width.toFixed(2)} onChange={(e) => updatePort(selected.id, { width: Number(e.target.value) })} /></FormLine>
                    <FormLine small label="h%"><Input type="number" step="0.1" value={selected.height.toFixed(2)} onChange={(e) => updatePort(selected.id, { height: Number(e.target.value) })} /></FormLine>
                  </div>
                  <div className="flex justify-between">
                    <Button size="sm" variant="ghost" onClick={() => removePort(selected.id)}><Trash2 className="w-3.5 h-3.5 mr-1 text-rose-400" /> Remove</Button>
                    <Button size="sm" variant="secondary" onClick={() => setSelectedPortId(null)}><X className="w-3.5 h-3.5 mr-1" /> Deselect</Button>
                  </div>
                </div>
              ) : (
                <div className="max-h-[400px] overflow-auto text-[12px] font-mono space-y-0.5">
                  {(template.ports || []).length === 0 ? (
                    <div className="text-muted-foreground text-center py-8">
                      <LayoutGrid className="w-6 h-6 mx-auto mb-1 opacity-40" />
                      Aktifkan <b>Mapping Mode</b> lalu klik pada gambar untuk menambah port.
                    </div>
                  ) : (
                    (template.ports || []).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPortId(p.id)}
                        className="w-full text-left px-2 py-1 rounded hover:bg-accent flex items-center justify-between"
                      >
                        <span className="truncate">{p.id}</span>
                        <span className="text-muted-foreground text-[10px]">{p.type}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground flex items-start gap-2 border border-border/60 rounded-md p-2 bg-muted/20">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              <b>Tips:</b> Koordinat menggunakan <b>persentase</b> — akurat pada semua ukuran layar & saat zoom. `if_name_hint` dipakai untuk mencocokkan interface SNMP (mis. RouterOS `sfp-sfpplus1`).
            </div>
          </div>
        </CardContent>
      </Card>

      <style>{`
        .input-small { padding: 0.25rem 0.5rem; font-size: 12px; border-radius: 4px; border: 1px solid hsl(var(--border)); background: hsl(var(--background)); }
      `}</style>
    </div>
  );
}

function PortHandle({ port, selected, editable, containerRef, onSelect, onMove }) {
  const [drag, setDrag] = useState(null);
  const onMouseDown = (e) => {
    if (!editable) { onSelect(); return; }
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const rect = containerRef.current.getBoundingClientRect();
    setDrag({ startX: e.clientX, startY: e.clientY, portX: port.x, portY: port.y, rect });
  };
  useEffect(() => {
    if (!drag) return;
    const onMove2 = (e) => {
      const dx = ((e.clientX - drag.startX) / drag.rect.width) * 100;
      const dy = ((e.clientY - drag.startY) / drag.rect.height) * 100;
      onMove({
        x: Math.max(0, Math.min(100 - port.width, drag.portX + dx)),
        y: Math.max(0, Math.min(100 - port.height, drag.portY + dy)),
      });
    };
    const onUp = () => setDrag(null);
    document.addEventListener('mousemove', onMove2);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove2); document.removeEventListener('mouseup', onUp); };
  }, [drag, onMove, port.width, port.height]);
  return (
    <div
      className={cn(
        'absolute cursor-pointer transition-colors',
        selected ? 'ring-2 ring-sky-400 shadow-[0_0_12px_2px_rgba(56,189,248,0.6)] z-30' : 'ring-1 ring-emerald-300/70',
      )}
      style={{
        left: `${port.x}%`,
        top: `${port.y}%`,
        width: `${port.width}%`,
        height: `${port.height}%`,
        background: selected ? 'rgba(56,189,248,0.35)' : 'rgba(16,185,129,0.28)',
      }}
      onMouseDown={onMouseDown}
      title={`${port.id} · ${port.type}`}
      data-testid={`handle-${port.id}`}
    />
  );
}

function FormLine({ label, children, full, small }) {
  return (
    <div className={cn(full && 'md:col-span-2')}>
      <div className={cn('text-muted-foreground font-mono uppercase tracking-widest mb-1',
        small ? 'text-[10px]' : 'text-[11px]')}>{label}</div>
      {children}
    </div>
  );
}
function Field({ label, children, small }) {
  return (
    <label className={cn('inline-flex items-center gap-1.5', small && 'text-[11px]')}>
      <span className="text-muted-foreground font-mono uppercase tracking-widest">{label}</span>
      {children}
    </label>
  );
}
