import type { LucideIcon } from 'lucide-react';
import { Image as ImageIcon, Type, Eraser, SlidersHorizontal, Folder, PenTool } from 'lucide-react';
import type { Point } from './paint/selection';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
];

/** Maps our blend mode ids to Konva's globalCompositeOperation values. */
export const BLEND_TO_COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
};

export type StudioLayerType = 'background' | 'clean-patch' | 'text' | 'adjustment' | 'group' | 'path';

/** How a click changes the canvas selection: plain click replaces it, Shift/Ctrl-click toggles. */
export type LayerSelectMode = 'replace' | 'toggle';

export const LAYER_TYPE_ICON: Record<StudioLayerType, LucideIcon> = {
  background: ImageIcon,
  'clean-patch': Eraser,
  text: Type,
  adjustment: SlidersHorizontal,
  group: Folder,
  path: PenTool,
};

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export const FONT_FAMILIES = [
  'Anime Ace', 'CC Wild Words', 'Comic Sans MS', 'Arial', 'Georgia', 'Impact',
];

export type TranslationStatus = 'draft' | 'translated' | 'reviewed';

export interface TextShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

/** Linear gradient fill. When enabled it overrides the flat `color` fill. */
export interface TextGradient {
  enabled: boolean;
  from: string;
  to: string;
  /** Degrees clockwise from left-to-right, matching the panel's control. */
  angle: number;
}

/**
 * Character-level overrides for a span of `content`.
 *
 * Runs are contiguous and cover `content` exactly — `sum(run.length) === content.length`. A run
 * with no overrides just renders in the layer's own style, so plain text is one full-length empty
 * run. `textRuns.ts` owns that invariant; don't hand-edit `runs` anywhere else.
 *
 * Only the properties Photoshop treats as *character* properties live here. Stroke, shadow/glow and
 * gradient are layer effects, and align/lineHeight/wrap are paragraph properties — those stay on
 * TextLayerData. This split is also what maps onto ag-psd's `styleRuns` for PSD export.
 */
export interface TextRun {
  length: number;
  fontFamily?: string;
  fontSize?: number;
  /** Falls back to `bold ? 700 : 400`. Families that ship a single weight get browser synthesis. */
  fontWeight?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  /** Tracking within this run (extra px between characters). */
  letterSpacing?: number;
  /**
   * Extra px inserted *before* this run — Photoshop's manual kern, which is applied at a caret
   * position between two characters. A caret position is exactly a run boundary, which is what
   * makes "advance before the run" a faithful model rather than an approximation.
   */
  kerning?: number;
  /** Raises (+) or lowers (-) this run off the baseline. */
  baselineShift?: number;
}

/**
 * A single wrapped line's overrides, independent from `TextRun` (per-character). Keyed by the
 * line's index in the *current* wrapped layout (`textLayout.ts`'s `layoutText`) — reflowing the
 * layer (edited content, resized frame) can shift what's on which line, same trade-off `runs`
 * would have without `textRuns.ts`'s reflow-by-diff, but line overrides are a coarser, occasional
 * tool (balancing one bubble line against another) rather than something edited every keystroke.
 */
export interface LineStyleOverride {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  letterSpacing?: number;
  align?: TextAlign;
}

/**
 * A shape a text layer's live rendering (and flattened export) clips to, in the same image-space
 * coordinates as the layer's own x/y — set when Type Region converts a non-rectangular selection
 * into a text container. Rect needs no entry (the frame itself already is the rect); a mask-kind
 * selection has no clean vector form to persist, so Type Region falls back to a plain rectangular
 * container for those rather than storing one (a documented gap, not silently dropped pixels).
 */
export type TextClipShape =
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: { x: number; y: number }[] };

