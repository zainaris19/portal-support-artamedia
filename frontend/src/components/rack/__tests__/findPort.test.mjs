// Unit test for findPort() — covers:
//  - Huawei slash format (100GE1/0/24, 10GE1/0/10)
//  - MikroTik native + sub-lane (ether1, sfp-sfpplus1, qsfpplus1-1..4)
//  - MikroTik USER-RENAMED interfaces (real production names from Zabbix
//    Interface List: "sfp-sfpplus1-j2-apjii",
//    "sfp-sfpplus2 - 99teck - Rajegnet", "sfp-sfpplus24=trunk_bangka", ...)
// Run: node /app/frontend/src/components/rack/__tests__/findPort.test.mjs

function findPort(portList, hint) {
  if (!hint) return null;
  const raw = String(hint).trim();
  const stripped = raw.toLowerCase().replace(/[\s_\-=]/g, '');
  for (const pt of portList) {
    const pidS = String(pt.id).toLowerCase().replace(/[\s_\-=]/g, '');
    if (stripped === pidS) return pt;
    const plS = String(pt.label).toLowerCase().replace(/[\s_\-=]/g, '');
    if (stripped === plS) return pt;
  }
  const slash = raw.match(/^(\d*[A-Za-z][A-Za-z0-9]*?)\s*(\d+)\/(\d+)(?:\/(\d+))?$/);
  if (slash) {
    const ifPrefix = slash[1].toLowerCase().replace(/[\s_\-=]/g, '');
    const ifPort = slash[4] || slash[3];
    for (const pt of portList) {
      const pn = String(pt.id).toLowerCase().replace(/[\s_\-=]/g, '');
      const s = pn.match(/^(\d*[a-z][a-z0-9]*?)(\d+)$/);
      if (!s) continue;
      if (s[1] === ifPrefix && (s[2] === ifPort || String(pt.number) === ifPort)) return pt;
    }
  }
  const normHint = raw.toLowerCase().replace(/[\s_=]/g, '-');
  const sorted = [...portList].sort((a, b) => String(b.id).length - String(a.id).length);
  for (const pt of sorted) {
    const pid = String(pt.id).toLowerCase().replace(/[\s_=]/g, '-');
    if (normHint.startsWith(pid)) {
      const next = normHint[pid.length];
      if (!next || !/[0-9]/.test(next)) return pt;
    }
  }
  for (const pt of sorted) {
    const pid = String(pt.id).toLowerCase().replace(/[\s_\-=]/g, '');
    if (stripped.startsWith(pid)) {
      const next = stripped[pid.length];
      if (!next || !/[0-9]/.test(next)) return pt;
    }
  }
  const PREFIX_ALIASES = [
    [/^sfpsfpplus/, 'sfpplus'],
    [/^sfpsfp/, 'sfp'],
    [/^qsfpqsfp/, 'qsfp'],
    [/^tengige/, 'te'],
    [/^gigabitethernet/, 'ge'],
  ];
  for (const pt of sorted) {
    let pid = String(pt.id).toLowerCase().replace(/[\s_\-=]/g, '');
    let changed = false;
    for (const [re, rep] of PREFIX_ALIASES) {
      if (re.test(pid)) { pid = pid.replace(re, rep); changed = true; break; }
    }
    if (!changed) continue;
    if (stripped.startsWith(pid)) {
      const next = stripped[pid.length];
      if (!next || !/[0-9]/.test(next)) return pt;
    }
  }
  const num = raw.match(/(\d+)\s*$/);
  if (num) {
    return portList.find((pt) => String(pt.number) === num[1] || String(pt.label) === num[1]) || null;
  }
  return null;
}

// ============ TEST FIXTURES ============
const huaweiCE6870 = [
  ...Array.from({length:24}, (_,i)=>({id:`10GE${i+1}`, label:String(i+1), number:i+1, type:'SFP+'})),
  ...Array.from({length:6},  (_,i)=>({id:`100GE${i+1}`, label:String(i+1), number:i+1, type:'QSFP28'})),
];

// MikroTik CRS326-24S+2Q+RM: 1x mgmt + 24x SFP+ 10G + 2x QSFP+ 40G
const mikrotikCRS326_24S_2Q = [
  {id:'ether1', label:'1', number:1, type:'RJ45'},
  ...Array.from({length:24}, (_,i)=>({id:`sfp-sfpplus${i+1}`, label:String(i+1), number:i+1, type:'SFP+'})),
  ...Array.from({length:2},  (_,i)=>({id:`qsfpplus${i+1}`, label:String(i+1), number:i+1, type:'QSFP'})),
];

