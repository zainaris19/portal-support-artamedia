import React, { useMemo } from 'react';
import { Filter } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * ProviderFilter — provider selector rendered as a compact dropdown.
 * Props:
 *  - items: array of records
 *  - getProvider: (item) => string | null  (return provider display name)
 *  - value: currently selected provider ('all', '__none__' or a specific name)
 *  - onChange: (name) => void
 *  - testKey: string used for data-testid
 */
export default function ProviderFilter({ items = [], getProvider, value = 'all', onChange, testKey = 'provider' }) {
  const providers = useMemo(() => {
    const set = new Map();
    items.forEach((it) => {
      const name = getProvider(it);
      if (!name) return;
      set.set(name, (set.get(name) || 0) + 1);
    });
    return Array.from(set.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items, getProvider]);

  const totalNoProv = items.filter((i) => !getProvider(i)).length;

  if (providers.length === 0 && totalNoProv === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap py-1">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground shrink-0">
        <Filter className="w-3 h-3" /> Provider
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className="h-9 w-full sm:w-64"
          data-testid={`${testKey}-filter-provider`}
        >
          <SelectValue placeholder="Pilih provider…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" data-testid={`${testKey}-filter-all`}>
            Semua Provider · {items.length}
          </SelectItem>
          {providers.map(([name, cnt]) => (
            <SelectItem
              key={name}
              value={name}
              data-testid={`${testKey}-filter-${name.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {name} · {cnt}
            </SelectItem>
          ))}
          {totalNoProv > 0 && (
            <SelectItem value="__none__" data-testid={`${testKey}-filter-none`}>
              Tanpa Provider · {totalNoProv}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