export interface TextLayerData {
  content: string;
  x: number;
  y: number;
  width: number;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  bold: boolean;
  italic: boolean;
  lineHeight: number;
  strokeColor: string;
  strokeWidth: number;
  rotation: number;
  /**
   * Point text (Photoshop's click-to-type) grows to fit its content and never wraps;
   * box text (click-drag) wraps inside a fixed `width`. Stored as a flag rather than
   * width=0 so a point layer keeps a usable width if it's later converted to a box.
   */
  autoWidth: boolean;
  /**
   * Area (box) text only: when set, the frame stops growing at this height instead of always
   * auto-sizing to content — `textLayout.ts` reports `overflowing` once laid-out content exceeds
   * it, which the canvas/panel surface as the ⊞ indicator rather than silently clipping.
   */
  fixedHeight?: number;
  /** Extra px between characters (Konva `letterSpacing`; canvas 2D letterSpacing on export). */
  letterSpacing: number;
  /** Drop shadow / glow — a glow is just a shadow at offset 0 with a wide blur. */
  shadow: TextShadow;
  /** Gradient fill; overrides `color` while enabled. */
  gradient: TextGradient;
  /** Per-character overrides over the layer style above. See TextRun; maintained by textRuns.ts. */
  runs: TextRun[];
  /** Per-wrapped-line overrides. See LineStyleOverride. */
  lineOverrides?: Record<number, LineStyleOverride>;
  /** Set by Type Region for a non-rectangular container. See TextClipShape. */
  clipShape?: TextClipShape;
  /** Translator workflow metadata — surfaced in the Translation Preview panel. */
  status: TranslationStatus;
  comment: string;
}

export const DEFAULT_TEXT_SHADOW: TextShadow = {
  enabled: false, color: '#000000', blur: 6, offsetX: 0, offsetY: 2,
};

export const DEFAULT_TEXT_GRADIENT: TextGradient = {
  enabled: false, from: '#ffffff', to: '#000000', angle: 90,
};

export type AdjustmentKind =
  | 'brightness-contrast' | 'hue-saturation' | 'levels'
  | 'curves' | 'exposure' | 'vibrance' | 'color-balance' | 'posterize' | 'threshold' | 'gradient-map';

export const ADJUSTMENT_KIND_LABEL: Record<AdjustmentKind, string> = {
  'brightness-contrast': 'Brightness/Contrast',
  'hue-saturation': 'Hue/Saturation',
  levels: 'Levels',
  curves: 'Curves',
  exposure: 'Exposure',
  vibrance: 'Vibrance',
  'color-balance': 'Color Balance',
  posterize: 'Posterize',
  threshold: 'Threshold',
  'gradient-map': 'Gradient Map',
};

/** One curve control point — `input`/`output` are both 0-255. */
export interface CurvePoint { input: number; output: number; }

/** Cyan-Red / Magenta-Green / Yellow-Blue sliders, each -100..100 — one per Color Balance tonal range. */
export interface ColorBalanceRange { cyanRed: number; magentaGreen: number; yellowBlue: number; }

/**
 * Non-destructive adjustment applied to **everything below it in its parent** — its position in the
 * stack is what it affects. `layerTree.partitionAdjustments` turns each one into a wrapper around
 * the layers beneath it, which both the canvas and `exportImage.ts` then walk.
 *
 * The layer's `opacity` eases the grade (folded into the filter by `adjustments.withStrength`, not
 * applied to the wrapper node — that would fade the page itself to transparent). Its `blendMode` is
 * **not** honoured and `LayersPanel` hides the control: Photoshop blends an adjustment's result
 * against its unadjusted backdrop, and the wrapper contains the very stack that backdrop would come
 * from.
 */
