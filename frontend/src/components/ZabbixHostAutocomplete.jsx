import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, X, CheckCircle2, Search, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

/**
 * ZabbixHostAutocomplete — live search a Zabbix host name.
 * Props:
 *   value          — current selected host name string
 *   onChange(name) — called when user picks a host or clears it
 *   testId         — optional data-testid prefix
 */
export default function ZabbixHostAutocomplete({ value, onChange, testId = 'zabbix-host' }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  // sync external value → local query
  useEffect(() => { setQuery(value || ''); }, [value]);

  // Debounced search
  useEffect(() => {
    if (!open) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get('/zabbix/hosts', { params: { search: query.trim() } });
        setResults(data.items || []);
      } catch (e) {
        setError(e.response?.data?.detail || e.message || 'Zabbix error');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  // click-outside → close
  useEffect(() => {
    const onDown = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const selectHost = (h) => {
    onChange?.(h.name);
    setQuery(h.name);
    setOpen(false);
  };
  const clear = () => {
    onChange?.('');
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <Wifi className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-400/70 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Cari nama host di Zabbix (live)…"
          className="pl-7 pr-8 font-mono text-[13px]"
          data-testid={`${testId}-input`}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title="Clear"
            tabIndex={-1}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full max-h-[280px] overflow-auto rounded-md border border-border/70 bg-popover shadow-lg"
          data-testid={`${testId}-dropdown`}
        >
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Mencari di Zabbix…
            </div>
          )}
          {error && !loading && (
            <div className="px-3 py-2 text-xs text-rose-400">
              {error}
              <div className="text-muted-foreground mt-0.5">Pastikan Zabbix sudah dikonfigurasi di Settings → Monitoring · Zabbix.</div>
            </div>
          )}
          {!loading && !error && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Search className="w-3.5 h-3.5" /> Tidak ada host {query ? `cocok "${query}"` : 'ditemukan'}.
            </div>
          )}
          {!loading && !error && results.slice(0, 50).map((h) => (
            <button
              key={h.hostid}
              type="button"
              onClick={() => selectHost(h)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2',
                value === h.name && 'bg-primary/10 text-primary',
              )}
              data-testid={`${testId}-option-${h.hostid}`}
            >
              {value === h.name ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
              ) : (
                <span className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="flex-1 truncate font-mono">{h.name}</span>
              {h.host && h.host !== h.name && (
                <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[130px]">{h.host}</span>
              )}
              <span
                className={cn(
                  'text-[9px] px-1 rounded font-mono uppercase',
                  h.status === '0' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-500/10 text-slate-400',
                )}
              >
                {h.status === '0' ? 'active' : 'disabled'}
              </span>
            </button>
          ))}
          {!loading && results.length > 50 && (
            <div className="px-3 py-1 text-[10px] text-muted-foreground border-t border-border/60">
              Menampilkan 50 dari {results.length} host. Ketik lebih spesifik untuk mempersempit.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
