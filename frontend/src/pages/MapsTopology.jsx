import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  Building2, Plus, Edit, X, Cable, Server, MapPin, ChevronRight, Trash2,
  Loader2, Search, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import NetworkMap, { getConnStyle, getSiteStyle } from '@/components/topology/GeographicMap';
import './topology.css';

const SITE_TYPES = [
  { value: 'datacenter', label: 'Data Center' },
  { value: 'pop', label: 'POP' },
  { value: 'tower', label: 'BTS / Tower' },
  { value: 'customer_site', label: 'Customer Site' },
  { value: 'office', label: 'Office' },
];
const CONN_TYPES = [
  { value: 'Fiber Optic Artamedia', label: 'Fiber Optic' },
  { value: 'Wireless BTS to BTS', label: 'Wireless' },
  { value: 'Tunnel', label: 'Tunnel' },
  { value: 'Metro Ethernet Mitra', label: 'Metro Ethernet' },
  { value: 'Cross Connect', label: 'Cross Connect' },
];

export default function MapsTopology() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'supervisor', 'engineer');

  const [refs, setRefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSite, setSelectedSite] = useState(null);
  const [selectedConn, setSelectedConn] = useState(null);
  const [siteFormOpen, setSiteFormOpen] = useState(false);
  const [siteFormInitial, setSiteFormInitial] = useState(null);
  const [deviceFormOpen, setDeviceFormOpen] = useState(false);
  const [connFormOpen, setConnFormOpen] = useState(false);
  const [connSourceDevice, setConnSourceDevice] = useState(null);
  const [pickingSite, setPickingSite] = useState(false);

  // Any modal/drawer open → map must be inert (drag/zoom/click/marker disabled)
  const anyModalOpen = siteFormOpen || deviceFormOpen || connFormOpen;

  const startAddSite = () => {
    setSelectedSite(null);
    setSelectedConn(null);
    setSiteFormInitial(null);
    setPickingSite(true);
    toast.info('Klik lokasi pada peta untuk menempatkan site baru');
  };

  const handleCoordsPick = ({ lat, lng }) => {
    setPickingSite(false);
    setSiteFormInitial({ latitude: lat, longitude: lng });
    setSiteFormOpen(true);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/topology/v2/references');
      setRefs(data);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Refresh selected site with latest data
  useEffect(() => {
    if (!selectedSite || !refs) return;
    const latest = refs.sites.find((s) => s.id === selectedSite.id);
    if (latest && JSON.stringify(latest) !== JSON.stringify(selectedSite)) setSelectedSite(latest);
  }, [refs, selectedSite]);

  // Devices grouped by site (via rack.site relationship OR direct link)
  const devicesBySite = useMemo(() => {
    if (!refs) return {};
    const rackToSite = {};
    for (const s of refs.sites) {
      if (s.ref_rack_id) rackToSite[s.ref_rack_id] = s.id;
    }
    const out = {};
    for (const d of refs.devices || []) {
      const siteId = rackToSite[d.rack_id];
      if (!siteId) continue;
      (out[siteId] = out[siteId] || []).push(d);
    }
    return out;
  }, [refs]);

  // Device → site lookup (for connection line rendering)
  const deviceToSite = useMemo(() => {
    const out = {};
    for (const [siteId, list] of Object.entries(devicesBySite)) {
      for (const d of list) out[d.id] = siteId;
    }
    return out;
  }, [devicesBySite]);

  // Enriched connections with source/dest site coordinates
  const connectionsForMap = useMemo(() => {
    if (!refs) return [];
    const enriched = [];
    for (const l of refs.links || []) {
      const srcSite = deviceToSite[l.source_device_id];
      const dstSite = deviceToSite[l.dest_device_id];
      if (!srcSite || !dstSite) continue;
      if (srcSite === dstSite) continue;  // intra-site — not shown on map
      enriched.push({ ...l, source_site_id: srcSite, dest_site_id: dstSite });
    }
    return enriched;
  }, [refs, deviceToSite]);

  // Filter sites via command bar
  const filteredSites = useMemo(() => {
    if (!refs) return [];
    if (!search) return refs.sites;
    const q = search.toLowerCase();
    return refs.sites.filter((s) => (s.name || '').toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q));
  }, [refs, search]);

  const openSiteFromSearch = (site) => {
    setSelectedSite(site);
    setSelectedConn(null);
  };
  const openConnFromDevice = (device) => {
    setConnSourceDevice(device);
    setConnFormOpen(true);
  };

  return (
    <div className="h-full flex flex-col gap-3" data-testid="topology-page">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'Maps Topology' }]} />

      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>Maps Topology</h1>
          <p className="text-xs text-muted-foreground">GIS-based network map · Site → Device → Connection · auto-generated dari database</p>
        </div>
        <div className="flex-1" />

        {/* Command bar */}
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari site…"
            className="pl-8 h-9" data-testid="topology-search" />
          {search && filteredSites.length > 0 && filteredSites.length < refs.sites.length && (
            <div className="absolute top-10 left-0 right-0 rounded-md border border-border bg-background shadow-lg z-[1000] max-h-60 overflow-y-auto">
              {filteredSites.slice(0, 10).map((s) => (
                <button key={s.id} className="w-full px-2 py-1.5 text-left hover:bg-accent text-sm"
                  onClick={() => { openSiteFromSearch(s); setSearch(''); }}
                  data-testid={`search-result-${s.id}`}
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{s.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {canEdit && (
          <Button size="sm" onClick={startAddSite} data-testid="topo-add-site">
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Tambah Site
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="topo-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Map + Detail Panel — side-by-side, no overlay */}
      <div className="flex-1 flex gap-3 min-h-[500px] h-[calc(100vh-220px)]">
        <div className="flex-1 min-w-0 rounded-lg border border-border overflow-hidden bg-white relative">
          <NetworkMap
            sites={refs?.sites || []}
            connections={connectionsForMap}
            onSiteClick={(s) => { setSelectedSite(s); setSelectedConn(null); }}
            onConnectionClick={(c) => { setSelectedConn(c); setSelectedSite(null); }}
            selectedSiteId={selectedSite?.id}
            selectedConnectionId={selectedConn?.id}
            pickCoords={pickingSite}
            onCoordsPick={handleCoordsPick}
            onCancelPick={() => setPickingSite(false)}
            interactionsDisabled={anyModalOpen}
          />
        </div>

        {/* Detail panel — renders next to the map, never covers it */}
        {(selectedSite || selectedConn) && (
          <aside
            className="w-[400px] shrink-0 rounded-lg border border-border bg-background overflow-y-auto shadow-sm"
            data-testid={selectedSite ? 'site-detail-panel' : 'conn-detail-panel'}
          >
            {selectedSite && (
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: getSiteStyle(selectedSite.type).color }}>
                      <Building2 className="w-3.5 h-3.5 text-white" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{selectedSite.name}</div>
                      <div className="text-xs text-muted-foreground">{SITE_TYPES.find((t) => t.value === selectedSite.type)?.label || selectedSite.type}</div>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setSelectedSite(null)} data-testid="site-detail-close">
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="space-y-3 text-sm">
                  <InfoRow label="Alamat" value={selectedSite.address || '—'} />
                  <InfoRow label="Kota" value={selectedSite.city || '—'} />
                  <InfoRow label="Koordinat" value={selectedSite.latitude && selectedSite.longitude
                    ? `${selectedSite.latitude.toFixed(5)}, ${selectedSite.longitude.toFixed(5)}`
                    : <span className="text-amber-600">Belum di-set</span>} />
                  <InfoRow label="Notes" value={selectedSite.notes || '—'} />

                  <div className="pt-3 border-t border-border">
                    <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                      Devices ({(devicesBySite[selectedSite.id] || []).length})
                    </div>
                    {(devicesBySite[selectedSite.id] || []).length === 0 ? (
                      <div className="text-xs text-muted-foreground italic">Belum ada device di site ini.</div>
                    ) : (
                      <ul className="space-y-1.5">
                        {(devicesBySite[selectedSite.id] || []).map((d) => (
                          <li key={d.id} className="border border-border rounded-md p-2 hover:bg-accent" data-testid={`site-device-${d.id}`}>
                            <div className="flex items-center gap-2">
                              <Server className="w-3.5 h-3.5 text-muted-foreground" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{d.name}</div>
                                <div className="text-[10px] text-muted-foreground">{d.role || 'Device'} · {d.mgmt_ip || 'no-ip'}</div>
                              </div>
                              {canEdit && (
                                <Button size="sm" variant="ghost" onClick={() => openConnFromDevice(d)} title="Tambah Connection" data-testid={`device-add-conn-${d.id}`}>
                                  <Cable className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                            <DeviceConnections deviceId={d.id} links={refs?.links || []} onOpenConn={(c) => { setSelectedConn(c); }} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <div className="mt-4 flex flex-col sm:flex-row gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setSiteFormInitial(selectedSite); setSiteFormOpen(true); }} data-testid="site-edit">
                      <Edit className="w-3.5 h-3.5 mr-1.5" /> Edit Site
                    </Button>
                    <Button className="flex-1" onClick={() => setDeviceFormOpen(true)} data-testid="site-add-device">
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Device
                    </Button>
                  </div>
                )}
              </div>
            )}

            {selectedConn && (
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Cable className="w-4 h-4 shrink-0" style={{ color: getConnStyle(selectedConn.link_type).color }} />
                    <div className="min-w-0">
                      <div className="font-semibold">Connection</div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate">{selectedConn.id}</div>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setSelectedConn(null)} data-testid="conn-detail-close">
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="space-y-2 text-sm">
                  <InfoRow label="Type" value={<span style={{ color: getConnStyle(selectedConn.link_type).color, fontWeight: 600 }}>{selectedConn.link_type}</span>} />
                  <InfoRow label="Status" value={selectedConn.status_override || 'Active'} />
                  <InfoRow label="Capacity" value={selectedConn.capacity_mbps ? `${selectedConn.capacity_mbps} Mbps` : '—'} />
                  <InfoRow label="Provider" value={(refs?.partners || []).find((p) => p.id === selectedConn.provider_id)?.name || '—'} />
                  <InfoRow label="Circuit ID" value={selectedConn.circuit_id || '—'} mono />
                  <InfoRow label="SID" value={selectedConn.sid || '—'} mono />
                  <InfoRow label="VLAN" value={selectedConn.vlan || '—'} />
                  <InfoRow label="Description" value={selectedConn.description || '—'} />
                  <InfoRow label="Source" value={
                    (() => { const d = refs?.devices?.find((x) => x.id === selectedConn.source_device_id); return d ? `${d.name} · ${selectedConn.source_port || '?'}` : '—'; })()
                  } />
                  <InfoRow label="Destination" value={
                    (() => { const d = refs?.devices?.find((x) => x.id === selectedConn.dest_device_id); return d ? `${d.name} · ${selectedConn.dest_port || '?'}` : '—'; })()
                  } />
                </div>

                {canEdit && (
                  <div className="mt-4">
                    <Button variant="outline" className="w-full" onClick={async () => {
                      if (!window.confirm('Hapus connection ini?')) return;
                      try { await api.delete(`/topology/v2/links/${selectedConn.id}`); toast.success('Connection dihapus'); setSelectedConn(null); load(); }
                      catch (err) { toast.error(formatApiError(err)); }
                    }} data-testid="conn-delete">
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Hapus
                    </Button>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Site Form (Add/Edit) */}
      <SiteForm
        open={siteFormOpen}
        onOpenChange={setSiteFormOpen}
        initial={siteFormInitial}
        onSaved={(saved) => { setSiteFormOpen(false); load(); setSelectedSite(saved); }}
      />

      {/* Device Form */}
      <DeviceForm
        open={deviceFormOpen}
        onOpenChange={setDeviceFormOpen}
        site={selectedSite}
        allDevices={refs?.devices || []}
        allRacks={refs?.racks || []}
        onSaved={() => { setDeviceFormOpen(false); load(); }}
      />

      {/* Connection Form */}
      <ConnForm
        open={connFormOpen}
        onOpenChange={setConnFormOpen}
        sourceDevice={connSourceDevice}
        allSites={refs?.sites || []}
        allDevices={refs?.devices || []}
        devicesBySite={devicesBySite}
        partners={refs?.partners || []}
        onSaved={() => { setConnFormOpen(false); load(); }}
      />
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono min-w-[80px] pt-0.5">{label}</span>
      <span className={`flex-1 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function DeviceConnections({ deviceId, links, onOpenConn }) {
  const conns = links.filter((l) => l.source_device_id === deviceId || l.dest_device_id === deviceId);
  if (!conns.length) return null;
  return (
    <ul className="mt-1 pl-5 space-y-0.5 text-[11px]">
      {conns.map((c) => (
        <li key={c.id} className="flex items-center gap-1.5 cursor-pointer hover:text-primary" onClick={() => onOpenConn(c)} data-testid={`device-conn-${c.id}`}>
          <span className="w-2 h-2 rounded-full" style={{ background: getConnStyle(c.link_type).color }} />
          <span className="text-muted-foreground truncate">{c.link_type} · {c.description || c.circuit_id || 'no-desc'}</span>
        </li>
      ))}
    </ul>
  );
}

// ============================================================================
// SITE FORM
// ============================================================================
function SiteForm({ open, onOpenChange, initial, onSaved }) {
  const isEdit = !!(initial && initial.id);
  const [form, setForm] = useState({ name: '', type: 'customer_site', address: '', city: '', latitude: '', longitude: '', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? {
      name: initial.name || '', type: initial.type || 'customer_site',
      address: initial.address || '', city: initial.city || '',
      latitude: initial.latitude ?? '', longitude: initial.longitude ?? '',
      notes: initial.notes || '',
    } : { name: '', type: 'customer_site', address: '', city: '', latitude: '', longitude: '', notes: '' });
  }, [open, initial]);

  const save = async () => {
    if (!form.name) return toast.error('Nama site wajib');
    setSaving(true);
    try {
      const payload = {
        name: form.name, type: form.type, address: form.address, city: form.city,
        notes: form.notes,
        latitude: form.latitude === '' ? null : parseFloat(form.latitude),
        longitude: form.longitude === '' ? null : parseFloat(form.longitude),
      };
      const { data } = isEdit
        ? await api.put(`/topology/v2/sites/${initial.id}`, payload)
        : await api.post('/topology/v2/sites', payload);
      toast.success(isEdit ? 'Site di-update' : 'Site dibuat');
      onSaved?.(data);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  const hasCoords = form.latitude !== '' && form.longitude !== '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="site-form">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit Site' : 'Tambah Site'}</SheetTitle>
          <SheetDescription>Site akan tampil sebagai marker di peta.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {hasCoords && !isEdit && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" data-testid="site-form-coords-banner">
              <MapPin className="w-4 h-4 shrink-0" />
              <span>Koordinat dari peta: <b>{Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}</b></span>
            </div>
          )}
          <F label="Nama Site *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="site-form-name" /></F>
          <F label="Tipe">
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger data-testid="site-form-type"><SelectValue /></SelectTrigger>
              <SelectContent>{SITE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </F>
          <F label="Deskripsi"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="site-form-notes" /></F>

          <div className="grid grid-cols-2 gap-2">
            <F label="Kota"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></F>
            <F label="Alamat"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></F>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <F label="Latitude"><Input type="number" step="0.00001" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} data-testid="site-form-lat" /></F>
            <F label="Longitude"><Input type="number" step="0.00001" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} data-testid="site-form-lng" /></F>
          </div>
          <div className="text-[10px] text-muted-foreground">Koordinat terisi otomatis dari klik peta. Kosongkan kalau belum tahu — site tidak akan muncul di peta sampai koordinat diisi.</div>
        </div>
        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={save} disabled={saving} data-testid="site-form-save">{saving ? 'Menyimpan…' : 'Simpan'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// DEVICE FORM — pilih device existing atau buat baru
// ============================================================================
function DeviceForm({ open, onOpenChange, site, allDevices, allRacks, onSaved }) {
  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [deviceId, setDeviceId] = useState('');
  const [newDevice, setNewDevice] = useState({ name: '', role: '', vendor: '', mgmt_ip: '', model: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setDeviceId(''); setNewDevice({ name: '', role: '', vendor: '', mgmt_ip: '', model: '' }); setMode('existing'); }
  }, [open]);

  const targetRackId = site?.ref_rack_id;

  const save = async () => {
    setSaving(true);
    try {
      if (mode === 'existing') {
        if (!deviceId) return toast.error('Pilih device');
        if (!targetRackId) return toast.error('Site ini belum punya rack — buat rack dulu di My DataCenter');
        await api.put(`/devices/${deviceId}`, {
          ...(allDevices.find((d) => d.id === deviceId) || {}),
          rack_id: targetRackId,
        });
        toast.success('Device ditugaskan ke site');
      } else {
        if (!newDevice.name) return toast.error('Nama device wajib');
        if (!targetRackId) return toast.error('Site ini belum punya rack — buat rack dulu di My DataCenter');
        await api.post('/devices', { ...newDevice, rack_id: targetRackId });
        toast.success('Device baru dibuat');
      }
      onSaved?.();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md" data-testid="device-form">
        <SheetHeader>
          <SheetTitle>Add Device ke {site?.name}</SheetTitle>
          <SheetDescription>Pilih device yang sudah ada atau buat baru.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/40 w-full">
            <button onClick={() => setMode('existing')} className={`flex-1 text-xs px-3 py-1.5 rounded ${mode === 'existing' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} data-testid="device-mode-existing">Existing</button>
            <button onClick={() => setMode('new')} className={`flex-1 text-xs px-3 py-1.5 rounded ${mode === 'new' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} data-testid="device-mode-new">New</button>
          </div>
          {mode === 'existing' ? (
            <F label="Device">
              <Select value={deviceId} onValueChange={setDeviceId}>
                <SelectTrigger data-testid="device-form-select"><SelectValue placeholder="Pilih device…" /></SelectTrigger>
                <SelectContent>
                  {allDevices.map((d) => <SelectItem key={d.id} value={d.id}>{d.name} · {d.role || '?'}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
          ) : (
            <>
              <F label="Nama *"><Input value={newDevice.name} onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })} data-testid="device-form-name" /></F>
              <F label="Role"><Input value={newDevice.role} onChange={(e) => setNewDevice({ ...newDevice, role: e.target.value })} placeholder="Router / Switch / AP" /></F>
              <F label="Vendor"><Input value={newDevice.vendor} onChange={(e) => setNewDevice({ ...newDevice, vendor: e.target.value })} placeholder="MikroTik / Cisco / Ubiquiti" /></F>
              <F label="Mgmt IP"><Input value={newDevice.mgmt_ip} onChange={(e) => setNewDevice({ ...newDevice, mgmt_ip: e.target.value })} placeholder="10.0.0.1" /></F>
            </>
          )}
        </div>
        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={save} disabled={saving} data-testid="device-form-save">{saving ? 'Menyimpan…' : 'Simpan'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// CONNECTION FORM
// ============================================================================
function ConnForm({ open, onOpenChange, sourceDevice, allSites, allDevices, devicesBySite, partners, onSaved }) {
  const [form, setForm] = useState({
    dest_site_id: '', dest_device_id: '', link_type: 'Fiber Optic Artamedia',
    description: '', capacity_mbps: '', provider_id: '', circuit_id: '',
    source_port: '', dest_port: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setForm({ dest_site_id: '', dest_device_id: '', link_type: 'Fiber Optic Artamedia', description: '', capacity_mbps: '', provider_id: '', circuit_id: '', source_port: '', dest_port: '' });
  }, [open]);

  const destDevices = form.dest_site_id ? (devicesBySite[form.dest_site_id] || []) : [];

  const save = async () => {
    if (!sourceDevice) return toast.error('Source device tidak ada');
    if (!form.dest_device_id) return toast.error('Destination device wajib');
    setSaving(true);
    try {
      await api.post('/topology/v2/links', {
        source_device_id: sourceDevice.id,
        source_port: form.source_port,
        dest_device_id: form.dest_device_id,
        dest_port: form.dest_port,
        link_type: form.link_type,
        description: form.description,
        capacity_mbps: form.capacity_mbps === '' ? null : parseInt(form.capacity_mbps, 10),
        provider_id: form.provider_id || null,
        circuit_id: form.circuit_id,
        role: 'primary',
      });
      toast.success('Connection tersimpan');
      onSaved?.();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSaving(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="conn-form">
        <SheetHeader>
          <SheetTitle>Add Connection</SheetTitle>
          <SheetDescription>Sistem akan otomatis menggambar garis di peta.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <F label="Source Device">
            <Input value={sourceDevice?.name || ''} disabled data-testid="conn-form-source-device" />
          </F>
          <F label="Source Port"><Input value={form.source_port} onChange={(e) => setForm({ ...form, source_port: e.target.value })} placeholder="e.g. ether1" data-testid="conn-form-source-port" /></F>
          <F label="Destination Site *">
            <Select value={form.dest_site_id} onValueChange={(v) => setForm({ ...form, dest_site_id: v, dest_device_id: '' })}>
              <SelectTrigger data-testid="conn-form-dest-site"><SelectValue placeholder="Pilih site tujuan…" /></SelectTrigger>
              <SelectContent>
                {allSites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </F>
          <F label="Destination Device *">
            <Select value={form.dest_device_id} onValueChange={(v) => setForm({ ...form, dest_device_id: v })} disabled={!form.dest_site_id}>
              <SelectTrigger data-testid="conn-form-dest-device"><SelectValue placeholder={form.dest_site_id ? 'Pilih device…' : 'Pilih site dulu'} /></SelectTrigger>
              <SelectContent>
                {destDevices.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                {destDevices.length === 0 && form.dest_site_id && <div className="p-2 text-xs text-muted-foreground">Site ini belum punya device</div>}
              </SelectContent>
            </Select>
          </F>
          <F label="Destination Port"><Input value={form.dest_port} onChange={(e) => setForm({ ...form, dest_port: e.target.value })} placeholder="e.g. ether2" data-testid="conn-form-dest-port" /></F>
          <F label="Connection Type *">
            <Select value={form.link_type} onValueChange={(v) => setForm({ ...form, link_type: v })}>
              <SelectTrigger data-testid="conn-form-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONN_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-1" style={{ background: getConnStyle(t.value).color }} />
                      {t.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Capacity (Mbps)"><Input type="number" value={form.capacity_mbps} onChange={(e) => setForm({ ...form, capacity_mbps: e.target.value })} placeholder="e.g. 1000" /></F>
          <F label="Provider">
            <Select value={form.provider_id || 'none'} onValueChange={(v) => setForm({ ...form, provider_id: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Pilih provider…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tidak ada —</SelectItem>
                {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </F>
          <F label="Circuit ID"><Input value={form.circuit_id} onChange={(e) => setForm({ ...form, circuit_id: e.target.value })} placeholder="mis. CID-12345" /></F>
          <F label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="conn-form-desc" /></F>
        </div>
        <SheetFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={save} disabled={saving} data-testid="conn-form-save">{saving ? 'Menyimpan…' : 'Simpan'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function F({ label, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-widest text-muted-foreground font-mono">{label}</Label>
      {children}
    </div>
  );
}
