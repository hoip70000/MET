import { supabase } from './supabaseClient';

export interface TeamMessage {
  id: string;
  team_id: string;
  /** null = a system bot message (see SYSTEM_BOT_SENDER_ID below) — team_messages.sender_id
   *  is nullable specifically for this; every other message always has a real sender. */
  sender_id: string | null;
  body: string;
  created_at: string;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted: boolean;
  pinned: boolean;
  attachment_msg_id: number | null;
  attachment_name: string | null;
  attachment_size: number | null;
  sender?: { name: string; avatar: string } | null;
}

export interface DirectMessage {
  id: string;
  team_id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  read: boolean;
  created_at: string;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted: boolean;
  attachment_msg_id: number | null;
  attachment_name: string | null;
  attachment_size: number | null;
}

export interface Conversation {
  otherUserId: string;
  otherName: string;
  otherAvatar: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

export interface MessageAttachment { msgId: number; name: string; size: number }

/**
 * `id` lets the caller optimistically render the message before this resolves — pass a
 * client-generated uuid, append a locally-built TeamMessage with that same id, and the eventual
 * realtime INSERT (if it arrives) just replaces the optimistic copy in place via upsertById.
 */
export async function sendTeamMessage(teamId: string, body: string, opts?: { id?: string; replyToId?: string; attachment?: MessageAttachment }): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const senderId = userData.user?.id;
  if (!senderId) return 'Not signed in.';
  const { error } = await supabase.from('team_messages').insert({
    id: opts?.id, team_id: teamId, sender_id: senderId, body,
    reply_to_id: opts?.replyToId ?? null,
    attachment_msg_id: opts?.attachment?.msgId ?? null,
    attachment_name: opts?.attachment?.name ?? null,
    attachment_size: opts?.attachment?.size ?? null,
  });
  return error ? error.message : null;
}

