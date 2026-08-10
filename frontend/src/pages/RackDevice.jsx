import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Server, Pencil, Trash2, ArrowLeft, Upload, ImageIcon, Boxes, Layers, List } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import Breadcrumb from '@/components/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { CRUD } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import InfrastructureExplorer from '@/components/rack/InfrastructureExplorer';
import ZabbixHostAutocomplete from '@/components/ZabbixHostAutocomplete';

const RACK_STATUSES = ['Active', 'Maintenance', 'Retired'];
const DEVICE_STATUSES = ['Active', 'Maintenance', 'Offline', 'Retired'];
const MOD_R = 'rack';
const MOD_D = 'device';
const MAX_IMG = 2 * 1024 * 1024;

const EMPTY_RACK = { datacenter: '', room: '', name: '', number: '', capacity_u: 42, position: '', status: 'Active', notes: '', photo_base64: null };
const EMPTY_DEVICE = {
  name: '', hostname: '', brand: '', model: '', serial_number: '',
  position_u: 1, height_u: 1, ip_management: '', power_ports: '',
  power_source_a: '', power_source_b: '', status: 'Active', install_date: '',
  photo_front_base64: null, photo_back_base64: null,
  customer_id: null, partner_id: null, service: '', notes: '',
  // Monitoring + template fields
  device_template_id: null, monitoring_source: 'snmp', snmp_version: '',
  snmp_port: null, zabbix_host: '', device_role: '', ru_position: null,
};

