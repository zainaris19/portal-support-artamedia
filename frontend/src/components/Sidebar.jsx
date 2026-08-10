import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, ClipboardList, AlertOctagon, Wrench, ShieldCheck,
  ChevronsLeft, ChevronsRight, ChevronDown, ChevronRight,
  Wifi, Server, Cable, Zap, Network, Handshake, FileSignature, FileCheck2, ScrollText,
  PackageOpen, Boxes, Building2, Waypoints, Headphones, Globe, Router as RouterIcon,
  Folder, FolderOpen, Map as MapIcon, Settings, Activity,
  TicketPlus, Inbox, CheckCircle2, BellRing, FileText as FileTextIcon, Radio,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useCounts } from '@/context/CountsContext';
import { APP } from '@/constants/testIds';
import { canAccessSection, ROLE_HAS_DASHBOARD } from '@/lib/roleAccess';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

// Customer Broadband removed per requirement — Broadband remains on Provider side only
const CUSTOMER_CATEGORIES = [
  { key: 'dedicated', label: 'Dedicated Internet', to: '/customers/dedicated', icon: Server, countKey: ['customers', 'Dedicated Internet'] },
  { key: 'crossconnect', label: 'Cross Connect', to: '/customers/cross-connect', icon: Cable, countKey: ['customers', 'Cross Connect'] },
  { key: 'darkfiber', label: 'Dark Fiber', to: '/customers/dark-fiber', icon: Zap, countKey: ['customers', 'Dark Fiber'] },
  { key: 'metroethernet', label: 'Metro Ethernet', to: '/customers/metro-ethernet', icon: Network, countKey: ['customers', 'Metro Ethernet'] },
];

const PARTNER_CATEGORIES = [
  { key: 'mitra-broadband', label: 'Broadband', to: '/partners/broadband', icon: Wifi, countKey: ['partners', 'Broadband'] },
  { key: 'mitra-dedicated', label: 'Dedicated Internet', to: '/partners/dedicated', icon: Server, countKey: ['partners', 'Dedicated Internet'] },
  { key: 'mitra-metro', label: 'Metro Ethernet', to: '/partners/metro-ethernet', icon: Network, countKey: ['partners', 'Metro Ethernet'] },
  { key: 'mitra-dark-fiber', label: 'Dark Fiber', to: '/partners/dark-fiber', icon: Zap, countKey: ['partners', 'Dark Fiber'] },
  { key: 'mitra-cross-connect', label: 'Cross Connect', to: '/partners/cross-connect', icon: Cable, countKey: ['partners', 'Cross Connect'] },
];

const DOCUMENT_TREE = [
  {
    key: 'doc-ba', label: 'Berita Acara', icon: Folder, openIcon: FolderOpen, countKey: ['documents', 'BA'],
    children: [
      { key: 'doc-ba-customer', label: 'BA Customer', to: '/documents/ba/customer', icon: FileCheck2, countKey: ['documents', 'BA_customer'] },
      { key: 'doc-ba-provider', label: 'BA Mitra', to: '/documents/ba/provider', icon: FileCheck2, countKey: ['documents', 'BA_provider'] },
    ],
  },
  {
    key: 'doc-kontrak', label: 'Kontrak', icon: Folder, openIcon: FolderOpen, countKey: ['documents', 'Kontrak'],
    children: [
      { key: 'doc-kontrak-customer', label: 'Kontrak Customer', to: '/documents/kontrak/customer', icon: ScrollText, countKey: ['documents', 'Kontrak_customer'] },
      { key: 'doc-kontrak-provider', label: 'Kontrak Mitra', to: '/documents/kontrak/provider', icon: ScrollText, countKey: ['documents', 'Kontrak_provider'] },
    ],
  },
  { key: 'doc-teknis', label: 'Dokumen Teknis', to: '/documents/teknis', icon: FileText, countKey: ['documents', 'Teknis'] },
  { key: 'doc-kmz', label: 'Data Mapping (KMZ)', to: '/documents/kmz-mapping', icon: MapIcon, countKey: ['documents', 'KMZ'] },
];

const DATACENTER = [
  { key: 'dc-rack', label: 'My Rack & Device', to: '/datacenter/rack-device', icon: Boxes, countKey: ['racks'] },
  { key: 'dc-interconnection', label: 'Cable Connections', to: '/datacenter/interconnection', icon: Waypoints, countKey: ['interconnections'] },
];

