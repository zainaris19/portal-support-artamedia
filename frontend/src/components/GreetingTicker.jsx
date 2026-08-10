import React, { useEffect, useMemo, useState } from 'react';
import { Sunrise, Sun, Sunset, Moon, Sparkles, Radio } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/**
 * Returns { label, icon, tone } based on local hour.
 *   04–10  → Selamat pagi
 *   10–15  → Selamat siang
 *   15–18  → Selamat sore
 *   18–04  → Selamat malam
 */
function greetingForHour(hour) {
  if (hour >= 4 && hour < 10) return { label: 'Selamat pagi', icon: Sunrise, tone: 'from-amber-400 via-orange-400 to-rose-400' };
  if (hour >= 10 && hour < 15) return { label: 'Selamat siang', icon: Sun, tone: 'from-yellow-400 via-amber-400 to-orange-400' };
  if (hour >= 15 && hour < 18) return { label: 'Selamat sore', icon: Sunset, tone: 'from-orange-400 via-rose-400 to-purple-400' };
  return { label: 'Selamat malam', icon: Moon, tone: 'from-indigo-500 via-blue-500 to-cyan-400' };
}

const HAPPY_LINES = [
  'Semoga hari NOC kamu lancar dan jaringan tetap green.',
  'Uptime tinggi, response cepat, kopi jangan lupa.',
  'Selalu ada satu link yang menunggu dipantau — kamu bisa!',
  'Tetap tenang, ping-mu lebih rendah dari pikiranmu.',
  'Semoga tidak ada tiket P1 hari ini. Amin.',
  'Latency stabil, hati juga.',
  'MRTG hijau semua, tugas kamu tinggal senyum.',
];

export default function GreetingTicker() {
  const { user } = useAuth();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { label, icon: Icon, tone } = greetingForHour(now.getHours());
  const displayName = (user?.name || user?.email?.split('@')[0] || 'NOC Team').split(' ')[0];

  const timeStr = useMemo(
    () => now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    [now]
  );
  const dateStr = useMemo(
    () => now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    [now]
  );

  // Build a marquee line that repeats twice for a seamless -50% translate loop.
  const items = useMemo(() => {
    const base = [
      { icon: Icon, text: `${label}, ${displayName}!` },
      { icon: Sparkles, text: HAPPY_LINES[now.getDate() % HAPPY_LINES.length] },
      { icon: Radio, text: 'Portal Support Artamedia · Enterprise NOC dashboard' },
      { icon: Sparkles, text: `${dateStr} · ${timeStr} WIB` },
    ];
    return [...base, ...base];
  }, [Icon, label, displayName, now, timeStr, dateStr]);

  return (
    <div
      data-testid="greeting-ticker"
      className="greeting-bar h-9 relative overflow-hidden shrink-0"
      role="status"
      aria-label={`${label}, ${displayName}`}
    >
      {/* Static greeting pill on the left (non-scrolling on md+) */}
      <div className="hidden md:flex absolute left-0 top-0 h-full items-center gap-2 pl-4 pr-3 z-10 bg-card/70 backdrop-blur-sm">
        <span
          className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold bg-gradient-to-r ${tone} bg-clip-text text-transparent`}
        >
          <Icon className="w-3.5 h-3.5 text-foreground/70" />
          {label},
        </span>
        <span
          data-testid="greeting-name"
          className="text-[12.5px] font-semibold text-foreground truncate max-w-[160px]"
        >
          {displayName}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums hidden lg:inline">· {timeStr} WIB</span>
      </div>

      {/* Scrolling ticker (behind pill on md+, full width on mobile) */}
      <div className="absolute inset-0 flex items-center md:pl-[280px] overflow-hidden">
        <div className="ticker-track text-[12px] text-muted-foreground">
          {items.map((it, idx) => (
            <span key={idx} className="inline-flex items-center gap-2">
              <it.icon className="w-3 h-3 text-primary/70 shrink-0" strokeWidth={2.25} />
              <span>{it.text}</span>
              <span className="text-primary/40">·</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