export async function listTeamMessages(teamId: string, opts?: { limit?: number; before?: string; search?: string }): Promise<TeamMessage[]> {
  let query = supabase
    .from('team_messages')
    .select('*, sender:profiles!team_messages_sender_id_fkey(name, avatar)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.before) query = query.lt('created_at', opts.before);
  if (opts?.search) query = query.ilike('body', `%${opts.search}%`);
  const { data } = await query;
  return ((data as unknown as TeamMessage[]) ?? []).reverse();
}

export function subscribeToTeamMessages(teamId: string, onMessage: (msg: TeamMessage) => void): () => void {
  const channel = supabase
    .channel(`team_messages:${teamId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages', filter: `team_id=eq.${teamId}` },
      payload => onMessage(payload.new as TeamMessage))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'team_messages', filter: `team_id=eq.${teamId}` },
      payload => onMessage(payload.new as TeamMessage))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function editTeamMessage(id: string, body: string): Promise<string | null> {
  const { error } = await supabase.from('team_messages').update({ body, edited_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

export async function deleteTeamMessage(id: string): Promise<string | null> {
  const { error } = await supabase.from('team_messages').update({ deleted: true, body: '' }).eq('id', id);
  return error ? error.message : null;
}

export async function pinTeamMessage(id: string, pinned: boolean): Promise<string | null> {
  const { error } = await supabase.from('team_messages').update({ pinned }).eq('id', id);
  return error ? error.message : null;
}

export async function sendDirectMessage(teamId: string, toUserId: string, body: string, opts?: { id?: string; replyToId?: string; attachment?: MessageAttachment }): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const senderId = userData.user?.id;
  if (!senderId) return 'Not signed in.';
  const { error } = await supabase.from('direct_messages').insert({
    id: opts?.id, team_id: teamId, sender_id: senderId, receiver_id: toUserId, body,
    reply_to_id: opts?.replyToId ?? null,
    attachment_msg_id: opts?.attachment?.msgId ?? null,
    attachment_name: opts?.attachment?.name ?? null,
    attachment_size: opts?.attachment?.size ?? null,
  });
  return error ? error.message : null;
}

export async function listDirectMessages(teamId: string, otherUserId: string): Promise<DirectMessage[]> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return [];
  const { data } = await supabase
    .from('direct_messages')
    .select('*')
    .eq('team_id', teamId)
    .or(`and(sender_id.eq.${myId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${myId})`)
    .order('created_at', { ascending: true });
  return (data as DirectMessage[]) ?? [];
}

export function subscribeToDirectMessages(teamId: string, onMessage: (msg: DirectMessage) => void): () => void {
  const channel = supabase
    .channel(`direct_messages:${teamId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `team_id=eq.${teamId}` },
      payload => onMessage(payload.new as DirectMessage))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `team_id=eq.${teamId}` },
      payload => onMessage(payload.new as DirectMessage))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function editDirectMessage(id: string, body: string): Promise<string | null> {
  const { error } = await supabase.from('direct_messages').update({ body, edited_at: new Date().toISOString() }).eq('id', id);
  return error ? error.message : null;
}

export async function deleteDirectMessage(id: string): Promise<string | null> {
  const { error } = await supabase.from('direct_messages').update({ deleted: true, body: '' }).eq('id', id);
  return error ? error.message : null;
}

export async function markDirectMessagesRead(teamId: string, otherUserId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return;
  await supabase.from('direct_messages').update({ read: true })
    .eq('team_id', teamId).eq('sender_id', otherUserId).eq('receiver_id', myId).eq('read', false);
}

export async function listConversations(teamId: string): Promise<Conversation[]> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return [];

  const { data } = await supabase
    .from('direct_messages')
    .select('*, sender:profiles!direct_messages_sender_id_fkey(name, avatar), receiver:profiles!direct_messages_receiver_id_fkey(name, avatar)')
    .eq('team_id', teamId)
    .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
    .order('created_at', { ascending: false });

  const rows = (data as any[]) ?? [];
  const byPartner = new Map<string, Conversation>();
  for (const row of rows) {
    const isMine = row.sender_id === myId;
    const otherId = isMine ? row.receiver_id : row.sender_id;
    const otherProfile = isMine ? row.receiver : row.sender;
    if (!byPartner.has(otherId)) {
      byPartner.set(otherId, {
        otherUserId: otherId,
        otherName: otherProfile?.name || 'Unknown',
        otherAvatar: otherProfile?.avatar || '',
        lastMessage: row.deleted ? 'Message deleted' : row.body,
        lastAt: row.created_at,
        unread: 0,
      });
    }
    if (!isMine && !row.read) {
      byPartner.get(otherId)!.unread += 1;
    }
  }
  return Array.from(byPartner.values());
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export interface MessageReaction {
  id: string;
  message_id: string;
  message_table: 'team_messages' | 'direct_messages';
  team_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export async function listReactions(teamId: string, messageTable: 'team_messages' | 'direct_messages'): Promise<MessageReaction[]> {
  const { data } = await supabase.from('message_reactions').select('*').eq('team_id', teamId).eq('message_table', messageTable);
  return (data as MessageReaction[]) ?? [];
}

export async function toggleReaction(teamId: string, messageTable: 'team_messages' | 'direct_messages', messageId: string, emoji: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;
  const { data: existing } = await supabase
    .from('message_reactions')
    .select('id')
    .eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji)
    .maybeSingle();
  if (existing) {
    await supabase.from('message_reactions').delete().eq('id', existing.id);
  } else {
    await supabase.from('message_reactions').insert({ team_id: teamId, message_table: messageTable, message_id: messageId, user_id: userId, emoji });
  }
}

export function subscribeToReactions(teamId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`message_reactions:${teamId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `team_id=eq.${teamId}` }, () => onChange())
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// ---------------------------------------------------------------------------
// Report to admin
// ---------------------------------------------------------------------------

export async function reportMessage(teamId: string, messageTable: 'team_messages' | 'direct_messages', messageId: string, reason: string): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const reporterId = userData.user?.id;
  if (!reporterId) return 'Not signed in.';
  const { error } = await supabase.from('message_reports').insert({ team_id: teamId, message_table: messageTable, message_id: messageId, reporter_id: reporterId, reason });
  return error ? error.message : null;
}

// ---------------------------------------------------------------------------
// System bot — automated messages only (welcome/task notices), no command parsing.
// ---------------------------------------------------------------------------

/** team_messages rows with a null sender_id are system-bot messages — see system_post_message
 *  in migration 0063_system_bot.sql for why this is a null sentinel rather than a synthetic user. */

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

export function parseMentions(body: string, members: { user_id: string | null; profile?: { name: string } | null; invited_email: string }[]): string[] {
  const matches = body.match(/@[\w.-]+/g) || [];
  const ids = new Set<string>();
  for (const raw of matches) {
    const handle = raw.slice(1).toLowerCase();
    const hit = members.find(m => {
      const name = (m.profile?.name || m.invited_email || '').toLowerCase().replace(/\s+/g, '');
      return name && (name === handle || name.startsWith(handle));
    });
    if (hit?.user_id) ids.add(hit.user_id);
  }
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Typing indicator (ephemeral, Realtime Broadcast — no table)
// ---------------------------------------------------------------------------

export function subscribeToTyping(teamId: string, onTyping: (userId: string, name: string) => void) {
  const channel = supabase.channel(`typing:${teamId}`);
  channel.on('broadcast', { event: 'typing' }, ({ payload }) => onTyping(payload.userId, payload.name));
  channel.subscribe();
  return {
    notifyTyping: (userId: string, name: string) => channel.send({ type: 'broadcast', event: 'typing', payload: { userId, name } }),
    unsubscribe: () => { supabase.removeChannel(channel); },
  };
}

// ---------------------------------------------------------------------------
// Read state (team chat unread badge)
// ---------------------------------------------------------------------------

export async function markTeamChatRead(teamId: string, lastMessageId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;
  await supabase.from('team_chat_read_state').upsert({ team_id: teamId, user_id: userId, last_read_message_id: lastMessageId, updated_at: new Date().toISOString() });
}

export async function getTeamChatUnreadCount(teamId: string): Promise<number> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 0;
  const { data: state } = await supabase.from('team_chat_read_state').select('last_read_message_id, updated_at').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  let query = supabase.from('team_messages').select('id', { count: 'exact', head: true }).eq('team_id', teamId).neq('sender_id', userId);
  if (state?.updated_at) query = query.gt('created_at', state.updated_at);
  const { count } = await query;
  return count ?? 0;
}
