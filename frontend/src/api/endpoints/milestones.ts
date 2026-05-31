import client from '../client';
import type { ApiResponse, Milestone, MilestoneStatus, ProjectTimeline } from '@/types';

export const milestonesApi = {
  list: (projectId: string) =>
    client.get<ApiResponse<Milestone[]>>(`/projects/${projectId}/milestones`),

  get: (projectId: string, milestoneId: string) =>
    client.get<ApiResponse<Milestone>>(`/projects/${projectId}/milestones/${milestoneId}`),

  create: (projectId: string, data: { name: string; description?: string; target_date: string; status?: MilestoneStatus }) =>
    client.post<ApiResponse<Milestone>>(`/projects/${projectId}/milestones`, data),

  update: (projectId: string, milestoneId: string, data: { name?: string; description?: string; target_date?: string; status?: MilestoneStatus }) =>
    client.patch<ApiResponse<Milestone>>(`/projects/${projectId}/milestones/${milestoneId}`, data),

  delete: (projectId: string, milestoneId: string) =>
    client.delete<ApiResponse<null>>(`/projects/${projectId}/milestones/${milestoneId}`),

  timeline: (projectId: string, archived = false) =>
    client.get<ApiResponse<ProjectTimeline>>(`/projects/${projectId}/timeline${archived ? '?archived=true' : ''}`),

  // Bind (milestoneId) or unbind (null) a project-tree node to a milestone.
  bindNode: (projectId: string, nodeId: string, milestoneId: string | null) =>
    client.put<ApiResponse<null>>(`/projects/${projectId}/stages/${nodeId}/milestone`, { milestone_id: milestoneId }),
};