export interface AdjustmentLayerData {
  kind: AdjustmentKind;
  /** -100..100 */
  brightness: number;
  /** -100..100 */
  contrast: number;
  /** -180..180 degrees */
  hue: number;
  /** -100..100 */
  saturation: number;
  /** -100..100 */
  lightness: number;
  levels: {
    inBlack: number; // 0-255
    inWhite: number; // 0-255
    gamma: number; // 0.1-9.99
    outBlack: number; // 0-255
    outWhite: number; // 0-255
  };
  /** Control points, sorted by `input`, identity (no-op) by default. Edited by CurvesEditor.tsx;
   *  `adjustments.ts`'s `curveLut` is the single source of truth for what they render to, shared by
   *  the live filter and the editor's own on-screen preview so the two can't drift. */
  curves: { rgb: CurvePoint[] };
  /** ag-psd's ExposureAdjustment field names, reused verbatim so exportPsd needs no renaming. */
  exposure: number; // -20..20 stops
  exposureOffset: number; // -0.5..0.5
  exposureGamma: number; // 0.01..9.99, 1 = identity
  /** -100..100. Boosts low-saturation pixels more than already-saturated ones. */
  vibrance: number;
  colorBalance: {
    shadows: ColorBalanceRange;
    midtones: ColorBalanceRange;
    highlights: ColorBalanceRange;
    preserveLuminosity: boolean;
  };
  /** 2..255 */
  posterizeLevels: number;
  /** 0..255 */
  threshold: number;
  /** Deliberately 2-stop only, matching this app's one Gradient tool (also foreground->background
   *  only) — there's no multi-stop gradient editor anywhere in this codebase yet. */
  gradientMap: { from: string; to: string };
}

export function createDefaultAdjustmentData(kind: AdjustmentKind = 'brightness-contrast'): AdjustmentLayerData {
  return {
    kind,
    brightness: 0,
    contrast: 0,
    hue: 0,
    saturation: 0,
    lightness: 0,
    levels: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
    curves: { rgb: [{ input: 0, output: 0 }, { input: 255, output: 255 }] },
    exposure: 0,
    exposureOffset: 0,
    exposureGamma: 1,
    vibrance: 0,
    colorBalance: {
      shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: true,
    },
    posterizeLevels: 4,
    threshold: 128,
    gradientMap: { from: '#000000', to: '#ffffff' },
  };
}

/**
 * A raster mask on a layer. The pixels live in `paint/maskCanvasRegistry.ts` keyed by `id`,
 * mirroring how `paintCanvasRegistry` holds clean-patch pixels — a layer's paint canvas and its
 * mask canvas are two separate registry entries, which is why the mask carries its own id.
 *
 * The canvas is RGBA with the mask in the *alpha* channel, not grayscale RGB, so rendering is a
 * plain `destination-in` composite with no conversion. PSD is the only consumer that wants
 * grayscale, and it converts at that boundary.
 */
export interface LayerMask {
  id: string;
  enabled: boolean;
  /** Unlinked masks don't follow the layer when it moves. Nothing moves raster layers yet. */
  linked: boolean;
  /** Photoshop's Alt-click-the-mask preview. Render-only, never exported. */
  showAlone?: boolean;
}

/**
 * One anchor on a vector path. `handleIn`/`handleOut` are stored as offsets from `point`, not
 * absolute coordinates — translating the whole path is then a pure `point += delta` per anchor
 * with handles untouched, the same convention `translateSelection` already uses for polygon
 * points (paint/selection.ts).
 *
 * `type` is an interaction hint ("keep handles collinear on drag"), not an enforced geometry
 * invariant — Photoshop itself lets you later drag one handle of a smooth anchor to break
 * symmetry while staying collinear, so the data model doesn't police this.
 */
export interface PathAnchor {
  id: string;
  point: Point;
  /** Offset from `point`; absent means no handle on that side (a pure corner). */
  handleIn?: Point;
  handleOut?: Point;
  type: 'corner' | 'smooth';
}

export type PathFillRule = 'nonzero' | 'evenodd';

/** Vector path data — models exactly one open-or-closed subpath (no compound paths). Pure
 *  geometry, deliberately no rasterized pixel cache: a path layer can't be a clip base/target
 *  and can't carry a paintable mask until it's baked onto a raster layer (Stroke Path/Fill Path). */
export interface PathLayerData {
  anchors: PathAnchor[];
  closed: boolean;
  fill: { enabled: boolean; color: string };
  stroke: { enabled: boolean; color: string; width: number };
  fillRule: PathFillRule;
}

