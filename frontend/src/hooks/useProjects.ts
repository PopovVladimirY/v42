import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/endpoints/projects';
import { epicsApi } from '@/api/endpoints/epics';
import { backlogApi, type BacklogFilters } from '@/api/endpoints/backlog';
import type { ProjectStatus, EpicStatus, BacklogItemType, BacklogItemStatus, ClarityQuadrant } from '@/types';

// -- Projects ----------------------------------------------------------------

export const projectKeys = {
  all: ['projects'] as const,
  byTeam: (teamId: string) => ['projects', 'team', teamId] as const,
  detail: (id: string) => ['projects', id] as const,
  teams: (id: string) => ['projects', id, 'teams'] as const,
};

export function useProjects(teamId: string) {
  return useQuery({
    queryKey: projectKeys.byTeam(teamId),
    queryFn: async () => {
      const { data } = await projectsApi.list(teamId);
      return data.data ?? [];
    },
    enabled: !!teamId,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: async () => {
      const { data } = await projectsApi.get(id);
      return data.data;
    },
    enabled: !!id,
  });
}

export function useProjectTeams(projectId: string) {
  return useQuery({
    queryKey: projectKeys.teams(projectId),
    queryFn: async () => {
      const { data } = await projectsApi.listTeams(projectId);
      return data.data ?? [];
    },
    enabled: !!projectId,
  });
}

export function useAddProjectTeam(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => projectsApi.addTeam(projectId, teamId),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.teams(projectId) }),
  });
}

export function useRemoveProjectTeam(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => projectsApi.removeTeam(projectId, teamId),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.teams(projectId) }),
  });
}

export function useCreateProject(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      projectsApi.create({ ...data, team_id: teamId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.byTeam(teamId) }),
  });
}

export function useUpdateProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name?: string; description?: string; status?: ProjectStatus }) =>
      projectsApi.update(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      // Also invalidate team list -- status change affects card display.
      qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

// -- Epics -------------------------------------------------------------------

export const epicKeys = {
  byProject: (projectId: string) => ['epics', projectId] as const,
  detail: (projectId: string, epicId: string) => ['epics', projectId, epicId] as const,
};

export function useEpics(projectId: string) {
  return useQuery({
    queryKey: epicKeys.byProject(projectId),
    queryFn: async () => {
      const { data } = await epicsApi.list(projectId);
      return data.data ?? [];
    },
    enabled: !!projectId,
  });
}

export function useCreateEpic(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; description?: string; owner_id?: string }) =>
      epicsApi.create(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: epicKeys.byProject(projectId) }),
  });
}

export function useUpdateEpic(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ epicId, ...data }: { epicId: string; title?: string; description?: string; status?: EpicStatus; clarity?: ClarityQuadrant; owner_id?: string; target_date?: string }) =>
      epicsApi.update(projectId, epicId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: epicKeys.byProject(projectId) }),
  });
}

export function useDeleteEpic(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (epicId: string) => epicsApi.delete(projectId, epicId),
    onSuccess: () => qc.invalidateQueries({ queryKey: epicKeys.byProject(projectId) }),
  });
}

// -- Backlog -----------------------------------------------------------------

export const backlogKeys = {
  byProject: (projectId: string, filters?: BacklogFilters) =>
    ['backlog', projectId, filters] as const,
  detail: (projectId: string, itemId: string) => ['backlog', projectId, itemId] as const,
};

export function useBacklog(projectId: string, filters?: BacklogFilters) {
  return useQuery({
    queryKey: backlogKeys.byProject(projectId, filters),
    queryFn: async () => {
      const { data } = await backlogApi.list(projectId, filters);
      return data.data ?? [];
    },
    enabled: !!projectId,
  });
}

export function useBacklogItem(projectId: string, itemId: string) {
  return useQuery({
    queryKey: backlogKeys.detail(projectId, itemId),
    queryFn: async () => {
      const { data } = await backlogApi.get(projectId, itemId);
      return data.data;
    },
    enabled: !!projectId && !!itemId,
  });
}

export function useCreateBacklogItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; type: BacklogItemType; description?: string; epic_id?: string }) =>
      backlogApi.create(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backlog', projectId] }),
  });
}

export function useUpdateBacklogItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, ...data }: {
      itemId: string;
      title?: string;
      status?: BacklogItemStatus;
      clarity?: ClarityQuadrant;
      estimate?: string | null;
      epic_id?: string;
      assignee_id?: string;
      ac_setup?: string;
      ac_steps?: string;
      ac_expected?: string;
    }) => backlogApi.update(projectId, itemId, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['backlog', projectId] });
      qc.invalidateQueries({ queryKey: backlogKeys.detail(projectId, variables.itemId) });
    },
  });
}

export function useDeleteBacklogItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => backlogApi.delete(projectId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backlog', projectId] }),
  });
}

export function useReorderBacklog(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { id: string; order_index: number }[]) =>
      backlogApi.reorder(projectId, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backlog', projectId] }),
  });
}
