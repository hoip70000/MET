import { useEffect, useRef, useState } from 'react';
import { MenuIcon } from 'lucide-react';
import { cn } from '../../ui/cn';
import { Menu } from './Menu';
import type { MenuDef } from './menuDefinitions';

interface MenuBarProps {
  menus: MenuDef[];
  /** Phone layout: collapses the inline menu row into a single trigger that opens a vertical
   *  list of menus instead — the row itself has no room to lay out ten labels, and this avoids
   *  the horizontal-scroll approach entirely (see the overflow-x/overflow-y coercion bug this
   *  bar already had once, still documented at its call site in Studio.tsx). */
  compact?: boolean;
}

export function MenuBar({ menus, compact = false }: MenuBarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId && !mobileOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenId(null);
        setMobileOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenId(null);
        setMobileOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openId, mobileOpen]);

  if (compact) {
    return (
      <div ref={ref} className="liquid-glass-bar relative flex items-center px-1 h-8 shrink-0 border-b border-hairline">
        <button
          aria-label="Menu"
          onClick={() => { setMobileOpen(v => !v); setOpenId(null); }}
          className={cn(
            'min-w-11 h-8 flex items-center justify-center rounded-control transition-colors',
            mobileOpen ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink hover:bg-ink/5'
          )}
        >
          <MenuIcon size={18} />
        </button>
        {mobileOpen && (
          <div className="absolute top-full left-1 mt-1 z-50 liquid-glass-heavy rounded-panel border border-hairline py-1 min-w-[12rem] max-h-[70vh] overflow-y-auto">
            {menus.map(menu => (
              <div key={menu.id} className="relative">
                <button
                  onClick={() => setOpenId(v => v === menu.id ? null : menu.id)}
                  className={cn(
                    'w-full text-left px-3 min-h-11 flex items-center text-ui font-medium transition-colors',
                    openId === menu.id ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-ink/5'
                  )}
                >
                  {menu.label}
                </button>
                {openId === menu.id && (
                  <Menu items={menu.items} onItemClick={(action) => { action?.(); setOpenId(null); setMobileOpen(false); }} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="liquid-glass-bar flex items-center gap-0.5 px-2 h-8 shrink-0 border-b border-hairline">
      {menus.map(menu => (
        <div key={menu.id} className="relative">
          <button
            onClick={() => setOpenId(v => v === menu.id ? null : menu.id)}
            onMouseEnter={() => { if (openId) setOpenId(menu.id); }}
            className={cn(
              'px-2.5 h-6 rounded-control text-micro font-medium transition-colors',
              openId === menu.id ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink hover:bg-ink/5'
            )}
          >
            {menu.label}
          </button>
          {openId === menu.id && (
            <Menu items={menu.items} onItemClick={(action) => { action?.(); setOpenId(null); }} />
          )}
        </div>
      ))}
    </div>
  );
}
