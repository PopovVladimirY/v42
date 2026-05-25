import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sprintsApi, type Sprint, type SprintStatus } from '@/api/endpoints/sprints';

// ---------- Query keys ----------

export const sprintKeys = {
  all:   (projectId: string) => ['sprints', projectId] as const,
  one:   (projectId: string, id: string) => ['sprints', projectId, id] as const,
  items: (projectId: string, id: string) => ['sprints', projectId, id, 'items'] as const,
};

// ---------- Sprint list ----------

export function useSprints(projectId: string) {
  return useQuery({
    queryKey: sprintKeys.all(projectId),
    queryFn: async () => {
      const res = await sprintsApi.list(projectId);
      return res.data.data ?? [];
    },
    enabled: !!projectId,
  });
}

// ---------- Single sprint ----------

export function useSprint(projectId: string, sprintId: string) {
  return useQuery({
    queryKey: sprintKeys.one(projectId, sprintId),
    queryFn: async () => {
      const res = await sprintsApi.get(projectId, sprintId);
      return res.data.data;
    },
    enabled: !!projectId && !!sprintId,
  });
}

// ---------- Sprint items ----------

export function useSprintItems(projectId: string, sprintId: string) {
  return useQuery({
    queryKey: sprintKeys.items(projectId, sprintId),
    queryFn: async () => {
      const res = await sprintsApi.listItems(projectId, sprintId);
      return res.data.data ?? [];
    },
    enabled: !!projectId && !!sprintId,
  });
}

// ---------- Create sprint ----------

export function useCreateSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      goal?: string;
      start_date?: string;
      end_date?: string;
      capacity_hours?: number;
    }) => sprintsApi.create(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: sprintKeys.all(projectId) }),
  });
}

// ---------- Update sprint (status, dates, etc.) ----------

export function useUpdateSprint(projectId: string, sprintId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name?: string;
      goal?: string;
      status?: SprintStatus;
      start_date?: string;
      end_date?: string;
      capacity_hours?: number;
    }) => sprintsApi.update(projectId, sprintId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sprintKeys.all(projectId) });
      qc.invalidateQueries({ queryKey: sprintKeys.one(projectId, sprintId) });
    },
  });
}

// ---------- Delete sprint ----------

export function useDeleteSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sprintId: string) => sprintsApi.delete(projectId, sprintId),
    onSuccess: () => qc.invalidateQueries({ queryKey: sprintKeys.all(projectId) }),
  });
}

// ---------- Add item to sprint ----------

export function useAddSprintItem(projectId: string, sprintId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (backlogItemId: string) =>
      sprintsApi.addItem(projectId, sprintId, backlogItemId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: sprintKeys.items(projectId, sprintId) }),
  });
}

// ---------- Remove item from sprint ----------

export function useRemoveSprintItem(projectId: string, sprintId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (backlogItemId: string) =>
      sprintsApi.removeItem(projectId, sprintId, backlogItemId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: sprintKeys.items(projectId, sprintId) }),
  });
}

// ---------- Close sprint ----------

export function useCloseSprint(projectId: string, sprintId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (carryToSprintId?: string) =>
      sprintsApi.close(projectId, sprintId, carryToSprintId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sprintKeys.all(projectId) });
      qc.invalidateQueries({ queryKey: sprintKeys.one(projectId, sprintId) });
      qc.invalidateQueries({ queryKey: sprintKeys.items(projectId, sprintId) });
    },
  });
}

// ---------- Handy: status badge metadata ----------

export const SPRINT_STATUS_LABEL: Record<Sprint['status'], string> = {
  planning:  'Planning',
  active:    'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const SPRINT_STATUS_COLOR: Record<Sprint['status'], string> = {
  planning:  'bg-blue-500/20 text-blue-300',
  active:    'bg-green-500/20 text-green-300',
  completed: 'bg-gray-500/20 text-gray-400',
  cancelled: 'bg-red-500/20 text-red-400',
};
