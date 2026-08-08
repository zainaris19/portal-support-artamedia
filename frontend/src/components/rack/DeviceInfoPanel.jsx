import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { Server, Boxes, Cpu, HardDrive, Network, User, Building2, FileText, Layers } from 'lucide-react';

/**
 * DeviceInfoPanel
 * ---------------
 * Section 2 — details of the currently-selected device.
 * Purely presentational.
 */
export default function DeviceInfoPanel({ device, template, customer, partner }) {
  if (!device) {
    return (
      <Card className="border-border/70 h-full">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          <Server className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="font-medium">Pilih perangkat dari rack elevation</p>
          <p className="text-xs mt-1 opacity-70">Klik salah satu device di kolom kiri untuk melihat detail, front panel, dan port.</p>
        </CardContent>
      </Card>
    );
  }

  const positionRange = `U${device.position_u}${(device.height_u || 1) > 1 ? `–U${device.position_u + (device.height_u || 1) - 1}` : ''}`;

  return (
    <Card className="border-border/70">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Selected Device</div>
            <div className="flex items-center gap-2 mt-1">
              <Server className="w-5 h-5 text-blue-400 shrink-0" />
              <h2 className="text-xl font-semibold tracking-tight truncate" style={{ fontFamily: 'Manrope' }}>
                {device.name}
              </h2>
            </div>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">{device.hostname || '—'}</div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={device.status} />
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-border/60 text-muted-foreground">
              {template.vendor} · {template.model}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
          <Field icon={Cpu} label="Vendor" value={device.brand} />
          <Field icon={HardDrive} label="Model" value={device.model} />
          <Field icon={FileText} label="Serial" value={device.serial_number} mono />
          <Field icon={Network} label="Mgmt IP" value={device.ip_management} mono />
          <Field icon={Boxes} label="Position" value={positionRange} mono />
          <Field icon={Layers} label="Height" value={`${device.height_u || 1}U`} mono />
          <Field icon={FileText} label="Role" value={device.service || '—'} />
          <Field icon={Cpu} label="Firmware" value={device.firmware || '—'} mono />
          <Field icon={FileText} label="Install date" value={device.install_date || '—'} mono />
          <Field icon={FileText} label="Power A / B" value={`${device.power_source_a || '—'} / ${device.power_source_b || '—'}`} mono />
          {customer && <Field icon={User} label="Customer" value={customer} />}
          {partner && <Field icon={Building2} label="Provider" value={partner} />}
        </div>

        {device.notes && (
          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Notes</div>
            <p className="text-sm whitespace-pre-wrap text-foreground/90">{device.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ icon: Icon, label, value, mono }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className={cn('mt-1 truncate', mono ? 'font-mono text-[13px]' : 'text-sm')}>
        {value || '—'}
      </div>
    </div>
  );
}
