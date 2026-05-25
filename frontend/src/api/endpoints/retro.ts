import client from '../client';
import type { ApiResponse } from '@/types';

// -- Types -------------------------------------------------------------------

export type RetroCategory = 'went_well' | 'didnt_go_well' | 'to_improve' | 'kudos';

export interface RetroItem {
  id: string;
  sprint_id: string;
  author_id: string;
  author_name: string;
  category: RetroCategory;
  content: string;
  is_action: boolean;
  is_resolved: boolean;
  backlog_item_id?: string | null;
  created_at: string;
  updated_at: string;
  votes: number;
  my_vote: boolean;
  my_total_votes: number;
}

export interface CreateRetroItemInput {
  category: RetroCategory;
  content: string;
  is_action?: boolean;
}

// -- API client --------------------------------------------------------------

export const retroApi = {
  list: (projectId: string, sprintId: string, viewAs?: string) =>
    client.get<ApiResponse<RetroItem[]>>(
      `/projects/${projectId}/sprints/${sprintId}/retro${viewAs ? `?view_as=${encodeURIComponent(viewAs)}` : ''}`
    ),

  create: (projectId: string, sprintId: string, input: CreateRetroItemInput) =>
    client.post<ApiResponse<RetroItem>>(
      `/projects/${projectId}/sprints/${sprintId}/retro`,
      input
    ),

  update: (projectId: string, sprintId: string, retroId: string, patch: { content?: string; is_action?: boolean }) =>
    client.patch<ApiResponse<RetroItem>>(
      `/projects/${projectId}/sprints/${sprintId}/retro/${retroId}`,
      patch
    ),

  delete: (projectId: string, sprintId: string, retroId: string) =>
    client.delete(`/projects/${projectId}/sprints/${sprintId}/retro/${retroId}`),

  vote: (projectId: string, sprintId: string, retroId: string, onBehalfOf?: string) =>
    client.post<ApiResponse<{ voted: boolean; total_votes: number }>>(
      `/projects/${projectId}/sprints/${sprintId}/retro/${retroId}/vote`,
      onBehalfOf ? { on_behalf_of_user_id: onBehalfOf } : {}
    ),

  unvote: (projectId: string, sprintId: string, retroId: string, onBehalfOf?: string) =>
    client.delete(
      `/projects/${projectId}/sprints/${sprintId}/retro/${retroId}/vote${onBehalfOf ? `?on_behalf_of=${onBehalfOf}` : ''}`
    ),

  resolve: (projectId: string, sprintId: string, retroId: string, resolved: boolean) =>
    client.patch<ApiResponse<{ id: string; is_resolved: boolean }>>(
      `/projects/${projectId}/sprints/${sprintId}/retro/${retroId}/resolve`,
      { resolved }
    ),

  close: (projectId: string, sprintId: string) =>
    client.post<ApiResponse<{ retro_closed: boolean }>>(
      `/projects/${projectId}/sprints/${sprintId}/retro/close`
    ),
};
