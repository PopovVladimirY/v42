import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { TeamsPage } from '@/pages/TeamsPage';
import { TeamDetailPage } from '@/pages/TeamDetailPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import { AdminSkillsPage } from '@/pages/AdminSkillsPage';
import { AdminSettingsPage } from '@/pages/AdminSettingsPage';
import { AdminArchivePage } from '@/pages/AdminArchivePage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ProjectShell, ProjectOverviewPage } from '@/pages/ProjectShell';
import { ProjectSubProjectsPage } from '@/pages/ProjectSubProjectsPage';
import { BacklogPage } from '@/pages/BacklogPage';
import { EpicsPage } from '@/pages/EpicsPage';
import { SprintsPage } from '@/pages/SprintsPage';
import { SprintDetailPage } from '@/pages/SprintDetailPage';

import { BacklogItemDetailPage } from '@/pages/BacklogItemDetailPage';
import { AllProjectsPage } from '@/pages/AllProjectsPage';

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
          { path: '/teams/:id/projects', element: <ProjectsPage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/projects', element: <AllProjectsPage /> },
          { path: '/admin', element: <Navigate to="/admin/settings" replace /> },
          { path: '/admin/settings', element: <AdminSettingsPage /> },
          { path: '/admin/users', element: <AdminUsersPage /> },
          { path: '/admin/users/:userId', element: <ProfilePage /> },
          { path: '/admin/skills', element: <AdminSkillsPage /> },
          { path: '/admin/archive', element: <AdminArchivePage /> },
          // Project routes -- nested under ProjectShell (header + tab nav)
          {
            path: '/projects/:projectId',
            element: <ProjectShell />,
            children: [
              { index: true, element: <Navigate to="backlog" replace /> },
              { path: 'backlog', element: <BacklogPage /> },
              { path: 'backlog/:itemId', element: <BacklogItemDetailPage /> },
              { path: 'epics', element: <EpicsPage /> },
              { path: 'sprints', element: <SprintsPage /> },
              { path: 'sprints/:sprintId', element: <SprintDetailPage /> },
              { path: 'tree', element: <ProjectSubProjectsPage /> },
              { path: 'overview', element: <ProjectOverviewPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

