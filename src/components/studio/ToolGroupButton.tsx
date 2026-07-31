import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../ui';
import { cn } from '../ui/cn';
import { ToolFlyout } from './ToolFlyout';
import type { StudioToolGroup } from './toolGroups';

interface ToolGroupButtonProps {
  group: StudioToolGroup;
  activeTool: string;
  onToolChange: (id: string) => void;
  orientation: 'vertical' | 'horizontal';
}

const HOLD_MS = 350;

export function ToolGroupButton({ group, activeTool, onToolChange, orientation }: ToolGroupButtonProps) {
  const [remembered, setRemembered] = useState(group.tools[0].id);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeInGroup = group.tools.find(t => t.id === activeTool);
  const shown = activeInGroup ?? group.tools.find(t => t.id === remembered) ?? group.tools[0];
  const Icon = shown.icon;
  const hasSiblings = group.tools.length > 1;

  function pick(id: string) {
    setRemembered(id);
    onToolChange(id);
  }

  // Picking a tool outside this group (keyboard shortcut, or another group's own icon/flyout)
  // must close this flyout too — it's otherwise local state with nothing else telling it to.
  useEffect(() => {
    if (!group.tools.some(t => t.id === activeTool)) setFlyoutOpen(false);
  }, [activeTool, group.tools]);

  function startHold() {
    if (!hasSiblings) return;
    holdTimer.current = setTimeout(() => setFlyoutOpen(true), HOLD_MS);
  }
  function cancelHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }

  return (
    <div className="relative contents">
      <div className="relative">
        <IconButton
          size={orientation === 'horizontal' ? 'lg' : 'sm'}
          active={!!activeInGroup}
          disabled={!shown.enabled}
          aria-label={shown.enabled ? shown.label : `${shown.label} (coming soon)`}
          title={shown.enabled ? `${shown.label}${shown.shortcut ? ` (${shown.shortcut.toUpperCase()})` : ''}` : `${shown.label} — coming soon`}
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onClick={() => pick(shown.id)}
          onContextMenu={(e) => { e.preventDefault(); if (hasSiblings) setFlyoutOpen(true); }}
          className={cn(
            'studio-interactive studio-focusable shrink-0 !rounded-control',
            // Only force a transparent background when idle. Passing !bg-transparent
            // unconditionally (as this used to) overrode IconButton's `bg-accent-soft`
            // active fill, leaving the selected tool with almost no visible state.
            activeInGroup
              ? '!bg-accent-soft !border-accent/40 !text-accent shadow-control'
              : '!bg-transparent hover:!bg-ink/10'
          )}
        >
          <Icon size={16} strokeWidth={1.75} />
        </IconButton>
        {hasSiblings && (
          <span
            onClick={(e) => { e.stopPropagation(); setFlyoutOpen(v => !v); }}
            aria-hidden
            className="absolute bottom-0.5 right-0.5 w-0 h-0 border-solid cursor-pointer"
            style={{ borderWidth: '0 0 4px 4px', borderColor: `transparent transparent ${activeInGroup ? 'var(--color-accent)' : 'var(--color-ink-faint)'} transparent` }}
          />
        )}
        {flyoutOpen && (
          <ToolFlyout
            tools={group.tools}
            activeTool={activeTool}
            orientation={orientation}
            onPick={pick}
            onClose={() => setFlyoutOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
