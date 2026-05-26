import client from '../client';
import type { ApiResponse, BacklogItem, BacklogItemStatus, BacklogItemType, ClarityQuadrant, ReadinessResult } from '@/types';

export type BacklogFilters = {
  status?: BacklogItemStatus;
  type?: BacklogItemType;
  clarity?: ClarityQuadrant;
  epic_id?: string;
  assignee_id?: string;
};

export const backlogApi = {
  list: (projectId: string, filters?: BacklogFilters) =>
    client.get<ApiResponse<BacklogItem[]>>(`/projects/${projectId}/backlog`, { params: filters }),

  get: (projectId: string, itemId: string) =>
    client.get<ApiResponse<BacklogItem>>(`/projects/${projectId}/backlog/${itemId}`),

  create: (projectId: string, data: {
    title: string;
    type: BacklogItemType;
    description?: string;
    epic_id?: string;
    estimate?: string;
    assignee_id?: string;
    parent_item_id?: string | null;
  }) =>
    client.post<ApiResponse<BacklogItem>>(`/projects/${projectId}/backlog`, data),

  update: (projectId: string, itemId: string, data: {
    title?: string;
    description?: string;
    type?: BacklogItemType;
    status?: BacklogItemStatus;
    clarity?: ClarityQuadrant;
    estimate?: string | null;
    assignee_id?: string;
    epic_id?: string;
    stage_id?: string | null;
    node_id?: string | null;
    ac_setup?: string;
    ac_steps?: string;
    ac_expected?: string;
  }) =>
    client.patch<ApiResponse<BacklogItem>>(`/projects/${projectId}/backlog/${itemId}`, data),

  delete: (projectId: string, itemId: string) =>
    client.delete<ApiResponse<null>>(`/projects/${projectId}/backlog/${itemId}`),

  reorder: (projectId: string, items: { id: string; order_index: number }[]) =>
    client.post<ApiResponse<null>>(`/projects/${projectId}/backlog/reorder`, { items }),

  getChildren: (projectId: string, itemId: string) =>
    client.get<ApiResponse<BacklogItem[]>>(`/projects/${projectId}/backlog/${itemId}/children`),

  readiness: (projectId: string, itemId: string) =>
    client.get<ApiResponse<ReadinessResult>>(`/projects/${projectId}/backlog/${itemId}/readiness`),
};
