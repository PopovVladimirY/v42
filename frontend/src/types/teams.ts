// Team shapes mirror backend store.Team and store.TeamWithMembers.

export interface Team {
  id: string;
  name: string;
  description: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  avatar_url: string | null;
  capacity_hours: number;
  joined_at: string;
}

export interface TeamWithMembers extends Team {
  members: TeamMember[];
}
