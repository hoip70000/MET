import { Plus } from 'lucide-react';
import { NAV_TABS, type NavTabId } from '../config/navTabs';

interface SidebarRailProps {
  activeTab: NavTabId;
  onTabChange: (id: NavTabId) => void;
  onCreatePress: () => void;
}

export function SidebarRail({ activeTab, onTabChange, onCreatePress }: SidebarRailProps) {
  return (
    <div className="liquid-glass-bar hidden lg:flex fixed left-0 top-14 sm:top-16 bottom-0 z-30 w-20 flex-col items-center gap-2 py-6 border-r border-hairline">
      <button
        type="button"
        onClick={onCreatePress}
        className="w-11 h-11 mb-4 bg-accent rounded-full flex items-center justify-center shadow-[0_6px_20px_color-mix(in_srgb,var(--color-accent)_55%,transparent)] text-white hover:scale-105 active:scale-95 transition-all"
        aria-label="Create"
      >
        <Plus size={20} strokeWidth={2.4} />
      </button>

      <div className="flex flex-col items-center gap-1 w-full">
        {NAV_TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center gap-1 w-full py-2.5 transition-colors group ${active ? 'text-accent' : 'text-ink-muted hover:text-ink'}`}
            >
              <div className={`p-2 rounded-xl transition-all ${active ? 'bg-accent-soft' : 'group-hover:bg-ink/8'}`}>
                <Icon size={19} strokeWidth={1.8} />
              </div>
              <span className="text-[10px] font-medium tracking-wide text-center leading-tight px-0.5">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
