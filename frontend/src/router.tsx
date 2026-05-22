import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { TeamsPage } from '@/pages/TeamsPage';
import { TeamDetailPage } from '@/pages/TeamDetailPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    // Auth guard wraps everything; AppShell provides the sidebar layout.
    element: <ProtectedRoute />,
    children: [
      {
        // Change-password is outside AppShell -- full-screen form, no nav clutter.
        path: '/change-password',
        element: <ChangePasswordPage />,
      },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/teams" replace /> },
          { path: '/teams', element: <TeamsPage /> },
          { path: '/teams/:id', element: <TeamDetailPage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/admin/users', element: <AdminUsersPage /> },
        ],
      },
    ],
  },
]);

