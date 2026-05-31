import client from '../client';
import type { ApiResponse, TestSpec, TestType } from '@/types';

export const itemTestsApi = {
  list: (projectId: string, itemId: string) =>
    client.get<ApiResponse<TestSpec[]>>(`/projects/${projectId}/backlog/${itemId}/tests`),

  create: (projectId: string, itemId: string, data: {
    title: string;
    type?: TestType;
    description?: string;
    steps?: string;
    expected_results?: string;
    skill_required?: string | null;
  }) =>
    client.post<ApiResponse<TestSpec>>(`/projects/${projectId}/backlog/${itemId}/tests`, data),

  // Get a single test by project-level ID
  get: (projectId: string, testId: string) =>
    client.get<ApiResponse<TestSpec>>(`/projects/${projectId}/tests/${testId}`),

  // Delete uses the project-level test endpoint
  delete: (projectId: string, testId: string) =>
    client.delete<ApiResponse<null>>(`/projects/${projectId}/tests/${testId}`),

  // Update uses the project-level test endpoint
  update: (projectId: string, testId: string, data: {
    title?: string;
    type?: TestType;
    description?: string;
    setup?: string;
    config?: string;
    steps?: string;
    expected_results?: string;
    skill_required?: string | null;
  }) =>
    client.patch<ApiResponse<TestSpec>>(`/projects/${projectId}/tests/${testId}`, data),

  move: (projectId: string, itemId: string, testId: string, targetItemId: string) =>
    client.post<ApiResponse<TestSpec>>(
      `/projects/${projectId}/backlog/${itemId}/tests/${testId}/move`,
      { target_item_id: targetItemId },
    ),
};
