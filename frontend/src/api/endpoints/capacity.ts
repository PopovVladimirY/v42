import apiClient from '@/api/client';
import type { MatrixEntry, TandemPair } from '@/types/index';

function unwrap<T>(res: { data: T }): T {
  return res.data;
}

export interface TeamMemberAppetite {
  user_id: string;
  reaching_count: number;
  curious_breadth: number;
}

export const capacityApi = {
  teamSkillMatrix: (teamId: string) =>
    apiClient
      .get<{ data: MatrixEntry[] }>(`/teams/${teamId}/skill-matrix`)
      .then((r) => unwrap(r.data)),

  teamTandems: (teamId: string) =>
    apiClient
      .get<{ data: TandemPair[] }>(`/teams/${teamId}/tandems`)
      .then((r) => unwrap(r.data)),

  teamLearningAppetite: (teamId: string) =>
    apiClient
      .get<{ data: TeamMemberAppetite[] }>(`/teams/${teamId}/learning-appetite`)
      .then((r) => unwrap(r.data)),
};