export interface StudioLayer {
  id: string;
  type: StudioLayerType;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0-1
  blendMode: BlendMode;
  /** Background layers can't be deleted, reordered below, or have opacity/blend changed. */
  isBackground?: boolean;
  /**
   * Present iff type === 'group'. Bottom-to-top, same convention as the root array — `layerTree.ts`
   * owns that invariant, and nothing outside it may walk or edit this directly.
   */
  children?: StudioLayer[];
  /** Groups only: whether the panel shows the subtree. Persisted, as Photoshop does. */
  collapsed?: boolean;
  /** Clipped to the nearest non-clipped sibling below it in the same parent. */
  clipped?: boolean;
  /** Raster layer mask. Any layer type may carry one, groups included — except 'path', see PathLayerData. */
  mask?: LayerMask;
  /** Only present when type === 'text'. */
  text?: TextLayerData;
  /** Only present when type === 'adjustment'. */
  adjustment?: AdjustmentLayerData;
  /** Only present when type === 'path'. */
  path?: PathLayerData;
}

export function createBackgroundLayer(): StudioLayer {
  return {
    id: 'background',
    type: 'background',
    name: 'Background',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    isBackground: true,
  };
}

let layerCounter = 0;
export function createLayer(type: StudioLayerType, name: string): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type,
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
  };
}

export function createAdjustmentLayer(kind: AdjustmentKind = 'brightness-contrast'): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'adjustment',
    name: ADJUSTMENT_KIND_LABEL[kind],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    adjustment: createDefaultAdjustmentData(kind),
  };
}

export function createGroupLayer(name = 'Group', children: StudioLayer[] = []): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'group',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    children,
    collapsed: false,
  };
}

export function createPathLayer(anchors: PathAnchor[], closed: boolean, style: { strokeColor: string; strokeWidth: number }): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'path',
    name: `Path ${layerCounter}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    path: {
      anchors,
      closed,
      fill: { enabled: false, color: '#000000' },
      stroke: { enabled: true, color: style.strokeColor, width: style.strokeWidth },
      fillRule: 'nonzero',
    },
  };
}

let maskCounter = 0;
export function createLayerMask(): LayerMask {
  maskCounter += 1;
  return { id: `mask-${Date.now()}-${maskCounter}`, enabled: true, linked: true };
}

/**
 * @param boxWidth When given, creates *box* (area) text of that width (click-drag);
 *                 omitted creates *point* text that grows with its content (click).
 * @param boxHeight When given alongside boxWidth, becomes the area frame's `fixedHeight` — the
 *                  exact Photoshop area-text convention: the rectangle you drag *is* the frame,
 *                  height included, not just a starting width that then auto-grows.
 */
export function createTextLayer(x: number, y: number, boxWidth?: number, boxHeight?: number): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'text',
    name: `Text ${layerCounter}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    text: {
      content: '',
      x,
      y,
      width: boxWidth ?? 240,
      autoWidth: boxWidth === undefined,
      ...(boxWidth !== undefined && boxHeight !== undefined ? { fixedHeight: boxHeight } : {}),
      letterSpacing: 0,
      shadow: { ...DEFAULT_TEXT_SHADOW },
      gradient: { ...DEFAULT_TEXT_GRADIENT },
      // Empty content -> no runs; normalizeRuns keeps them in step as the content grows.
      runs: [],
      fontFamily: FONT_FAMILIES[0],
      fontSize: 28,
      color: '#000000',
      align: 'center',
      bold: false,
      italic: false,
      lineHeight: 1.15,
      strokeColor: '#ffffff',
      strokeWidth: 0,
      rotation: 0,
      status: 'draft',
      comment: '',
    },
  };
}

/**
 * TypeR-style scripted lettering: a style is picked per script line by matching
 * a prefix (e.g. "!!" for SFX), then stripped before the text is placed.
 * Ported from the real TypeR 2.5 extension's parsing model (folders, "//"
 * continuation lines, Page-N auto page switching) — see CLAUDE.md for the
 * mapping of Photoshop-host concepts to this canvas app's equivalents.
 */
