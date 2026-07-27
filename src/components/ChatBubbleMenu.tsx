import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Copy, CornerUpLeft, Pencil, Trash2, Pin, PinOff, Flag } from 'lucide-react';

export interface ChatBubbleMenuAction {
  key: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

export interface ChatBubbleMenuReaction {
  emoji: string;
  active: boolean;
  onSelect: () => void;
}

const LONG_PRESS_MS = 350;

/** Wraps a chat bubble so a long-press (touch) or right-click (desktop) opens a small themed
 *  menu instead of the row of always-visible hover buttons the bubble used to render inline —
 *  matches the app's existing long-press/right-click convention for tool flyouts. Reacting also
 *  happens from here (a quick-emoji row up top) rather than a separate "+" button on the bubble. */
export function useChatBubbleMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ChatBubbleMenuAction[]; reactions: ChatBubbleMenuReaction[] } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openAt = (x: number, y: number, actions: ChatBubbleMenuAction[], reactions: ChatBubbleMenuReaction[]) => setMenu({ x, y, actions, reactions });
  const close = () => setMenu(null);

  const bind = (getActions: () => ChatBubbleMenuAction[], getReactions: () => ChatBubbleMenuReaction[]) => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      openAt(e.clientX, e.clientY, getActions(), getReactions());
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const { clientX, clientY } = e;
      timerRef.current = setTimeout(() => openAt(clientX, clientY, getActions(), getReactions()), LONG_PRESS_MS);
    },
    onPointerUp: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onPointerLeave: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onPointerMove: () => { if (timerRef.current) clearTimeout(timerRef.current); },
  });

  const menuElement = menu ? (
    <ChatBubbleMenuPopup x={menu.x} y={menu.y} actions={menu.actions} reactions={menu.reactions} onClose={close} />
  ) : null;

  return { bind, menuElement };
}

function ChatBubbleMenuPopup({ x, y, actions, reactions, onClose }: {
  x: number; y: number; actions: ChatBubbleMenuAction[]; reactions: ChatBubbleMenuReaction[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Registering on the next tick avoids the same right-click's own pointerdown/contextmenu
    // event sequence being seen by this listener and closing the menu the instant it opens.
    const raf = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handlePointerDown);
      document.addEventListener('keydown', handleKey);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const rowHeight = 34;
  const reactionRowHeight = reactions.length > 0 ? 44 : 0;
  const clampedX = Math.min(x, window.innerWidth - 188);
  const clampedY = Math.min(y, window.innerHeight - actions.length * rowHeight - reactionRowHeight - 16);

  // Rendered via a portal directly under <body> — this popup uses `position: fixed` positioned
  // from raw viewport coordinates (e.clientX/clientY), but every chat bubble sits inside a
  // GlassCard-style ancestor with `backdrop-filter` set, and backdrop-filter establishes a new
  // containing block for fixed-position descendants (same rule as `transform`) — so rendered
  // inline, this menu would position itself relative to that ancestor's box instead of the
  // viewport, landing in the wrong place depending on where in the page the bubble scrolled to.
  // Modal.tsx already hit this exact class of bug and portals to document.body for the same
  // reason; this does the same.
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] min-w-[176px] py-1.5 rounded-xl bg-surface border border-hairline shadow-lg animate-modal-in"
      style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}
    >
      {reactions.length > 0 && (
        <div className="flex items-center gap-1 px-2 pb-1.5 mb-1 border-b border-hairline">
          {reactions.map(r => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => { r.onSelect(); onClose(); }}
              className={`text-base w-7 h-7 rounded-lg flex items-center justify-center transition-transform hover:scale-125 ${r.active ? 'bg-accent-soft' : ''}`}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
      {actions.map(a => (
        <button
          key={a.key}
          type="button"
          onClick={() => { a.onSelect(); onClose(); }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-left hover:bg-ink/8 transition-colors ${a.danger ? 'text-danger' : 'text-ink'}`}
        >
          {a.icon} {a.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export const ChatBubbleIcons = { Copy, Reply: CornerUpLeft, Edit: Pencil, Delete: Trash2, Pin, PinOff, Report: Flag };
