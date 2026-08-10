/**
 * Device Template Registry
 * ------------------------
 * Reusable, data-driven templates that describe the *physical layout* of
 * network devices (front + rear panels) so the Infrastructure Explorer can
 * render them purely from JS/SVG — no hard-coded per-model UI.
 *
 * A template is a plain object:
 * {
 *   vendor: string,
 *   model:  string,
 *   heightU: number,             // for reference / rear rendering (not enforced)
 *   description?: string,
 *   front: {
 *     rows: [
 *       {
 *         label?: string,        // e.g. "Ports 1-24"
 *         gap?: number,          // px gap after this row group
 *         ports: [
 *           {
 *             id: string,        // stable identifier (e.g. "GigabitEthernet1/0/1")
 *             label: string,     // short label shown on port (e.g. "1")
 *             type: 'RJ45' | 'SFP' | 'SFP+' | 'QSFP' | 'QSFP28' | '100GE' | 'CONSOLE' | 'MGMT' | 'USB' | 'POWER',
 *             number?: number,   // sequential port number
 *           }, ...
 *         ]
 *       }
 *     ],
 *     accessories?: [
 *       { id, label, type }      // console / mgmt / usb rendered on the left
 *     ]
 *   },
 *   rear?: {
 *     items: [ { id, label, type, span?: number } ]  // simple horizontal strip
 *   }
 * }
 *
 * IMPORTANT: templates are pure data — they never touch React state, so they
 * can be extended, loaded from the backend, or generated later with zero UI
 * changes. The renderer (<DeviceFrontPanel/>) reads whatever is passed in.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);

const rj45 = (i, prefix = 'GE') => ({ id: `${prefix}${i}`, label: String(i), type: 'RJ45', number: i });
const sfpPort = (i, prefix = 'SFP') => ({ id: `${prefix}${i}`, label: String(i), type: 'SFP', number: i });
const sfpPlus = (i, prefix = 'SFP+') => ({ id: `${prefix}${i}`, label: String(i), type: 'SFP+', number: i });
const qsfp28 = (i, prefix = 'QSFP28') => ({ id: `${prefix}${i}`, label: String(i), type: 'QSFP28', number: i });
const qsfp = (i, prefix = 'QSFP') => ({ id: `${prefix}${i}`, label: String(i), type: 'QSFP', number: i });

// ---------------------------------------------------------------------------
// Registered templates
// ---------------------------------------------------------------------------
const templates = {
  // -------- Huawei CE6870-24S6CQ-EI (24x SFP+ 10GE + 6x QSFP28 100GE) ------
  'HUAWEI:CE6870-24S6CQ': {
    vendor: 'Huawei',
    model: 'CloudEngine CE6870-24S6CQ-EI',
    heightU: 1,
    description: '24x SFP+ 10GE + 6x QSFP28 100GE',
    front: {
      rows: [
        { label: '10GE SFP+ 1-24', ports: range(1, 24).map((i) => sfpPlus(i, '10GE')) },
        { label: 'QSFP28 100GE', ports: range(1, 6).map((i) => qsfp28(i, '100GE')) },
      ],
      accessories: [
        { id: 'CONSOLE', label: 'CON', type: 'CONSOLE' },
        { id: 'MGMT', label: 'MGMT', type: 'MGMT' },
        { id: 'USB', label: 'USB', type: 'USB' },
      ],
    },
    rear: {
      items: [
        { id: 'PSU1', label: 'PSU 1', type: 'POWER' },
        { id: 'PSU2', label: 'PSU 2', type: 'POWER' },
        { id: 'FAN1', label: 'FAN 1', type: 'ACCESSORY' },
        { id: 'FAN2', label: 'FAN 2', type: 'ACCESSORY' },
        { id: 'FAN3', label: 'FAN 3', type: 'ACCESSORY' },
        { id: 'FAN4', label: 'FAN 4', type: 'ACCESSORY' },
      ],
    },
  },

  // -------- Huawei CE6870 (48x10G SFP+ + 6x40/100G QSFP28) -----------------
  'HUAWEI:CE6870': {
    vendor: 'Huawei',
    model: 'CloudEngine CE6870',
    heightU: 1,
    description: '48x SFP+ 10GE + 6x QSFP28 100GE',
    front: {
      rows: [
        { label: '10GE SFP+ 1-48', ports: range(1, 48).map((i) => sfpPlus(i, '10GE')) },
        { label: 'QSFP28 100GE', ports: range(1, 6).map((i) => qsfp28(i, '100GE')) },
      ],
      accessories: [
        { id: 'CONSOLE', label: 'CON', type: 'CONSOLE' },
        { id: 'MGMT', label: 'MGMT', type: 'MGMT' },
        { id: 'USB', label: 'USB', type: 'USB' },
      ],
    },
    rear: {
      items: [
        { id: 'PSU1', label: 'PSU 1', type: 'POWER' },
        { id: 'PSU2', label: 'PSU 2', type: 'POWER' },
        { id: 'FAN1', label: 'FAN 1', type: 'ACCESSORY' },
        { id: 'FAN2', label: 'FAN 2', type: 'ACCESSORY' },
        { id: 'FAN3', label: 'FAN 3', type: 'ACCESSORY' },
        { id: 'FAN4', label: 'FAN 4', type: 'ACCESSORY' },
      ],
    },
  },

  // -------- Huawei CE6860 (48x SFP28 25GE + 8x QSFP28 100GE) ---------------
  'HUAWEI:CE6860': {
    vendor: 'Huawei',
    model: 'CloudEngine CE6860',
    heightU: 1,
    description: '48x SFP28 25GE + 8x QSFP28 100GE',
    front: {
      rows: [
        { label: 'SFP28 25GE 1-48', ports: range(1, 48).map((i) => ({ id: `25GE${i}`, label: String(i), type: 'SFP+', number: i })) },
        { label: 'QSFP28 100GE', ports: range(1, 8).map((i) => qsfp28(i, '100GE')) },
      ],
      accessories: [
        { id: 'CONSOLE', label: 'CON', type: 'CONSOLE' },
        { id: 'MGMT', label: 'MGMT', type: 'MGMT' },
        { id: 'USB', label: 'USB', type: 'USB' },
      ],
    },
    rear: {
      items: [
        { id: 'PSU1', label: 'PSU 1', type: 'POWER' },
        { id: 'PSU2', label: 'PSU 2', type: 'POWER' },
        { id: 'FAN1', label: 'FAN 1', type: 'ACCESSORY' },
        { id: 'FAN2', label: 'FAN 2', type: 'ACCESSORY' },
      ],
    },
  },

  // -------- MikroTik CRS326-24S+2Q+RM (24x SFP+ 10G + 2x QSFP+ 40G) --------
  'MIKROTIK:CRS326-24SPQ': {
    vendor: 'MikroTik',
    model: 'CRS326-24S+2Q+RM',
    heightU: 1,
    description: '24x SFP+ 10G + 2x QSFP+ 40G + 1x RJ45 mgmt',
    front: {
      rows: [
        { label: 'MGMT', ports: [rj45(1, 'ether')] },
        { label: 'SFP+ 10G', ports: range(1, 24).map((i) => sfpPlus(i, 'sfp-sfpplus')) },
        { label: 'QSFP+ 40G', ports: range(1, 2).map((i) => qsfp(i, 'qsfpplus')) },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'PSU 1', type: 'POWER' }, { id: 'PSU2', label: 'PSU 2', type: 'POWER' }] },
  },

  // -------- MikroTik CRS354-48G-4S+2Q+RM (48x RJ45 + 4x SFP+ + 2x QSFP+) ---
  'MIKROTIK:CRS354': {
    vendor: 'MikroTik',
    model: 'CRS354-48G-4S+2Q+RM',
    heightU: 1,
    description: '48x RJ45 GE + 4x SFP+ 10G + 2x QSFP+ 40G',
    front: {
      rows: [
        { label: 'Gigabit RJ45 1-48', ports: range(1, 48).map((i) => rj45(i, 'ether')) },
        { label: 'SFP+ 10G', ports: range(1, 4).map((i) => sfpPlus(i, 'sfp-sfpplus')) },
        { label: 'QSFP+ 40G', ports: range(1, 2).map((i) => qsfp(i, 'qsfpplus')) },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'PSU 1', type: 'POWER' }, { id: 'PSU2', label: 'PSU 2', type: 'POWER' }] },
  },

  // -------- MikroTik CRS328-4C-20S-4S+RM (4x Combo + 20x SFP + 4x SFP+) ----
  'MIKROTIK:CRS328': {
    vendor: 'MikroTik',
    model: 'CRS328-4C-20S-4S+RM',
    heightU: 1,
    description: '4x Combo (RJ45/SFP) + 20x SFP 1G + 4x SFP+ 10G',
    front: {
      rows: [
        { label: 'Combo (RJ45/SFP) 1-4', ports: range(1, 4).map((i) => ({ id: `combo${i}`, label: String(i), type: 'SFP', number: i })) },
        { label: 'SFP 1G 5-24', ports: range(5, 24).map((i) => sfpPort(i, 'sfp')) },
        { label: 'SFP+ 10G 25-28', ports: range(25, 28).map((i) => sfpPlus(i, 'sfpplus')) },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'PSU 1', type: 'POWER' }, { id: 'PSU2', label: 'PSU 2', type: 'POWER' }] },
  },

  // -------- MikroTik CCR2004-1G-12S+2XS (1x RJ45 + 12x SFP+ + 2x SFP28) ----
  'MIKROTIK:CCR2004': {
    vendor: 'MikroTik',
    model: 'CCR2004-1G-12S+2XS',
    heightU: 1,
    description: '1x RJ45 GE + 12x SFP+ 10G + 2x SFP28 25G',
    front: {
      rows: [
        { label: 'MGMT', ports: [rj45(1, 'ether')] },
        { label: 'SFP+ 10G', ports: range(1, 12).map((i) => sfpPlus(i, 'sfp-sfpplus')) },
        { label: 'SFP28 25G', ports: range(1, 2).map((i) => ({ id: `sfp28-${i}`, label: String(i), type: 'SFP+', number: i })) },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }, { id: 'USB', label: 'USB', type: 'USB' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'PSU 1', type: 'POWER' }, { id: 'PSU2', label: 'PSU 2', type: 'POWER' }] },
  },

  // -------- MikroTik CCR2116-12G-4S+ (13x 2.5G RJ45 + 4x SFP+ 10G) --------
  'MIKROTIK:CCR2116': {
    vendor: 'MikroTik',
    model: 'CCR2116-12G-4S+',
    heightU: 1,
    description: '13x RJ45 2.5G + 4x SFP+ 10G',
    front: {
      rows: [
        { label: 'RJ45 2.5G 1-13', ports: range(1, 13).map((i) => rj45(i, 'ether')) },
        { label: 'SFP+ 10G', ports: range(1, 4).map((i) => sfpPlus(i, 'sfp-sfpplus')) },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }, { id: 'USB', label: 'USB', type: 'USB' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'PSU 1', type: 'POWER' }, { id: 'PSU2', label: 'PSU 2', type: 'POWER' }] },
  },

  // -------- MikroTik CCR1009-8G-1S-1S+ (8x RJ45 + 1x SFP + 1x SFP+) -------
  'MIKROTIK:CCR1009': {
    vendor: 'MikroTik',
    model: 'CCR1009-7G-1C-1S+',
    heightU: 1,
    description: '8x RJ45 GE + 1x SFP 1G + 1x SFP+ 10G',
    front: {
      rows: [
        { label: 'Gigabit RJ45 1-8', ports: range(1, 8).map((i) => rj45(i, 'ether')) },
        { label: 'SFP 1G', ports: [sfpPort(1, 'sfp')] },
        { label: 'SFP+ 10G', ports: [sfpPlus(1, 'sfp-sfpplus')] },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'PSU 1', type: 'POWER' }, { id: 'PSU2', label: 'PSU 2', type: 'POWER' }] },
  },

  // -------- MikroTik CCR1036-8G-2S+ (8x RJ45 + 2x SFP+) -------------------
  'MIKROTIK:CCR1036': {
    vendor: 'MikroTik',
    model: 'CCR1036-8G-2S+',
    heightU: 1,
    description: '8x RJ45 GE + 2x SFP+ 10G',
    front: {
      rows: [
        { label: 'Gigabit RJ45 1-8', ports: range(1, 8).map((i) => rj45(i, 'ether')) },
        { label: 'SFP+ 10G', ports: range(1, 2).map((i) => sfpPlus(i, 'sfp-sfpplus')) },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'PSU 1', type: 'POWER' }, { id: 'PSU2', label: 'PSU 2', type: 'POWER' }] },
  },

  // -------- MikroTik RB3011UiAS-RM (10x RJ45 GE + 1x SFP + microUSB) ------
  'MIKROTIK:RB3011': {
    vendor: 'MikroTik',
    model: 'RB3011UiAS-RM',
    heightU: 1,
    description: '10x RJ45 GE + 1x SFP 1G + 1x microUSB',
    front: {
      rows: [
        { label: 'Gigabit RJ45 1-10', ports: range(1, 10).map((i) => rj45(i, 'ether')) },
        { label: 'SFP 1G', ports: [sfpPort(1, 'sfp')] },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }, { id: 'USB', label: 'USB', type: 'USB' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'DC IN', type: 'POWER' }, { id: 'POE', label: 'POE-IN', type: 'POWER' }] },
  },

  // -------- MikroTik RB2011UiAS-2HnD-IN (5x 100M + 5x GE + 1x SFP) --------
  'MIKROTIK:RB2011': {
    vendor: 'MikroTik',
    model: 'RB2011UiAS-2HnD-IN',
    heightU: 1,
    description: '5x Fast Ethernet + 5x Gigabit RJ45 + 1x SFP',
    front: {
      rows: [
        { label: 'Fast Ethernet 1-5', ports: range(1, 5).map((i) => rj45(i, 'ether-fe')) },
        { label: 'Gigabit RJ45 6-10', ports: range(6, 10).map((i) => rj45(i, 'ether')) },
        { label: 'SFP 1G', ports: [sfpPort(1, 'sfp')] },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }, { id: 'USB', label: 'USB', type: 'USB' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'DC IN', type: 'POWER' }, { id: 'POE', label: 'POE-IN', type: 'POWER' }] },
  },

  // -------- MikroTik RB4011iGS+RM (10x RJ45 GE + 1x SFP+) ----------------
  'MIKROTIK:RB4011': {
    vendor: 'MikroTik',
    model: 'RB4011iGS+RM',
    heightU: 1,
    description: '10x RJ45 GE + 1x SFP+ 10G',
    front: {
      rows: [
        { label: 'Gigabit RJ45 1-10', ports: range(1, 10).map((i) => rj45(i, 'ether')) },
        { label: 'SFP+ 10G', ports: [sfpPlus(1, 'sfp-sfpplus')] },
      ],
      accessories: [{ id: 'CONSOLE', label: 'CON', type: 'CONSOLE' }, { id: 'USB', label: 'USB', type: 'USB' }],
    },
    rear: { items: [{ id: 'PSU1', label: 'DC IN', type: 'POWER' }, { id: 'POE', label: 'POE-IN', type: 'POWER' }] },
  },

  // -------- MikroTik CRS326-24G-2S+ (24x RJ45 GE + 2x SFP+) ---------------
  'MIKROTIK:CRS326': {
    vendor: 'MikroTik',
    model: 'CRS326-24G-2S+',
    heightU: 1,
    description: '24x RJ45 GE + 2x SFP+ 10G',
    front: {
      rows: [
        { label: 'Gigabit RJ45', ports: range(1, 24).map((i) => rj45(i, 'ether')) },
        { label: 'SFP+', ports: range(1, 2).map((i) => sfpPlus(i, 'sfp-sfpplus')) },
      ],
      accessories: [
        { id: 'CONSOLE', label: 'CON', type: 'CONSOLE' },
      ],
    },
    rear: {
      items: [
        { id: 'PSU1', label: 'DC IN', type: 'POWER' },
      ],
    },
  },

  // -------- MikroTik CCR2216-1G-12XS-2XQ (12x SFP28 + 2x QSFP28 + 1x RJ45) -
  'MIKROTIK:CCR2216': {
    vendor: 'MikroTik',
    model: 'CCR2216-1G-12XS-2XQ',
    heightU: 1,
    description: '12x SFP28 25GE + 2x QSFP28 100GE + 1x RJ45',
    front: {
      rows: [
        { label: 'MGMT', ports: [rj45(1, 'mgmt')] },
        { label: 'SFP28 25GE', ports: range(1, 12).map((i) => ({ id: `sfp28-${i}`, label: String(i), type: 'SFP+', number: i })) },
        { label: 'QSFP28 100GE', ports: range(1, 2).map((i) => qsfp28(i, 'qsfp28-')) },
      ],
      accessories: [
        { id: 'CONSOLE', label: 'CON', type: 'CONSOLE' },
      ],
    },
    rear: {
      items: [
        { id: 'PSU1', label: 'PSU 1', type: 'POWER' },
        { id: 'PSU2', label: 'PSU 2', type: 'POWER' },
      ],
    },
  },

  // -------- Cisco Nexus 9300 (48x SFP+/10G + 6x QSFP 40G) ------------------
  'CISCO:NEXUS9300': {
    vendor: 'Cisco',
    model: 'Nexus 9300-EX',
    heightU: 1,
    description: '48x SFP+ 10GE + 6x QSFP 40/100GE',
    front: {
      rows: [
        { label: 'Ethernet 1/1-48 (10G SFP+)', ports: range(1, 48).map((i) => ({ id: `Eth1/${i}`, label: String(i), type: 'SFP+', number: i })) },
        { label: 'Ethernet 1/49-54 (QSFP)', ports: range(49, 54).map((i) => qsfp(i, 'Eth1/')) },
      ],
      accessories: [
        { id: 'CONSOLE', label: 'CON', type: 'CONSOLE' },
        { id: 'MGMT', label: 'MGMT', type: 'MGMT' },
        { id: 'USB', label: 'USB', type: 'USB' },
      ],
    },
    rear: {
      items: [
        { id: 'PSU1', label: 'PSU 1', type: 'POWER' },
        { id: 'PSU2', label: 'PSU 2', type: 'POWER' },
        { id: 'FAN1', label: 'FAN 1', type: 'ACCESSORY' },
        { id: 'FAN2', label: 'FAN 2', type: 'ACCESSORY' },
        { id: 'FAN3', label: 'FAN 3', type: 'ACCESSORY' },
      ],
    },
  },

  // -------- Generic 24-port RJ45 switch (safe default) ---------------------
  'GENERIC:24RJ45': {
    vendor: 'Generic',
    model: '24-Port Switch',
    heightU: 1,
    description: '24x RJ45 GE (default template)',
    front: {
      rows: [
        { label: 'RJ45 Gigabit', ports: range(1, 24).map((i) => rj45(i)) },
      ],
      accessories: [
        { id: 'CONSOLE', label: 'CON', type: 'CONSOLE' },
      ],
    },
    rear: { items: [{ id: 'PSU1', label: 'PSU', type: 'POWER' }] },
  },

  // -------- Generic patch panel (48x RJ45) ---------------------------------
  'GENERIC:PATCH48': {
    vendor: 'Generic',
    model: 'Patch Panel 48-port',
    heightU: 1,
    description: '48x RJ45 keystone patch panel',
    front: {
      rows: [
        { label: 'Ports 1-48', ports: range(1, 48).map((i) => rj45(i, 'P')) },
      ],
      accessories: [],
    },
    rear: { items: [] },
  },
};

// ---------------------------------------------------------------------------
// Resolver — normalise vendor/model strings and match to a template
// ---------------------------------------------------------------------------
function normalize(s) {
  return String(s || '').toUpperCase().replace(/[\s\-_.]/g, '');
}

/**
 * getDeviceTemplate(device) → template object
 * Never returns null; falls back to a sane generic template so the Explorer
 * always renders a front panel.
 */
