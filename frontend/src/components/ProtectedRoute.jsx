import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { isPathAllowed, defaultLandingPath } from '@/lib/roleAccess';

export default function ProtectedRoute({ children }) {
  const { user, checking } = useAuth();
  const location = useLocation();

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Memuat sesi…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!isPathAllowed(user.role, location.pathname)) {
    return <Navigate to={defaultLandingPath(user.role)} replace />;
  }
  return children;
}
