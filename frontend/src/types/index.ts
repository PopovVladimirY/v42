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
  idle_timeout_minutes: number;
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

// -- Projects ----------------------------------------------------------------

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectTeamEntry {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  added_at: string;
}

// -- Epics -------------------------------------------------------------------

export type EpicStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type ClarityQuadrant = 'clear' | 'scoped' | 'tacit' | 'foggy' | 'unknown';

export interface Epic {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description: string | null;
  owner_id: string | null;
  status: EpicStatus;
  clarity: ClarityQuadrant;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// -- Backlog -----------------------------------------------------------------

export type BacklogItemType = 'story' | 'bug' | 'task' | 'spike';

// Pre-sprint statuses (not visible on kanban board)
// Sprint statuses (shown in kanban columns)
export type BacklogItemStatus =
  | 'planned'      // waiting to be picked up (was 'backlog')
  | 'request'      // incoming request, needs triage
  | 'on_hold'      // blocked or deferred
  | 'rejected'     // not going to happen
  | 'open'         // To Do -- first kanban column (was 'ready')
  | 'in_progress'  // being worked on
  | 'in_review'    // under review (was 'review')
  | 'done'         // complete
  | 'cancelled';   // cancelled mid-sprint

export const STATUS_COLOR: Record<BacklogItemStatus, { bg: string; fg: string }> = {
  planned:     { bg: '#6B7280', fg: '#fff' },
  request:     { bg: '#3B82F6', fg: '#fff' },
  on_hold:     { bg: '#F59E0B', fg: '#000' },
  rejected:    { bg: '#EF4444', fg: '#fff' },
  open:        { bg: '#0EA5E9', fg: '#fff' },
  in_progress: { bg: '#8B5CF6', fg: '#fff' },
  in_review:   { bg: '#EC4899', fg: '#fff' },
  done:        { bg: '#10B981', fg: '#fff' },
  cancelled:   { bg: '#9CA3AF', fg: '#fff' },
};

export const STATUS_LABEL: Record<BacklogItemStatus, string> = {
  planned:     'Planned',
  request:     'Request',
  on_hold:     'On Hold',
  rejected:    'Rejected',
  open:        'To Do',
  in_progress: 'In Progress',
  in_review:   'In Review',
  done:        'Done',
  cancelled:   'Cancelled',
};

export interface BacklogItem {
  id: string;
  project_id: string;
  number: number;
  epic_id: string | null;
  title: string;
  description: string | null;
  type: BacklogItemType;
  status: BacklogItemStatus;
  clarity: ClarityQuadrant;
  estimate: string | null;
  assignee_id: string | null;
  stage_id: string | null;
  release_id: string | null;
  order_index: number;
  // Sprint membership -- null when not assigned.
  sprint_id: string | null;
  sprint_name: string | null;
  // ATDD fields
  ac_setup: string | null;
  ac_steps: string | null;
  ac_expected: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ClarityColor = Record<ClarityQuadrant, string>;
export const CLARITY_COLOR: ClarityColor = {
  clear: 'bg-green-500',
  scoped: 'bg-yellow-400',
  tacit: 'bg-orange-400',
  foggy: 'bg-red-500',
  unknown: 'bg-gray-400',
};

export const CLARITY_LABEL: Record<ClarityQuadrant, string> = {
  clear: 'Clear',
  scoped: 'Scoped',
  tacit: 'Tacit',
  foggy: 'Foggy',
  unknown: 'Unknown',
};

// -- Tasks -------------------------------------------------------------------

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

export interface Task {
  id: string;
  backlog_item_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  estimate: string | null;
  order_index: number;
  assignee_id: string | null;
  skill_required: string | null;
  reviewer_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// -- TestSpec ----------------------------------------------------------------

export type TestType = 'manual' | 'acceptance' | 'integration' | 'unit';

export interface TestSpec {
  id: string;
  project_id: string;
  backlog_item_id: string | null;
  epic_id: string | null;
  title: string;
  description: string | null;
  setup: string | null;
  config: string | null;
  steps: string | null;
  expected_results: string | null;
  type: TestType;
  created_by: string;
  created_at: string;
  updated_at: string;
}
