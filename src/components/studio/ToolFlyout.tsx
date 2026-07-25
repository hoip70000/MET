import { useEffect, useLayoutEffect, useRef } from 'react';
import { IconButton } from '../ui';
import { cn } from '../ui/cn';
import type { StudioToolDef } from './toolGroups';

interface ToolFlyoutProps {
  tools: StudioToolDef[];
  activeTool: string;
  orientation: 'vertical' | 'horizontal';
  onPick: (id: string) => void;
  onClose: () => void;
}

/** Screen-edge margin kept clear on every side once the flyout is nudged back into the viewport. */
const VIEWPORT_MARGIN = 6;

export function ToolFlyout({ tools, activeTool, orientation, onPick, onClose }: ToolFlyoutProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const isVertical = orientation === 'vertical';

  // Viewport clamping: the flyout is CSS-positioned (left-full/bottom-full) relative to its own
  // icon, which keeps it correctly on the required side of the rail (right of vertical, above
  // horizontal) but doesn't know about the screen edges. Measure the *actual* rendered rect (real
  // Tailwind-computed layout, not a hand-estimated one that could silently drift from the classes
  // above) and nudge it back on-screen along the *other* axis only — it must never flip which side
  // it opens on.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    const rect = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (isVertical) {
      if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) dy = window.innerHeight - VIEWPORT_MARGIN - rect.bottom;
      if (rect.top + dy < VIEWPORT_MARGIN) dy = VIEWPORT_MARGIN - rect.top;
    } else {
      if (rect.right > window.innerWidth - VIEWPORT_MARGIN) dx = window.innerWidth - VIEWPORT_MARGIN - rect.right;
      if (rect.left + dx < VIEWPORT_MARGIN) dx = VIEWPORT_MARGIN - rect.left;
    }
    if (dx || dy) el.style.transform = `translate(${dx}px, ${dy}px)`;
  }, [isVertical, tools.length]);

  return (
    <div
      ref={ref}
      className={cn(
        'absolute z-50 liquid-glass-heavy rounded-panel border border-hairline p-1 flex gap-0.5',
        isVertical ? 'left-full top-0 ml-1.5 flex-col' : 'bottom-full left-0 mb-1.5 flex-row'
      )}
    >
      {tools.map(tool => {
        const Icon = tool.icon;
        return (
          <IconButton
            key={tool.id}
            size="sm"
            active={activeTool === tool.id}
            disabled={!tool.enabled}
            aria-label={tool.enabled ? tool.label : `${tool.label} (coming soon)`}
            title={tool.enabled ? `${tool.label}${tool.shortcut ? ` (${tool.shortcut.toUpperCase()})` : ''}` : `${tool.label} — coming soon`}
            onClick={() => { onPick(tool.id); onClose(); }}
            className="!bg-transparent shrink-0"
          >
            <Icon size={16} />
          </IconButton>
        );
      })}
    </div>
  );
}