export function getDeviceTemplate(device) {
  if (!device) return templates['GENERIC:24RJ45'];
  const vendor = normalize(device.brand);
  const model = normalize(device.model);
  const combined = `${vendor}${model}`;

  // Explicit lookups (order matters — most specific first)
  // -- Huawei
  if (combined.includes('CE6870') && (combined.includes('24S6CQ') || combined.includes('24S'))) return templates['HUAWEI:CE6870-24S6CQ'];
  if (combined.includes('CE6870')) return templates['HUAWEI:CE6870'];
  if (combined.includes('CE6860')) return templates['HUAWEI:CE6860'];
  // -- MikroTik CRS
  if (combined.includes('CRS354')) return templates['MIKROTIK:CRS354'];
  if (combined.includes('CRS328')) return templates['MIKROTIK:CRS328'];
  if (combined.includes('CRS326') && (combined.includes('24S') || combined.includes('2Q'))) return templates['MIKROTIK:CRS326-24SPQ'];
  if (combined.includes('CRS326')) return templates['MIKROTIK:CRS326'];
  // -- MikroTik CCR
  if (combined.includes('CCR2216')) return templates['MIKROTIK:CCR2216'];
  if (combined.includes('CCR2116')) return templates['MIKROTIK:CCR2116'];
  if (combined.includes('CCR2004')) return templates['MIKROTIK:CCR2004'];
  if (combined.includes('CCR1036')) return templates['MIKROTIK:CCR1036'];
  if (combined.includes('CCR1009')) return templates['MIKROTIK:CCR1009'];
  // -- MikroTik RB
  if (combined.includes('RB4011')) return templates['MIKROTIK:RB4011'];
  if (combined.includes('RB3011')) return templates['MIKROTIK:RB3011'];
  if (combined.includes('RB2011')) return templates['MIKROTIK:RB2011'];
  // -- Cisco
  if (combined.includes('NEXUS') || combined.includes('CATALYST9') || combined.includes('N9K'))
    return templates['CISCO:NEXUS9300'];
  if (combined.includes('PATCHPANEL') || combined.includes('ODF'))
    return templates['GENERIC:PATCH48'];

  // Fallback — pick 24-port generic switch
  return templates['GENERIC:24RJ45'];
}

