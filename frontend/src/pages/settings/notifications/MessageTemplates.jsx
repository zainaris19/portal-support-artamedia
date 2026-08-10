import React, { useEffect, useState } from 'react';
import Breadcrumb from '@/components/Breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { FileText, Save, RotateCcw, Copy, User, Users } from 'lucide-react';
import api, { formatApiError } from '@/lib/api';

export default function MessageTemplates() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [placeholders, setPlaceholders] = useState([]);
  const [savingKey, setSavingKey] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/notifications/templates');
      setItems(data.items || []);
      setPlaceholders(data.placeholders || []);
    } catch (e) {
      toast.error('Gagal memuat template');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const update = (key, patch) => setItems((arr) => arr.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const saveOne = async (t) => {
    setSavingKey(t.key);
    try {
      await api.put(`/notifications/templates/${t.key}`, { body: t.body, enabled: t.enabled, title: t.title });
      toast.success(`Template "${t.title}" tersimpan`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setSavingKey(null); }
  };

  const resetAll = async () => {
    try {
      const { data } = await api.post('/notifications/templates/reset');
      setItems(data.items || []);
      toast.success('Semua template dikembalikan ke default');
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const copyPlaceholder = (p) => {
    const text = `{{${p}}}`;
    navigator.clipboard?.writeText(text);
    toast.success(`${text} disalin`);
  };

  if (loading) return <div className="p-6 text-muted-foreground">Memuat…</div>;

  const customer = items.filter((t) => t.channel === 'customer');
  const internal = items.filter((t) => t.channel === 'internal');

  const Group = ({ title, icon: Icon, list, tint }) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        <Icon className="w-4 h-4" /> {title}
      </div>
      {list.map((t) => (
        <Card key={t.key} data-testid={`tpl-card-${t.key}`}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${tint}`} />
                <Input className="h-8 w-64 font-medium" value={t.title} onChange={(e) => update(t.key, { title: e.target.value })} data-testid={`tpl-title-${t.key}`} />
                <Badge variant="outline" className="text-[10px]">{t.event}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t.enabled ? 'Aktif' : 'Nonaktif'}</span>
                <Switch checked={t.enabled} onCheckedChange={(v) => update(t.key, { enabled: v })} data-testid={`tpl-enabled-${t.key}`} />
              </div>
            </div>
            <Textarea
              value={t.body}
              onChange={(e) => update(t.key, { body: e.target.value })}
              rows={t.channel === 'customer' ? 9 : 7}
              className="font-mono text-[13px] leading-relaxed"
              data-testid={`tpl-body-${t.key}`}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveOne(t)} disabled={savingKey === t.key} data-testid={`tpl-save-${t.key}`}>
                <Save className="w-3.5 h-3.5 mr-1.5" />{savingKey === t.key ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="space-y-6" data-testid="message-templates-page">
      <Breadcrumb items={[{ label: 'Settings' }, { label: 'Notification Center' }, { label: 'Message Templates' }]} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">Message Templates</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Ubah isi pesan tanpa menyentuh kode. Gunakan placeholder yang tersedia di bawah.</p>
          </div>
        </div>
        <Button variant="outline" onClick={resetAll} data-testid="tpl-reset-btn"><RotateCcw className="w-4 h-4 mr-2" />Reset ke Default</Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="text-xs font-semibold text-muted-foreground mb-2">PLACEHOLDER TERSEDIA (klik untuk menyalin)</div>
          <div className="flex flex-wrap gap-2">
            {placeholders.map((p) => (
              <button key={p} onClick={() => copyPlaceholder(p)} className="group inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[12px] font-mono hover:border-primary hover:text-primary transition-colors" data-testid={`tpl-ph-${p}`}>
                {`{{${p}}}`}<Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-8">
        <Group title="Pesan ke Customer" icon={User} list={customer} tint="bg-emerald-500" />
        <Group title="Pesan Grup Internal" icon={Users} list={internal} tint="bg-blue-500" />
      </div>
    </div>
  );
}
