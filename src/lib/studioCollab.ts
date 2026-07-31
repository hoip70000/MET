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

/** Active live sessions for one specific team — the only scope this is ever queried at (Teams'
 *  own "Live" section, one team at a time, per the RLS-backed guarantee that a member of team A
 *  can never see team B's rows this way). RLS on `studio_sessions` additionally already restricts
 *  this to teams the caller belongs to, so a stray call with someone else's team_id just comes
 *  back empty rather than leaking anything. */
export async function getActiveStudioSessionsForTeam(teamId: string): Promise<StudioSessionRow[]> {
  const { data } = await supabase.from('studio_sessions').select('*').eq('team_id', teamId).is('ended_at', null);
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
  /** `tts` marks a message the sender wants read aloud on the host's device via SpeechSynthesis —
   *  only the host side ever acts on it (see Studio.tsx's onChat wiring); a viewer receiving a
   *  tts-flagged message from someone else just renders it as a normal chat bubble. */
  onChat?: (fromUserId: string, name: string, text: string, at: number, tts: boolean) => void;
  /** The host closed Studio or lost the connection — viewers should be kicked back to the Library. */
  onEnded?: () => void;
  /** WebRTC mesh voice chat signaling — see useStudioVoiceChat.ts, which is the only consumer of
   *  these three. Each carries `toUserId` in its payload so only the intended peer acts on it;
   *  everyone else's client just ignores it (cheap — Realtime broadcast fans out to the whole
   *  channel regardless, there's no way to address one participant server-side). */
  onVoiceOffer?: (fromUserId: string, sdp: RTCSessionDescriptionInit) => void;
  onVoiceAnswer?: (fromUserId: string, sdp: RTCSessionDescriptionInit) => void;
  onVoiceIce?: (fromUserId: string, candidate: RTCIceCandidateInit) => void;
  /** Remote control — a viewer asking to drive the host's Studio. Host-only: fires when someone
   *  else requests control. */
  onControlRequest?: (fromUserId: string, name: string) => void;
  /** Everyone gets this: who (if anyone) currently holds control, so a viewer's own canvas can
   *  become interactive and everyone's roster can show who's driving. */
  onControlGranted?: (userId: string | null) => void;
  /** Host-only: a pointer event from whoever currently holds control, in page-space (unscaled
   *  image-pixel coordinates, same convention cursor broadcasting already uses) — see
   *  StudioCanvasHandle.dispatchRemotePointerEvent, which is what actually turns this into a real
   *  interaction with the host's own tools. */
  onRemoteInput?: (fromUserId: string, kind: 'down' | 'move' | 'up', x: number, y: number, button: number) => void;
}

export interface StudioCollabHandle {
  broadcastFrame: (dataUrl: string) => void;
  broadcastCursor: (x: number, y: number) => void;
  sendChat: (text: string, tts?: boolean) => void;
  /** Host-only: tells every viewer the session is over, ahead of/independent from the DB update. */
  announceEnded: () => void;
  sendVoiceOffer: (toUserId: string, sdp: RTCSessionDescriptionInit) => void;
  sendVoiceAnswer: (toUserId: string, sdp: RTCSessionDescriptionInit) => void;
  sendVoiceIce: (toUserId: string, candidate: RTCIceCandidateInit) => void;
  /** Viewer → host: "let me drive." */
  requestControl: () => void;
  /** Host → everyone: grant control to a userId, or pass null to revoke/take it back. */
  grantControl: (userId: string | null) => void;
  sendRemoteInput: (kind: 'down' | 'move' | 'up', x: number, y: number, button: number) => void;
  leave: () => void;
}

export function joinStudioSessionChannel(
  sessionId: string,
  self: { userId: string; name: string; isHost: boolean },
  handlers: StudioCollabHandlers,
): StudioCollabHandle {
  // broadcast.self:true — without it, a sender never receives their own broadcast events back.
  // Cursor/frame/voice-signal handlers already filter `payload.userId !== self.userId` (or
  // toUserId checks) so this changes nothing for them, but chat needs it: there was no local
  // optimistic-append, so a sent message previously only ever showed up for *other* participants,
  // never the sender's own window — a real bug, not a design choice.
  const channel = supabase.channel(channelName(sessionId), {
    config: { presence: { key: self.userId }, broadcast: { self: true } },
  });

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
      handlers.onChat?.(payload.userId, payload.name, payload.text, payload.at, !!payload.tts);
    })
    .on('broadcast', { event: 'ended' }, () => {
      handlers.onEnded?.();
    })
    .on('broadcast', { event: 'voice-offer' }, ({ payload }) => {
      if (payload.toUserId === self.userId) handlers.onVoiceOffer?.(payload.fromUserId, payload.sdp);
    })
    .on('broadcast', { event: 'voice-answer' }, ({ payload }) => {
      if (payload.toUserId === self.userId) handlers.onVoiceAnswer?.(payload.fromUserId, payload.sdp);
    })
    .on('broadcast', { event: 'voice-ice' }, ({ payload }) => {
      if (payload.toUserId === self.userId) handlers.onVoiceIce?.(payload.fromUserId, payload.candidate);
    })
    .on('broadcast', { event: 'control-request' }, ({ payload }) => {
      if (self.isHost && payload.userId !== self.userId) handlers.onControlRequest?.(payload.userId, payload.name);
    })
    .on('broadcast', { event: 'control-granted' }, ({ payload }) => {
      handlers.onControlGranted?.(payload.userId);
    })
    .on('broadcast', { event: 'remote-input' }, ({ payload }) => {
      if (self.isHost && payload.userId !== self.userId) handlers.onRemoteInput?.(payload.userId, payload.kind, payload.x, payload.y, payload.button);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ name: self.name, isHost: self.isHost });
      }
    });

  return {
    broadcastFrame: (dataUrl) => { channel.send({ type: 'broadcast', event: 'frame', payload: { userId: self.userId, dataUrl } }); },
    broadcastCursor: (x, y) => { channel.send({ type: 'broadcast', event: 'cursor', payload: { userId: self.userId, name: self.name, x, y } }); },
    sendChat: (text, tts) => { channel.send({ type: 'broadcast', event: 'chat', payload: { userId: self.userId, name: self.name, text, at: Date.now(), tts: !!tts } }); },
    announceEnded: () => { channel.send({ type: 'broadcast', event: 'ended', payload: {} }); },
    sendVoiceOffer: (toUserId, sdp) => { channel.send({ type: 'broadcast', event: 'voice-offer', payload: { fromUserId: self.userId, toUserId, sdp } }); },
    sendVoiceAnswer: (toUserId, sdp) => { channel.send({ type: 'broadcast', event: 'voice-answer', payload: { fromUserId: self.userId, toUserId, sdp } }); },
    sendVoiceIce: (toUserId, candidate) => { channel.send({ type: 'broadcast', event: 'voice-ice', payload: { fromUserId: self.userId, toUserId, candidate } }); },
    requestControl: () => { channel.send({ type: 'broadcast', event: 'control-request', payload: { userId: self.userId, name: self.name } }); },
    grantControl: (userId) => { channel.send({ type: 'broadcast', event: 'control-granted', payload: { userId } }); },
    sendRemoteInput: (kind, x, y, button) => { channel.send({ type: 'broadcast', event: 'remote-input', payload: { userId: self.userId, kind, x, y, button } }); },
    leave: () => { supabase.removeChannel(channel); },
  };
}
