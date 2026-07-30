import { supabase } from './supabaseClient';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  avatar: string;
  is_admin: boolean;
  deleted_at: string | null;
}

export interface AdminTeamRow {
  id: string;
  name: string;
  owner_id: string;
  member_count: number;
}

export async function isSiteAdmin(): Promise<boolean> {
  const { data } = await supabase.rpc('is_site_admin');
  return !!data;
}

export async function listAllUsers(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.from('profiles').select('id, name, email, avatar, is_admin, deleted_at').order('name');
  if (error) return [];
  return data as AdminUserRow[];
}

export async function listAllTeams(): Promise<AdminTeamRow[]> {
  const { data, error } = await supabase.from('teams').select('id, name, owner_id, team_members(count)');
  if (error) return [];
  return (data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    owner_id: t.owner_id,
    member_count: t.team_members?.[0]?.count ?? 0,
  }));
}

export async function adminSoftDeleteUser(userId: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_soft_delete_user', { _user_id: userId });
  return error ? error.message : null;
}

export async function adminRestoreUser(userId: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_restore_user', { _user_id: userId });
  return error ? error.message : null;
}

export async function adminSetTeamRole(teamId: string, userId: string, role: 'leader' | 'member'): Promise<string | null> {
  const { error } = await supabase.rpc('admin_set_team_role', { _team_id: teamId, _user_id: userId, _role: role });
  return error ? error.message : null;
}

export async function adminNotifyUser(userId: string, title: string, body: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_notify_user', { _user_id: userId, _title: title, _body: body });
  return error ? error.message : null;
}
