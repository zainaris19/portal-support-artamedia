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
import { CheckCircle2, TicketPlus, Users, Info, MessageSquare, PhoneCall, Mail, Radar, Building, HelpCircle } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import api, { formatApiError } from '@/lib/api';
import { PRIORITIES, REPORT_SOURCES } from './helpdeskUtils';
import UploadZone from './components/UploadZone';
import { useAuth } from '@/context/AuthContext';

const REPORT_ICONS = {
  WhatsApp: MessageSquare, Telepon: PhoneCall, Email: Mail,
  Monitoring: Radar, Internal: Building, Lainnya: HelpCircle,
};

const EMPTY = {
  customer_id: null, customer_name: '',
  location: '',
  category_id: null, category_name: '',
  priority: 'Medium',
  outage_started_at: '',
  description: '',
  pic_name: '', pic_contact: '',
  report_source: 'Telepon',
  initial_evidence_note: '',
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
    if (!form.customer_name?.trim()) e.customer_name = 'Nama customer wajib';
    if (!form.description?.trim()) e.description = 'Deskripsi gangguan wajib';
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
            <F label="Deskripsi Gangguan *" full error={errors.description}>
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
