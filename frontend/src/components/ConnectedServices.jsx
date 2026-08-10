import React, { useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X, Search, Layers, Trash2, ChevronDown, Check, Cable, Wifi, Server, Zap, Network } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORIES = ['Broadband', 'Dedicated Internet', 'Metro Ethernet', 'Dark Fiber', 'Cross Connect'];
const CATEGORY_ICONS = {
  'Broadband': Wifi,
  'Dedicated Internet': Server,
  'Metro Ethernet': Network,
  'Dark Fiber': Zap,
  'Cross Connect': Cable,
};

/**
 * ConnectedServices — reusable multi-service picker for a customer profile.
 * A service item can be:
 *   { source: 'partner', partner_id, category, name, capacity, description, cid }
 *   { source: 'manual',  category, name, capacity, description }
 *
 * Props:
 *  - value: array of service items
 *  - onChange: (list) => void
 *  - partners: array of partner records (id, name, category, cid, capacity, service_name)
 */
export default function ConnectedServices({ value = [], onChange, partners = [] }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ category: 'Broadband', name: '', capacity: '', description: '' });

  const usedPartnerIds = useMemo(() => new Set(value.filter((v) => v.source === 'partner' && v.partner_id).map((v) => v.partner_id)), [value]);

  const addFromPartner = (p) => {
    const item = {
      source: 'partner',
      partner_id: p.id,
      category: p.category || 'Broadband',
      name: p.service_name || p.name,
      capacity: p.capacity || '',
      cid: p.cid || '',
      description: '',
    };
    onChange([...(value || []), item]);
    setPickerOpen(false);
  };

  const addManual = () => {
    if (!manualForm.name.trim()) return;
    onChange([...(value || []), { source: 'manual', ...manualForm }]);
    setManualForm({ category: 'Broadband', name: '', capacity: '', description: '' });
    setManualOpen(false);
  };

  const removeAt = (idx) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const updateAt = (idx, patch) => {
    const next = value.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" /> Connected Services ({value?.length || 0})
        </div>
        <div className="flex-1" />
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" data-testid="cs-add-provider">
              <Plus className="w-3.5 h-3.5 mr-1" /> Dari Provider
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[420px] p-0" align="end">
            <Command>
              <CommandInput placeholder="Cari provider / CID / layanan…" />
              <CommandList className="max-h-80">
                <CommandEmpty>Tidak ada provider.</CommandEmpty>
                {CATEGORIES.map((cat) => {
                  const list = partners.filter((p) => (p.category || 'Broadband') === cat);
                  if (list.length === 0) return null;
                  return (
                    <CommandGroup key={cat} heading={cat}>
                      {list.map((p) => {
                        const already = usedPartnerIds.has(p.id);
                        return (
                          <CommandItem
                            key={p.id}
                            value={`${p.name} ${p.cid} ${p.service_name} ${cat}`}
                            onSelect={() => !already && addFromPartner(p)}
                            className={cn('flex items-start gap-2', already && 'opacity-50')}
                          >
                            {already ? <Check className="w-3.5 h-3.5 mt-0.5 text-primary" /> : <Plus className="w-3.5 h-3.5 mt-0.5" />}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{p.name} <span className="font-mono text-[11px] text-muted-foreground">· {p.cid || '-'}</span></div>
                              <div className="text-[11px] text-muted-foreground truncate">{p.service_name || '-'} · {p.capacity || '-'}</div>
                              {p.install_address && <div className="text-[10px] text-muted-foreground/80 truncate italic">📍 {p.install_address}</div>}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="outline" onClick={() => setManualOpen((o) => !o)} data-testid="cs-add-manual">
          <Plus className="w-3.5 h-3.5 mr-1" /> Manual
        </Button>
      </div>

      {manualOpen && (
        <div className="p-3 rounded-md border border-dashed border-border bg-muted/40 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Kategori</Label>
              <Select value={manualForm.category} onValueChange={(v) => setManualForm({ ...manualForm, category: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Kapasitas</Label>
              <Input className="h-8" value={manualForm.capacity} placeholder="mis. 100 Mbps" onChange={(e) => setManualForm({ ...manualForm, capacity: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Nama Layanan</Label>
              <Input className="h-8" value={manualForm.name} placeholder="mis. IPTV / Backup ADSL" onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })} data-testid="cs-manual-name" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Deskripsi</Label>
              <Input className="h-8" value={manualForm.description} onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setManualOpen(false)}>Batal</Button>
            <Button size="sm" onClick={addManual} data-testid="cs-manual-save">Tambah</Button>
          </div>
        </div>
      )}

      {(value?.length || 0) === 0 ? (
        <div className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-md">
          Belum ada layanan tertaut. Tambahkan dari Provider database atau entri manual.
        </div>
      ) : (
        <ul className="space-y-2">
          {value.map((it, idx) => {
            const Icon = CATEGORY_ICONS[it.category] || Layers;
            return (
              <li key={idx} className="flex items-start gap-2 p-2.5 rounded-md border border-border bg-card">
                <div className="w-7 h-7 shrink-0 rounded bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1 grid grid-cols-6 gap-2 items-center">
                  <div className="col-span-2 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Layanan</div>
                    <div className="text-sm font-medium truncate">{it.name || '-'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Kategori</div>
                    <div className="text-xs truncate">{it.category}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Kapasitas</div>
                    <div className="text-xs truncate">{it.capacity || '-'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</div>
                    <div className="text-xs truncate">
                      {it.source === 'partner' ? (
                        <span className="font-mono">CID {it.cid || '-'}</span>
                      ) : (
                        <span className="text-muted-foreground italic">manual</span>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 flex justify-end">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600 hover:text-rose-700" onClick={() => removeAt(idx)} data-testid={`cs-remove-${idx}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
