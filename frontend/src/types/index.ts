// Core domain types -- mirrors the Go backend models

export type UserRole = 'admin' | 'maintainer' | 'developer';

export interface User {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  avatar_url?: string;
  theme?: string;
  created_at: string;
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
