// Core domain types -- mirrors the Go backend models

export type UserRole = 'admin' | 'maintainer' | 'developer' | 'tester' | 'observer';

export interface User {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  avatar_url?: string;
  theme?: string;
  created_at: string;
}

// Dreyfus 5-level model -- matches backend enum
export type SkillLevel = 'novice' | 'beginner' | 'competent' | 'proficient' | 'expert';
export type InterestLevel = 'low' | 'medium' | 'high';

export interface MemberSkill {
  skill_id: string;
  skill_name: string;
  category: string | null;
  is_builtin: boolean;
  level: SkillLevel;
  interest: InterestLevel;
  interest_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Skill {
  id: string;
  name: string;
  category: string | null;
  is_builtin: boolean;
  created_at: string;
}

// Capacity analytics types -- mirrors store/capacity.go
export interface RadarSkill {
  skill_id: string;
  skill_name: string;
  category: string | null;
  level: SkillLevel;
  interest: InterestLevel;
  interest_note: string | null;
  level_rank: number;
}

export interface MatrixEntry {
  user_id: string;
  skill_id: string;
  skill_name: string;
  category: string | null;
  level: SkillLevel;
  interest: InterestLevel;
  interest_note: string | null;
  level_rank: number;
}

export interface TandemPair {
  learner_id: string;
  learner_level: SkillLevel;
  learner_interest: InterestLevel;
  mentor_id: string;
  mentor_level: SkillLevel;
  skill_id: string;
  skill_name: string;
}

export interface LearningAppetite {
  reaching_count: number;
  curious_breadth: number;
  total_skills: number;
  recent_level_ups: number;
}

export interface EngagementScore {
  engaged_skills: number;
  declared_expert_count: number;
  grounded_expert_count: number;
}

export interface TeamMemberAppetite {
  user_id: string;
  reaching_count: number;
  curious_breadth: number;
}

export interface MemberCapacity {
  user_id: string;
  capacity_hours: number;   // declared weekly capacity
  assigned_items: number;   // open items in active sprint
}

// Generic API envelope -- matches Go's { data, meta, error }
export interface ApiResponse<T> {
  data: T | null;
  meta: PaginationMeta | null;
  error: ApiError | null;
}

export interface PaginationMeta {
  total: number;
  page: number;
  per_page: number;
}

export interface ApiError {
  code: string;
  message: string;
}