const CRM = [
  { key: 'crm-dashboard', label: 'Dashboard CRM', to: '/crm/dashboard', icon: LayoutDashboard, countKey: null },
  { key: 'crm-open', label: 'Open Ticket', to: '/crm/open', icon: TicketPlus, countKey: null },
  { key: 'crm-masuk', label: 'Ticket Masuk', to: '/crm/masuk', icon: Inbox, countKey: ['crm', 'masuk'] },
  { key: 'crm-diproses', label: 'Ticket Diproses', to: '/crm/diproses', icon: Wrench, countKey: ['crm', 'diproses'] },
  { key: 'crm-selesai', label: 'Ticket Selesai', to: '/crm/selesai', icon: CheckCircle2, countKey: ['crm', 'selesai'] },
];

const NETWORK = [
  { key: 'net-topology', label: 'Maps Topology', to: '/topology', icon: MapIcon, countKey: null },
  { key: 'net-genieacs', label: 'GenieACS', to: '/network/genieacs', icon: RouterIcon, countKey: null },
  { key: 'net-olt', label: 'OLT Management', to: '/network/olt', icon: Server, countKey: null },
  { key: 'net-ipv4', label: 'Public IPv4 Management', to: '/network/ipv4', icon: Globe, countKey: null },
  { key: 'net-audit', label: 'IPAM Audit Log', to: '/network/audit', icon: ClipboardList, countKey: null },
];

const OPERATIONS = [
  { key: 'shift-input', label: 'Input Shift Handover', to: '/operations/shift-handover/new', icon: ClipboardList, countKey: null },
  { key: 'shift-data', label: 'Data Shift Handover', to: '/operations/shift-handover', icon: ClipboardList, countKey: ['handovers', 'pending_accept'] },
  { key: 'incidents', label: 'Incident Log', to: '/operations/incidents', icon: AlertOctagon, countKey: ['incidents'] },
  { key: 'maintenances', label: 'Maintenance Log', to: '/operations/maintenances', icon: Wrench, countKey: ['maintenances'] },
];

const SETTINGS = [
  { key: 'set-mikrotik', label: 'MikroTik Setup', to: '/network/mikrotik', icon: RouterIcon, countKey: null },
  { key: 'set-snmp', label: 'SNMP Discovery', to: '/network/snmp', icon: Wifi, countKey: null },
  { key: 'set-templates', label: 'Device Templates', to: '/settings/device-templates', icon: Boxes, countKey: null },
  { key: 'set-zabbix', label: 'Monitoring · Zabbix', to: '/settings/monitoring/zabbix', icon: Activity, countKey: null },
  { key: 'set-genieacs', label: 'Integrations · GenieACS', to: '/settings/integrations/genieacs', icon: RouterIcon, countKey: null },
  { key: 'set-olt', label: 'Integrations · OLT', to: '/settings/integrations/olt', icon: Server, countKey: null },
  { key: 'set-wa-gateway', label: 'Notification Gateway', to: '/settings/notifications/gateway', icon: BellRing, countKey: null },
  { key: 'set-notif-templates', label: 'Message Templates', to: '/settings/notifications/templates', icon: FileTextIcon, countKey: null },
  { key: 'set-notif-logs', label: 'Delivery Logs', to: '/settings/notifications/logs', icon: Radio, countKey: null },
];

