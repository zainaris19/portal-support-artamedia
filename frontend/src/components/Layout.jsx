import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar, { MobileSidebar } from './Sidebar';
import Header from './Header';
import GreetingTicker from './GreetingTicker';

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Auto-close mobile drawer on route change
  React.useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <div className="h-screen overflow-hidden flex bg-background text-foreground">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <MobileSidebar open={mobileOpen} onOpenChange={setMobileOpen} />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <GreetingTicker />
        <Header onMobileMenuOpen={() => setMobileOpen(true)} />
        <main className="flex-1 min-h-0 overflow-y-auto p-3 md:p-6" data-testid="app-main-scroll">
          <div className="fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
