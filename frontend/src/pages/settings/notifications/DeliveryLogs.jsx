import React, { useEffect, useState, useCallback } from 'react';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Radio, RefreshCw, User, Users } from 'lucide-react';
import api from '@/lib/api';

const STATUS_STYLE = {
  sent: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  skipped: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  failed: 'bg-red-500/15 text-red-600 border-red-500/30',
  error: 'bg-red-500/15 text-red-600 border-red-500/30',
};

function fmt(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
}

export default function DeliveryLogs() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (status !== 'all') params.status = status;
      const { data } = await api.get('/notifications/logs', { params });
      setItems(data.items || []);
    } catch { /* noop */ } finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6" data-testid="delivery-logs-page">
      <Breadcrumb items={[{ label: 'Settings' }, { label: 'Notification Center' }, { label: 'Delivery Logs' }]} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Radio className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">Delivery Logs</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Jejak seluruh notifikasi keluar dari semua modul.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" data-testid="logs-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={load} data-testid="logs-refresh-btn"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Modul / Event</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Keterangan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Memuat…</TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Belum ada log notifikasi.</TableCell></TableRow>
              ) : items.map((l) => (
                <TableRow key={l.id} data-testid={`log-row-${l.id}`}>
                  <TableCell className="whitespace-nowrap text-xs">{fmt(l.at)}</TableCell>
                  <TableCell className="text-xs"><span className="uppercase font-medium">{l.module}</span> · {l.event}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-xs">
                      {l.channel === 'internal' ? <Users className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                      {l.channel}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs font-mono">{l.ref_number || '-'}</TableCell>
                  <TableCell className="text-xs font-mono max-w-[160px] truncate">{l.target || '-'}</TableCell>
                  <TableCell><Badge className={`border ${STATUS_STYLE[l.status] || ''}`} variant="outline">{l.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">{l.detail || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
