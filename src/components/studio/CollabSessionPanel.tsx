import { useState } from 'react';
import { Send, Crown, Mic, MicOff, PhoneOff, Volume2, MousePointer2, MousePointerClick } from 'lucide-react';
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
  /** `tts` asks the host's device specifically to read this message aloud — see Studio.tsx's
   *  onChat wiring, the only place that actually speaks it. */
  onSend: (text: string, tts: boolean) => void;
  /** Participants (by userId) whose mic volume is currently above the speaking threshold — pulses
   *  their roster avatar. Includes the local user when they're the one talking. */
  speakingUserIds: Set<string>;
  voiceJoined: boolean;
  voiceMuted: boolean;
  onToggleVoiceJoined: () => void;
  onToggleVoiceMuted: () => void;
  /** Remote control (StudioCanvasHandle.dispatchRemotePointerEvent). `isHost` is this mount's own
   *  role — a host sees a "take back control" affordance instead of "request control". */
  isHost: boolean;
  controlGrantedTo: string | null;
  onRequestControl: () => void;
  onRevokeControl: () => void;
  hideTitle?: boolean;
}

/** Small circular avatar (initial letter, no photo support — matches the collab roster's identity
 *  being name-only) with a pulsing ring while `speaking` is true. */
function PeerAvatar({ name, speaking }: { name: string; speaking: boolean }) {
  return (
    <span className="relative shrink-0">
      {speaking && <span className="absolute -inset-0.5 rounded-full bg-success/60 animate-ping" />}
      <span
        className={`relative w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white ${
          speaking ? 'bg-success ring-2 ring-success/40' : 'bg-accent/70'
        }`}
      >
        {(name || '?')[0]?.toUpperCase()}
      </span>
    </span>
  );
}

/**
 * Roster + chat + mic voice chat + remote control for a live collaborative Studio session. Chat
 * is broadcast-only/ephemeral (no table, mirrors chat.ts's typing-indicator broadcast) — it exists
 * for participants watching live, not as a record to read back later, so `messages` is whatever
 * this mount has seen since it joined the channel. Voice is a separate opt-in
 * (useStudioVoiceChat.ts's WebRTC mesh) — joining the session never requests mic access on its own.
 */
export function CollabSessionPanel({
  peers, messages, selfUserId, onSend, speakingUserIds, voiceJoined, voiceMuted, onToggleVoiceJoined, onToggleVoiceMuted,
  isHost, controlGrantedTo, onRequestControl, onRevokeControl, hideTitle,
}: CollabSessionPanelProps) {
  const [draft, setDraft] = useState('');
  const [ttsOnSend, setTtsOnSend] = useState(false);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text, ttsOnSend);
    setDraft('');
  }

  const iHaveControl = controlGrantedTo === selfUserId;
  const controllerName = controlGrantedTo ? peers.find(p => p.userId === controlGrantedTo)?.name ?? 'Someone' : null;

  return (
    <StudioPanel title="Live Session" hideTitle={hideTitle} bare>
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-hairline/70 overflow-x-auto shrink-0">
          {peers.length === 0 && <span className="text-micro text-ink-faint">No one else here yet</span>}
          {peers.map((p) => (
            <span
              key={p.userId}
              className="flex items-center gap-1 shrink-0 pl-1 pr-2 py-1 rounded-full bg-ink/5 border border-hairline text-micro text-ink"
              title={p.isHost ? `${p.name} (host)` : p.name}
            >
              <PeerAvatar name={p.name} speaking={speakingUserIds.has(p.userId)} />
              {p.isHost && <Crown size={10} className="text-accent" />}
              {p.userId === controlGrantedTo && <MousePointerClick size={10} className="text-success" />}
              {p.name}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline/70 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={onToggleVoiceJoined}
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded-control text-micro font-medium transition-colors ${
              voiceJoined ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-accent-soft text-accent hover:bg-accent/20'
            }`}
          >
            {voiceJoined ? <><PhoneOff size={12} /> Leave Voice</> : <><Mic size={12} /> Join Voice</>}
          </button>
          {voiceJoined && (
            <button
              type="button"
              aria-label={voiceMuted ? 'Unmute microphone' : 'Mute microphone'}
              onClick={onToggleVoiceMuted}
              className={`w-7 h-7 flex items-center justify-center rounded-control transition-colors ${
                voiceMuted ? 'bg-ink/10 text-ink-faint' : 'bg-success/15 text-success'
              }`}
            >
              {voiceMuted ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
          )}

          {/* Remote control: a viewer asks, the host approves/denies via a confirm prompt
              (Studio.tsx's onControlRequest) — this button only ever sends the request. */}
          {!isHost && !iHaveControl && (
            <button
              type="button"
              onClick={onRequestControl}
              disabled={!!controlGrantedTo}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-control text-micro font-medium bg-ink/5 text-ink hover:bg-ink/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={controlGrantedTo ? `${controllerName} is currently in control` : 'Ask the host for control'}
            >
              <MousePointer2 size={12} /> Request Control
            </button>
          )}
          {!isHost && iHaveControl && (
            <span className="flex items-center gap-1.5 h-7 px-2.5 rounded-control text-micro font-medium bg-success/15 text-success">
              <MousePointer2 size={12} /> You're in control
            </span>
          )}
          {isHost && controlGrantedTo && (
            <button
              type="button"
              onClick={onRevokeControl}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-control text-micro font-medium bg-danger/15 text-danger hover:bg-danger/25 transition-colors"
            >
              <MousePointer2 size={12} /> Take back control ({controllerName})
            </button>
          )}
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

        <label className="flex items-center gap-1.5 px-3 pt-1 shrink-0 text-micro text-ink-faint">
          <input type="checkbox" checked={ttsOnSend} onChange={(e) => setTtsOnSend(e.target.checked)} />
          <Volume2 size={11} /> Read aloud on host's device
        </label>

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
