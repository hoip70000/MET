import type { ReactNode } from 'react';
import { cn } from '../ui/cn';

interface StudioPanelProps {
  title: string;
  /** Header-right controls (icon buttons). Kept compact — the dock owns float/close. */
  actions?: ReactNode;
  children: ReactNode;
  /** Extra classes for the scrollable body. Defaults to standard padding + column gap. */
  bodyClassName?: string;
  /** Opt out of the default body padding/scroll for panels that manage their own (e.g. lists). */
  bare?: boolean;
  /** Hides just the title text — for when an outer wrapper (CollapsiblePanel, in the right-column
   *  panel stack) already shows the panel's name in its own header, so this one doesn't repeat it.
   *  The header row itself still renders if there are `actions` to show; otherwise it's skipped
   *  entirely rather than leaving a blank strip. */
  hideTitle?: boolean;
}

/**
 * Unified chrome for every docked Studio panel: a fixed-height header with a
 * title and optional actions, plus a scrollable body. Replaces the identical
 * header markup that was copy-pasted across ~11 panels (Layers, Text, Color,
 * TypeR, Fonts, History, Adjustment, Translation…), which is where most of the
 * Studio's inconsistent paddings/type sizes came from.
 *
 * Note this renders no border of its own — the dock region already draws the
 * edge, and stacking both was the source of the double-border seams.
 */
export function StudioPanel({ title, actions, children, bodyClassName, bare, hideTitle }: StudioPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {(!hideTitle || actions) && (
        <div className="flex items-center justify-between gap-2 px-3 h-10 shrink-0 border-b border-hairline/70">
          {!hideTitle && (
            <span className="text-micro font-display font-semibold text-ink-faint uppercase tracking-wider truncate">
              {title}
            </span>
          )}
          {actions && <div className="flex items-center gap-0.5 shrink-0">{actions}</div>}
        </div>
      )}
      <div
        className={cn(
          'flex-1 min-h-0 overflow-y-auto',
          !bare && 'px-3 py-3 flex flex-col gap-3',
          bodyClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
