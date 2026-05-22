import apiClient from '@/api/client';
import type {
  MatrixEntry,
  TandemPair,
  RadarSkill,
  LearningAppetite,
  EngagementScore,
  TeamMemberAppetite,
} from '@/types/index';

function unwrap<T>(res: { data: T }): T {
  return res.data;
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

  personalRadar: (userId: string) =>
    apiClient
      .get<{ data: RadarSkill[] }>(`/users/${userId}/skill-radar`)
      .then((r) => unwrap(r.data)),

  userLearningAppetite: (userId: string) =>
    apiClient
      .get<{ data: LearningAppetite }>(`/users/${userId}/learning-appetite`)
      .then((r) => unwrap(r.data)),

  userEngagement: (userId: string) =>
    apiClient
      .get<{ data: EngagementScore }>(`/users/${userId}/engagement`)
      .then((r) => unwrap(r.data)),
};
