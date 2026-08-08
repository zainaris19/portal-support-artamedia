import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export default function Breadcrumb({ items }) {
  const location = useLocation();
  const list = items || defaultFromPath(location.pathname);
  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4" aria-label="Breadcrumb">
      <Link to="/" className="flex items-center gap-1 hover:text-foreground transition-colors">
        <Home className="w-3 h-3" /> Beranda
      </Link>
      {list.map((it, i) => (
        <React.Fragment key={i}>
          <ChevronRight className="w-3 h-3 opacity-60" />
          {it.to && i !== list.length - 1 ? (
            <Link to={it.to} className="hover:text-foreground transition-colors">{it.label}</Link>
          ) : (
            <span className={i === list.length - 1 ? 'text-foreground font-medium' : ''}>{it.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

function defaultFromPath(path) {
  const seg = path.split('/').filter(Boolean);
  return seg.map((s, i) => ({ label: cap(s.replace(/-/g, ' ')), to: '/' + seg.slice(0, i + 1).join('/') }));
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
