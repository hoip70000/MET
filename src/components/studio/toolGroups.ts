import type { LucideIcon } from 'lucide-react';
import {
  MousePointer2, Hand, Square, Circle, Rows, Columns, Lasso, Spline, Wand2,
  Crop, Scissors, Pipette, Bandage, Stamp, Sparkles, Paintbrush, Pencil, Eraser,
  Blend, PaintBucket, Droplets, SunDim, Sun, Flame, Waves, PenTool, Type,
  ZoomIn, Minus, Wind, MousePointerClick, Pointer,
} from 'lucide-react';

export interface StudioToolDef {
  id: string;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  /** Single-key hotkey, matching Photoshop conventions where practical. */
  shortcut?: string;
}

export interface StudioToolGroup {
  id: string;
  /** First entry is the group's default/remembered tool. */
  tools: StudioToolDef[];
  groupStart?: boolean;
}

export const STUDIO_TOOL_GROUPS: StudioToolGroup[] = [
  { id: 'move', tools: [{ id: 'select', label: 'Move', icon: MousePointer2, enabled: true, shortcut: 'v' }] },
  { id: 'hand', tools: [{ id: 'pan', label: 'Hand', icon: Hand, enabled: true, shortcut: 'h' }] },

  {
    id: 'marquee', groupStart: true,
    tools: [
      { id: 'marquee-rect', label: 'Rectangular Marquee', icon: Square, enabled: true, shortcut: 'm' },
      { id: 'marquee-ellipse', label: 'Elliptical Marquee', icon: Circle, enabled: true },
      { id: 'marquee-row', label: 'Single Row Marquee', icon: Rows, enabled: true },
      { id: 'marquee-col', label: 'Single Column Marquee', icon: Columns, enabled: true },
    ],
  },
  {
    id: 'lasso',
    tools: [
      { id: 'lasso-freehand', label: 'Lasso', icon: Lasso, enabled: true, shortcut: 'l' },
      { id: 'lasso-polygon', label: 'Polygonal Lasso', icon: Spline, enabled: true },
      { id: 'lasso-magnetic', label: 'Magnetic Lasso', icon: Spline, enabled: true },
    ],
  },
  {
    id: 'wand',
    tools: [
      { id: 'wand', label: 'Magic Wand', icon: Wand2, enabled: true, shortcut: 'w' },
    ],
  },

  {
    id: 'crop', groupStart: true,
    tools: [
      { id: 'crop', label: 'Crop', icon: Crop, enabled: true, shortcut: 'c' },
      { id: 'slice', label: 'Slice', icon: Scissors, enabled: true },
    ],
  },
  { id: 'eyedropper', tools: [{ id: 'eyedropper', label: 'Eyedropper', icon: Pipette, enabled: true, shortcut: 'i' }] },

  {
    id: 'healing', groupStart: true,
    tools: [
      { id: 'spot-heal', label: 'Spot Healing Brush', icon: Bandage, enabled: true },
      { id: 'heal', label: 'Healing Brush', icon: Bandage, enabled: true },
      { id: 'patch', label: 'Patch Tool', icon: Sparkles, enabled: true },
      { id: 'contentAware', label: 'Content-Aware Fill', icon: Sparkles, enabled: true },
    ],
  },
  { id: 'clone', tools: [{ id: 'clone', label: 'Clone Stamp', icon: Stamp, enabled: true, shortcut: 's' }] },

  {
    id: 'brush', groupStart: true,
    tools: [
      { id: 'brush', label: 'Brush', icon: Paintbrush, enabled: true, shortcut: 'b' },
      { id: 'pencil', label: 'Pencil', icon: Pencil, enabled: true },
    ],
  },
  { id: 'eraser', tools: [{ id: 'eraser', label: 'Eraser', icon: Eraser, enabled: true, shortcut: 'e' }] },
  {
    id: 'gradient',
    tools: [
      { id: 'gradient', label: 'Gradient', icon: Blend, enabled: true, shortcut: 'g' },
      { id: 'bucket', label: 'Paint Bucket', icon: PaintBucket, enabled: true },
    ],
  },
  {
    id: 'filters',
    tools: [
      { id: 'blur', label: 'Blur', icon: Droplets, enabled: true },
      { id: 'sharpen', label: 'Sharpen', icon: Sparkles, enabled: true },
      { id: 'smudge', label: 'Smudge', icon: Waves, enabled: true },
    ],
  },
  {
    id: 'tone',
    tools: [
      { id: 'dodge', label: 'Dodge', icon: Sun, enabled: true },
      { id: 'burn', label: 'Burn', icon: Flame, enabled: true },
      { id: 'sponge', label: 'Sponge', icon: SunDim, enabled: true },
    ],
  },
  { id: 'liquify', tools: [{ id: 'liquify', label: 'Liquify', icon: Wind, enabled: true }] },
  // Paints a scratch mask (reuses Quick Mask's paint-any-tool-onto-an-alpha-buffer machinery — see
  // Studio.tsx) rather than owning a separate one; picking this tool is just a labeled shortcut into
  // that same mechanism, tuned for marking an area to send to Magic Erase instead of a selection.
  { id: 'magic-erase', tools: [{ id: 'magic-erase', label: 'Magic Erase', icon: Sparkles, enabled: true }] },

  {
    id: 'pen', groupStart: true,
    tools: [
      { id: 'pen', label: 'Pen', icon: PenTool, enabled: true, shortcut: 'p' },
      { id: 'curvature-pen', label: 'Curvature Pen', icon: PenTool, enabled: true },
      { id: 'path-select', label: 'Path Selection', icon: MousePointerClick, enabled: true },
      { id: 'direct-select', label: 'Direct Selection', icon: Pointer, enabled: true },
    ],
  },
  {
    id: 'shape',
    tools: [
      { id: 'shape-rect', label: 'Rectangle', icon: Square, enabled: true, shortcut: 'u' },
      { id: 'shape-ellipse', label: 'Ellipse', icon: Circle, enabled: true },
      { id: 'shape-line', label: 'Line', icon: Minus, enabled: true },
    ],
  },
  { id: 'type', tools: [{ id: 'text', label: 'Text', icon: Type, enabled: true, shortcut: 't' }] },

  { id: 'zoom', groupStart: true, tools: [{ id: 'zoom', label: 'Zoom', icon: ZoomIn, enabled: true, shortcut: 'z' }] },
];

export function findTool(id: string): StudioToolDef | undefined {
  for (const group of STUDIO_TOOL_GROUPS) {
    const tool = group.tools.find(t => t.id === id);
    if (tool) return tool;
  }
  return undefined;
}