export interface TyperStyle {
  id: string;
  name: string;
  /** Which TyperFolder this style belongs to, or null/undefined if unsorted. Also drives
   *  prefix-matching priority — see parseTyperScript's `currentFolderId` option. */
  folderId?: string | null;
  /** Empty prefix ("") matches any line that no other, more specific style claims first. */
  prefix: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  strokeColor: string;
  strokeWidth: number;
  /** Eye-icon toggle: false means this style's prefix can never match a script line (it falls
   *  through to the next candidate) — the style still exists and can be re-enabled. Missing/undefined
   *  on data saved before this field existed is treated as enabled (see parseTyperScript's matchStyle). */
  enabled?: boolean;
}

/** A node in the TypeR style-folder tree. Nesting is expressed via `parentId`; `order` is the
 *  sibling sort key (mirrors `layerTree.ts`'s sibling-order convention for layer groups). */
export interface TyperFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}

export const DEFAULT_TYPER_FOLDERS: TyperFolder[] = [
  { id: 'general', name: 'General', parentId: null, order: 0 },
];

export const DEFAULT_TYPER_STYLES: TyperStyle[] = [
  { id: 'dialogue', name: 'Dialogue', folderId: 'general', prefix: '', fontFamily: FONT_FAMILIES[0], fontSize: 26, color: '#000000', bold: false, italic: false, strokeColor: '#ffffff', strokeWidth: 0, enabled: true },
  { id: 'sfx', name: 'SFX', folderId: 'general', prefix: '!!', fontFamily: 'Impact', fontSize: 44, color: '#ffffff', bold: true, italic: false, strokeColor: '#000000', strokeWidth: 3, enabled: true },
  { id: 'thought', name: 'Thought', folderId: 'general', prefix: '~', fontFamily: FONT_FAMILIES[0], fontSize: 24, color: '#000000', bold: false, italic: true, strokeColor: '#ffffff', strokeWidth: 0, enabled: true },
];

export function createTyperStyle(name = 'New Style', folderId: string | null = null): TyperStyle {
  return { id: genTyperId(), name, folderId, prefix: '', fontFamily: FONT_FAMILIES[0], fontSize: 26, color: '#000000', bold: false, italic: false, strokeColor: '#ffffff', strokeWidth: 0, enabled: true };
}

let typerIdCounter = 0;
function genTyperId() {
  typerIdCounter += 1;
  return `style-${Date.now()}-${typerIdCounter}`;
}

let typerFolderIdCounter = 0;
function genTyperFolderId() {
  typerFolderIdCounter += 1;
  return `folder-${Date.now()}-${typerFolderIdCounter}`;
}

interface TyperFolderNode extends TyperFolder {
  children: TyperFolderNode[];
}

