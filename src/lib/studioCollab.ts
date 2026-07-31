import { supabase } from './supabaseClient';
import { listMyMemberships } from './teams';

/** Live collaborative Studio — spectator mode. A team leader (or site admin) hosts a session for
 *  a chapter; team members join to watch the host's canvas + cursors and chat. Mirrors the
 *  presence.ts (roster) and chat.ts (broadcast typing indicator) patterns already used for Teams:
 *  a `studio_sessions` row is only for discovery/roster bookkeeping (see migration
 *  0067_studio_sessions.sql) — the live canvas/cursor/chat traffic itself is pure Realtime
 *  Presence + Broadcast on one channel per session, never written to Postgres. */

export interface StudioSessionRow {
  id: string;
  team_id: string;
  chapter_id: string;
  host_user_id: string;
  started_at: string;
  ended_at: string | null;
}

function channelName(sessionId: string): string {
  return `studio-session:${sessionId}`;
}

export async function startStudioSession(teamId: string, chapterId: string): Promise<{ session: StudioSessionRow | null; error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const hostUserId = userData.user?.id;
  if (!hostUserId) return { session: null, error: 'Not signed in.' };
  const { data, error } = await supabase
    .from('studio_sessions')
    .insert({ team_id: teamId, chapter_id: chapterId, host_user_id: hostUserId })
    .select('*')
    .single();
  if (error) return { session: null, error: error.message };
  return { session: data as StudioSessionRow, error: null };
}

export async function endStudioSession(sessionId: string): Promise<string | null> {
  const { error } = await supabase.from('studio_sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId);
  return error ? error.message : null;
}

export async function getActiveStudioSession(teamId: string, chapterId: string): Promise<StudioSessionRow | null> {
  const { data } = await supabase
    .from('studio_sessions')
    .select('*')
    .eq('team_id', teamId).eq('chapter_id', chapterId).is('ended_at', null)
    .maybeSingle();
  return (data as StudioSessionRow) ?? null;
}

/** Any live session(s) for this chapter, across every team the current user can see — RLS on
 *  `studio_sessions` already scopes this to the caller's own teams, so no explicit team filter
 *  is needed here. Chapters aren't tied to a team in this app's data model, so "is this chapter
 *  live" has to be asked this way rather than via a stored chapter->team link. */
export async function getActiveStudioSessionsForChapter(chapterId: string): Promise<StudioSessionRow[]> {
  const { data } = await supabase.from('studio_sessions').select('*').eq('chapter_id', chapterId).is('ended_at', null);
  return (data as StudioSessionRow[]) ?? [];
}

/** Batched form of the above, for a Library chapter-card grid — one query for every chapter
 *  currently on screen instead of one per card. */
export async function getActiveStudioSessionsForChapters(chapterIds: string[]): Promise<StudioSessionRow[]> {
  if (chapterIds.length === 0) return [];
  const { data } = await supabase.from('studio_sessions').select('*').in('chapter_id', chapterIds).is('ended_at', null);
  return (data as StudioSessionRow[]) ?? [];
}

/** Teams the current user can host a live session under: teams they lead, own, or (being a site
 *  admin) any team at all. Mirrors the same leader-or-admin check the studio_sessions insert RLS
 *  policy enforces server-side — this is only for building the "which team?" picker the Go Live
 *  button shows, not a security boundary itself.
 *
 *  Three sources are merged, not just `listMyMemberships()` alone: a team *owner* has no
 *  guaranteed `team_members` row for their own team (creating a team doesn't insert one), and a
 *  site admin should be able to host under any team, not just ones they happen to belong to —
 *  which requires `teams_select_admin` (migration 0068) to even be visible to them under RLS in
 *  the first place; `is_admin=true` alone doesn't grant that at the database level. */
export async function listHostableTeams(): Promise<{ id: string; name: string }[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];
  const [{ data: profile }, memberships, { data: owned }] = await Promise.all([
    supabase.from('profiles').select('is_admin').eq('id', userId).maybeSingle(),
    listMyMemberships(),
    supabase.from('teams').select('id, name').eq('owner_id', userId),
  ]);
  const isAdmin = !!profile?.is_admin;
  const byId = new Map<string, string>();
  for (const t of owned ?? []) byId.set(t.id, t.name);
  for (const m of memberships) {
    if (m.status === 'active' && m.role === 'leader') byId.set(m.team_id, m.team.name);
  }
  if (isAdmin) {
    const { data: allTeams } = await supabase.from('teams').select('id, name');
    for (const t of allTeams ?? []) byId.set(t.id, t.name);
  }
  return Array.from(byId, ([id, name]) => ({ id, name }));
}

