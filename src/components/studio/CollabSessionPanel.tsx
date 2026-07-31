import { useState } from 'react';
import { Send, Crown } from 'lucide-react';
import { StudioPanel } from './StudioPanel';
import type { StudioCollabPeer } from '../../lib/studioCollab';

export interface CollabChatMessage {
  userId: string;
  name: string;
  text: string;
  at: number;
}

interface CollabSessionPanelProps {
  peers: StudioCollabPeer[];
  messages: CollabChatMessage[];
  selfUserId: string;
  onSend: (text: string) => void;
  hideTitle?: boolean;
}

/**
 * Roster + chat for a live collaborative Studio session. Chat is broadcast-only/ephemeral (no
 * table, mirrors chat.ts's typing-indicator broadcast) — it exists for participants watching
 * live, not as a record to read back later, so `messages` is whatever this mount has seen since
 * it joined the channel.
 */
export function CollabSessionPanel({ peers, messages, selfUserId, onSend, hideTitle }: CollabSessionPanelProps) {
  const [draft, setDraft] = useState('');

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  }

  return (
    <StudioPanel title="Live Session" hideTitle={hideTitle} bare>
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-hairline/70 overflow-x-auto shrink-0">
          {peers.length === 0 && <span className="text-micro text-ink-faint">No one else here yet</span>}
          {peers.map((p) => (
            <span
              key={p.userId}
              className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-full bg-ink/5 border border-hairline text-micro text-ink"
              title={p.isHost ? `${p.name} (host)` : p.name}
            >
              {p.isHost && <Crown size={10} className="text-accent" />}
              {p.name}
            </span>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
          {messages.length === 0 && (
            <p className="text-micro text-ink-faint text-center mt-4">No messages yet — say hi.</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.userId === selfUserId ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] text-ink-faint">{m.name}</span>
              <span className="text-ui text-ink bg-ink/5 border border-hairline rounded-control px-2 py-1 max-w-[85%] break-words">
                {m.text}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 p-2 border-t border-hairline/70 shrink-0">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="Message the session…"
            className="flex-1 min-w-0 bg-ink/5 border border-hairline rounded-control px-2.5 min-h-9 text-ui text-ink"
          />
          <button
            type="button"
            aria-label="Send message"
            onClick={submit}
            disabled={!draft.trim()}
            className="studio-interactive studio-focusable shrink-0 w-9 h-9 flex items-center justify-center rounded-control bg-accent-soft text-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </StudioPanel>
  );
}
