import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Search, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';
import Breadcrumb from '@/components/Breadcrumb';

export default function IPAMAuditLog() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get('/network/ipam/audit-log')
      .then(({ data }) => setItems(data || []))
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter((a) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return [a.user, a.action, a.cidr, a.router, a.description].some((v) => (v || '').toLowerCase().includes(s));
  });

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Network' }, { label: 'IPAM Audit Log' }]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Manrope' }}>IPAM Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">Semua aksi IPAM tercatat untuk kepentingan audit dan riwayat.</p>
      </div>
      <Card className="border-border"><CardContent className="p-3 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari user, action, CIDR, router…" className="pl-9 h-9" />
        </div>
        {loading ? <Skeleton className="h-64" /> : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            <ClipboardList className="w-6 h-6 mx-auto mb-1 opacity-60" />
            Belum ada aktivitas IPAM.
          </div>
        ) : (
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Waktu</TableHead>
                  <TableHead className="text-xs">User</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs">CIDR</TableHead>
                  <TableHead className="text-xs">Router</TableHead>
                  <TableHead className="text-xs">Source IP</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id} className="hover:bg-accent/40">
                    <TableCell className="text-xs whitespace-nowrap">{new Date(a.at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{a.user}</TableCell>
                    <TableCell className="text-xs"><span className="px-1.5 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary text-[10px]">{a.action}</span></TableCell>
                    <TableCell className="font-mono text-xs">{a.cidr || '—'}</TableCell>
                    <TableCell className="text-xs">{a.router || '—'}</TableCell>
                    <TableCell className="text-xs font-mono">{a.source_ip || '—'}</TableCell>
                    <TableCell className="text-xs">{a.description || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
