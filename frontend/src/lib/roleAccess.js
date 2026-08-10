// Central role → allowed menu-section mapping.
// `null` = unrestricted (full access). Array = list of top-level path prefixes
// (without leading slash) that the role can view/access.
// Dashboard ("/") is treated separately below.
export const ROLE_SECTIONS = {
  admin: null,
  supervisor: null,
  engineer: null,
  viewer: null,
  admin_router: ['customers', 'partners', 'documents'],
  operational: ['customers', 'partners', 'documents', 'datacenter'],
  // Teknisi lapangan — hanya CRM Ticket Helpdesk. Landing = /crm/dashboard.
  teknisi: ['crm'],
};

// Whether the role is allowed to see the Dashboard landing.
// Restricted roles skip dashboard entirely and land on their first section.
export const ROLE_HAS_DASHBOARD = {
  admin: true,
  supervisor: true,
  engineer: true,
  viewer: true,
  admin_router: false,
  operational: false,
  teknisi: false,
};

// Custom landing per role (overrides `/${firstSection}` default).
const ROLE_LANDING = {
  teknisi: '/crm/dashboard',
};

// Paths that a role is explicitly blocked from, even if inside an allowed section.
const ROLE_BLOCKED_PATHS = {
  teknisi: ['/crm/open'],  // teknisi tidak boleh membuka ticket baru
};

export function allowedSections(role) {
  return ROLE_SECTIONS[role] ?? null;
}

export function canAccessSection(role, sectionKey) {
  const list = ROLE_SECTIONS[role];
  if (list == null) return true; // unrestricted
  return list.includes(sectionKey);
}

export function isPathAllowed(role, pathname) {
  // Explicit per-role block list (takes precedence)
  const blocked = ROLE_BLOCKED_PATHS[role] || [];
  if (blocked.some((p) => pathname === p || pathname.startsWith(p + '/'))) return false;
  const list = ROLE_SECTIONS[role];
  if (list == null) return true;
  const hasDash = ROLE_HAS_DASHBOARD[role] ?? true;
  if (pathname === '/' || pathname === '') return hasDash;
  return list.some((p) => pathname === `/${p}` || pathname.startsWith(`/${p}/`));
}

export function defaultLandingPath(role) {
  if (ROLE_LANDING[role]) return ROLE_LANDING[role];
  const list = ROLE_SECTIONS[role];
  if (list == null) return '/';
  if ((ROLE_HAS_DASHBOARD[role] ?? true)) return '/';
  return `/${list[0]}`;
}