const cases = [
  // ---- Huawei slash format ----
  ['CE6870',  huaweiCE6870, '10GE1/0/1',   '10GE1'],
  ['CE6870',  huaweiCE6870, '10GE1/0/10',  '10GE10'],
  ['CE6870',  huaweiCE6870, '10GE1/0/24',  '10GE24'],
  ['CE6870',  huaweiCE6870, '100GE1/0/1',  '100GE1'],
  ['CE6870',  huaweiCE6870, '100GE1/0/6',  '100GE6'],

  // ---- MikroTik CRS326-24S+2Q+ native names ----
  ['CRS326',  mikrotikCRS326_24S_2Q, 'ether1',        'ether1'],
  ['CRS326',  mikrotikCRS326_24S_2Q, 'sfp-sfpplus1',  'sfp-sfpplus1'],
  ['CRS326',  mikrotikCRS326_24S_2Q, 'sfp-sfpplus24', 'sfp-sfpplus24'],
  ['CRS326',  mikrotikCRS326_24S_2Q, 'qsfpplus1-1',   'qsfpplus1'],
  ['CRS326',  mikrotikCRS326_24S_2Q, 'qsfpplus1-4',   'qsfpplus1'],
  ['CRS326',  mikrotikCRS326_24S_2Q, 'qsfpplus2-1',   'qsfpplus2'],
  ['CRS326',  mikrotikCRS326_24S_2Q, 'qsfpplus2-4',   'qsfpplus2'],

  // ---- REAL user-renamed interfaces (from Zabbix Interface List screenshot) ----
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus1-j2-apjii',           'sfp-sfpplus1'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus2 - 99teck - Rajegnet','sfp-sfpplus2'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus3-ntt',                'sfp-sfpplus3'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus4-moratel',            'sfp-sfpplus4'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus5-iix',                'sfp-sfpplus5'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus6 - IDC via IOSYS',    'sfp-sfpplus6'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus9 - ODP_INDOSAT',      'sfp-sfpplus9'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus10-to-DCI',            'sfp-sfpplus10'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus11-LA METRO',          'sfp-sfpplus11'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus16 - primacom_new',    'sfp-sfpplus16'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus21-ggc_palapa',        'sfp-sfpplus21'],
  ['User',    mikrotikCRS326_24S_2Q, 'sfp-sfpplus24=trunk_bangka',      'sfp-sfpplus24'],
  // Boundary check: sfp-sfpplus1 should NOT swallow sfp-sfpplus10
  ['Boundary',mikrotikCRS326_24S_2Q, 'sfp-sfpplus1',   'sfp-sfpplus1'],
  ['Boundary',mikrotikCRS326_24S_2Q, 'sfp-sfpplus10',  'sfp-sfpplus10'],

  // ---- Short-form MikroTik naming (older RouterOS): "sfpplus1..24" instead
  //      of "sfp-sfpplus1..24". Alias fallback should handle these.
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus1',                    'sfp-sfpplus1'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus24',                   'sfp-sfpplus24'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus1_to_apjii',           'sfp-sfpplus1'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus3-NTT',                'sfp-sfpplus3'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus4 - DCC',              'sfp-sfpplus4'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus6 - NTT New Rack',     'sfp-sfpplus6'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus8-JKTIX',              'sfp-sfpplus8'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus12 - singtel',         'sfp-sfpplus12'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus18-dcc_herza_new',     'sfp-sfpplus18'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'sfpplus20-sw huawei ce6870',  'sfp-sfpplus20'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'qsfpplus1-1_to_apjii',        'qsfpplus1'],
  ['Alias',   mikrotikCRS326_24S_2Q, 'qsfpplus2-1',                 'qsfpplus2'],
];

let pass = 0, fail = 0;
for (const [tpl, portList, hint, expected] of cases) {
  const got = findPort(portList, hint);
  const ok = got?.id === expected;
  console.log(`${ok?'✓':'✗'}  [${tpl.padEnd(8)}] ${hint.padEnd(38)} → ${got?.id ?? 'null'}  (expected ${expected})`);
  if (ok) pass++; else fail++;
}
console.log(`\n${pass}/${pass+fail} PASS${fail ? ` · ${fail} FAIL` : ''}`);
process.exit(fail ? 1 : 0);
