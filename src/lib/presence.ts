import { supabase } from './supabaseClient';

/** Realtime Presence — no DB table, entirely ephemeral on Supabase's Realtime server, mirroring
 *  the existing `subscribeToTyping`/`notifyTyping` broadcast-channel pattern in chat.ts. Two
 *  scopes: a per-team channel for "N users active" in team chat, and a single global channel
 *  (keyed by user_id) for the DM green-dot, since presence there needs to work across teams. */

const GLOBAL_PRESENCE_CHANNEL = 'presence:online';

function teamPresenceChannelName(teamId: string): string {
  return `presence:${teamId}`;
}

export function subscribeToTeamPresence(teamId: string, userId: string, onChange: (onlineUserIds: string[]) => void): () => void {
  const channel = supabase.channel(teamPresenceChannelName(teamId), { config: { presence: { key: userId } } });
  channel
    .on('presence', { event: 'sync' }, () => {
      onChange(Object.keys(channel.presenceState()));
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });
  return () => { supabase.removeChannel(channel); };
}

export function subscribeToGlobalPresence(userId: string, onChange: (onlineUserIds: string[]) => void): () => void {
  const channel = supabase.channel(GLOBAL_PRESENCE_CHANNEL, { config: { presence: { key: userId } } });
  channel
    .on('presence', { event: 'sync' }, () => {
      onChange(Object.keys(channel.presenceState()));
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });
  return () => { supabase.removeChannel(channel); };
}
