import React, { useEffect, useState } from 'react';

// POP nodes positioned stylistically to hint at Indonesia's shape (west→east).
// coords are in viewBox 800x360.
const NODES = [
  { id: 'medan',   name: 'Medan',       x: 90,  y: 90,  tier: 'core' },
  { id: 'batam',   name: 'Batam',       x: 180, y: 130, tier: 'edge' },
  { id: 'pontianak', name: 'Pontianak', x: 340, y: 100, tier: 'edge' },
  { id: 'jakarta', name: 'Jakarta',     x: 280, y: 210, tier: 'core' },
  { id: 'bandung', name: 'Bandung',     x: 310, y: 240, tier: 'edge' },
  { id: 'semarang', name: 'Semarang',   x: 370, y: 220, tier: 'edge' },
  { id: 'surabaya', name: 'Surabaya',   x: 430, y: 240, tier: 'core' },
  { id: 'denpasar', name: 'Denpasar',   x: 490, y: 275, tier: 'edge' },
  { id: 'balikpapan', name: 'Balikpapan', x: 460, y: 130, tier: 'edge' },
  { id: 'makassar', name: 'Makassar',   x: 540, y: 200, tier: 'core' },
  { id: 'manado',  name: 'Manado',      x: 600, y: 100, tier: 'edge' },
  { id: 'ambon',   name: 'Ambon',       x: 640, y: 210, tier: 'edge' },
  { id: 'jayapura', name: 'Jayapura',   x: 730, y: 170, tier: 'core' },
];

// Fiber links between POPs
const LINKS = [
  ['medan', 'batam'],
  ['batam', 'jakarta'],
  ['medan', 'pontianak'],
  ['pontianak', 'jakarta'],
  ['jakarta', 'bandung'],
  ['jakarta', 'semarang'],
  ['bandung', 'semarang'],
  ['semarang', 'surabaya'],
  ['surabaya', 'denpasar'],
  ['surabaya', 'balikpapan'],
  ['balikpapan', 'makassar'],
  ['makassar', 'denpasar'],
  ['makassar', 'manado'],
  ['makassar', 'ambon'],
  ['manado', 'ambon'],
  ['ambon', 'jayapura'],
  ['pontianak', 'balikpapan'],
];

export default function BackboneMap() {
  // rotate pulse timing across nodes so they animate out of sync
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => (v + 1) % 1000), 900);
    return () => clearInterval(t);
  }, []);

  const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));

  return (
    <div className="relative w-full">
      <svg viewBox="0 0 800 360" className="w-full h-auto block" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* subtle background grid */}
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="1" />
          </pattern>
          <linearGradient id="glow" x1="0" x2="1">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0" />
            <stop offset="50%" stopColor="#60A5FA" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="nodeCore" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#93C5FD" />
            <stop offset="60%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#1E40AF" />
          </radialGradient>
        </defs>

        {/* background grid */}
        <rect width="800" height="360" fill="url(#grid)" />

        {/* Indonesia landmass hint: soft blob paths per island cluster */}
        <g fill="rgba(59,130,246,0.05)" stroke="rgba(96,165,250,0.15)" strokeWidth="1">
          <path d="M40,100 C80,60 160,60 210,90 C240,110 240,150 220,170 C170,190 90,180 60,150 Z" />
          <path d="M240,220 C270,200 470,200 520,225 C510,270 460,285 380,285 C300,285 260,265 240,240 Z" />
          <path d="M320,80 C420,60 500,80 520,115 C500,150 460,170 400,160 C350,155 320,120 320,80 Z" />
          <path d="M520,110 C570,90 620,90 630,110 C625,145 590,160 540,150 C520,140 510,125 520,110 Z" />
          <path d="M540,180 C620,170 700,190 720,220 C700,250 620,255 560,240 C530,225 520,200 540,180 Z" />
          <path d="M660,140 C720,130 780,150 780,190 C760,215 700,220 660,205 C640,190 640,160 660,140 Z" />
        </g>

        {/* Fiber links */}
        {LINKS.map(([a, b], i) => {
          const A = nodeById[a]; const B = nodeById[b];
          if (!A || !B) return null;
          // curved path for elegance
          const mx = (A.x + B.x) / 2;
          const my = (A.y + B.y) / 2 - 12;
          return (
            <g key={i}>
              {/* base fibre */}
              <path d={`M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}`} fill="none" stroke="rgba(96,165,250,0.25)" strokeWidth="1" />
              {/* flowing pulse */}
              <path
                d={`M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}`}
                fill="none"
                stroke="#60A5FA"
                strokeWidth="1.5"
                strokeDasharray="4 40"
                strokeLinecap="round"
                style={{ animation: `dashFlow ${5 + (i % 3)}s linear infinite`, animationDelay: `${(i * 0.2) % 3}s`, opacity: 0.85 }}
              />
            </g>
          );
        })}

        {/* Nodes */}
        {NODES.map((n, i) => {
          const isCore = n.tier === 'core';
          return (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
              {/* outer pulse ring */}
              <circle r={isCore ? 4 : 3} fill="#60A5FA" opacity="0.35">
                <animate attributeName="r" values={`${isCore ? 4 : 3};${isCore ? 16 : 12};${isCore ? 4 : 3}`} dur={`${2.5 + (i % 3) * 0.5}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0;0.4" dur={`${2.5 + (i % 3) * 0.5}s`} repeatCount="indefinite" />
              </circle>
              {/* node dot */}
              <circle r={isCore ? 5 : 3.5} fill="url(#nodeCore)" stroke="rgba(147,197,253,0.8)" strokeWidth={isCore ? 1.2 : 0.6} />
              {/* label */}
              <text x={0} y={isCore ? -12 : -9} textAnchor="middle" fontSize={isCore ? 10 : 8.5} fill={isCore ? '#DBEAFE' : 'rgba(203,213,225,0.65)'} fontFamily="IBM Plex Sans, system-ui" fontWeight={isCore ? 600 : 400} style={{ letterSpacing: '0.02em' }}>
                {n.name}
              </text>
            </g>
          );
        })}
      </svg>

      <style>{`
        @keyframes dashFlow { to { stroke-dashoffset: -220; } }
      `}</style>
    </div>
  );
}