// ============================================================================
// Shared nav content — used by both desktop <Sidebar> and <MobileSidebar>
// ============================================================================
function SidebarNav({ collapsed, onNavigate }) {
  const { isAdmin, user } = useAuth();
  const { counts } = useCounts();
  const location = useLocation();
  const role = user?.role;
  const showDashboard = ROLE_HAS_DASHBOARD[role] ?? true;
  const showSection = (key) => canAccessSection(role, key);

  const inGroup = (prefix) => location.pathname.startsWith(prefix);
  const [openCustomers, setOpenCustomers] = useState(() => inGroup('/customers'));
  const [openPartners, setOpenPartners] = useState(() => inGroup('/partners'));
  const [openDocuments, setOpenDocuments] = useState(() => inGroup('/documents'));
  const [openDC, setOpenDC] = useState(() => inGroup('/datacenter'));
  const [openCRM, setOpenCRM] = useState(() => inGroup('/crm') || !showDashboard);
  const [openNetwork, setOpenNetwork] = useState(() => inGroup('/network'));
  const [openOps, setOpenOps] = useState(() => inGroup('/operations'));
  const [openSettings, setOpenSettings] = useState(() => inGroup('/settings'));

  useEffect(() => { if (inGroup('/customers')) setOpenCustomers(true); }, [location.pathname]);  // eslint-disable-line
  useEffect(() => { if (inGroup('/partners')) setOpenPartners(true); }, [location.pathname]);  // eslint-disable-line
  useEffect(() => { if (inGroup('/documents')) setOpenDocuments(true); }, [location.pathname]);  // eslint-disable-line
  useEffect(() => { if (inGroup('/datacenter')) setOpenDC(true); }, [location.pathname]);  // eslint-disable-line
  useEffect(() => { if (inGroup('/crm')) setOpenCRM(true); }, [location.pathname]);  // eslint-disable-line
  useEffect(() => { if (inGroup('/network')) setOpenNetwork(true); }, [location.pathname]);  // eslint-disable-line
  useEffect(() => { if (inGroup('/operations')) setOpenOps(true); }, [location.pathname]);  // eslint-disable-line
  useEffect(() => { if (inGroup('/settings')) setOpenSettings(true); }, [location.pathname]);  // eslint-disable-line

  const getCount = (path) => {
    if (!counts || !path) return null;
    return path.reduce((acc, k) => (acc && k in acc ? acc[k] : null), counts);
  };

  return (
    <ul className="space-y-1">
      {showDashboard && (
        <NavItem to="/" end icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} testKey="dashboard" onNavigate={onNavigate} />
      )}

      {showSection('customers') && (<>
        <GroupItem open={openCustomers} onToggle={() => setOpenCustomers((o) => !o)} icon={Users} label="Data Pelanggan" collapsed={collapsed} badge={getCount(['customers', '_total'])} active={inGroup('/customers')} testKey="customers" />
        {!collapsed && openCustomers && CUSTOMER_CATEGORIES.map((c) => (
          <SubItem key={c.key} to={c.to} icon={c.icon} label={c.label} badge={getCount(c.countKey)} testKey={c.key} onNavigate={onNavigate} />
        ))}
      </>)}

      {showSection('partners') && (<>
        <GroupItem open={openPartners} onToggle={() => setOpenPartners((o) => !o)} icon={Handshake} label="Mitra / Provider" collapsed={collapsed} badge={getCount(['partners', '_total'])} active={inGroup('/partners')} testKey="partners" />
        {!collapsed && openPartners && PARTNER_CATEGORIES.map((c) => (
          <SubItem key={c.key} to={c.to} icon={c.icon} label={c.label} badge={getCount(c.countKey)} testKey={c.key} onNavigate={onNavigate} />
        ))}
      </>)}

      {showSection('documents') && (<>
        <GroupItem open={openDocuments} onToggle={() => setOpenDocuments((o) => !o)} icon={FileText} label="Dokumen & Arsip" collapsed={collapsed} badge={getCount(['documents', '_total'])} active={inGroup('/documents')} testKey="documents" />
        {!collapsed && openDocuments && DOCUMENT_TREE.map((node) =>
          node.children ? (
            <NestedFolder key={node.key} node={node} getCount={getCount} pathname={location.pathname} onNavigate={onNavigate} />
          ) : (
            <SubItem key={node.key} to={node.to} icon={node.icon} label={node.label} badge={getCount(node.countKey)} testKey={node.key} onNavigate={onNavigate} />
          )
        )}
      </>)}

      {showSection('datacenter') && (<>
        <GroupItem open={openDC} onToggle={() => setOpenDC((o) => !o)} icon={Building2} label="My DataCenter" collapsed={collapsed} badge={(getCount(['racks']) || 0) + (getCount(['interconnections']) || 0)} active={inGroup('/datacenter')} testKey="datacenter" />
        {!collapsed && openDC && DATACENTER.map((c) => (
          <SubItem key={c.key} to={c.to} icon={c.icon} label={c.label} badge={getCount(c.countKey)} testKey={c.key} onNavigate={onNavigate} />
        ))}
      </>)}

      {showSection('network') && (<>
        <GroupItem open={openNetwork} onToggle={() => setOpenNetwork((o) => !o)} icon={Globe} label="Network" collapsed={collapsed} active={inGroup('/network') || location.pathname.startsWith('/topology')} testKey="network" />
        {!collapsed && openNetwork && NETWORK.map((c) => (
          <SubItem key={c.key} to={c.to} icon={c.icon} label={c.label} badge={getCount(c.countKey)} testKey={c.key} onNavigate={onNavigate} />
        ))}
      </>)}

        {showSection('crm') && (<>
        <GroupItem open={openCRM} onToggle={() => setOpenCRM((o) => !o)} icon={Headphones} label="CRM Ticket Helpdesk" collapsed={collapsed} badge={(getCount(['crm', 'masuk']) || 0) + (getCount(['crm', 'diproses']) || 0)} active={inGroup('/crm')} testKey="crm" />
        {!collapsed && openCRM && CRM.filter((c) => !(role === 'teknisi' && c.key === 'crm-open')).map((c) => (
          <SubItem key={c.key} to={c.to} icon={c.icon} label={c.label} badge={getCount(c.countKey)} testKey={c.key} onNavigate={onNavigate} />
        ))}
        </>)}

      {showSection('operations') && (<>
        <GroupItem open={openOps} onToggle={() => setOpenOps((o) => !o)} icon={PackageOpen} label="Operasional NOC" collapsed={collapsed} badge={(getCount(['incidents_active']) || 0) + (getCount(['maintenances_active']) || 0)} active={inGroup('/operations')} testKey="operations" />
        {!collapsed && openOps && OPERATIONS.map((c) => (
          <SubItem key={c.key} to={c.to} icon={c.icon} label={c.label} badge={getCount(c.countKey)} testKey={c.key} onNavigate={onNavigate} />
        ))}
      </>)}

      {isAdmin && (
        <NavItem to="/users" icon={ShieldCheck} label="User & Hak Akses" collapsed={collapsed} testKey="users" onNavigate={onNavigate} />
      )}

      {isAdmin && (<>
        <GroupItem open={openSettings} onToggle={() => setOpenSettings((o) => !o)} icon={Settings} label="Settings" collapsed={collapsed} active={inGroup('/settings')} testKey="settings" />
        {!collapsed && openSettings && SETTINGS.map((c) => (
          <SubItem key={c.key} to={c.to} icon={c.icon} label={c.label} testKey={c.key} onNavigate={onNavigate} />
        ))}
      </>)}
    </ul>
  );
}

