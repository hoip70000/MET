import { Settings, Users, CloudCog, LayoutGrid, type LucideIcon } from 'lucide-react';

// 'text-editor' stays a valid navigable value (App.tsx still renders it, reached only from a
// button inside Studio now — see StudioToolbar's Text Editor button) — it's just no longer a
// top-level destination a user can click into from the nav rail/bottom bar directly.
export type NavTabId = 'settings' | 'teams' | 'cloud' | 'library' | 'text-editor';

export interface NavTab {
  id: NavTabId;
  label: string;
  icon: LucideIcon;
}

export const NAV_TABS: NavTab[] = [
  { id: 'library', label: 'Library', icon: LayoutGrid },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'cloud', label: 'Cloud', icon: CloudCog },
];
