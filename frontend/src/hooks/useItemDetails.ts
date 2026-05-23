import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '@/api/endpoints/tasks';
import { itemTestsApi } from '@/api/endpoints/item_tests';
import type { TaskStatus, TestType } from '@/types';

// ---------- Task query keys ----------

export const taskKeys = {
  byItem: (projectId: string, itemId: string) =>
    ['tasks', projectId, itemId] as const,
};

// ---------- Tests query keys ----------

export const itemTestKeys = {
  byItem: (projectId: string, itemId: string) =>
    ['item-tests', projectId, itemId] as const,
};

// ============================================================
//  Tasks
// ============================================================

export function useTasks(projectId: string, itemId: string) {
  return useQuery({
    queryKey: taskKeys.byItem(projectId, itemId),
    queryFn: async () => {
      const res = await tasksApi.list(projectId, itemId);
      return res.data.data ?? [];
    },
    enabled: !!projectId && !!itemId,
  });
}

export function useCreateTask(projectId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      description?: string;
      estimate?: string;
      assignee_id?: string;
      skill_required?: string;
    }) => tasksApi.create(projectId, itemId, data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, itemId) }),
  });
}

export function useUpdateTask(projectId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...data }: {
      taskId: string;
      title?: string;
      status?: TaskStatus;
      estimate?: string;
      skill_required?: string;
      assignee_id?: string;
    }) => tasksApi.update(projectId, itemId, taskId, data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, itemId) }),
  });
}

export function useDeleteTask(projectId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasksApi.delete(projectId, itemId, taskId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, itemId) }),
  });
}

// ============================================================
//  Item-level tests
// ============================================================

export function useItemTests(projectId: string, itemId: string) {
  return useQuery({
    queryKey: itemTestKeys.byItem(projectId, itemId),
    queryFn: async () => {
      const res = await itemTestsApi.list(projectId, itemId);
      return res.data.data ?? [];
    },
    enabled: !!projectId && !!itemId,
  });
}

export function useCreateItemTest(projectId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      type?: TestType;
      description?: string;
      steps?: string;
      expected_results?: string;
    }) => itemTestsApi.create(projectId, itemId, data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: itemTestKeys.byItem(projectId, itemId) }),
  });
}

export function useDeleteItemTest(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ testId, itemId }: { testId: string; itemId: string }) =>
      itemTestsApi.delete(projectId, testId),
    onSuccess: (_d, { itemId }) =>
      qc.invalidateQueries({ queryKey: itemTestKeys.byItem(projectId, itemId) }),
  });
}

export function useUpdateItemTest(projectId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ testId, ...data }: { testId: string; title?: string }) =>
      itemTestsApi.update(projectId, testId, data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: itemTestKeys.byItem(projectId, itemId) }),
  });
}

export function useMoveTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, fromItemId, toItemId }: { taskId: string; fromItemId: string; toItemId: string }) =>
      tasksApi.move(projectId, fromItemId, taskId, toItemId),
    onSuccess: (_d, { fromItemId, toItemId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, fromItemId) });
      void qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, toItemId) });
    },
  });
}

export function useMoveItemTest(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ testId, fromItemId, toItemId }: { testId: string; fromItemId: string; toItemId: string }) =>
      itemTestsApi.move(projectId, fromItemId, testId, toItemId),
    onSuccess: (_d, { fromItemId, toItemId }) => {
      void qc.invalidateQueries({ queryKey: itemTestKeys.byItem(projectId, fromItemId) });
      void qc.invalidateQueries({ queryKey: itemTestKeys.byItem(projectId, toItemId) });
    },
  });
}
