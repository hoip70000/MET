import { STUDIO_TOOL_GROUPS } from '../toolGroups';

/** key (lowercase) -> tool id, built from each tool's `shortcut` field so hotkeys stay in sync with the toolbar. */
export function buildToolShortcutMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const group of STUDIO_TOOL_GROUPS) {
    for (const tool of group.tools) {
      if (tool.shortcut && tool.enabled) map[tool.shortcut] = tool.id;
    }
  }
  return map;
}

export const FIXED_SHORTCUTS_HELP: { keys: string; description: string }[] = [
  { keys: '[ / ]', description: 'Decrease / increase brush size' },
  { keys: 'X', description: 'Swap foreground / background color' },
  { keys: 'D', description: 'Reset to default colors (black / white)' },
  { keys: 'O', description: 'Toggle Original / Cleaned view' },
  { keys: 'Tab', description: 'Hide / show all panels' },
  { keys: 'Ctrl/Cmd+Shift+F', description: 'Toggle fullscreen' },
  { keys: 'Ctrl/Cmd+E', description: 'Export page' },
  { keys: 'Ctrl/Cmd+G', description: 'Group selected layers' },
  { keys: 'Ctrl/Cmd+Shift+G', description: 'Ungroup layers' },
  { keys: 'Space (hold) + drag', description: 'Pan the canvas, regardless of active tool' },
  { keys: 'Middle-mouse drag', description: 'Pan the canvas, regardless of active tool' },
  { keys: 'Ctrl/Cmd+Z', description: 'Undo' },
  { keys: 'Ctrl/Cmd+Shift+Z', description: 'Redo' },
  { keys: 'Ctrl/Cmd+=', description: 'Zoom in' },
  { keys: 'Ctrl/Cmd+-', description: 'Zoom out' },
  { keys: 'Ctrl/Cmd+0', description: 'Fit to screen' },
  { keys: 'Ctrl/Cmd+1', description: 'Actual size (100%)' },
  { keys: 'Ctrl/Cmd+.', description: 'Increase active text layer size (re-centers)' },
  { keys: 'Ctrl/Cmd+,', description: 'Decrease active text layer size (re-centers)' },
  { keys: 'Ctrl/Cmd+X / C / V', description: 'Cut / copy / paste the active layer' },
  { keys: 'Ctrl/Cmd+F', description: 'Find & Replace (opens Translation panel)' },
  { keys: 'Ctrl/Cmd+B / I', description: 'Bold / italic the active text layer or selection' },
  { keys: 'Ctrl/Cmd+R', description: 'Toggle rulers' },
  { keys: "Ctrl/Cmd+'", description: 'Toggle grid' },
  { keys: 'Ctrl/Cmd+Shift+N', description: 'New layer' },
  { keys: 'Ctrl/Cmd+Shift+E', description: 'Merge visible layers' },
];
