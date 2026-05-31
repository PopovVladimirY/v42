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
import { AdminProjectsPage } from '@/pages/AdminProjectsPage';
import { AdminAgentTokensPage } from '@/pages/AdminAgentTokensPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ProjectShell, ProjectOverviewPage } from '@/pages/ProjectShell';
import { ProjectSubProjectsPage } from '@/pages/ProjectSubProjectsPage';
import { BacklogPage } from '@/pages/BacklogPage';
import { EpicsPage } from '@/pages/EpicsPage';
import { EpicDetailPage } from '@/pages/EpicDetailPage';
import { MilestonesPage } from '@/pages/MilestonesPage';
import { SprintsPage } from '@/pages/SprintsPage';
import { SprintShell, SprintRedirect } from '@/pages/SprintShell';
import { SprintBoardTab } from '@/pages/SprintBoardTab';
import { SprintBacklogTab } from '@/pages/SprintBacklogTab';
import { SprintCapacityTab } from '@/pages/SprintCapacityTab';
import { SprintRetroTab } from '@/pages/SprintRetroTab';
import { SprintTestsTab } from '@/pages/SprintTestsTab';
import { MySprintsPage } from '@/pages/MySprintsPage';

import { BacklogItemDetailPage } from '@/pages/BacklogItemDetailPage';
import { TaskDetailPage } from '@/pages/TaskDetailPage';
import { TestDetailPage } from '@/pages/TestDetailPage';
import { AllProjectsPage } from '@/pages/AllProjectsPage';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

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
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, element: <Navigate to="/sprints" replace /> },
          { path: '/sprints', element: <MySprintsPage /> },
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
          { path: '/admin/projects', element: <AdminProjectsPage /> },
          { path: '/admin/agent-tokens', element: <AdminAgentTokensPage /> },
          // Project routes -- nested under ProjectShell (header + tab nav)
          {
            path: '/projects/:projectId',
            element: <ProjectShell />,
            errorElement: <RouteErrorBoundary />,
            children: [
              { index: true, element: <Navigate to="backlog" replace /> },
              {
                path: 'backlog',
                element: <BacklogPage />,
                children: [
                  {
                    path: ':itemId',
                    element: <BacklogItemDetailPage />,
                    children: [
                      { path: 'tasks/:taskId', element: <TaskDetailPage /> },
                      { path: 'tests/:testId', element: <TestDetailPage /> },
                    ],
                  },
                ],
              },
              { path: 'tests/:testId', element: <TestDetailPage /> },
              { path: 'epics', element: <EpicsPage /> },
              { path: 'epics/:epicId', element: <EpicDetailPage /> },
              { path: 'milestones', element: <MilestonesPage /> },
              { path: 'sprints', element: <SprintsPage /> },
              {
                path: 'sprints/:sprintId',
                element: <SprintShell />,
                children: [
                  { index: true, element: <SprintRedirect /> },
                  { path: 'board',     element: <SprintBoardTab /> },
                  {
                    path: 'backlog',
                    element: <SprintBacklogTab />,
                    children: [
                      { path: 'items/:itemId/tasks/:taskId', element: <TaskDetailPage /> },
                      { path: 'tests/:testId', element: <TestDetailPage /> },
                    ],
                  },
                  { path: 'tests',     element: <SprintTestsTab /> },
                  { path: 'capacity',  element: <SprintCapacityTab /> },
                  { path: 'retro',     element: <SprintRetroTab /> },
                ],
              },
              { path: 'tree', element: <ProjectSubProjectsPage /> },
              { path: 'overview', element: <ProjectOverviewPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

