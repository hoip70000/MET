import { useEffect, useRef, useState } from 'react';
import { PanelRightOpen, GripHorizontal } from 'lucide-react';
import { IconButton } from '../ui';
import { TyperPanel, type TyperPanelProps } from './TyperPanel';

interface FloatPos { x: number; y: number }

interface TyperFloatingWindowProps {
  pos: FloatPos;
  onPosChange: (pos: FloatPos) => void;
  onDock: () => void;
  /** The exact same prop bag Studio.tsx builds for the docked <TyperPanel> — reused unforked, so
   *  typerIndex/typerArmed/etc. (which live in Studio.tsx regardless of floating vs docked) are
   *  never duplicated across two mounted TyperPanel instances. */
  typerProps: Omit<TyperPanelProps, 'onPopOut'>;
}

/**
 * TypeR's own detached, freely-draggable window — the first floating panel anywhere in this app
 * (there is no general floating-panel system; this is deliberately scoped to TypeR, not a new
 * generic system nobody else needs yet). No Esc/click-outside dismissal: this is a persistent
 * workspace element, not a transient popup like ToolFlyout/AppContextMenu.
 *
 * The title strip carries no "TypeR" label of its own — TyperPanel's own StudioPanel header
 * already shows one, and a second label directly above it would just be visual noise. It's still
 * fully draggable everywhere except the dock-back button itself.
 */
export function TyperFloatingWindow({ pos, onPosChange, onDock, typerProps }: TyperFloatingWindowProps) {
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [liveOffset, setLiveOffset] = useState({ dx: 0, dy: 0 });

  function startDrag(e: React.MouseEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      setLiveOffset({ dx: e.clientX - d.startX, dy: e.clientY - d.startY });
    }
    function onMouseUp(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      const rawX = d.originX + (e.clientX - d.startX);
      const rawY = d.originY + (e.clientY - d.startY);
      // Clamp on drag-end, not continuously — a title-bar-only drag doesn't need per-pixel
      // clamping, just to never leave the window fully unreachable off-screen.
      const clampedX = Math.min(Math.max(rawX, 0), window.innerWidth - 40);
      const clampedY = Math.min(Math.max(rawY, 0), window.innerHeight - 40);
      setLiveOffset({ dx: 0, dy: 0 });
      onPosChange({ x: clampedX, y: clampedY });
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [pos, onPosChange]);

  return (
    <div
      className="fixed z-50 w-80 max-h-[80vh] flex flex-col rounded-panel border border-hairline liquid-glass-heavy shadow-2xl overflow-hidden"
      style={{ left: pos.x + liveOffset.dx, top: pos.y + liveOffset.dy }}
    >
      <div
        data-testid="typer-float-strip"
        onMouseDown={startDrag}
        className="flex items-center justify-between gap-2 px-2 h-6 shrink-0 border-b border-hairline/70 cursor-move select-none"
      >
        <GripHorizontal size={13} className="text-ink-faint" />
        <IconButton size="sm" aria-label="Dock TypeR back into the panel" title="Dock back into panel" onClick={onDock} className="!bg-transparent !w-5 !h-5">
          <PanelRightOpen size={12} />
        </IconButton>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <TyperPanel {...typerProps} />
      </div>
    </div>
  );
}
