import { Settings, Users, CloudCog, LayoutGrid, FileText, type LucideIcon } from 'lucide-react';

export type NavTabId = 'settings' | 'teams' | 'cloud' | 'library' | 'text-editor';

export interface NavTab {
  id: NavTabId;
  label: string;
  icon: LucideIcon;
}

export const NAV_TABS: NavTab[] = [
  { id: 'library', label: 'Library', icon: LayoutGrid },
  { id: 'text-editor', label: 'Text Editor', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'cloud', label: 'Cloud', icon: CloudCog },
];