export default function RackDevice() {
  const { canWrite, canDelete } = useAuth();
  const { refresh: refreshCounts } = useCounts();
  const [racks, setRacks] = useState([]);
  const [loadingRacks, setLoadingRacks] = useState(true);
  const [selected, setSelected] = useState(null); // rack currently open
  const [devices, setDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [partners, setPartners] = useState([]);

  // rack form
  const [openRackForm, setOpenRackForm] = useState(false);
  const [editingRack, setEditingRack] = useState(null);
  const [rackForm, setRackForm] = useState(EMPTY_RACK);
  const [rackErrors, setRackErrors] = useState({});
  const [rackSaving, setRackSaving] = useState(false);
  const [rackDeleteId, setRackDeleteId] = useState(null);

  // device form
  const [openDeviceForm, setOpenDeviceForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [devicePrefillU, setDevicePrefillU] = useState(null);
  const [deviceForm, setDeviceForm] = useState(EMPTY_DEVICE);
  const [deviceErrors, setDeviceErrors] = useState({});
  const [deviceSaving, setDeviceSaving] = useState(false);
  const [deviceDeleteId, setDeviceDeleteId] = useState(null);
  const [previewDevice, setPreviewDevice] = useState(null);
  const [viewMode, setViewMode] = useState('explorer'); // 'explorer' | 'classic'

  const loadRacks = useCallback(async () => {
    setLoadingRacks(true);
    try { const { data } = await api.get('/racks', { params: { page_size: 200 } }); setRacks(data.items || []); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setLoadingRacks(false); }
  }, []);

  const loadDevices = useCallback(async (rackId) => {
    setLoadingDevices(true);
    try { const { data } = await api.get('/devices', { params: { rack_id: rackId, page_size: 200 } }); setDevices(data.items || []); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setLoadingDevices(false); }
  }, []);

  useEffect(() => { loadRacks(); }, [loadRacks]);
  useEffect(() => {
    api.get('/customers', { params: { page_size: 200 } }).then(({ data }) => setCustomers(data.items || []));
    api.get('/partners', { params: { page_size: 200 } }).then(({ data }) => setPartners(data.items || []));
  }, []);
  useEffect(() => { if (selected) loadDevices(selected.id); else setDevices([]); }, [selected, loadDevices]);

  const cmap = Object.fromEntries(customers.map(c => [c.id, c.company_name]));
  const pmap = Object.fromEntries(partners.map(p => [p.id, p.name]));

  // ---- Rack CRUD ----
  const openCreateRack = () => { setEditingRack(null); setRackForm(EMPTY_RACK); setRackErrors({}); setOpenRackForm(true); };
  const openEditRack = (r) => { setEditingRack(r); setRackForm({ ...EMPTY_RACK, ...r }); setRackErrors({}); setOpenRackForm(true); };

  const onRackPhoto = async (file) => {
    if (!file) return;
    if (file.size > MAX_IMG) { toast.error('Foto maksimum 2MB'); return; }
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    setRackForm((f) => ({ ...f, photo_base64: b64 }));
  };

  const saveRack = async () => {
    const e = {};
    if (!rackForm.datacenter?.trim()) e.datacenter = 'Datacenter wajib';
    if (!rackForm.name?.trim()) e.name = 'Nama rack wajib';
    if (!rackForm.capacity_u || rackForm.capacity_u < 1) e.capacity_u = 'Kapasitas U wajib';
    setRackErrors(e);
    if (Object.keys(e).length) return;

    setRackSaving(true);
    try {
      const payload = { ...rackForm, capacity_u: Number(rackForm.capacity_u) };
      if (editingRack) { await api.put(`/racks/${editingRack.id}`, payload); toast.success('Rack diperbarui'); }
      else { await api.post('/racks', payload); toast.success('Rack ditambahkan'); }
      setOpenRackForm(false); loadRacks(); refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); } finally { setRackSaving(false); }
  };

  const doDeleteRack = async () => {
    try {
      await api.delete(`/racks/${rackDeleteId}`);
      toast.success('Rack dihapus');
      if (selected?.id === rackDeleteId) setSelected(null);
      setRackDeleteId(null); loadRacks(); refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  // ---- Device CRUD ----
  const openCreateDevice = (uStart = null) => {
    setEditingDevice(null);
    setDevicePrefillU(uStart);
    setDeviceForm({ ...EMPTY_DEVICE, position_u: uStart ?? 1 });
    setDeviceErrors({});
    setOpenDeviceForm(true);
  };
  const openEditDevice = (d) => {
    setEditingDevice(d);
    setDeviceForm({ ...EMPTY_DEVICE, ...d, customer_id: d.customer_id || null, partner_id: d.partner_id || null });
    setDeviceErrors({});
    setOpenDeviceForm(true);
  };

  const onDevicePhoto = async (file, key) => {
    if (!file) return;
    if (file.size > MAX_IMG) { toast.error('Foto maksimum 2MB'); return; }
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    setDeviceForm((f) => ({ ...f, [key]: b64 }));
  };

  const saveDevice = async () => {
    const e = {};
    if (!deviceForm.name?.trim()) e.name = 'Nama wajib';
    const pos = Number(deviceForm.position_u);
    const h = Number(deviceForm.height_u);
    if (!pos || pos < 1) e.position_u = 'Posisi U wajib';
    if (!h || h < 1) e.height_u = 'Tinggi U minimal 1';
    if (selected && pos + h - 1 > selected.capacity_u) e.position_u = `Melebihi kapasitas rack (${selected.capacity_u}U)`;
    setDeviceErrors(e);
    if (Object.keys(e).length) return;

    setDeviceSaving(true);
    try {
      const payload = {
        ...deviceForm,
        rack_id: selected.id,
        position_u: pos,
        height_u: h,
        customer_id: deviceForm.customer_id || null,
        partner_id: deviceForm.partner_id || null,
      };
      if (editingDevice) { await api.put(`/devices/${editingDevice.id}`, payload); toast.success('Device diperbarui'); }
      else { await api.post('/devices', payload); toast.success('Device ditambahkan'); }
      setOpenDeviceForm(false); loadDevices(selected.id); refreshCounts();
    } catch (err) { toast.error(formatApiError(err)); } finally { setDeviceSaving(false); }
  };

  const doDeleteDevice = async () => {
    try { await api.delete(`/devices/${deviceDeleteId}`); toast.success('Device dihapus'); setDeviceDeleteId(null); setPreviewDevice(null); loadDevices(selected.id); refreshCounts(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  // ---- List view ----
  if (!selected) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[{ label: 'My DataCenter' }, { label: 'My Rack & Device' }]} />
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>My Rack & Device</h1>
            <p className="text-sm text-muted-foreground mt-1">Inventaris rack dan perangkat perusahaan di setiap datacenter.</p>
          </div>
          {canWrite && <Button size="sm" onClick={openCreateRack} data-testid={CRUD.addBtn(MOD_R)}><Plus className="w-4 h-4 mr-1.5" /> Tambah Rack</Button>}
        </div>

        {loadingRacks ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
          </div>
        ) : racks.length === 0 ? (
          <Card className="border-border"><CardContent className="p-10 text-center text-sm text-muted-foreground">
            <Boxes className="w-8 h-8 mx-auto mb-2 opacity-60" />
            Belum ada rack terdaftar. Klik "Tambah Rack" untuk memulai.
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {racks.map((r) => {
              const used = 0; // simple count later if needed
              return (
                <button key={r.id} onClick={() => setSelected(r)} data-testid={CRUD.row(MOD_R, r.id)} className="text-left group">
                  <Card className="border-border h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/30">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{r.datacenter}</div>
                          <div className="text-base font-semibold truncate" style={{ fontFamily: 'Manrope' }}>{r.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.room} · {r.position}</div>
                        </div>
                        <StatusBadge value={r.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1"><Boxes className="w-3.5 h-3.5" /> {r.capacity_u}U</div>
                        <div className="flex items-center gap-1"><Server className="w-3.5 h-3.5" /> Rack {r.number}</div>
                      </div>
                      {r.photo_base64 && (
                        <img src={r.photo_base64} alt={r.name} className="w-full h-24 object-cover rounded-md border border-border" />
                      )}
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>
        )}

        <RackForm
          open={openRackForm}
          onOpenChange={setOpenRackForm}
          editing={editingRack}
          form={rackForm} setForm={setRackForm}
          errors={rackErrors}
          saving={rackSaving}
          onSave={saveRack}
          onPhoto={onRackPhoto}
        />
      </div>
    );
  }

  // ---- Rack detail view (elevation) ----
  const usedDevices = devices.filter((d) => d.rack_id === selected.id);
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'My DataCenter' }, { label: 'My Rack & Device', to: '/datacenter/rack-device' }, { label: selected.name }]} />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setSelected(null)}><ArrowLeft className="w-4 h-4 mr-1.5" /> Kembali</Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>{selected.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{selected.datacenter} · {selected.room} · {selected.capacity_u}U</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border/60 p-0.5 bg-muted/40" data-testid="rack-view-toggle">
            <button
              onClick={() => setViewMode('explorer')}
              className={cn(
                'text-xs px-2.5 py-1 rounded-[5px] transition-colors flex items-center gap-1.5',
                viewMode === 'explorer'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid="rack-view-explorer"
            >
              <Layers className="w-3.5 h-3.5" /> Explorer
            </button>
            <button
              onClick={() => setViewMode('classic')}
              className={cn(
                'text-xs px-2.5 py-1 rounded-[5px] transition-colors flex items-center gap-1.5',
                viewMode === 'classic'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid="rack-view-classic"
            >
              <List className="w-3.5 h-3.5" /> Classic
            </button>
          </div>
          {canWrite && <Button size="sm" variant="outline" onClick={() => openEditRack(selected)}><Pencil className="w-4 h-4 mr-1.5" /> Edit Rack</Button>}
          {canDelete && <Button size="sm" variant="outline" onClick={() => setRackDeleteId(selected.id)} className="text-rose-600 hover:text-rose-700"><Trash2 className="w-4 h-4 mr-1.5" /> Hapus Rack</Button>}
          {canWrite && <Button size="sm" onClick={() => openCreateDevice()} data-testid={CRUD.addBtn(MOD_D)}><Plus className="w-4 h-4 mr-1.5" /> Tambah Device</Button>}
        </div>
      </div>

      {viewMode === 'explorer' ? (
        <InfrastructureExplorer
          rack={selected}
          devices={usedDevices}
          loading={loadingDevices}
          customerMap={cmap}
          partnerMap={pmap}
          onSlotClick={(u) => canWrite && openCreateDevice(u)}
        />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Rack elevation */}
        <Card className="border-border lg:col-span-1">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Rack Elevation</div>
            {loadingDevices ? <Skeleton className="h-96 w-full" /> : (
              <RackElevation
                capacityU={selected.capacity_u}
                devices={usedDevices}
                onSlotClick={(u) => canWrite && openCreateDevice(u)}
                onDeviceClick={(d) => setPreviewDevice(d)}
              />
            )}
          </CardContent>
        </Card>

        {/* Device list */}
        <Card className="border-border lg:col-span-2">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Perangkat di rack ini ({usedDevices.length})</div>
            {usedDevices.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Belum ada perangkat. Klik slot U pada rack di kiri atau tombol "Tambah Device".</div>
            ) : (
              <ul className="space-y-2">
                {usedDevices.map((d) => (
                  <li key={d.id} data-testid={CRUD.row(MOD_D, d.id)}
                      className="flex items-start gap-3 p-3 rounded-md border border-border hover:bg-accent/40 transition-colors cursor-pointer"
                      onClick={() => setPreviewDevice(d)}>
                    <div className="w-14 shrink-0 rounded bg-primary/10 border border-primary/20 text-center text-xs font-mono text-primary py-1">
                      U{d.position_u}-U{d.position_u + (d.height_u || 1) - 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{d.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{d.hostname}</span>
                        <StatusBadge value={d.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{d.brand} {d.model} · SN {d.serial_number || '-'} · IP {d.ip_management || '-'}</div>
                      {(d.customer_id || d.partner_id) && (
                        <div className="text-[11px] mt-1 text-muted-foreground">
                          {d.customer_id && <>Customer: <span className="text-foreground">{cmap[d.customer_id] || '-'}</span> </>}
                          {d.partner_id && <>· Mitra: <span className="text-foreground">{pmap[d.partner_id] || '-'}</span></>}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {canWrite && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openEditDevice(d); }} data-testid={CRUD.editBtn(MOD_D, d.id)}><Pencil className="w-4 h-4" /></Button>}
                      {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={(e) => { e.stopPropagation(); setDeviceDeleteId(d.id); }} data-testid={CRUD.deleteBtn(MOD_D, d.id)}><Trash2 className="w-4 h-4" /></Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      <RackForm
        open={openRackForm}
        onOpenChange={setOpenRackForm}
        editing={editingRack}
        form={rackForm} setForm={setRackForm}
        errors={rackErrors}
        saving={rackSaving}
        onSave={saveRack}
        onPhoto={onRackPhoto}
      />

      {/* Device form */}
      <Sheet open={openDeviceForm} onOpenChange={setOpenDeviceForm}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingDevice ? 'Edit Device' : 'Tambah Device'}</SheetTitle>
            <SheetDescription>Rack {selected.name} ({selected.capacity_u}U){devicePrefillU ? ` — mulai di U${devicePrefillU}` : ''}</SheetDescription>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <F label="Nama Perangkat *" full error={deviceErrors.name}><Input value={deviceForm.name} onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })} /></F>
            <F label="Hostname"><Input value={deviceForm.hostname} onChange={(e) => setDeviceForm({ ...deviceForm, hostname: e.target.value })} /></F>
            <F label="Status">
              <Select value={deviceForm.status} onValueChange={(v) => setDeviceForm({ ...deviceForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEVICE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </F>
            <F label="Brand"><Input value={deviceForm.brand} onChange={(e) => setDeviceForm({ ...deviceForm, brand: e.target.value })} /></F>
            <F label="Tipe / Model"><Input value={deviceForm.model} onChange={(e) => setDeviceForm({ ...deviceForm, model: e.target.value })} /></F>
            <F label="Serial Number" full><Input value={deviceForm.serial_number} onChange={(e) => setDeviceForm({ ...deviceForm, serial_number: e.target.value })} /></F>
            <F label={`Posisi U * (1-${selected.capacity_u})`} error={deviceErrors.position_u}><Input type="number" min="1" max={selected.capacity_u} value={deviceForm.position_u} onChange={(e) => setDeviceForm({ ...deviceForm, position_u: e.target.value })} /></F>
            <F label="Tinggi U *" error={deviceErrors.height_u}><Input type="number" min="1" max={selected.capacity_u} value={deviceForm.height_u} onChange={(e) => setDeviceForm({ ...deviceForm, height_u: e.target.value })} /></F>
            <F label="IP Management" full><Input value={deviceForm.ip_management} onChange={(e) => setDeviceForm({ ...deviceForm, ip_management: e.target.value })} /></F>
            <F label="Port Power"><Input value={deviceForm.power_ports} onChange={(e) => setDeviceForm({ ...deviceForm, power_ports: e.target.value })} /></F>
            <F label="Tanggal Pemasangan"><Input type="date" value={deviceForm.install_date || ''} onChange={(e) => setDeviceForm({ ...deviceForm, install_date: e.target.value })} /></F>
            <F label="Sumber Listrik A"><Input value={deviceForm.power_source_a} onChange={(e) => setDeviceForm({ ...deviceForm, power_source_a: e.target.value })} /></F>
            <F label="Sumber Listrik B"><Input value={deviceForm.power_source_b} onChange={(e) => setDeviceForm({ ...deviceForm, power_source_b: e.target.value })} /></F>
            <F label="Customer terkait" full>
              <Select value={deviceForm.customer_id || 'none'} onValueChange={(v) => setDeviceForm({ ...deviceForm, customer_id: v === 'none' ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Opsional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak terhubung —</SelectItem>
                  {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name} ({c.sid})</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Mitra terkait" full>
              <Select value={deviceForm.partner_id || 'none'} onValueChange={(v) => setDeviceForm({ ...deviceForm, partner_id: v === 'none' ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Opsional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak terhubung —</SelectItem>
                  {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Layanan / Service" full><Input value={deviceForm.service} onChange={(e) => setDeviceForm({ ...deviceForm, service: e.target.value })} /></F>

            {/* --- Monitoring & template extension --- */}
            <F label="Device Role"><Input placeholder="Core / Aggregation / Access / Edge" value={deviceForm.device_role || ''} onChange={(e) => setDeviceForm({ ...deviceForm, device_role: e.target.value })} /></F>
            <F label="Monitoring Source">
              <Select value={deviceForm.monitoring_source || 'snmp'} onValueChange={(v) => setDeviceForm({ ...deviceForm, monitoring_source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="snmp">SNMP (live)</SelectItem>
                  <SelectItem value="zabbix">Zabbix (history)</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="SNMP Version">
              <Select value={deviceForm.snmp_version || 'none'} onValueChange={(v) => setDeviceForm({ ...deviceForm, snmp_version: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak dipakai —</SelectItem>
                  <SelectItem value="v1">v1</SelectItem>
                  <SelectItem value="v2c">v2c</SelectItem>
                  <SelectItem value="v3">v3</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="SNMP Port"><Input type="number" min="1" max="65535" placeholder="161" value={deviceForm.snmp_port ?? ''} onChange={(e) => setDeviceForm({ ...deviceForm, snmp_port: e.target.value ? Number(e.target.value) : null })} /></F>
            <F label="Zabbix Host" full>
              <ZabbixHostAutocomplete
                value={deviceForm.zabbix_host || ''}
                onChange={(name) => setDeviceForm({ ...deviceForm, zabbix_host: name })}
                testId="device-zabbix-host"
              />
              <div className="text-[11px] text-muted-foreground mt-1">
                Ketik untuk mencari host di server Zabbix (live). Pilih host untuk otomatis mengaktifkan graph histori pada device ini.
              </div>
            </F>

            <F label="Foto Depan">
              <PhotoInput value={deviceForm.photo_front_base64} onChange={(file) => onDevicePhoto(file, 'photo_front_base64')} onClear={() => setDeviceForm({ ...deviceForm, photo_front_base64: null })} />
            </F>
            <F label="Foto Belakang">
              <PhotoInput value={deviceForm.photo_back_base64} onChange={(file) => onDevicePhoto(file, 'photo_back_base64')} onClear={() => setDeviceForm({ ...deviceForm, photo_back_base64: null })} />
            </F>
            <F label="Catatan" full><Textarea rows={3} value={deviceForm.notes} onChange={(e) => setDeviceForm({ ...deviceForm, notes: e.target.value })} /></F>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setOpenDeviceForm(false)} data-testid={CRUD.cancelBtn(MOD_D)}>Batal</Button>
            <Button onClick={saveDevice} disabled={deviceSaving} data-testid={CRUD.saveBtn(MOD_D)}>{deviceSaving ? 'Menyimpan…' : 'Simpan'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Device Preview */}
      <Dialog open={!!previewDevice} onOpenChange={(o) => !o && setPreviewDevice(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{previewDevice?.name}</DialogTitle></DialogHeader>
          {previewDevice && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <I k="Hostname" v={previewDevice.hostname} />
                <I k="Status" v={<StatusBadge value={previewDevice.status} />} />
                <I k="Brand / Model" v={`${previewDevice.brand || '-'} / ${previewDevice.model || '-'}`} />
                <I k="Serial Number" v={previewDevice.serial_number || '-'} />
                <I k="Posisi" v={`U${previewDevice.position_u} - U${previewDevice.position_u + (previewDevice.height_u || 1) - 1}`} />
                <I k="IP Management" v={previewDevice.ip_management || '-'} />
                <I k="Port Power" v={previewDevice.power_ports || '-'} />
                <I k="Sumber A / B" v={`${previewDevice.power_source_a || '-'} / ${previewDevice.power_source_b || '-'}`} />
                <I k="Pemasangan" v={previewDevice.install_date || '-'} />
                <I k="Customer" v={cmap[previewDevice.customer_id] || '-'} />
                <I k="Mitra" v={pmap[previewDevice.partner_id] || '-'} />
                <I k="Layanan" v={previewDevice.service || '-'} />
              </div>
              {(previewDevice.photo_front_base64 || previewDevice.photo_back_base64) && (
                <div className="pt-3 border-t border-border">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Gallery</div>
                  <div className="grid grid-cols-2 gap-3">
                    {previewDevice.photo_front_base64 && <div><div className="text-xs text-muted-foreground mb-1">Depan</div><img src={previewDevice.photo_front_base64} alt="front" className="w-full rounded-md border border-border" /></div>}
                    {previewDevice.photo_back_base64 && <div><div className="text-xs text-muted-foreground mb-1">Belakang</div><img src={previewDevice.photo_back_base64} alt="back" className="w-full rounded-md border border-border" /></div>}
                  </div>
                </div>
              )}
              {previewDevice.notes && (
                <div className="pt-2 border-t border-border">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Catatan</div>
                  <div className="text-foreground whitespace-pre-wrap">{previewDevice.notes}</div>
                </div>
              )}
              <div className="pt-3 border-t border-border flex justify-end gap-2">
                {canWrite && <Button variant="outline" size="sm" onClick={() => { openEditDevice(previewDevice); setPreviewDevice(null); }}><Pencil className="w-4 h-4 mr-1.5" /> Edit</Button>}
                {canDelete && <Button variant="outline" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => setDeviceDeleteId(previewDevice.id)}><Trash2 className="w-4 h-4 mr-1.5" /> Hapus</Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirms */}
      <AlertDialog open={!!rackDeleteId} onOpenChange={(o) => !o && setRackDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus rack ini?</AlertDialogTitle><AlertDialogDescription>Perangkat di dalam rack akan tetap tersimpan tapi kehilangan referensi rack.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doDeleteRack} data-testid={CRUD.confirmDelete(MOD_R)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deviceDeleteId} onOpenChange={(o) => !o && setDeviceDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus device ini?</AlertDialogTitle><AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doDeleteDevice} data-testid={CRUD.confirmDelete(MOD_D)} className="bg-rose-600 hover:bg-rose-700 text-white">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Rack Elevation visual ---
function RackElevation({ capacityU, devices, onSlotClick, onDeviceClick }) {
  const slots = useMemo(() => {
    // Build array of slots from top (capacity_u) to bottom (1)
    const arr = [];
    for (let u = capacityU; u >= 1; u--) {
      const dev = devices.find((d) => d.position_u <= u && (d.position_u + (d.height_u || 1) - 1) >= u);
      const isStart = dev && dev.position_u + (dev.height_u || 1) - 1 === u; // top slot for that device
      arr.push({ u, dev, isStart });
    }
    return arr;
  }, [capacityU, devices]);

  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
      <div className="grid grid-cols-[36px_1fr] text-[11px]">
        {slots.map(({ u, dev, isStart }) => (
          <React.Fragment key={u}>
            <div className="border-r border-b border-border/60 py-1.5 text-center font-mono text-muted-foreground bg-background/60">U{u}</div>
            {dev ? (
              isStart ? (
                <button
                  onClick={() => onDeviceClick(dev)}
                  className={cn(
                    'border-b border-border/60 px-2 flex items-center gap-2 text-left transition-colors',
                    'bg-primary/10 hover:bg-primary/20 text-primary'
                  )}
                  style={{ gridRow: `span ${dev.height_u || 1}`, minHeight: `${(dev.height_u || 1) * 28}px` }}
                >
                  <Server className="w-3.5 h-3.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{dev.name}</div>
                    <div className="text-[10px] text-primary/80 truncate">{dev.hostname || dev.brand} · {dev.height_u || 1}U</div>
                  </div>
                </button>
              ) : null
            ) : (
              <button
                onClick={() => onSlotClick(u)}
                className="border-b border-border/60 py-1.5 text-muted-foreground/60 hover:bg-primary/5 transition-colors text-left px-2"
                title={`Slot kosong U${u}`}
              >
                <span className="opacity-0 group-hover:opacity-100">·</span>
              </button>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// --- Rack form ---
function RackForm({ open, onOpenChange, editing, form, setForm, errors, saving, onSave, onPhoto }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? 'Edit Rack' : 'Tambah Rack'}</SheetTitle>
          <SheetDescription>Lengkapi info rack di datacenter.</SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-2 gap-3 py-4">
          <F label="Datacenter *" full error={errors.datacenter}><Input value={form.datacenter} onChange={(e) => setForm({ ...form, datacenter: e.target.value })} /></F>
          <F label="Ruangan / Floor"><Input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></F>
          <F label="Posisi Rack"><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="mis. Row A - Col 12" /></F>
          <F label="Nama Rack *" error={errors.name}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></F>
          <F label="Nomor Rack"><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></F>
          <F label="Kapasitas U *" error={errors.capacity_u}><Input type="number" value={form.capacity_u} onChange={(e) => setForm({ ...form, capacity_u: e.target.value })} /></F>
          <F label="Status">
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RACK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Foto Rack" full>
            <PhotoInput value={form.photo_base64} onChange={onPhoto} onClear={() => setForm({ ...form, photo_base64: null })} />
          </F>
          <F label="Catatan" full><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></F>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid={CRUD.cancelBtn(MOD_R)}>Batal</Button>
          <Button onClick={onSave} disabled={saving} data-testid={CRUD.saveBtn(MOD_R)}>{saving ? 'Menyimpan…' : 'Simpan'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PhotoInput({ value, onChange, onClear }) {
  return (
    <div className="space-y-2">
      {value && <img src={value} alt="preview" className="w-full max-h-40 object-cover rounded-md border border-border" />}
      <div className="flex items-center gap-2">
        <label className="flex-1">
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onChange(e.target.files?.[0])} />
          <div className="cursor-pointer border border-dashed border-border rounded-md px-3 py-2 text-center text-xs text-muted-foreground hover:bg-accent/40 transition-colors flex items-center justify-center gap-2">
            {value ? <><ImageIcon className="w-3.5 h-3.5" /> Ganti Foto</> : <><Upload className="w-3.5 h-3.5" /> Unggah Foto (max 2MB)</>}
          </div>
        </label>
        {value && <Button variant="outline" size="sm" onClick={onClear} type="button">Hapus</Button>}
      </div>
    </div>
  );
}

function F({ label, children, full, error }) {
  return (
    <div className={cn('space-y-1.5', full && 'col-span-2')}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
    </div>
  );
}
function I({ k, v }) {
  return (<div><div className="text-xs uppercase tracking-wider text-muted-foreground">{k}</div><div className="text-sm mt-0.5">{v || '-'}</div></div>);
}