// ============================================================================
// Desktop Sidebar (hidden on mobile)
// ============================================================================
export default function Sidebar({ collapsed, onToggle }) {
  return (
    <aside
      className={cn(
        'hidden md:flex flex-col shrink-0 border-r border-border bg-card transition-[width] duration-200 h-full min-h-0',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className={cn('h-16 flex items-center border-b border-border px-3', collapsed ? 'justify-center' : 'px-4')}>
        {collapsed ? (
          <div data-testid="sidebar-brand-collapsed" className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border border-primary/30 flex items-center justify-center font-display font-extrabold text-primary text-lg leading-none" title="Portal Support · Artamedia">
            PS
          </div>
        ) : (
          <div data-testid="sidebar-brand" className="flex flex-col leading-[1.05] select-none">
            <span className="font-display font-semibold text-[15px] text-foreground/85 tracking-tight">Portal Support</span>
            <span className="font-display font-extrabold text-[26px] brand-gradient tracking-tighter">Artamedia</span>
          </div>
        )}
      </div>

      <nav className="flex-1 p-2 overflow-y-auto">
        <SidebarNav collapsed={collapsed} />
      </nav>

      <button
        onClick={onToggle}
        data-testid={APP.sidebarToggle}
        className={cn(
          'h-11 border-t border-border flex items-center gap-2 px-3 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
          collapsed && 'justify-center px-0'
        )}
      >
        {collapsed ? <ChevronsRight className="w-4 h-4" /> : <><ChevronsLeft className="w-4 h-4" /><span>Collapse</span></>}
      </button>
    </aside>
  );
}

// ============================================================================
// Mobile Sidebar — Sheet drawer opened from Header hamburger
// ============================================================================
export function MobileSidebar({ open, onOpenChange }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="p-0 w-[280px] flex flex-col gap-0" data-testid="mobile-sidebar">
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
          <SheetTitle asChild>
            <div className="flex flex-col leading-[1.05] select-none text-left">
              <span className="font-display font-semibold text-[13px] text-foreground/85 tracking-tight">Portal Support</span>
              <span className="font-display font-extrabold text-[22px] brand-gradient tracking-tighter">Artamedia</span>
            </div>
          </SheetTitle>
        </SheetHeader>
        <nav className="flex-1 p-2 overflow-y-auto">
          <SidebarNav collapsed={false} onNavigate={() => onOpenChange(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// Nav item helpers
// ============================================================================
function NavItem({ to, end, icon: Icon, label, collapsed, badge, testKey, onNavigate }) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        onClick={onNavigate}
        data-testid={APP.sidebarLink(testKey)}
        className={({ isActive }) => cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-accent',
          isActive && 'bg-primary/10 text-primary font-medium hover:bg-primary/10',
          collapsed && 'justify-center px-0'
        )}
      >
        <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
        {!collapsed && <span className="truncate flex-1">{label}</span>}
        {!collapsed && badge != null && badge > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground tabular-nums">{badge}</span>
        )}
      </NavLink>
    </li>
  );
}

function GroupItem({ open, onToggle, icon: Icon, label, collapsed, badge, active, testKey }) {
  return (
    <li>
      <button
        onClick={onToggle}
        data-testid={APP.sidebarLink(`group-${testKey}`)}
        className={cn(
          'w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-accent',
          active && 'text-foreground',
          collapsed && 'justify-center px-0'
        )}
      >
        <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left">{label}</span>
            {badge != null && badge > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground tabular-nums">{badge}</span>
            )}
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </>
        )}
      </button>
    </li>
  );
}

