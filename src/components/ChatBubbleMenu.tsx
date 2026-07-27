import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, CornerUpLeft, Pencil, Trash2, Pin, PinOff, Flag } from 'lucide-react';

export interface ChatBubbleMenuAction {
  key: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

const LONG_PRESS_MS = 350;

/** Wraps a chat bubble so a long-press (touch) or right-click (desktop) opens a small themed
 *  menu instead of the row of always-visible hover buttons the bubble used to render inline —
 *  matches the app's existing long-press/right-click convention for tool flyouts. */
export function useChatBubbleMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ChatBubbleMenuAction[] } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openAt = (x: number, y: number, actions: ChatBubbleMenuAction[]) => setMenu({ x, y, actions });
  const close = () => setMenu(null);

  const bind = (getActions: () => ChatBubbleMenuAction[]) => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      openAt(e.clientX, e.clientY, getActions());
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const { clientX, clientY } = e;
      timerRef.current = setTimeout(() => openAt(clientX, clientY, getActions()), LONG_PRESS_MS);
    },
    onPointerUp: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onPointerLeave: () => { if (timerRef.current) clearTimeout(timerRef.current); },
    onPointerMove: () => { if (timerRef.current) clearTimeout(timerRef.current); },
  });

  const menuElement = menu ? <ChatBubbleMenuPopup x={menu.x} y={menu.y} actions={menu.actions} onClose={close} /> : null;

  return { bind, menuElement };
}

function ChatBubbleMenuPopup({ x, y, actions, onClose }: { x: number; y: number; actions: ChatBubbleMenuAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const clampedX = Math.min(x, window.innerWidth - 180);
  const clampedY = Math.min(y, window.innerHeight - actions.length * 36 - 16);

  return (
    <div
      ref={ref}
      className="fixed z-[200] min-w-[160px] py-1.5 rounded-xl bg-surface border border-hairline shadow-lg animate-modal-in"
      style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}
    >
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
    </div>
  );
}

export const ChatBubbleIcons = { Copy, Reply: CornerUpLeft, Edit: Pencil, Delete: Trash2, Pin, PinOff, Report: Flag };
