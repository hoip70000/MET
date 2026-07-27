import { useEffect, useRef, useState } from 'react';
import { cn } from '../../ui/cn';
import { Menu } from './Menu';
import type { MenuDef } from './menuDefinitions';

interface MenuBarProps {
  menus: MenuDef[];
}

export function MenuBar({ menus }: MenuBarProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenId(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenId(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openId]);

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
