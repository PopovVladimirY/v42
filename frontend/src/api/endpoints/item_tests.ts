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
  }) =>
    client.post<ApiResponse<TestSpec>>(`/projects/${projectId}/backlog/${itemId}/tests`, data),

  // Delete uses the project-level test endpoint
  delete: (projectId: string, testId: string) =>
    client.delete<ApiResponse<null>>(`/projects/${projectId}/tests/${testId}`),

  move: (projectId: string, itemId: string, testId: string, targetItemId: string) =>
    client.post<ApiResponse<TestSpec>>(
      `/projects/${projectId}/backlog/${itemId}/tests/${testId}/move`,
      { target_item_id: targetItemId },
    ),
};