function SubItem({ to, icon: Icon, label, badge, testKey, onNavigate }) {
  return (
    <li className="ml-3 pl-3 border-l border-border">
      <NavLink
        to={to}
        onClick={onNavigate}
        data-testid={APP.sidebarLink(testKey)}
        className={({ isActive }) => cn(
          'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-accent',
          isActive && 'bg-primary/10 text-primary font-medium hover:bg-primary/10'
        )}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
        <span className="truncate flex-1">{label}</span>
        {badge != null && badge > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground tabular-nums">{badge}</span>
        )}
      </NavLink>
    </li>
  );
}

function NestedFolder({ node, getCount, pathname, onNavigate }) {
  const childActive = (node.children || []).some((c) => pathname.startsWith(c.to));
  const [open, setOpen] = useState(() => childActive);
  useEffect(() => { if (childActive) setOpen(true); }, [childActive]);
  const total = (node.children || []).reduce((acc, c) => acc + (getCount(c.countKey) || 0), 0);
  const Icon = open ? (node.openIcon || node.icon) : node.icon;
  return (
    <>
      <li className="ml-3 pl-3 border-l border-border">
        <button
          onClick={() => setOpen((o) => !o)}
          data-testid={APP.sidebarLink(`folder-${node.key}`)}
          className={cn(
            'w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors',
            'text-muted-foreground hover:text-foreground hover:bg-accent',
            childActive && 'text-foreground'
          )}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate flex-1 text-left">{node.label}</span>
          {total > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground tabular-nums">{total}</span>
          )}
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      </li>
      {open && node.children.map((c) => (
        <li key={c.key} className="ml-6 pl-3 border-l border-border">
          <NavLink
            to={c.to}
            onClick={onNavigate}
            data-testid={APP.sidebarLink(c.key)}
            className={({ isActive }) => cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors',
              'text-muted-foreground hover:text-foreground hover:bg-accent',
              isActive && 'bg-primary/10 text-primary font-medium hover:bg-primary/10'
            )}
          >
            <c.icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            <span className="truncate flex-1">{c.label}</span>
            {getCount(c.countKey) != null && getCount(c.countKey) > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground tabular-nums">{getCount(c.countKey)}</span>
            )}
          </NavLink>
        </li>
      ))}
    </>
  );
}