// ---------------------------------------------------------------------------
// Live channel: roster (presence) + canvas frames / cursors / chat / end-of-session (broadcast)
// ---------------------------------------------------------------------------

export interface StudioCollabPeer {
  userId: string;
  name: string;
  isHost: boolean;
}

export interface StudioCollabHandlers {
  /** Fires on every presence sync with the full current roster. */
  onPeers?: (peers: StudioCollabPeer[]) => void;
  /** A viewer-facing throttled raster snapshot broadcast by the host. */
  onFrame?: (fromUserId: string, dataUrl: string) => void;
  /** Page-space (not screen-space) cursor position from any participant, including the host. */
  onCursor?: (fromUserId: string, name: string, x: number, y: number) => void;
  onChat?: (fromUserId: string, name: string, text: string, at: number) => void;
  /** The host closed Studio or lost the connection — viewers should be kicked back to the Library. */
  onEnded?: () => void;
}

export interface StudioCollabHandle {
  broadcastFrame: (dataUrl: string) => void;
  broadcastCursor: (x: number, y: number) => void;
  sendChat: (text: string) => void;
  /** Host-only: tells every viewer the session is over, ahead of/independent from the DB update. */
  announceEnded: () => void;
  leave: () => void;
}

export function joinStudioSessionChannel(
  sessionId: string,
  self: { userId: string; name: string; isHost: boolean },
  handlers: StudioCollabHandlers,
): StudioCollabHandle {
  const channel = supabase.channel(channelName(sessionId), { config: { presence: { key: self.userId } } });

  channel
    .on('presence', { event: 'sync' }, () => {
      if (!handlers.onPeers) return;
      const state = channel.presenceState<{ name: string; isHost: boolean }>();
      const peers: StudioCollabPeer[] = Object.entries(state).map(([userId, entries]) => ({
        userId,
        name: entries[0]?.name ?? 'Unknown',
        isHost: !!entries[0]?.isHost,
      }));
      handlers.onPeers(peers);
    })
    .on('broadcast', { event: 'frame' }, ({ payload }) => {
      if (payload.userId !== self.userId) handlers.onFrame?.(payload.userId, payload.dataUrl);
    })
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      if (payload.userId !== self.userId) handlers.onCursor?.(payload.userId, payload.name, payload.x, payload.y);
    })
    .on('broadcast', { event: 'chat' }, ({ payload }) => {
      handlers.onChat?.(payload.userId, payload.name, payload.text, payload.at);
    })
    .on('broadcast', { event: 'ended' }, () => {
      handlers.onEnded?.();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ name: self.name, isHost: self.isHost });
      }
    });

  return {
    broadcastFrame: (dataUrl) => { channel.send({ type: 'broadcast', event: 'frame', payload: { userId: self.userId, dataUrl } }); },
    broadcastCursor: (x, y) => { channel.send({ type: 'broadcast', event: 'cursor', payload: { userId: self.userId, name: self.name, x, y } }); },
    sendChat: (text) => { channel.send({ type: 'broadcast', event: 'chat', payload: { userId: self.userId, name: self.name, text, at: Date.now() } }); },
    announceEnded: () => { channel.send({ type: 'broadcast', event: 'ended', payload: {} }); },
    leave: () => { supabase.removeChannel(channel); },
  };
}
