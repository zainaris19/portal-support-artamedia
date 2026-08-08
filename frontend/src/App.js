import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { CountsProvider } from '@/context/CountsContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';

// Customer pages (Broadband removed)
import DedicatedInternet from '@/pages/customers/DedicatedInternet';
import CrossConnect from '@/pages/customers/CrossConnect';
import DarkFiber from '@/pages/customers/DarkFiber';
import MetroEthernet from '@/pages/customers/MetroEthernet';

// Partners
import MitraBroadband from '@/pages/partners/MitraBroadband';
import MitraDedicated from '@/pages/partners/MitraDedicated';
import MitraMetro from '@/pages/partners/MitraMetro';
import MitraDarkFiber from '@/pages/partners/MitraDarkFiber';
import MitraCrossConnect from '@/pages/partners/MitraCrossConnect';

// Documents (Customer + Mitra variants; SLA + PO/SO removed from menu, routes redirected)
import BACustomer from '@/pages/documents/BACustomer';
import BAProvider from '@/pages/documents/BAProvider';
import KontrakCustomer from '@/pages/documents/KontrakCustomer';
import KontrakProvider from '@/pages/documents/KontrakProvider';
import Teknis from '@/pages/documents/Teknis';
import DataMappingKMZ from '@/pages/documents/DataMappingKMZ';

// My DataCenter
import RackDevice from '@/pages/RackDevice';
import MyInterconnection from '@/pages/datacenter/MyInterconnection';

// Maps Topology (new — read-only visualization)
import MapsTopology from '@/pages/MapsTopology';

// CRM
import CRMHelpdeskDashboard from '@/pages/crm/CRMHelpdeskDashboard';
import OpenTicket from '@/pages/crm/OpenTicket';
import TicketMasuk from '@/pages/crm/TicketMasuk';
import TicketDiproses from '@/pages/crm/TicketDiproses';
import TicketSelesai from '@/pages/crm/TicketSelesai';
import TicketDetail from '@/pages/crm/TicketDetail';

// Network
import PublicIPv4Management from '@/pages/network/PublicIPv4Management';
import MikroTikSetup from '@/pages/network/MikroTikSetup';
import IPAMAuditLog from '@/pages/network/IPAMAuditLog';
import SNMPDiscovery from '@/pages/network/SNMPDiscovery';
import GenieACS from '@/pages/network/GenieACS';

// Operations
import DataShiftHandover from '@/pages/operations/DataShiftHandover';
import InputShiftHandover from '@/pages/operations/InputShiftHandover';
import ShiftHandoverDetail from '@/pages/operations/ShiftHandoverDetail';
import Incidents from '@/pages/Incidents';
import Maintenance from '@/pages/Maintenance';
import Users from '@/pages/Users';

