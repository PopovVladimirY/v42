import { createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    // All authenticated routes under one guard
    element: <ProtectedRoute />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: '/teams', element: <DashboardPage /> }, // Phase 8.3 placeholder
    ],
  },
]);
