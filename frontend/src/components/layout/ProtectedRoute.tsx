import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

// Guards all child routes. If no token -- redirect to /login.
// On first render with a persisted token, fetches /auth/me to validate it.
export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const loadMe = useAuthStore((s) => s.loadMe);
  const location = useLocation();

  useEffect(() => {
    // Token present but no user data -- validate token and load profile
    if (accessToken && !user) {
      void loadMe();
    }
  }, [accessToken, user, loadMe]);

  if (!accessToken) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Force password change -- redirect to /change-password unless already there.
  if (user?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}
