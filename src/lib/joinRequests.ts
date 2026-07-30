import { supabase } from './supabaseClient';
import type { Team } from './teams';

export interface JoinRequest {
  id: string;
  team_id: string;
  user_id: string;
  message: string;
  job_types: string[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  user?: { name: string; email: string } | null;
}

export interface PublicTeamCard extends Team {
  member_count: number;
  badges: { code: string; label: string }[];
  activity_count: number;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args);
  return error ? error.message : null;
}

export const requestToJoinTeam = (teamId: string, message: string, jobTypes: string[] = []) =>
  rpc('request_to_join_team', { _team_id: teamId, _message: message, _job_types: jobTypes });

/** A user's own join-request history across every team they've applied to — item 17's
 *  "show my accept/refuse history for team invites/requests" — no new table needed, the rows
 *  already carry status. */
export async function listMyJoinRequestHistory(): Promise<(JoinRequest & { team: { name: string; logo: string } | null })[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];
  const { data } = await supabase
    .from('join_requests')
    .select('*, team:teams(name, logo)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data as unknown as (JoinRequest & { team: { name: string; logo: string } | null })[]) ?? [];
}

export interface TeamInviteToken {
  id: string;
  team_id: string;
  token: string;
  expires_at: string | null;
  uses_left: number | null;
  created_at: string;
}

export async function createInviteToken(teamId: string): Promise<{ token: TeamInviteToken | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_invite_token', { _team_id: teamId });
  return { token: (data as TeamInviteToken) ?? null, error: error ? error.message : null };
}

export async function redeemInviteToken(token: string, message = ''): Promise<string | null> {
  const { error } = await supabase.rpc('redeem_invite_token', { _token: token, _message: message });
  return error ? error.message : null;
}

export const decideJoinRequest = (id: string, approve: boolean, responseBody?: string) =>
  rpc('decide_join_request', { _id: id, _approve: approve, _response_body: responseBody || null });

export interface ResponseTemplate {
  id: string;
  team_id: string;
  label: string;
  body: string;
  created_at: string;
}

export async function listResponseTemplates(teamId: string): Promise<ResponseTemplate[]> {
  const { data } = await supabase.from('team_response_templates').select('*').eq('team_id', teamId).order('created_at', { ascending: true });
  return (data as ResponseTemplate[]) ?? [];
}

export async function upsertResponseTemplate(teamId: string, label: string, body: string, id?: string): Promise<string | null> {
  const { error } = await supabase.rpc('upsert_response_template', { _id: id || null, _team_id: teamId, _label: label, _body: body });
  return error ? error.message : null;
}

export async function deleteResponseTemplate(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('delete_response_template', { _id: id });
  return error ? error.message : null;
}

export async function listPublicTeams(): Promise<PublicTeamCard[]> {
  const { data: teams } = await supabase.from('teams').select('*').eq('visibility', 'public');
  if (!teams || teams.length === 0) return [];

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [counts, badgeRows, activityRows] = await Promise.all([
    Promise.all(
      (teams as Team[]).map(t =>
        supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('team_id', t.id).eq('status', 'active')
      )
    ),
    supabase.from('team_badges').select('team_id, code, label').in('team_id', (teams as Team[]).map(t => t.id)),
    supabase.rpc('get_team_activity_counts', { _since: since }),
  ]);
  const badgesByTeam = new Map<string, { code: string; label: string }[]>();
  for (const row of badgeRows.data ?? []) {
    const list = badgesByTeam.get(row.team_id) ?? [];
    list.push({ code: row.code, label: row.label });
    badgesByTeam.set(row.team_id, list);
  }
  const activityByTeam = new Map<string, number>();
  for (const row of (activityRows.data ?? []) as { team_id: string; activity_count: number }[]) {
    activityByTeam.set(row.team_id, row.activity_count);
  }
  return (teams as Team[]).map((t, i) => ({
    ...t,
    member_count: counts[i].count ?? 0,
    badges: badgesByTeam.get(t.id) ?? [],
    activity_count: activityByTeam.get(t.id) ?? 0,
  }));
}

export async function expireStaleJoinRequests(teamId: string): Promise<void> {
  await supabase.rpc('expire_stale_join_requests', { _team_id: teamId });
}

export interface PublicTeamLeaderboardRow {
  team_id: string;
  team_name: string;
  team_logo: string;
  tasks_done: number;
  total_balance: number;
}

export async function getPublicTeamLeaderboard(): Promise<PublicTeamLeaderboardRow[]> {
  const { data } = await supabase.rpc('get_public_team_leaderboard');
  return (data as PublicTeamLeaderboardRow[]) ?? [];
}

export async function listPendingJoinRequests(teamId: string): Promise<JoinRequest[]> {
  const { data } = await supabase
    .from('join_requests')
    .select('*, user:profiles!join_requests_user_id_fkey(name, email)')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data as unknown as JoinRequest[]) ?? [];
}
