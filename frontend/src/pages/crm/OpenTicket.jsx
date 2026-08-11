import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, TicketPlus, Users, Info, MessageSquare, PhoneCall, Mail, Radar, Building, HelpCircle, Trash2 } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PRIORITIES, REPORT_SOURCES, TICKET_TYPES, TICKET_TYPE_LABEL, PSB_SERVICE_TYPES } from './helpdeskUtils';
import UploadZone from './components/UploadZone';
import { useAuth } from '@/context/AuthContext';

const REPORT_ICONS = {
  WhatsApp: MessageSquare, Telepon: PhoneCall, Email: Mail,
  Monitoring: Radar, Internal: Building, Lainnya: HelpCircle,
};

const EMPTY = {
  ticket_type: 'GANGGUAN',
  customer_id: null, customer_name: '',
  location: '',
  category_id: null, category_name: '',
  priority: 'Medium',
  outage_started_at: '',
  description: '',
  pic_name: '', pic_contact: '',
  report_source: 'Telepon',
  initial_evidence_note: '',
  // PSB
  psb_service_type: 'Broadband FTTH', psb_package: '', psb_install_address: '',
  // Multigangguan
  mg_cause: '', affected_customers: [],
};

export default function OpenTicket() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [customers, setCustomers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [createdTicket, setCreatedTicket] = useState(null);

  useEffect(() => {
    api.get('/customers', { params: { page_size: 1000 } }).then(({ data }) => setCustomers(data.items || []));
    api.get('/crm/categories').then(({ data }) => setCategories(Array.isArray(data) ? data : (data.items || [])));
  }, []);

  const validate = () => {
    const e = {};
    if (!form.customer_name?.trim() && form.ticket_type !== 'MULTIGANGGUAN') e.customer_name = 'Nama customer wajib';
    if (form.ticket_type === 'GANGGUAN' && !form.description?.trim()) e.description = 'Deskripsi gangguan wajib';
    if (form.ticket_type === 'MULTIGANGGUAN') {
      if (!form.description?.trim()) e.description = 'Informasi gangguan wajib';
      if ((form.affected_customers || []).length === 0) e.affected_customers = 'Minimal 1 pelanggan terdampak';
    }
    if (form.ticket_type === 'PSB' && !form.psb_install_address?.trim()) e.psb_install_address = 'Alamat instalasi wajib';
    if (!form.priority) e.priority = 'Prioritas wajib';
    if (!form.report_source) e.report_source = 'Sumber laporan wajib';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/crm/tickets', form);
      toast.success(`Ticket ${data.ticket_number} dibuat`);
      setCreatedTicket(data);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  const reset = () => { setCreatedTicket(null); setForm(EMPTY); setErrors({}); };

  // Post-create screen for uploading optional initial evidence
  if (createdTicket) {
    const Icon = REPORT_ICONS[createdTicket.report_source] || HelpCircle;
    return (
      <div className="space-y-4 max-w-4xl mx-auto">
        <Breadcrumb items={[{ label: 'CRM Ticket Helpdesk' }, { label: 'Open Ticket' }]} />
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold" style={{ fontFamily: 'Manrope' }}>Ticket berhasil dibuat</div>
              <div className="text-sm text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold text-foreground">{createdTicket.ticket_number}</span>
                <span>·</span>
                <span>{createdTicket.customer_name}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {createdTicket.report_source}</span>
              </div>
              <p className="text-sm mt-2">
                Status ticket sekarang <span className="font-semibold">MASUK</span>. Anda dapat menambahkan foto evidence awal
                pelanggan (opsional — laporan dari telepon tidak wajib foto).
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold" style={{ fontFamily: 'Manrope' }}>
              Evidence Awal Pelanggan <span className="text-muted-foreground font-normal text-xs">(opsional)</span>
            </div>
            <UploadZone
              ticketId={createdTicket.id}
              evidenceType="CUSTOMER_INITIAL_EVIDENCE"
              description={form.initial_evidence_note}
              testKey="open-initial-upload"
              onUploaded={() => toast.info('Evidence awal tersimpan')}
            />
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button variant="outline" onClick={reset} data-testid="open-ticket-create-another">
                <TicketPlus className="w-4 h-4 mr-1.5" /> Buat ticket lain
              </Button>
              <Button onClick={() => nav('/crm/masuk')} data-testid="open-ticket-goto-masuk">
                Lihat di Ticket Masuk →
              </Button>
              <Button variant="ghost" onClick={() => nav(`/crm/tickets/${createdTicket.id}`)} data-testid="open-ticket-goto-detail">
                Buka detail ticket
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <Breadcrumb items={[{ label: 'CRM Ticket Helpdesk' }, { label: 'Open Ticket' }]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Open Ticket Baru</h1>
        <p className="text-sm text-muted-foreground mt-1">Buat ticket helpdesk berdasarkan laporan gangguan dari pelanggan.</p>
      </div>

      <Card className="border-border">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Jenis Tiket</Label>
            <div className="flex flex-wrap gap-2" data-testid="open-ticket-type">
              {TICKET_TYPES.map((tt) => (
                <button
                  key={tt}
                  type="button"
                  onClick={() => setForm({ ...form, ticket_type: tt })}
                  data-testid={`open-ticket-type-${tt}`}
                  className={cn(
                    'px-3.5 py-1.5 rounded-md border text-sm font-semibold transition-colors',
                    form.ticket_type === tt
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-accent border-border text-muted-foreground',
                  )}
                >
                  {TICKET_TYPE_LABEL[tt]}
                </button>
              ))}
            </div>
          </div>

          {form.ticket_type === 'PSB' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3" data-testid="open-psb-fields">
              <F label="Jenis Layanan *">
                <Select value={form.psb_service_type} onValueChange={(v) => setForm({ ...form, psb_service_type: v })}>
                  <SelectTrigger data-testid="open-psb-service"><SelectValue /></SelectTrigger>
                  <SelectContent>{PSB_SERVICE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Paket / Bandwidth">
                <Input value={form.psb_package} onChange={(e) => setForm({ ...form, psb_package: e.target.value })} placeholder="mis. 50 Mbps / Dedicated 1:1 100 Mbps" data-testid="open-psb-package" />
              </F>
              <F label="Alamat Instalasi *" full error={errors.psb_install_address}>
                <Textarea rows={2} value={form.psb_install_address} onChange={(e) => setForm({ ...form, psb_install_address: e.target.value })} placeholder="Alamat lengkap lokasi pemasangan" data-testid="open-psb-address" />
              </F>
            </div>
          )}

          {form.ticket_type === 'MULTIGANGGUAN' && (
            <div className="space-y-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3" data-testid="open-mg-fields">
              <F label="Penyebab Gangguan">
                <Input value={form.mg_cause} onChange={(e) => setForm({ ...form, mg_cause: e.target.value })} placeholder="mis. FO Cut ruas A-B, Power OLT down" data-testid="open-mg-cause" />
              </F>
              <AffectedEditor
                customers={customers}
                value={form.affected_customers}
                onChange={(list) => setForm({ ...form, affected_customers: list })}
                error={errors.affected_customers}
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <F label="Customer *" error={errors.customer_name}>
              <CustomerPicker
                customers={customers}
                value={form.customer_id}
                displayValue={form.customer_name}
                onChange={(id, name, location) => setForm({ ...form, customer_id: id, customer_name: name, location: location || form.location })}
              />
            </F>
            <F label="Lokasi / Site">
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="mis. Jakarta Pusat · SCBD Tower A"
                data-testid="open-ticket-location"
              />
            </F>
            <F label="Kategori Gangguan">
              <Select
                value={form.category_id || 'free'}
                onValueChange={(v) => {
                  if (v === 'free') return setForm({ ...form, category_id: null });
                  const c = categories.find((x) => x.id === v);
                  setForm({ ...form, category_id: v, category_name: c?.name || '' });
                }}
              >
                <SelectTrigger data-testid="open-ticket-category"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">— Ketik manual —</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!form.category_id && (
                <Input
                  className="mt-1.5"
                  value={form.category_name}
                  onChange={(e) => setForm({ ...form, category_name: e.target.value })}
                  placeholder="Nama kategori (opsional)"
                />
              )}
            </F>
            <F label="Prioritas *" error={errors.priority}>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger data-testid="open-ticket-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Waktu Mulai Gangguan">
              <Input
                type="datetime-local" value={form.outage_started_at || ''}
                onChange={(e) => setForm({ ...form, outage_started_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                data-testid="open-ticket-outage"
              />
            </F>
            <F label="Sumber Laporan *" error={errors.report_source}>
              <Select value={form.report_source} onValueChange={(v) => setForm({ ...form, report_source: v })}>
                <SelectTrigger data-testid="open-ticket-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_SOURCES.map((s) => {
                    const Icon = REPORT_ICONS[s] || HelpCircle;
                    return (
                      <SelectItem key={s} value={s}>
                        <span className="inline-flex items-center gap-2"><Icon className="w-3.5 h-3.5" /> {s}</span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </F>
            <F label="PIC Customer">
              <Input value={form.pic_name} onChange={(e) => setForm({ ...form, pic_name: e.target.value })} placeholder="Nama PIC" data-testid="open-ticket-pic-name" />
            </F>
            <F label="Nomor Kontak PIC">
              <Input value={form.pic_contact} onChange={(e) => setForm({ ...form, pic_contact: e.target.value })} placeholder="+62…" data-testid="open-ticket-pic-contact" />
            </F>
            <F label={form.ticket_type === 'MULTIGANGGUAN' ? 'Informasi Gangguan *' : form.ticket_type === 'PSB' ? 'Catatan / Deskripsi' : 'Deskripsi Gangguan *'} full error={errors.description}>
              <Textarea
                rows={3} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Jelaskan gangguan seperti yang dilaporkan pelanggan…"
                data-testid="open-ticket-description"
              />
            </F>
            <F label="Keterangan Evidence Awal" full>
              <Input
                value={form.initial_evidence_note}
                onChange={(e) => setForm({ ...form, initial_evidence_note: e.target.value })}
                placeholder="mis. Screenshot notifikasi WA, foto lampu router, dll. (foto diunggah setelah ticket tersimpan)"
                data-testid="open-ticket-initial-note"
              />
            </F>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Info className="w-4 h-4 text-muted-foreground" />
            <div className="text-xs text-muted-foreground flex-1">
              Ticket dibuat oleh <span className="font-medium text-foreground">{user?.name}</span>.
              Nomor ticket dibuat otomatis (TCK-YYYYMMDD-NNNN).
            </div>
            <Button onClick={submit} disabled={saving} data-testid="open-ticket-submit">
              {saving ? 'Menyimpan…' : 'Simpan & Lanjut Evidence'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerPicker({ customers, value, displayValue, onChange }) {
  const [open, setOpen] = useState(false);
  const current = customers.find((c) => c.id === value);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline" role="combobox" data-testid="open-ticket-customer"
            className="w-full justify-between h-9 font-normal text-left"
          >
            {current ? (
              <span className="truncate"><span className="font-medium">{current.company_name}</span> <span className="text-muted-foreground text-xs">· {current.sid}</span></span>
            ) : (
              <span className="text-muted-foreground">{displayValue || 'Pilih customer…'}</span>
            )}
            <Users className="w-4 h-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Cari nama / SID…" />
            <CommandList className="max-h-72">
              <CommandEmpty>Customer tidak ditemukan.</CommandEmpty>
              <CommandGroup>
                {customers.map((c) => (
                  <CommandItem
                    key={c.id} value={`${c.company_name} ${c.sid} ${c.location || ''}`}
                    onSelect={() => { onChange(c.id, c.company_name, c.location); setOpen(false); }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate font-medium">{c.company_name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{c.sid} · {c.category} · {c.location}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        className="mt-1.5"
        value={displayValue}
        onChange={(e) => onChange(null, e.target.value, null)}
        placeholder="Atau ketik nama customer manual"
        data-testid="open-ticket-customer-manual"
      />
    </>
  );
}

function F({ label, full, error, children }) {
  return (
    <div className={full ? 'md:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  );
}

function AffectedEditor({ customers, value, onChange, error }) {
  const [manual, setManual] = useState('');
  const [open, setOpen] = useState(false);
  const list = value || [];
  const addManual = () => {
    const name = manual.trim();
    if (!name) return;
    onChange([...list, { customer_id: null, customer_name: name, status: 'Down' }]);
    setManual('');
  };
  const addCustomer = (c) => {
    if (!list.some((x) => x.customer_id === c.id)) {
      onChange([...list, { customer_id: c.id, customer_name: c.company_name, status: 'Down' }]);
    }
    setOpen(false);
  };
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Daftar Pelanggan Terdampak * <span className="text-foreground">({list.length})</span>
      </Label>
      <div className="flex flex-col sm:flex-row gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="justify-between sm:w-60 h-9 font-normal" data-testid="mg-add-customer-picker">
              <span className="text-muted-foreground">Pilih dari database…</span>
              <Users className="w-4 h-4 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Cari nama / SID…" />
              <CommandList className="max-h-64">
                <CommandEmpty>Customer tidak ditemukan.</CommandEmpty>
                <CommandGroup>
                  {customers.map((c) => (
                    <CommandItem key={c.id} value={`${c.company_name} ${c.sid} ${c.location || ''}`} onSelect={() => addCustomer(c)}>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate font-medium">{c.company_name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{c.sid} · {c.location}</div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="flex gap-2 flex-1">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }}
            placeholder="…atau ketik manual nama / ID pelanggan"
            data-testid="mg-add-customer-manual"
          />
          <Button type="button" variant="secondary" onClick={addManual} data-testid="mg-add-customer-btn">Tambah</Button>
        </div>
      </div>
      {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
      {list.length > 0 && (
        <div className="border border-border rounded-md divide-y divide-border max-h-56 overflow-y-auto bg-background" data-testid="mg-affected-list">
          {list.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm" data-testid={`mg-affected-${i}`}>
              <div className="min-w-0">
                <div className="truncate font-medium">{c.customer_name}</div>
                {c.customer_id && <div className="text-[10px] text-muted-foreground">dari database</div>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300">Down</span>
                <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-rose-600" data-testid={`mg-affected-remove-${i}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
