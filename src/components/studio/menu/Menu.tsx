import { useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { MenuItemDef } from './menuDefinitions';

interface MenuProps {
  items: MenuItemDef[];
  onItemClick: (action?: () => void) => void;
}

/** Screen-edge margin kept clear once a submenu is nudged back on-screen along its secondary axis. */
const VIEWPORT_MARGIN = 6;

/** The top-level dropdown a menu-bar button opens. Submenus (►) are a separate, recursive popover
 *  rendered inline by MenuItemRow below, since they anchor beside their parent item and edge-flip
 *  left/right instead of always opening below-left. */
export function Menu({ items, onItemClick }: MenuProps) {
  return (
    <div className="absolute top-full left-0 mt-1 z-50 liquid-glass-heavy rounded-panel border border-hairline py-1 min-w-[200px]">
      {items.map(item => <MenuItemRow key={item.id} item={item} onItemClick={onItemClick} />)}
    </div>
  );
}

function MenuItemRow({ item, onItemClick }: { item: MenuItemDef; onItemClick: (action?: () => void) => void }) {
  const [openSide, setOpenSide] = useState<'right' | 'left' | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const hasSubmenu = !!item.submenu;

  // Flips the submenu to the left when it would clip the right edge of the viewport, and nudges it
  // vertically (translate only, never flipping which side it opens on that axis) if it would clip
  // the bottom — the same measure-then-nudge idea ToolFlyout.tsx already uses for its own flyouts.
  useLayoutEffect(() => {
    if (!openSide) return;
    const el = submenuRef.current;
    if (!el) return;
    el.style.transform = '';
    const rect = el.getBoundingClientRect();
    if (openSide === 'right' && rect.right > window.innerWidth - VIEWPORT_MARGIN) {
      setOpenSide('left');
      return;
    }
    let dy = 0;
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) dy = window.innerHeight - VIEWPORT_MARGIN - rect.bottom;
    if (rect.top + dy < VIEWPORT_MARGIN) dy = VIEWPORT_MARGIN - rect.top;
    if (dy) el.style.transform = `translateY(${dy}px)`;
  }, [openSide]);

  if (item.separator) return <div className="h-px bg-hairline my-1 mx-2" />;

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onMouseEnter={() => { if (hasSubmenu && !item.disabled) setOpenSide('right'); }}
      // Moving the pointer onto the submenu itself never fires this — it's a DOM descendant of this
      // wrapper even though it's positioned elsewhere on screen, so mouseleave only fires once the
      // pointer truly leaves the whole row+submenu subtree. No separate close-grace timer needed.
      onMouseLeave={() => setOpenSide(null)}
    >
      <button
        type="button"
        disabled={item.disabled}
        onClick={() => {
          if (hasSubmenu) {
            if (!item.disabled) setOpenSide(v => (v ? null : 'right'));
            return;
          }
          onItemClick(item.action);
        }}
        className={cn(
          'w-full flex items-center justify-between gap-4 px-3 py-1.5 text-ui text-left transition-colors',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
          'text-ink hover:bg-accent-soft hover:text-accent'
        )}
      >
        <span className="flex items-center gap-1.5">
          <Check size={11} className={item.checked ? 'text-accent' : 'invisible'} />
          {item.label}
        </span>
        {hasSubmenu ? (
          <ChevronRight size={12} className="text-ink-faint" />
        ) : (
          item.shortcut && <span className="text-micro text-ink-faint font-mono">{item.shortcut}</span>
        )}
      </button>
      {hasSubmenu && openSide && !item.disabled && (
        <div
          ref={submenuRef}
          className={cn(
            'absolute top-0 z-50 liquid-glass-heavy rounded-panel border border-hairline py-1 min-w-[200px]',
            openSide === 'right' ? 'left-full -mt-1 ml-0.5' : 'right-full -mt-1 mr-0.5'
          )}
        >
          {item.submenu!.map(sub => <MenuItemRow key={sub.id} item={sub} onItemClick={onItemClick} />)}
        </div>
      )}
    </div>
  );
}
