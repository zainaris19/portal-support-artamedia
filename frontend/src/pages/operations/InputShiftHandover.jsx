import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import {
  Plus, Save, Send, Trash2, ChevronDown, ChevronUp, Copy, GripVertical, Users,
  Ticket, Info, ClipboardList, ArrowLeft, RefreshCw, ArrowUp, ArrowDown, Layers, Loader2, Camera, X,
} from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import {
  SHIFT_CODES, SHIFT_HOURS, CASE_STATUSES, PRIORITIES,
  CaseStatusBadge, CasePriorityBadge, HandoverStatusBadge,
  CarryOverBadge, jktToday, fmtDate,
} from './handoverUtils';
import { cn } from '@/lib/utils';

const EMPTY_CASE = {
  customer_id: null, customer_name: '', location: '', category: '',
  ticket_id: null, ticket_number: null,
  case_detail: '', action_taken: '', current_condition: '', next_action: '',
  assigned_pic: '', priority: 'Medium', status: 'Open',
  follow_up_at: null, previous_case_id: null, carry_over_count: 0,
  attachment_ids: [],
};

export default function InputShiftHandover() {
  const nav = useNavigate();
  const { id: routeId } = useParams();
  const { user, hasRole } = useAuth();
  const { refresh: refreshCounts } = useCounts();

  const isSupervisor = hasRole('admin', 'supervisor');

  const [loading, setLoading] = useState(!!routeId);
  const [handover, setHandover] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [technicians, setTechnicians] = useState([]);

  const [meta, setMeta] = useState({
    handover_date: jktToday(),
    shift_code: 'R1',
    worker_name: user?.name || '',
    receiver_id: null,
    receiver_name: '',
    general_notes: '',
  });
  const [cases, setCases] = useState([{ ...EMPTY_CASE, id: 'draft-1' }]);
  const [openIdx, setOpenIdx] = useState(new Set([0]));
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [carryOverOpen, setCarryOverOpen] = useState(false);

  // Load existing handover if editing
  useEffect(() => {
    api.get('/customers', { params: { page_size: 1000 } }).then(({ data }) => setCustomers(data.items || []));
    api.get('/crm/technicians').then(({ data }) => setTechnicians(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!routeId) return;
    setLoading(true);
    api.get(`/ops/handovers/${routeId}`)
      .then(({ data }) => {
        setHandover(data);
        setMeta({
          handover_date: data.handover_date,
          shift_code: data.shift_code,
          worker_name: data.worker_name,
          receiver_id: data.receiver_id,
          receiver_name: data.receiver_name || '',
          general_notes: data.general_notes || '',
        });
        setCases(data.cases || []);
        setOpenIdx(new Set(data.cases?.length ? [0] : []));
      })
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => setLoading(false));
  }, [routeId]);

  const isEditingSubmitted = handover && !['Draft', 'Returned'].includes(handover.status);
  const readOnly = isEditingSubmitted && !isSupervisor;

  const updateCase = (idx, patch) => {
    setCases((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const addCase = (initial = EMPTY_CASE) => {
    setCases((prev) => [...prev, { ...initial, id: `draft-${prev.length + Date.now()}` }]);
    setOpenIdx((prev) => new Set([...prev, cases.length]));
  };

  const removeCase = (idx) => {
    if (readOnly) return;
    if (!window.confirm('Hapus case ini?')) return;
    setCases((prev) => prev.filter((_, i) => i !== idx));
  };

  const duplicateCase = (idx) => {
    setCases((prev) => {
      const copy = { ...prev[idx], id: `draft-${Date.now()}`, previous_case_id: null, carry_over_count: 0, attachment_ids: [] };
      copy.case_detail = (copy.case_detail || '') + ' (copy)';
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };

  const moveCase = (idx, dir) => {
    setCases((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });
  };

  const toggle = (idx) => {
    setOpenIdx((prev) => {
      const n = new Set(prev);
      n.has(idx) ? n.delete(idx) : n.add(idx);
      return n;
    });
  };

  const validate = (submitting = false) => {
    if (!cases.length) { toast.error('Minimal 1 case wajib'); return false; }
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (!c.customer_name?.trim() && !c.location?.trim() && !c.case_detail?.trim()) {
        toast.error(`Case #${i + 1}: minimal isi customer/lokasi/detail`); setOpenIdx(new Set([i])); return false;
      }
      if (submitting && !c.case_detail?.trim()) {
        toast.error(`Case #${i + 1}: detail case wajib sebelum submit`); setOpenIdx(new Set([i])); return false;
      }
    }
    return true;
  };

  const buildPayload = () => ({
    ...meta,
    cases: cases.map((c) => ({
      customer_id: c.customer_id || null, customer_name: c.customer_name || '',
      location: c.location || '', category: c.category || '',
      ticket_id: c.ticket_id || null, ticket_number: c.ticket_number || null,
      case_detail: c.case_detail || '', action_taken: c.action_taken || '',
      current_condition: c.current_condition || '', next_action: c.next_action || '',
      assigned_pic: c.assigned_pic || '', priority: c.priority || 'Medium',
      status: c.status || 'Open', follow_up_at: c.follow_up_at || null,
      previous_case_id: c.previous_case_id || null,
      carry_over_count: c.carry_over_count || 0,
      attachment_ids: c.attachment_ids || [],
    })),
  });

  const saveDraft = async () => {
    if (!validate(false)) return;
    setSaving(true);
    try {
      if (handover) {
        // Update meta first
        await api.put(`/ops/handovers/${handover.id}`, {
          handover_date: meta.handover_date, shift_code: meta.shift_code,
          receiver_id: meta.receiver_id, receiver_name: meta.receiver_name,
          general_notes: meta.general_notes,
        });
        // Sync cases: add new, update changed, delete removed
        const existingIds = new Set((handover.cases || []).map((c) => c.id));
        const currentIds = new Set(cases.map((c) => c.id).filter((id) => !String(id).startsWith('draft-')));
        // Delete removed
        for (const oldId of existingIds) if (!currentIds.has(oldId)) await api.delete(`/ops/handovers/${handover.id}/cases/${oldId}`);
        // Add or update
        for (const c of cases) {
          const payload = {
            customer_id: c.customer_id || null, customer_name: c.customer_name || '',
            location: c.location || '', category: c.category || '',
            ticket_id: c.ticket_id || null, ticket_number: c.ticket_number || null,
            case_detail: c.case_detail || '', action_taken: c.action_taken || '',
            current_condition: c.current_condition || '', next_action: c.next_action || '',
            assigned_pic: c.assigned_pic || '', priority: c.priority || 'Medium',
            status: c.status || 'Open', follow_up_at: c.follow_up_at || null,
            previous_case_id: c.previous_case_id || null,
            carry_over_count: c.carry_over_count || 0,
            attachment_ids: c.attachment_ids || [],
          };
          if (String(c.id).startsWith('draft-')) {
            await api.post(`/ops/handovers/${handover.id}/cases`, payload);
          } else {
            await api.put(`/ops/handovers/${handover.id}/cases/${c.id}`, payload);
          }
        }
        toast.success('Draft disimpan');
        // reload
        const { data } = await api.get(`/ops/handovers/${handover.id}`);
        setHandover(data); setCases(data.cases || []);
      } else {
        const { data } = await api.post('/ops/handovers', buildPayload());
        toast.success(`Draft ${data.handover_number} disimpan`);
        setHandover(data); setCases(data.cases || []);
        nav(`/operations/shift-handover/edit/${data.id}`, { replace: true });
      }
      refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  const submitHandover = async () => {
    if (!validate(true)) return;
    if (!window.confirm(`Submit handover${handover ? ` ${handover.handover_number}` : ''}? Setelah submit, hanya supervisor/admin yang dapat mengedit.`)) return;
    setSaving(true);
    try {
      // Ensure draft exists first
      let h = handover;
      if (!h) {
        const { data } = await api.post('/ops/handovers', buildPayload());
        h = data;
      } else {
        await saveDraft(); // will refresh
        const { data } = await api.get(`/ops/handovers/${h.id}`);
        h = data;
      }
      await api.post(`/ops/handovers/${h.id}/submit`);
      toast.success('Handover di-submit');
      refreshCounts();
      nav(`/operations/shift-handover/${h.id}`);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  const takeCarryOver = (selected) => {
    // selected: array of {handover_id, handover_number, case}
    const newOnes = selected.map((s) => ({
      ...EMPTY_CASE,
      ...s.case,
      id: `draft-${Date.now()}-${s.case.id}`,
      previous_case_id: s.case.id,
      carry_over_count: (s.case.carry_over_count || 0) + 1,
      attachment_ids: [],
    }));
    setCases((prev) => [...prev, ...newOnes]);
    setOpenIdx((prev) => new Set([...prev, ...newOnes.map((_, i) => cases.length + i)]));
    setCarryOverOpen(false);
    toast.success(`${newOnes.length} case dibawa dari shift sebelumnya`);
  };

  if (loading) return (
    <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /></div>
  );

  return (
    <div className="pb-24">
      <Breadcrumb items={[{ label: 'Operasional NOC' }, { label: handover ? `Edit ${handover.handover_number}` : 'Input Shift Handover' }]} />

      <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>
            {handover ? `Edit Handover ${handover.handover_number}` : 'Input Shift Handover NOC'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Serah terima shift NOC lengkap dengan case, integrasi ticket CRM, dan lampiran.</p>
        </div>
        {handover && <div className="text-right"><HandoverStatusBadge value={handover.status} /></div>}
      </div>

      {/* Meta card */}
      <Card className="border-border mt-3">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <F label="Nama Petugas *">
            {isSupervisor ? (
              <Input value={meta.worker_name} onChange={(e) => setMeta({ ...meta, worker_name: e.target.value })} data-testid="handover-worker-name" disabled={readOnly} />
            ) : (
              <Input value={meta.worker_name || user?.name || '—'} disabled data-testid="handover-worker-name" />
            )}
            <div className="text-[10px] text-muted-foreground mt-0.5">Otomatis dari akun login. Admin/Supervisor dapat mengubah.</div>
          </F>
          <F label="Tanggal Handover *">
            <Input type="date" value={meta.handover_date} onChange={(e) => setMeta({ ...meta, handover_date: e.target.value })} data-testid="handover-date" disabled={readOnly} />
          </F>
          <F label="Kode Shift *">
            <Select value={meta.shift_code} onValueChange={(v) => setMeta({ ...meta, shift_code: v })} disabled={readOnly}>
              <SelectTrigger data-testid="handover-shift"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SHIFT_CODES.map((s) => (
                  <SelectItem key={s} value={s}>{s} — {SHIFT_HOURS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Penerima Shift">
            <Select value={meta.receiver_id || 'none'} onValueChange={(v) => {
              if (v === 'none') return setMeta({ ...meta, receiver_id: null, receiver_name: '' });
              const u = technicians.find((x) => x.id === v);
              setMeta({ ...meta, receiver_id: v, receiver_name: u?.name || '' });
            }} disabled={readOnly}>
              <SelectTrigger data-testid="handover-receiver"><SelectValue placeholder="Pilih penerima…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Belum ditentukan —</SelectItem>
                {technicians.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>)}
              </SelectContent>
            </Select>
          </F>
          <F label="Catatan Umum Shift" full>
            <Textarea rows={2} value={meta.general_notes} onChange={(e) => setMeta({ ...meta, general_notes: e.target.value })} placeholder="Catatan umum untuk shift berikutnya…" data-testid="handover-general-notes" disabled={readOnly} />
          </F>
        </CardContent>
      </Card>

      {/* Cases header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4 mb-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>Case ({cases.length})</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setCarryOverOpen(true)} data-testid="handover-open-carry" disabled={readOnly}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Ambil Case Shift Sebelumnya
          </Button>
          <Button size="sm" onClick={() => addCase()} data-testid="handover-add-case" disabled={readOnly}>
            <Plus className="w-4 h-4 mr-1.5" /> Tambah Case
          </Button>
        </div>
      </div>

      {/* Cases list */}
      <div className="space-y-2">
        {cases.map((c, idx) => (
          <CaseCard
            key={c.id || idx}
            idx={idx}
            c={c}
            open={openIdx.has(idx)}
            readOnly={readOnly}
            customers={customers}
            onToggle={() => toggle(idx)}
            onChange={(patch) => updateCase(idx, patch)}
            onDuplicate={() => duplicateCase(idx)}
            onRemove={() => removeCase(idx)}
            onMoveUp={() => moveCase(idx, -1)}
            onMoveDown={() => moveCase(idx, 1)}
            handoverId={handover?.id}
          />
        ))}
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 border-t border-border bg-background/95 backdrop-blur-sm p-3 z-30" data-testid="handover-action-bar">
        <div className="max-w-full flex flex-wrap gap-2 items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {handover ? <>Status: <HandoverStatusBadge value={handover.status} /></> : <>Belum disimpan</>}
            {' · '}
            <span className="font-mono">{cases.length} case</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} data-testid="handover-preview">Preview</Button>
            <Button variant="outline" size="sm" onClick={saveDraft} disabled={saving || readOnly} data-testid="handover-save-draft">
              <Save className="w-4 h-4 mr-1.5" /> Simpan Draft
            </Button>
            <Button size="sm" onClick={submitHandover} disabled={saving || readOnly} data-testid="handover-submit">
              <Send className="w-4 h-4 mr-1.5" /> Submit Handover
            </Button>
          </div>
        </div>
      </div>

      {previewOpen && (
        <PreviewSheet
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          meta={meta}
          cases={cases}
          user={user}
        />
      )}
      {carryOverOpen && (
        <CarryOverSheet
          open={carryOverOpen}
          onOpenChange={setCarryOverOpen}
          onTake={takeCarryOver}
          currentId={handover?.id}
        />
      )}
    </div>
  );
}

function F({ label, full, children }) {
  return (
    <div className={cn(full && 'md:col-span-3', 'space-y-1.5')}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CaseCard({ idx, c, open, readOnly, customers, onToggle, onChange, onDuplicate, onRemove, onMoveUp, onMoveDown, handoverId }) {
  return (
    <Card className={cn('border-border', c.carry_over_count >= 3 && 'border-rose-500/40')} data-testid={`case-card-${idx}`}>
      <CardContent className="p-3">
        {/* Header row */}
        <div className="flex items-center gap-2 cursor-pointer" onClick={onToggle}>
          <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-mono font-bold w-6 text-center bg-muted rounded px-1">#{idx + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {c.customer_name || c.location || <span className="italic text-muted-foreground">Case baru</span>}
              {c.ticket_number && <span className="ml-2 text-xs font-mono text-primary">· {c.ticket_number}</span>}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{c.case_detail || '—'}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <CasePriorityBadge value={c.priority} />
            <CaseStatusBadge value={c.status} />
            {c.carry_over_count > 0 && <CarryOverBadge count={c.carry_over_count} />}
            <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} className="p-1 hover:bg-muted rounded" data-testid={`case-move-up-${idx}`}><ArrowUp className="w-3.5 h-3.5" /></button>
            <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} className="p-1 hover:bg-muted rounded" data-testid={`case-move-down-${idx}`}><ArrowDown className="w-3.5 h-3.5" /></button>
            <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-1 hover:bg-muted rounded" data-testid={`case-duplicate-${idx}`}><Copy className="w-3.5 h-3.5" /></button>
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1 hover:bg-rose-500/20 hover:text-rose-600 rounded" data-testid={`case-remove-${idx}`}><Trash2 className="w-3.5 h-3.5" /></button>
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>

        {open && (
          <div className="mt-3 pt-3 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <F2 label="Customer / Client">
              <CustomerAutocomplete
                customers={customers}
                value={c.customer_id}
                displayValue={c.customer_name}
                onChange={(id, name, loc) => onChange({ customer_id: id, customer_name: name, location: loc || c.location })}
                disabled={readOnly}
                testId={`case-customer-${idx}`}
              />
            </F2>
            <F2 label="Lokasi / Site">
              <Input value={c.location} onChange={(e) => onChange({ location: e.target.value })} placeholder="Site / DC / kota" data-testid={`case-location-${idx}`} disabled={readOnly} />
            </F2>
            <F2 label="Kategori Case">
              <Input value={c.category} onChange={(e) => onChange({ category: e.target.value })} placeholder="mis. Link Down, PL, Hardware" data-testid={`case-category-${idx}`} disabled={readOnly} />
            </F2>
            <F2 label="Nomor Ticket CRM (opsional)">
              <TicketPicker
                value={c.ticket_number}
                onChange={(t) => {
                  if (!t) return onChange({ ticket_id: null, ticket_number: null });
                  onChange({
                    ticket_id: t.id, ticket_number: t.ticket_number,
                    customer_id: t.customer_id || c.customer_id,
                    customer_name: t.customer_name || c.customer_name,
                    location: t.location || c.location,
                    category: t.category_name || c.category,
                    priority: t.priority || c.priority,
                    assigned_pic: t.troubleshooter_name || c.assigned_pic,
                  });
                }}
                disabled={readOnly}
                testId={`case-ticket-${idx}`}
              />
            </F2>
            <F2 label="Detail Case *" full>
              <Textarea rows={2} value={c.case_detail} onChange={(e) => onChange({ case_detail: e.target.value })} placeholder="Jelaskan pekerjaan / gangguan…" data-testid={`case-detail-${idx}`} disabled={readOnly} />
            </F2>
            <F2 label="Action Taken">
              <Textarea rows={2} value={c.action_taken} onChange={(e) => onChange({ action_taken: e.target.value })} placeholder="Tindakan yang sudah dilakukan" data-testid={`case-action-${idx}`} disabled={readOnly} />
            </F2>
            <F2 label="Current Condition">
              <Textarea rows={2} value={c.current_condition} onChange={(e) => onChange({ current_condition: e.target.value })} placeholder="Kondisi saat ini" data-testid={`case-condition-${idx}`} disabled={readOnly} />
            </F2>
            <F2 label="Next Action" full>
              <Textarea rows={2} value={c.next_action} onChange={(e) => onChange({ next_action: e.target.value })} placeholder="Yang perlu dilakukan shift berikutnya" data-testid={`case-next-${idx}`} disabled={readOnly} />
            </F2>
            <F2 label="PIC (sedang menangani)">
              <Input value={c.assigned_pic} onChange={(e) => onChange({ assigned_pic: e.target.value })} placeholder="Nama PIC / teknisi" data-testid={`case-pic-${idx}`} disabled={readOnly} />
            </F2>
            <F2 label="Prioritas">
              <Select value={c.priority} onValueChange={(v) => onChange({ priority: v })} disabled={readOnly}>
                <SelectTrigger data-testid={`case-priority-select-${idx}`}><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </F2>
            <F2 label="Status Case">
              <Select value={c.status} onValueChange={(v) => onChange({ status: v })} disabled={readOnly}>
                <SelectTrigger data-testid={`case-status-select-${idx}`}><SelectValue /></SelectTrigger>
                <SelectContent>{CASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </F2>
            <F2 label="Target Follow-up">
              <Input type="datetime-local" value={c.follow_up_at ? c.follow_up_at.slice(0, 16) : ''} onChange={(e) => onChange({ follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })} data-testid={`case-followup-${idx}`} disabled={readOnly} />
            </F2>

            {handoverId && !String(c.id).startsWith('draft-') && (
              <F2 label="Lampiran" full>
                <CaseAttachments handoverId={handoverId} caseId={c.id} disabled={readOnly} onChange={(ids) => onChange({ attachment_ids: ids })} />
              </F2>
            )}
            {handoverId && String(c.id).startsWith('draft-') && (
              <F2 label="Lampiran" full>
                <div className="text-xs text-muted-foreground italic">Simpan draft dulu untuk mengunggah lampiran ke case ini.</div>
              </F2>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function F2({ label, full, children }) {
  return (
    <div className={cn(full && 'md:col-span-2', 'space-y-1')}>
      <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground font-mono">{label}</Label>
      {children}
    </div>
  );
}

function CustomerAutocomplete({ customers, value, displayValue, onChange, disabled, testId }) {
  const [open, setOpen] = useState(false);
  const current = customers.find((c) => c.id === value);
  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between h-9 font-normal text-left" disabled={disabled} data-testid={testId}>
            {current ? <span className="truncate"><span className="font-medium">{current.company_name}</span> <span className="text-muted-foreground text-xs">· {current.sid}</span></span> : <span className="text-muted-foreground">{displayValue || 'Pilih dari daftar customer…'}</span>}
            <Users className="w-4 h-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Cari nama / SID…" />
            <CommandList className="max-h-72">
              <CommandEmpty>Tidak ditemukan.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="none" onSelect={() => { onChange(null, '', null); setOpen(false); }}>
                  <span className="text-muted-foreground italic">— Kosongkan / ketik manual —</span>
                </CommandItem>
                {customers.map((c) => (
                  <CommandItem key={c.id} value={`${c.company_name} ${c.sid}`} onSelect={() => { onChange(c.id, c.company_name, c.location); setOpen(false); }}>
                    <div className="min-w-0 flex-1"><div className="text-sm truncate font-medium">{c.company_name}</div><div className="text-[11px] text-muted-foreground truncate">{c.sid} · {c.location}</div></div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        value={displayValue || ''}
        onChange={(e) => onChange(null, e.target.value, null)}
        placeholder="…atau ketik manual nama customer/client"
        disabled={disabled}
        data-testid={`${testId}-manual`}
        className="h-8 text-xs"
      />
    </div>
  );
}

function TicketPicker({ value, onChange, disabled, testId }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/crm/tickets', { params: { q, page_size: 25 } })
      .then(({ data }) => setItems(data.items || []))
      .finally(() => setLoading(false));
  }, [open, q]);
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="flex-1 justify-between h-9 font-normal text-left" disabled={disabled} data-testid={testId}>
              {value ? <span className="truncate font-mono text-primary">{value}</span> : <span className="text-muted-foreground">Pilih dari CRM…</span>}
              <Ticket className="w-4 h-4 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[420px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="TCK-… atau customer" value={q} onValueChange={setQ} />
              <CommandList className="max-h-72">
                {loading && <div className="p-3 text-xs text-muted-foreground text-center"><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> Memuat…</div>}
                {!loading && items.length === 0 && <CommandEmpty>Ticket tidak ditemukan.</CommandEmpty>}
                <CommandGroup>
                  {items.map((t) => (
                    <CommandItem key={t.id} value={`${t.ticket_number} ${t.customer_name}`} onSelect={() => { onChange(t); setOpen(false); }}>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-mono font-semibold">{t.ticket_number}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{t.customer_name} · {t.category_name} · {t.status}</div>
                      </div>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border">{t.priority}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {value && !disabled && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} data-testid={`${testId}-clear`}><X className="w-4 h-4" /></Button>
        )}
      </div>
      <Input
        value={value || ''}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return onChange(null);
          // Manual entry — no CRM link. Only ticket_number is set; other case fields kept as-is by parent handler.
          onChange({ id: null, ticket_number: v });
        }}
        placeholder="…atau ketik nomor ticket manual (TCK-… / internal)"
        disabled={disabled}
        data-testid={`${testId}-manual`}
        className="h-8 text-xs font-mono"
      />
    </div>
  );
}

function CaseAttachments({ handoverId, caseId, disabled, onChange }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = React.useRef(null);
  const load = useCallback(() => {
    api.get(`/ops/handovers/${handoverId}/files`).then(({ data }) => setFiles((data || []).filter((f) => f.case_id === caseId)));
  }, [handoverId, caseId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (list) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(list).forEach((f) => fd.append('files', f));
      fd.append('case_id', caseId);
      await api.post(`/ops/handovers/${handoverId}/files`, fd);
      toast.success('File diunggah');
      load();
      onChange?.((files || []).map((f) => f.id));
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setUploading(false); }
  };

  const del = async (f) => {
    if (!window.confirm(`Hapus ${f.original_file_name}?`)) return;
    try { await api.delete(`/ops/handovers/${handoverId}/files/${f.id}`); load(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={disabled || uploading} data-testid={`case-upload-${caseId}`}>
          {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Camera className="w-3.5 h-3.5 mr-1.5" />}
          Upload
        </Button>
        <input ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={(e) => upload(e.target.files)} />
        <span className="text-[10px] text-muted-foreground">JPG/PNG/WEBP/PDF · max 20 MB</span>
      </div>
      {files.length > 0 && (
        <ul className="text-xs space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between border border-border rounded px-2 py-1 bg-muted/30">
              <span className="truncate flex-1 font-mono">{f.original_file_name}</span>
              <span className="text-[10px] text-muted-foreground ml-2 shrink-0">{(f.file_size / 1024).toFixed(0)} KB</span>
              {!disabled && <button className="ml-2 text-rose-500 hover:text-rose-700" onClick={() => del(f)}><Trash2 className="w-3.5 h-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PreviewSheet({ open, onOpenChange, meta, cases, user }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="handover-preview-sheet">
        <SheetHeader>
          <SheetTitle>Preview Handover</SheetTitle>
          <SheetDescription>Ringkasan sebelum submit.</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><div className="text-[10px] uppercase text-muted-foreground">Petugas</div><div className="font-medium">{meta.worker_name || user?.name}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Penerima</div><div className="font-medium">{meta.receiver_name || '—'}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Tanggal</div><div className="font-mono">{meta.handover_date}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Shift</div><div className="font-mono">{meta.shift_code} · {SHIFT_HOURS[meta.shift_code]}</div></div>
          </div>
          {meta.general_notes && (
            <div><div className="text-[10px] uppercase text-muted-foreground mb-1">Catatan Umum</div><div className="text-sm whitespace-pre-wrap border border-border rounded p-2 bg-muted/30">{meta.general_notes}</div></div>
          )}
          <div><div className="text-[10px] uppercase text-muted-foreground mb-1">Case ({cases.length})</div>
            <ul className="space-y-2">
              {cases.map((c, i) => (
                <li key={i} className="border border-border rounded p-2 space-y-1">
                  <div className="text-xs font-semibold flex items-center gap-2"><span className="font-mono">#{i + 1}</span> {c.customer_name || c.location || '—'} {c.ticket_number && <span className="text-primary font-mono">· {c.ticket_number}</span>}</div>
                  <div className="flex flex-wrap gap-1">
                    <CasePriorityBadge value={c.priority} /><CaseStatusBadge value={c.status} />
                    {c.carry_over_count > 0 && <CarryOverBadge count={c.carry_over_count} />}
                  </div>
                  {c.case_detail && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{c.case_detail}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CarryOverSheet({ open, onOpenChange, onTake, currentId }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(new Set());
    api.get('/ops/handovers/carry-over-candidates', { params: { exclude_handover_id: currentId } })
      .then(({ data }) => setCandidates(data || []))
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => setLoading(false));
  }, [open, currentId]);
  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="carry-over-sheet">
        <SheetHeader>
          <SheetTitle>Ambil Case Shift Sebelumnya</SheetTitle>
          <SheetDescription>Case OPEN/Monitoring/Waiting/Escalated dari handover sebelumnya.</SheetDescription>
        </SheetHeader>
        {loading ? <Skeleton className="h-40 w-full mt-3" /> : candidates.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Tidak ada case terbuka untuk diteruskan.</div>
        ) : (
          <ul className="space-y-2 mt-3 mb-16">
            {candidates.map((r) => {
              const key = r.case.id;
              return (
                <li key={key} className={cn('border rounded-md p-2 cursor-pointer transition-colors', selected.has(key) ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30')} onClick={() => toggle(key)} data-testid={`carry-item-${key}`}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="mt-1" onClick={(e) => e.stopPropagation()} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-semibold">{r.handover_number}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{fmtDate(r.handover_date)} · Shift {r.shift_code}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>Oleh {r.worker_name}</span>
                      </div>
                      <div className="mt-1 text-sm font-medium">{r.case.customer_name || r.case.location || '—'} {r.case.ticket_number && <span className="text-primary font-mono">· {r.case.ticket_number}</span>}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.case.case_detail || r.case.next_action || '—'}</div>
                      <div className="mt-1 flex flex-wrap gap-1"><CasePriorityBadge value={r.case.priority} /><CaseStatusBadge value={r.case.status} />{r.case.carry_over_count > 0 && <CarryOverBadge count={r.case.carry_over_count} />}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <SheetFooter className="fixed bottom-0 right-0 left-0 sm:left-auto sm:max-w-2xl border-t border-border bg-background p-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button disabled={selected.size === 0} onClick={() => onTake(candidates.filter((r) => selected.has(r.case.id)))} data-testid="carry-take">
            Ambil {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