/** All registered templates (used for the model preview dropdown) */
export function listTemplates() {
  return Object.entries(templates).map(([key, t]) => ({ key, ...t }));
}

/** Interface metadata (color, shape hints) used by the SVG renderer */
export const INTERFACE_TYPES = {
  RJ45: { label: 'RJ45', shape: 'square', color: '#94a3b8' },
  SFP: { label: 'SFP', shape: 'slot', color: '#818cf8' },
  'SFP+': { label: 'SFP+', shape: 'slot', color: '#a78bfa' },
  QSFP: { label: 'QSFP', shape: 'slot-wide', color: '#f472b6' },
  QSFP28: { label: 'QSFP28', shape: 'slot-wide', color: '#f472b6' },
  '100GE': { label: '100GE', shape: 'slot-wide', color: '#f472b6' },
  CONSOLE: { label: 'Console', shape: 'circle', color: '#64748b' },
  MGMT: { label: 'MGMT', shape: 'square', color: '#38bdf8' },
  USB: { label: 'USB', shape: 'square', color: '#64748b' },
  POWER: { label: 'Power', shape: 'square', color: '#f97316' },
  ACCESSORY: { label: 'Slot', shape: 'square', color: '#64748b' },
};

/** Port status → color (matches spec) */
export const PORT_STATUS_COLORS = {
  'Link Up': { fill: '#10b981', ring: '#059669', text: '#ffffff', label: 'Link Up' },
  Unused: { fill: '#475569', ring: '#334155', text: '#cbd5e1', label: 'Unused' },
  Reserved: { fill: '#eab308', ring: '#ca8a04', text: '#1f2937', label: 'Reserved' },
  Trunk: { fill: '#3b82f6', ring: '#1d4ed8', text: '#ffffff', label: 'Trunk' },
  Backbone: { fill: '#a855f7', ring: '#7e22ce', text: '#ffffff', label: 'Backbone' },
  Customer: { fill: '#f97316', ring: '#c2410c', text: '#ffffff', label: 'Customer' },
  Error: { fill: '#ef4444', ring: '#b91c1c', text: '#ffffff', label: 'Error' },
  Disabled: { fill: '#1e293b', ring: '#334155', text: '#64748b', label: 'Disabled' },
};

export default templates;