/** Nests folders by `parentId`, sorted by `order` at every level (recursive, mirrors editStyle.jsx's buildFolderTree). */
export function buildFolderTree(folders: TyperFolder[]): TyperFolderNode[] {
  const map = new Map<string, TyperFolderNode>();
  folders.forEach(f => map.set(f.id, { ...f, children: [] }));
  const roots: TyperFolderNode[] = [];
  map.forEach(node => {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sortRec = (nodes: TyperFolderNode[]) => {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach(n => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export interface TyperFolderOption {
  id: string;
  depth: number;
  label: string;
}

/** Flattens a folder tree into an indented breadcrumb list, for a folder-picker `<select>`. */
export function flattenFolderTree(nodes: TyperFolderNode[], parents: string[] = [], depth = 0): TyperFolderOption[] {
  const list: TyperFolderOption[] = [];
  for (const node of nodes) {
    const breadcrumb = [...parents, node.name];
    list.push({ id: node.id, depth, label: breadcrumb.join(' / ') });
    list.push(...flattenFolderTree(node.children, breadcrumb, depth + 1));
  }
  return list;
}

function collectDescendantFolderIds(folders: TyperFolder[], folderId: string): string[] {
  const ids: string[] = [];
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of folders.filter(f => f.parentId === current)) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

function isDescendantFolder(folders: TyperFolder[], ancestorId: string, targetId: string): boolean {
  let current = folders.find(f => f.id === targetId);
  while (current) {
    if (current.parentId === ancestorId) return true;
    current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined;
  }
  return false;
}

export function createTyperFolder(folders: TyperFolder[], name: string, parentId: string | null = null): TyperFolder {
  const siblings = folders.filter(f => f.parentId === parentId);
  return { id: genTyperFolderId(), name: name.trim() || 'New Folder', parentId, order: siblings.length };
}

/** Renames a folder. No-ops on an empty/whitespace-only name rather than leaving the folder unnamed. */
export function renameFolder(folders: TyperFolder[], folderId: string, name: string): TyperFolder[] {
  const trimmed = name.trim();
  if (!trimmed) return folders;
  return folders.map(f => (f.id === folderId ? { ...f, name: trimmed } : f));
}

/** Moves a folder under a new parent. No-ops on self-parenting or on a cycle (parenting a folder
 *  under its own descendant) — mirrors layerTree.ts's "illegal drag drop degrades to nothing
 *  happening" rule rather than corrupting the tree. */
export function reparentFolder(folders: TyperFolder[], folderId: string, newParentId: string | null): TyperFolder[] {
  if (folderId === newParentId) return folders;
  if (newParentId && isDescendantFolder(folders, folderId, newParentId)) return folders;
  const siblings = folders.filter(f => f.parentId === newParentId && f.id !== folderId);
  return folders.map(f => (f.id === folderId ? { ...f, parentId: newParentId, order: siblings.length } : f));
}

/** Deletes a folder and its descendants; styles inside any of them become unsorted rather than
 *  deleted (matches the real extension's default, non-permanent folder delete). */
export function deleteTyperFolder(folders: TyperFolder[], styles: TyperStyle[], folderId: string): { folders: TyperFolder[]; styles: TyperStyle[] } {
  const idsToRemove = new Set([folderId, ...collectDescendantFolderIds(folders, folderId)]);
  return {
    folders: folders.filter(f => !idsToRemove.has(f.id)),
    styles: styles.map(s => (s.folderId && idsToRemove.has(s.folderId) ? { ...s, folderId: null } : s)),
  };
}

export interface TyperLine {
  /** Raw source line(s) — multi-line when "//" continuation lines were merged in. */
  raw: string;
  content: string;
  style: TyperStyle;
  /** Set when a preceding "Page N" control line (English or Arabic, incl. Arabic-Indic digits) preceded this line. */
  pageHint?: string;
  /** Inline bold (markdown or HTML) wrapping on this line overrides the matched style for this placement only. */
  boldOverride?: boolean;
  italicOverride?: boolean;
}

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function arabicIndicToLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)));
}

/** Matches an English or Arabic "Page N" control line — case-insensitive, optional colon/dash, Arabic-Indic digits supported. */
const PAGE_LINE_RE = /^(?:page|الصفحة|ص)[\s:\-]*([0-9٠-٩]+)\s*$/i;

function stripInlineEmphasis(content: string): { content: string; boldOverride?: boolean; italicOverride?: boolean } {
  const boldMatch = content.match(/^\*\*(.+)\*\*$/) ?? content.match(/^<b>(.+)<\/b>$/i);
  if (boldMatch) return { content: boldMatch[1].trim(), boldOverride: true };
  const italicMatch = content.match(/^\*(.+)\*$/) ?? content.match(/^<i>(.+)<\/i>$/i);
  if (italicMatch) return { content: italicMatch[1].trim(), italicOverride: true };
  return { content };
}

export interface ParseTyperScriptOptions {
  /** The folder tree, used only to expand `currentFolderId` to include its descendant folders. */
  folders?: TyperFolder[];
  /** Line prefixes that mark a note/comment line to skip entirely. Defaults to `['##']`. */
  ignoreLinePrefixes?: string[];
  /** Substrings stripped from anywhere in a line's content (not just a prefix) before placement. */
  ignoreTags?: string[];
  /** Fallback style when no prefix matches, preferred over the empty-prefix-style convention. */
  defaultStyleId?: string | null;
  /** The folder whose styles get first crack at matching a line's prefix — mirrors the real
   *  extension's "current folder tag priority": the folder of the style just placed. */
  currentFolderId?: string | null;
}

/**
 * Parses a pasted script into placeable lines.
 * - Lines starting with a configured ignore-prefix (default `##`) are skipped (notes).
 * - Configured `ignoreTags` are stripped from anywhere in a line's content.
 * - "Page N" control lines (English/Arabic, Arabic-Indic digits ok) don't place text
 *   themselves — they tag the next real line with a `pageHint` for auto page-switching.
 * - "//" lines append to the previously placed line (a continuation), joined with a newline.
 * - Styles in `currentFolderId` (and its descendant folders) are tried first, longest-prefix-first;
 *   then all styles, longest-prefix-first; then `defaultStyleId`; then the empty-prefix style.
 * - A line fully wrapped in bold or italic markdown/HTML markers gets a per-placement style override.
 */
export function parseTyperScript(script: string, styles: TyperStyle[], options: ParseTyperScriptOptions = {}): TyperLine[] {
  const { folders = [], ignoreLinePrefixes = ['##'], ignoreTags = [], defaultStyleId = null, currentFolderId = null } = options;
  const isEnabled = (s: TyperStyle) => s.enabled !== false;
  const sortedStyles = [...styles].sort((a, b) => b.prefix.length - a.prefix.length);
  const priorityFolderIds = currentFolderId ? new Set([currentFolderId, ...collectDescendantFolderIds(folders, currentFolderId)]) : null;
  const folderStyles = priorityFolderIds ? sortedStyles.filter(s => s.folderId && priorityFolderIds.has(s.folderId)) : [];
  const defaultStyle = defaultStyleId ? styles.find(s => s.id === defaultStyleId) : undefined;

  // A disabled style (eye icon off) can never match by prefix — it falls through to the next
  // candidate — but it can still be reached via defaultStyleId/the empty-prefix fallback, matching
  // the request's "disabled styles cannot match [by prefix]" rather than removing them entirely.
  const matchStyle = (trimmed: string): TyperStyle =>
    folderStyles.find(s => s.prefix && isEnabled(s) && trimmed.startsWith(s.prefix))
      ?? sortedStyles.find(s => s.prefix && isEnabled(s) && trimmed.startsWith(s.prefix))
      ?? defaultStyle
      ?? sortedStyles.find(s => s.prefix === '')
      ?? styles[0];

  const lines: TyperLine[] = [];
  let pendingPageHint: string | undefined;

  for (const rawLine of script.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    if (ignoreLinePrefixes.some(p => p && trimmed.startsWith(p))) continue;

    const pageMatch = trimmed.match(PAGE_LINE_RE);
    if (pageMatch) {
      pendingPageHint = arabicIndicToLatinDigits(pageMatch[1]);
      continue;
    }

    if (trimmed.startsWith('//')) {
      const last = lines[lines.length - 1];
      if (last) {
        last.content = `${last.content}\n${trimmed.slice(2).trim()}`;
        last.raw = `${last.raw}\n${rawLine}`;
      }
      continue;
    }

    const style = matchStyle(trimmed);
    const stripped = style.prefix ? trimmed.slice(style.prefix.length).trim() : trimmed;
    const withoutTags = ignoreTags.reduce((acc, tag) => (tag ? acc.split(tag).join('') : acc), stripped);
    const { content, boldOverride, italicOverride } = stripInlineEmphasis(withoutTags);

    lines.push({ raw: rawLine, content, style, pageHint: pendingPageHint, boldOverride, italicOverride });
    pendingPageHint = undefined;
  }

  return lines;
}