// Settings (admin)
import DeviceTemplateManager, { DeviceTemplateEditor } from '@/pages/settings/DeviceTemplateManager';
import ZabbixSettings from '@/pages/settings/ZabbixSettings';
import GenieACSSettings from '@/pages/settings/GenieACSSettings';
import NotificationGateway from '@/pages/settings/notifications/NotificationGateway';
import MessageTemplates from '@/pages/settings/notifications/MessageTemplates';
import DeliveryLogs from '@/pages/settings/notifications/DeliveryLogs';
import PublicTracking from '@/pages/PublicTracking';
import { Toaster } from '@/components/ui/sonner';

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <CountsProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/track/:token" element={<PublicTracking />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Dashboard />} />

                {/* Customers group — Broadband REMOVED */}
                <Route path="customers" element={<Navigate to="/customers/dedicated" replace />} />
                <Route path="customers/broadband" element={<Navigate to="/customers/dedicated" replace />} />
                <Route path="customers/dedicated" element={<DedicatedInternet />} />
                <Route path="customers/cross-connect" element={<CrossConnect />} />
                <Route path="customers/dark-fiber" element={<DarkFiber />} />
                <Route path="customers/metro-ethernet" element={<MetroEthernet />} />

                {/* Partners */}
                <Route path="partners" element={<Navigate to="/partners/broadband" replace />} />
                <Route path="partners/broadband" element={<MitraBroadband />} />
                <Route path="partners/dedicated" element={<MitraDedicated />} />
                <Route path="partners/metro-ethernet" element={<MitraMetro />} />
                <Route path="partners/dark-fiber" element={<MitraDarkFiber />} />
                <Route path="partners/cross-connect" element={<MitraCrossConnect />} />

                {/* Documents — restructured: BA/Kontrak → Customer + Mitra, Data Mapping (KMZ), SLA removed */}
                <Route path="documents" element={<Navigate to="/documents/ba/customer" replace />} />
                <Route path="documents/ba" element={<Navigate to="/documents/ba/customer" replace />} />
                <Route path="documents/ba/customer" element={<BACustomer />} />
                <Route path="documents/ba/provider" element={<BAProvider />} />
                {/* Legacy SLA redirects to Contract Customer */}
                <Route path="documents/sla" element={<Navigate to="/documents/kontrak/customer" replace />} />
                <Route path="documents/sla/customer" element={<Navigate to="/documents/kontrak/customer" replace />} />
                <Route path="documents/sla/provider" element={<Navigate to="/documents/kontrak/provider" replace />} />
                <Route path="documents/kontrak" element={<Navigate to="/documents/kontrak/customer" replace />} />
                <Route path="documents/kontrak/customer" element={<KontrakCustomer />} />
                <Route path="documents/kontrak/provider" element={<KontrakProvider />} />
                <Route path="documents/teknis" element={<Teknis />} />
                <Route path="documents/kmz-mapping" element={<DataMappingKMZ />} />
                {/* Legacy PO/SO redirects to Contract */}
                <Route path="documents/po" element={<Navigate to="/documents/kontrak/customer" replace />} />
                <Route path="documents/so" element={<Navigate to="/documents/kontrak/customer" replace />} />
                {/* Legacy rack-device path — moved to My DataCenter */}
                <Route path="documents/rack-device" element={<Navigate to="/datacenter/rack-device" replace />} />

                {/* My DataCenter */}
                <Route path="datacenter" element={<Navigate to="/datacenter/rack-device" replace />} />
                <Route path="datacenter/rack-device" element={<RackDevice />} />
                <Route path="datacenter/interconnection" element={<MyInterconnection />} />

                {/* Maps Topology — new read-only visualization */}
                <Route path="topology" element={<MapsTopology />} />

                {/* CRM Ticket Helpdesk (redesigned — replaces old broadband/dedicated CRM) */}
                <Route path="crm" element={<Navigate to="/crm/dashboard" replace />} />
                <Route path="crm/dashboard" element={<CRMHelpdeskDashboard />} />
                <Route path="crm/open" element={<OpenTicket />} />
                <Route path="crm/masuk" element={<TicketMasuk />} />
                <Route path="crm/diproses" element={<TicketDiproses />} />
                <Route path="crm/selesai" element={<TicketSelesai />} />
                <Route path="crm/tickets/:id" element={<TicketDetail />} />
                {/* Legacy CRM route redirects */}
                <Route path="crm/broadband" element={<Navigate to="/crm/masuk" replace />} />
                <Route path="crm/dedicated" element={<Navigate to="/crm/masuk" replace />} />

                {/* Network */}
                <Route path="network" element={<Navigate to="/network/ipv4" replace />} />
                <Route path="network/ipv4" element={<PublicIPv4Management />} />
                <Route path="network/genieacs" element={<GenieACS />} />
                <Route path="network/mikrotik" element={<MikroTikSetup />} />
                <Route path="network/snmp" element={<SNMPDiscovery />} />
                <Route path="network/audit" element={<IPAMAuditLog />} />

                {/* Operations */}
                <Route path="operations/shift-handover" element={<DataShiftHandover />} />
                <Route path="operations/shift-handover/new" element={<InputShiftHandover />} />
                <Route path="operations/shift-handover/edit/:id" element={<InputShiftHandover />} />
                <Route path="operations/shift-handover/:id" element={<ShiftHandoverDetail />} />
                <Route path="operations/incidents" element={<Incidents />} />
                <Route path="operations/maintenances" element={<Maintenance />} />

                {/* Admin */}
                <Route path="users" element={<Users />} />

                {/* Settings (admin) */}
                <Route path="settings" element={<Navigate to="/settings/device-templates" replace />} />
                <Route path="settings/device-templates" element={<DeviceTemplateManager />} />
                <Route path="settings/device-templates/:id" element={<DeviceTemplateEditor />} />
                <Route path="settings/monitoring" element={<Navigate to="/settings/monitoring/zabbix" replace />} />
                <Route path="settings/monitoring/zabbix" element={<ZabbixSettings />} />
                <Route path="settings/integrations" element={<Navigate to="/settings/integrations/genieacs" replace />} />
                <Route path="settings/integrations/genieacs" element={<GenieACSSettings />} />
                <Route path="settings/notifications" element={<Navigate to="/settings/notifications/gateway" replace />} />
                <Route path="settings/notifications/gateway" element={<NotificationGateway />} />
                <Route path="settings/notifications/whatsapp" element={<Navigate to="/settings/notifications/gateway" replace />} />
                <Route path="settings/notifications/templates" element={<MessageTemplates />} />
                <Route path="settings/notifications/logs" element={<DeliveryLogs />} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
            <Toaster richColors position="bottom-right" closeButton />
          </CountsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
