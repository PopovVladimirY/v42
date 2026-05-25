import client from '../client';
import type { ApiResponse } from '@/types';

// -- Types -------------------------------------------------------------------

export interface CapacityRow {
  user_id: string;
  user_name: string;
  planned_hours: string;
  actual_hours?: string | null;
  notes?: string | null;
}

export interface SkillCapacityRow {
  skill_id: string;
  skill_name: string;
  planned_hours: string;
}

export interface SprintCapacityData {
  capacity: CapacityRow[];
  skill_breakdown: SkillCapacityRow[];
}

export interface VelocityPoint {
  sprint_id: string;
  sprint_name: string;
  start_date: string;
  end_date: string;
  total_items: number;
  done_items: number;
  planned_hours: string;
  actual_hours: string;
  velocity_normalized?: string | null;
}

export interface PutCapacityEntry {
  user_id: string;
  planned_hours: string;
  notes?: string | null;
}

// -- API client --------------------------------------------------------------

export const sprintCapacityApi = {
  get: (projectId: string, sprintId: string) =>
    client.get<ApiResponse<SprintCapacityData>>(
      `/projects/${projectId}/sprints/${sprintId}/capacity`
    ),

  put: (projectId: string, sprintId: string, entries: PutCapacityEntry[]) =>
    client.put<ApiResponse<CapacityRow[]>>(
      `/projects/${projectId}/sprints/${sprintId}/capacity`,
      entries
    ),

  patchActual: (
    projectId: string,
    sprintId: string,
    userId: string,
    actual_hours: string,
    notes?: string | null
  ) =>
    client.patch<ApiResponse<CapacityRow>>(
      `/projects/${projectId}/sprints/${sprintId}/capacity/${userId}`,
      { actual_hours, notes }
    ),

  init: (projectId: string, sprintId: string, teamId: string) =>
    client.post<ApiResponse<{ seeded: number }>>(
      `/projects/${projectId}/sprints/${sprintId}/capacity/init`,
      { team_id: teamId }
    ),

  velocity: (projectId: string) =>
    client.get<ApiResponse<VelocityPoint[]>>(`/projects/${projectId}/velocity`),
};
