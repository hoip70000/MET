import { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Stage, Layer, Group, Image as KonvaImage, Rect, Ellipse, Line, Text as KonvaText, Transformer, Shape } from 'react-konva';
import type Konva from 'konva';
import type { Page, ProcessedImage } from '../../types';
import { BLEND_TO_COMPOSITE, type StudioLayer, type TextLayerData, type PathLayerData, type PathAnchor, type LayerSelectMode } from './studioTypes';
import { detectBubbleCenter } from './bubbleDetect';
import { TextLayerNode, TEXT_HIT_NAME } from './TextLayerNode';
import { FloatingTextToolbar } from './FloatingTextToolbar';
import { PathLayerNode } from './PathLayerNode';
import { traceAnchors, applyCurvatureSmoothing } from './pathGeometry';
import { genId } from '../../lib/id';
import {
  findLayer, findPath, getAtPath, getSiblings, flattenTree, mapTree, partitionAdjustments, groupClipRuns,
  type RenderNode, type ClipRun,
} from './layerTree';
import { layoutText } from './textLayout';
import { reflowRunsForContent } from './textRuns';
import { swalToast } from '../../lib/swalTheme';
import { getOrCreateCanvasFor, deleteCanvasFor, clonePaintCanvas, type PaintCanvasRegistry } from './paint/paintCanvasRegistry';
import { usePaintLayer, PAINT_TOOLS } from './paint/usePaintLayer';
import {
  NO_SELECTION, combineModeFromModifiers, combineSelections, hasSelection, rasterizeSelectionMask,
  selectionContainsPoint, translateSelection, transformSelectionMask, selectionToAlphaCanvas, alphaMaskToSelection,
  type Selection, type SelectionCombineMode,
} from './paint/selection';
import { applyPatch, type PaintSettings } from './paint/paintEngine';
import { snapSegmentToEdges } from './paint/magneticLasso';
import { BrushCursor } from './paint/BrushCursor';
import type { SerializedStudioLayer } from '../../lib/studioProjectStore';
import { filterForAdjustment, withStrength } from '../../lib/adjustments';

/** A character range inside one text layer, as reported by the editing textarea. */
export interface TextSelection {
  layerId: string;
  start: number;
  end: number;
}

/** A wrapped line clicked inside one text layer, while it's selected but not being edited. */
export interface TextLineSelection {
  layerId: string;
  lineIndex: number;
}

export interface ExportSnapshot {
  width: number;
  height: number;
  backgroundDataUrl: string;
  /** Bottom-to-top, same order as the layers panel; raster layers carry their pixels as a data URL. */
  layers: SerializedStudioLayer[];
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const GRID_SIZE = 100;
const RULER_SIZE = 20;
const RULER_STEP = 100;
const MARQUEE_TOOLS = new Set(['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col', 'crop', 'slice']);
const LASSO_TOOLS = new Set(['lasso-freehand']);
/** Tools whose footprint is brush-sized, so they get the live outline cursor instead of the OS one. */
const BRUSH_CURSOR_TOOLS = new Set([
  'brush', 'pencil', 'eraser', 'clone', 'heal', 'blur', 'sharpen', 'smudge',
  'dodge', 'burn', 'sponge', 'spot-heal', 'liquify',
]);

interface StudioCanvasProps {
  page: Page | null;
  showCleaned: boolean;
  /** 0 disables; >0 blends the original page as a translucent overlay above the cleaned page. */
  overlayOpacity: number;
  showGrid?: boolean;
  showRulers?: boolean;
  activeTool: string;
  /** Bumped by the parent (e.g. toolbar "Fit" button) to force a re-fit. */
  fitSignal: number;
  /** Non-background layers stacked above the page image, bottom to top. */
  layers: StudioLayer[];
  activeLayerId: string | null;
  onSelectLayer: (id: string, mode?: LayerSelectMode) => void;
  /** Every layer selected on canvas (primary last). Drives the combined transform box. */
  selectedLayerIds?: string[];
  /** Replaces the whole selection — used by the drag-a-box object marquee. */
  onSelectLayers?: (ids: string[]) => void;
  /** x/y are in page-image coordinates. */
  /** boxWidth given => box text of that width (click-drag); omitted => point text (click). */
  onAddTextLayer: (x: number, y: number, boxWidth?: number, boxHeight?: number) => void;
  /** Built-ins + any installed custom fonts, for the floating text toolbar's font picker. */
  fontFamilies?: string[];
  onUpdateTextLayer: (id: string, patch: Partial<TextLayerData>) => void;
  /** Double-clicking a text layer's own ⊞ overflow indicator — auto-fits fixedHeight to content,
   *  undoably. Separate from onUpdateTextLayer: that path is deliberately unlabeled/continuous-
   *  drag-safe everywhere else it's called, and this needs a real history entry. */
  onAutoFitTextHeight: (id: string) => void;
  onUpdatePathLayer: (id: string, patch: Partial<PathLayerData>) => void;
  /** Commits the Pen/Curvature Pen tool's in-progress anchors as a new persisted path layer. */
  onAddPathLayer: (anchors: PathAnchor[], closed: boolean) => void;
  /**
   * The character range selected inside the text layer being edited, or null when nothing is being
   * edited. Lifted out of the canvas so TextPanel can apply character styling to the selection —
   * the editing overlay is a plain textarea, so its selectionStart/End *is* the selection model.
   */
  onTextSelectionChange?: (selection: TextSelection | null) => void;
  /** A wrapped line clicked inside a selected (not editing) text layer — lifted the same way as
   *  onTextSelectionChange, so TextPanel can apply per-line overrides to it. */
  onTextLineSelectionChange?: (selection: TextLineSelection | null) => void;
  /** Current brush/fill/etc. settings, driven by the tool options bar. */
  paintSettings: PaintSettings;
  /** Active selection (marquee/lasso/wand); paint ops clip to this when present. */
  selection: Selection;
  onSelectionChange: (sel: Selection) => void;
  /** Type Region: while armed, clicking inside an existing selection — or completing a new
   *  marquee/lasso one — converts it straight into a text container instead of just setting the
   *  pixel selection. Independent of the TypeR panel's own arm state. */
  typeRegionArmed?: boolean;
  onCreateTypeRegion?: (shape: Selection) => void;
  /**
   * Fired once per committed stroke/fill/etc., with its pixels just before the op, for the history
   * stack. `maskId` is set when the stroke landed on a layer's mask rather than its own raster
   * canvas — `layerId` is still the owning layer either way (masks have no Konva node of their own
   * to redraw).
   */
  onPaintStrokeEnd: (layerId: string, before: ImageData, maskId?: string) => void;
  /** Fired when the Eyedropper samples a pixel from the background page image. */
  onEyedropperPick?: (hex: string) => void;
  /** Fired on Enter/double-click while the Crop tool is active, to commit the current rect selection as a crop. */
  onCommitCrop?: () => void;
  /** TypeR Multi-Bubble mode's already-queued rects, drawn as a distinct overlay from the live selection. */
  queuedBubbleRects?: { x: number; y: number; width: number; height: number }[];
  /** Slice tool's already-queued rects, drawn as a distinct overlay from the live selection. */
  queuedSliceRects?: { x: number; y: number; width: number; height: number }[];
  /** Select > Transform Selection: shows a free-transform box around the selection's bounds instead
   *  of the normal marquee/paint tool dispatch. Enter commits (reshapes `selection`), Escape cancels. */
  transformingSelection?: boolean;
  onExitTransformSelection?: () => void;
  /** Quick Mask mode: every paint tool draws onto a scratch alpha buffer instead of the active
   *  layer, shown as a red rubylith tint over deselected areas. */
  quickMaskActive?: boolean;
  /** The layer whose *mask* (not its own content) is the current paint target, or null when
   *  painting normally. Set by clicking a mask's thumbnail in the Layers panel. */
  activeMaskLayerId?: string | null;
  /** Live collab: the pointer's page-image-space position on every move (null on leave), for
   *  broadcasting this user's cursor to other participants of a hosted session. Independent of
   *  BRUSH_CURSOR_TOOLS — fires for any tool, unlike the brush outline's own tracking. */
  onLiveCursorMove?: (pagePos: { x: number; y: number } | null) => void;
}

export interface StudioCanvasHandle {
  /** Flood-fills the page around a text layer to find its speech bubble and re-centers it there. */
  centerTextLayerInBubble: (id: string) => void;
  /** Flood-fills the page from an arbitrary point (e.g. a TypeR armed-placement click) to find the
   *  speech bubble there, without needing an existing text layer. `centerX`/`centerY` are the
   *  detected region's bounding-box center, not a top-left — null if no bubble was detected. */
  detectBubbleBounds: (x: number, y: number) => { centerX: number; centerY: number; width: number; height: number } | null;
  /** Returns the raster canvas for a layer id, creating it if the layer has no backing yet. */
  getPaintCanvas: (layerId: string) => HTMLCanvasElement | null;
  /** Frees a raster layer's canvas when its layer is deleted. */
  deletePaintCanvas: (layerId: string) => void;
  /**
   * Clones raster pixels for every old→new id pair, for duplicating a layer or a whole group.
   * Takes the id map from `layerTree.cloneSubtree` — pairs with no canvas are skipped.
   */
  clonePaintCanvases: (idMap: Map<string, string>) => void;
  /** Forces Konva to redraw a layer after its raster canvas was mutated directly (e.g. by undo/redo). */
  redrawLayer: (layerId: string) => void;
  /** Snapshots every raster layer with a live canvas backing (for persistence) as PNG data URLs, keyed by layer id. */
  exportRasterLayers: () => Record<string, string>;
  /** Decodes a saved data URL back into a layer's raster canvas (for restoring persisted state). */
  loadRasterLayer: (layerId: string, dataUrl: string) => Promise<void>;
  /** Snapshots the active page's background + full layer stack for flatten/PSD export. Null if no page is loaded. */
  getExportSnapshot: () => ExportSnapshot | null;
  getZoom: () => number;
  zoomTo: (scale: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /**
   * Crops the background (original + cleaned) and every raster layer's canvas to `rect` (page-image
   * coordinates), in place. Returns the new original/cleaned image data so the caller (Studio.tsx)
   * can persist it and shift text layers by (-rect.x, -rect.y); null if there's no page loaded.
   */
  commitCrop: (rect: { x: number; y: number; width: number; height: number }) => Promise<{ original: ProcessedImage; cleaned: ProcessedImage | null } | null>;
  /**
   * Image > Rotate Canvas: transforms the background (original + cleaned) and every raster layer's
   * canvas in place, the same shape as `commitCrop` above. Text layer positions are transformed by
   * the caller (Studio.tsx has the box geometry via `layoutText`, which this module doesn't import) —
   * this only returns the new page dimensions alongside the transformed images so the caller knows
   * whether width/height swapped (90°) or stayed put (180°/flip).
   */
  rotateCanvas: (dir: 'cw' | 'ccw' | '180' | 'flip-h' | 'flip-v') => Promise<{ original: ProcessedImage; cleaned: ProcessedImage | null; width: number; height: number } | null>;
  /**
   * Copies the current background pixels into a clean-patch layer's raster canvas. Called right
   * after a new layer is created so Clone/Heal/filter-brush/Liquify tools have real page content
   * to work on immediately — a brand new blank layer would make those tools no-ops, since they
   * only ever read/write the active layer's own canvas, never the background underneath it.
   */
  seedLayerWithBackground: (layerId: string) => void;
  /** Like seedLayerWithBackground, but draws `maskCanvas` (already carrying its own precise
   *  per-pixel alpha — see whitedDiff.ts) instead of a flat unmasked copy of the background. */
  seedLayerWithMaskedImage: (layerId: string, maskCanvas: HTMLCanvasElement) => void;
  /** Reads the Quick Mask scratch buffer back into a Selection as mode is turned off; null if no
   *  mask buffer exists (Quick Mask was never entered, or no page is loaded). */
  commitQuickMask: () => Selection | null;
  /** Returns a layer mask's own canvas, creating it (blank) if it has no backing yet — mirrors
   *  `getPaintCanvas`, just keyed by mask id instead of layer id. */
  getMaskCanvas: (maskId: string) => HTMLCanvasElement | null;
  /** Frees a mask's canvas when the mask is removed or its owning layer is deleted. */
  deleteMaskCanvas: (maskId: string) => void;
  /** Clones mask pixels for every old→new id pair — shares the same `idMap` `clonePaintCanvases`
   *  takes, since `cloneSubtree` interleaves layer and mask id remaps in one map. */
  cloneMaskCanvases: (idMap: Map<string, string>) => void;
  /** Snapshots every mask with a live canvas backing as PNG data URLs, keyed by mask id. */
  exportMaskLayers: () => Record<string, string>;
  /** Decodes a saved data URL back into a mask's canvas (for restoring persisted state). Takes the
   *  owning layer's id too, purely to redraw its Konva node once the pixels land. */
  loadMaskLayer: (layerId: string, maskId: string, dataUrl: string) => Promise<void>;
  /**
   * Seeds a newly-created mask's canvas: fully opaque (reveal everything) if there's no active
   * selection, or the selection's own shape (`selectionToAlphaCanvas`) if there is — matching
   * Photoshop's "Add Layer Mask" behavior of masking to the current selection when one exists.
   */
  createMask: (maskId: string) => void;
  /** Live collab: the current stage pan/zoom, so a caller outside this component (Studio.tsx) can
   *  convert other participants' page-space cursor broadcasts into this view's own container-space
   *  to overlay them — mirrors the same `(v - pos) / scale` <-> `v * scale + pos` math this file
   *  already uses internally for its own pointer handling. */
  getViewTransform: () => { pos: { x: number; y: number }; scale: number };
}

export const StudioCanvas = forwardRef<StudioCanvasHandle, StudioCanvasProps>(function StudioCanvas({
  page, showCleaned, overlayOpacity, showGrid = false, showRulers = false, activeTool, fitSignal, layers,
  activeLayerId, selectedLayerIds, onSelectLayer, onSelectLayers, onAddTextLayer, onUpdateTextLayer, onAutoFitTextHeight, onUpdatePathLayer, onAddPathLayer, onTextSelectionChange,
  onTextLineSelectionChange, fontFamilies = [],
  paintSettings, selection, onSelectionChange, typeRegionArmed = false, onCreateTypeRegion, onPaintStrokeEnd, onEyedropperPick, onCommitCrop,
  queuedBubbleRects, queuedSliceRects, transformingSelection = false, onExitTransformSelection, quickMaskActive = false,
  activeMaskLayerId = null, onLiveCursorMove,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const textNodeRefs = useRef<Record<string, Konva.Group | null>>({});
  /** Path layers keep their own ref map, separate from textNodeRefs — they deliberately don't
   *  participate in the Transformer (Path Selection is a plain whole-path drag, no resize handles,
   *  matching real Photoshop), so there's no shared-map generalization to keep in sync here. */
  const pathNodeRefs = useRef<Record<string, Konva.Group | null>>({});
  /**
   * One Konva `Group` per StudioLayer. These used to be Konva `Layer`s — one canvas each — which
   * is why blend modes silently did nothing: `Container.drawScene` applies the composite op while
   * drawing children into the *current* canvas, and a Layer's own canvas starts empty, so
   * "multiply" had nothing beneath it to multiply with. Groups share the one stage canvas, so a
   * blend now composites against the background and everything under it, matching the exporter.
   */
  const layerNodeRefs = useRef<Record<string, Konva.Group | null>>({});
  /** Groups have no batchDraw of their own — only Layer does — so redraws go via the owning Layer. */
  const redrawLayerNode = useCallback((layerId: string | null | undefined) => {
    layerNodeRefs.current[layerId ?? '']?.getLayer()?.batchDraw();
  }, []);
  const paintCanvasRegistry = useRef<PaintCanvasRegistry>({});
  /** A layer's mask and its own raster content are two separate registry entries, keyed by the
   *  mask's own id — mirrors `paintCanvasRegistry` exactly (same generic functions, second ref). */
  const maskCanvasRegistry = useRef<PaintCanvasRegistry>({});
  /** Per-layer pristine pre-liquify snapshot, for Liquify's Reconstruct mode — see usePaintLayer.ts. */
  const liquifySnapshots = useRef<Record<string, ImageData>>({}).current;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  imageRef.current = image;
  const bgImageNodeRef = useRef<Konva.Image | null>(null);
  const pinchDistRef = useRef<number | null>(null);
  const prevPinchCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [touchCount, setTouchCount] = useState(0);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  /** The canvas selection. Falls back to the primary layer when the host doesn't track a set. */
  const selectionIds = useMemo(
    () => selectedLayerIds ?? (activeLayerId ? [activeLayerId] : []),
    [selectedLayerIds, activeLayerId],
  );
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  /** Text tool drag origin — a drag makes box text, a plain click makes point text. */
  const textDragRef = useRef<{ x: number; y: number } | null>(null);
  /** Set when a text drag already created a layer, so the trailing click doesn't make a second one. */
  const textDragConsumedRef = useRef(false);
  /** Live dashed-rectangle preview (image-space) while dragging out a new area text box — the
   *  W×H readout reads straight off this, matching Photoshop's live-drag box readout. */
  const [textDragPreview, setTextDragPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  /** Hovering a text layer's own box body (not one of the Transformer's handles, which sit on top
   *  and win the hit-test first) — drives the move-cursor over the container below. */
  const [hoveringTextBody, setHoveringTextBody] = useState(false);
  /** Hovering a text layer's own ⊞ overflow indicator specifically — takes priority over
   *  hoveringTextBody for cursor purposes since the indicator sits at/on the box's bottom edge,
   *  inside the body's own hit area. */
  const [hoveringOverflowIndicator, setHoveringOverflowIndicator] = useState(false);
  const lassoPointsRef = useRef<{ x: number; y: number }[] | null>(null);
  /** Selection to combine against and how, captured from Shift/Alt at the start of a marquee/lasso drag. */
  const combineBaseRef = useRef<Selection>(NO_SELECTION);
  const combineModeRef = useRef<SelectionCombineMode>('replace');
  /**
   * A marquee/lasso gesture doesn't touch the selection at all until the pointer has moved past a
   * small dead zone (4 screen px) — below that it's an ordinary click (e.g. re-clicking inside an
   * existing selection to start a paint stroke), not an attempt to draw a new empty selection. Once
   * crossed, the gesture behaves exactly as before for its remaining lifetime. Mirrors
   * objectMarqueeRef's `box.width < 4` gate and textDragRef's 12px gate for the same reason.
   */
  const marqueeDraggedRef = useRef(false);
  const lassoDraggedRef = useRef(false);
  const DRAG_DEAD_ZONE_PX = 4;
  /**
   * Move tool (activeTool 'select') dragging the pixel content trapped inside the active
   * selection on the active clean-patch layer — distinct from objectMarqueeRef (which
   * drag-selects text layers): this fires instead of it when the pointerdown lands inside the
   * selection's own shape rather than on empty canvas.
   */
  const movingSelectionRef = useRef<{
    layerId: string;
    originalSelection: Selection;
    before: ImageData;
    pieceCanvas: HTMLCanvasElement;
    origin: { x: number; y: number; width: number; height: number };
    cutBase: ImageData;
    dragStart: { x: number; y: number };
    lastOffset: { dx: number; dy: number };
  } | null>(null);
  /**
   * Patch tool: dragging from inside the active selection to elsewhere on the canvas. Unlike
   * movingSelectionRef above, no pixel content is cut/redrawn during the drag — only the marquee
   * slides live, matching Photoshop's own Patch UX (you see the outline slide over the "good" area
   * while the defect's pixels stay untouched until release). The one-shot blend happens on pointerUp.
   */
  const patchDragRef = useRef<{
    layerId: string;
    originalSelection: Selection;
    originBounds: { x: number; y: number; width: number; height: number };
    dragStart: { x: number; y: number };
    before: ImageData;
    lastOffset: { dx: number; dy: number };
  } | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Quick Mask's scratch paint buffer — alpha channel is the in-progress selection strength. */
  const quickMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The red rubylith tint derived from quickMaskCanvasRef, regenerated after every paint change. */
  // Always a real (possibly 0x0) canvas, never null, so the Konva Image node below always has a
  // valid `image` prop to satisfy its type — content is filled in once Quick Mask is entered.
  const quickMaskOverlayCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  /** Select > Transform Selection's live box (image-space centre + size + rotation) and the
   *  original selection/bounds it started from, needed to compute the final transform on commit. */
  const [transformBox, setTransformBox] = useState<{ x: number; y: number; width: number; height: number; rotation: number } | null>(null);
  const transformOriginRef = useRef<{ selection: Selection; bounds: { x: number; y: number; width: number; height: number } } | null>(null);
  const transformRectRef = useRef<Konva.Rect>(null);
  const transformerRef2 = useRef<Konva.Transformer>(null);
  /** Pointer position in container/CSS px for the live brush outline; null when off-canvas. */
  const [brushCursorPos, setBrushCursorPos] = useState<{ x: number; y: number } | null>(null);
  /** Pen/Curvature Pen's in-progress path — real anchors with bezier handles, persisted as a
   *  `path`-type layer on commit (Enter/dblclick/closing-click), never rasterized directly. */
  const [penDraft, setPenDraft] = useState<PathAnchor[]>([]);
  /** Set while a mousedown-to-placement gesture is live on the anchor just pushed to `penDraft` —
   *  tracks the drag vector so pointerup/move can tell a plain click (corner) from a click-drag
   *  (smooth, handles pulled out symmetrically along the drag). Cleared on pointerup. */
  const penPlacingRef = useRef<{ index: number; start: { x: number; y: number } } | null>(null);
  const [lassoPolyPoints, setLassoPolyPoints] = useState<{ x: number; y: number }[]>([]);
  const [overlayImage, setOverlayImage] = useState<HTMLImageElement | null>(null);

  // Spacebar-hold and middle-mouse-button pan, available regardless of the active tool (Photoshop-style).
  const [spaceDown, setSpaceDown] = useState(false);
  const panRef = useRef<{ active: boolean; lastX: number; lastY: number } | null>(null);
  useEffect(() => {
    function isTextInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !isTextInputFocused()) { e.preventDefault(); setSpaceDown(true); }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setSpaceDown(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Live Shift/Alt state for the Transformer's corner-drag behavior (Shift = constrain
  // proportions, Alt = resize from center) — Konva's `keepRatio`/`centeredScaling` are plain
  // props it re-reads on every transform-computation frame, so toggling them from React state
  // driven by keydown/keyup takes effect mid-drag, matching Photoshop's live modifier toggling
  // rather than requiring the modifier to be held before the drag starts.
  const [shiftHeld, setShiftHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Shift') setShiftHeld(true);
      if (e.key === 'Alt') setAltHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Shift') setShiftHeld(false);
      if (e.key === 'Alt') setAltHeld(false);
    }
    // A window blur (e.g. Alt-tabbing away mid-drag) never delivers the matching keyup — without
    // this, the modifier could get stuck "on" until the next unrelated keypress.
    function onBlur() { setShiftHeld(false); setAltHeld(false); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const activeLayer = findLayer(layers, activeLayerId) ?? null;
  const isPaintTool = (PAINT_TOOLS as readonly string[]).includes(activeTool);
  const paintLayerIdRef = useRef<string | null>(null);
  paintLayerIdRef.current = activeLayer?.type === 'clean-patch' ? activeLayer.id : null;

  // The layer whose mask is being painted, and that mask's own registry id — derived from the
  // current tree rather than passed as two separate props, so they can never disagree.
  const editingMaskLayer = activeMaskLayerId ? findLayer(layers, activeMaskLayerId) : null;
  const editingMaskId = editingMaskLayer?.mask?.id ?? null;

  // Quick Mask's red rubylith tint, regenerated from quickMaskCanvasRef after every paint change.
  // The `destination-out` trick punches the mask's own alpha out of a flat red rect natively, so no
  // per-pixel JS loop is needed even on a live per-pointermove redraw.
  const quickMaskImageRef = useRef<Konva.Image>(null);
  const redrawQuickMaskOverlay = useCallback(() => {
    const mask = quickMaskCanvasRef.current;
    if (!mask) return;
    let overlay = quickMaskOverlayCanvasRef.current;
    if (!overlay || overlay.width !== mask.width || overlay.height !== mask.height) {
      overlay = document.createElement('canvas');
      overlay.width = mask.width;
      overlay.height = mask.height;
      quickMaskOverlayCanvasRef.current = overlay;
    }
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // Set imperatively rather than via the `image` prop: the canvas is mutated in place (never a
    // new element), so a React re-render wouldn't see a changed prop value to diff against and
    // react-konva would never call the underlying Konva setter on its own.
    const node = quickMaskImageRef.current;
    if (node) {
      node.image(overlay);
      node.getLayer()?.batchDraw();
    }
  }, []);

  // Seed the Quick Mask paint buffer from the current selection the moment mode is entered — not
  // every render, or repeated toggles would keep resetting mid-edit.
  useEffect(() => {
    if (!quickMaskActive || !image) return;
    if (!quickMaskCanvasRef.current) {
      quickMaskCanvasRef.current = selectionToAlphaCanvas(selection, image.width, image.height);
      redrawQuickMaskOverlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickMaskActive, image]);

  const getActivePaintCanvas = useCallback(() => {
    const img = imageRef.current;
    // A layer mask being edited takes priority — it's a more specific target than Quick Mask or
    // the active layer's own canvas, and the two shouldn't normally coincide anyway.
    if (editingMaskId) return img ? getOrCreateCanvasFor(maskCanvasRegistry.current, editingMaskId, img.width, img.height) : null;
    if (quickMaskActive) return quickMaskCanvasRef.current;
    const layerId = paintLayerIdRef.current;
    if (!layerId || !img) return null;
    return getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
  }, [editingMaskId, quickMaskActive]);

  /**
   * Sets (or clears) a layer's mask filter to match its current `mask` field, reading the mask
   * canvas's pixels fresh each call — safe to call again after every stroke, unlike re-running
   * `.cache()` (see `maskAlphaFilter`'s doc comment for why compositing the mask as a cached
   * sibling image instead went stale on a live-edited mask).
   */
  const refreshMaskFilter = useCallback((layerId: string) => {
    const layer = findLayer(layersRef.current, layerId);
    // Adjustment wrappers reuse this same node ref (`adjustmentNodeRefs`/`layerNodeRefs` both point
    // at it) and own their filter via the effect below — clearing it here would silently wipe the
    // adjustment's own brightness/hue/levels filter. Adjustments have no paintable content to trim
    // to a mask anyway, so this is a real exclusion, not just a guard against clobbering.
    if (layer?.type === 'adjustment') return;
    const node = layerNodeRefs.current[layerId];
    const img = imageRef.current;
    if (!node) return;
    if (layer?.mask?.enabled && img) {
      const canvas = getOrCreateCanvasFor(maskCanvasRegistry.current, layer.mask.id, img.width, img.height);
      node.filters([maskAlphaFilter(canvas)]);
    } else {
      node.filters([]);
    }
  }, []);

  /** Redraws whatever the active tool is actually painting onto — a layer's mask, the active layer
   *  normally, or the Quick Mask buffer's tint while that mode is active. */
  const redrawActivePaintTarget = useCallback(() => {
    if (editingMaskLayer) { refreshMaskFilter(editingMaskLayer.id); redrawLayerNode(editingMaskLayer.id); return; }
    if (quickMaskActive) { redrawQuickMaskOverlay(); return; }
    redrawLayerNode(paintLayerIdRef.current);
  }, [editingMaskLayer, quickMaskActive, redrawQuickMaskOverlay, redrawLayerNode, refreshMaskFilter]);

  const paint = usePaintLayer({
    getCanvas: getActivePaintCanvas,
    settings: paintSettings,
    // Quick Mask must be paintable everywhere, not clipped to the selection it's redefining. A
    // layer mask being edited *does* respect the active selection, like any other paint target.
    selection: quickMaskActive ? NO_SELECTION : selection,
    onSelectionChange,
    onStrokeEnd: (before) => {
      if (editingMaskLayer && editingMaskId) {
        refreshMaskFilter(editingMaskLayer.id);
        redrawLayerNode(editingMaskLayer.id);
        onPaintStrokeEnd(editingMaskLayer.id, before, editingMaskId);
        return;
      }
      if (quickMaskActive) { redrawQuickMaskOverlay(); return; }
      const layerId = paintLayerIdRef.current;
      redrawLayerNode(layerId ?? '');
      if (layerId) onPaintStrokeEnd(layerId, before);
    },
    getLayerId: () => paintLayerIdRef.current,
    liquifySnapshots,
    getFallbackCanvas: () => sampleCanvasRef.current,
  });

  useImperativeHandle(ref, () => ({
    getPaintCanvas(layerId: string) {
      const img = imageRef.current;
      if (!img) return null;
      return getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
    },
    redrawLayer(layerId: string) {
      redrawLayerNode(layerId);
    },
    deletePaintCanvas(layerId: string) {
      deleteCanvasFor(paintCanvasRegistry.current, layerId);
      delete liquifySnapshots[layerId];
    },
    clonePaintCanvases(idMap: Map<string, string>) {
      // Liquify snapshots are deliberately not cloned: they're a pristine pre-liquify baseline for
      // Reconstruct, and the copy's baseline is its own starting pixels, captured on first use.
      for (const [fromId, toId] of idMap) clonePaintCanvas(paintCanvasRegistry.current, fromId, toId);
    },
    exportRasterLayers() {
      // Exports every raster canvas the registry currently holds — not just the active page's —
      // since the registry accumulates canvases for every page visited this session, and pages
      // navigated away from still need their edits captured on the next autosave.
      const out: Record<string, string> = {};
      for (const [layerId, canvas] of Object.entries(paintCanvasRegistry.current)) {
        if (canvas) out[layerId] = canvas.toDataURL('image/png');
      }
      return out;
    },
    async loadRasterLayer(layerId: string, dataUrl: string) {
      // The background image for a freshly-switched-to page loads asynchronously, so give it
      // a brief window to arrive rather than silently dropping the restore on a race.
      const img = imageRef.current ?? await waitForImage(imageRef);
      if (!img) return;
      const source = new window.Image();
      await new Promise<void>((resolve, reject) => {
        source.onload = () => resolve();
        source.onerror = () => reject(new Error(`Failed to decode raster layer ${layerId}`));
        source.src = dataUrl;
      });
      const canvas = getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      redrawLayerNode(layerId);
    },
    getExportSnapshot() {
      const img = imageRef.current;
      if (!img) return null;
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = img.width;
      bgCanvas.height = img.height;
      // Deliberately *unfiltered*. Adjustments used to be baked in here, duplicating the filter
      // pipeline; now they're layers in the tree and `exportImage.ts` applies them on its walk —
      // one implementation, two consumers, which is what keeps the file matching the screen.
      const bgCtx = bgCanvas.getContext('2d')!;
      bgCtx.drawImage(img, 0, 0);
      // Walks the whole tree: pixels hang off layers at every depth, and a flat map would hand the
      // exporter a group whose children carry no raster — i.e. silently export an empty group.
      const exportLayers = mapTree<SerializedStudioLayer>(layersRef.current, (l) => {
        const canvas = paintCanvasRegistry.current[l.id];
        return canvas ? { ...l, raster: canvas.toDataURL('image/png') } : l;
      });
      return { width: img.width, height: img.height, backgroundDataUrl: bgCanvas.toDataURL('image/png'), layers: exportLayers };
    },
    getZoom() {
      return scale;
    },
    zoomTo(nextScale: number) {
      const clamped = clampScale(nextScale);
      const cx = containerSize.width / 2, cy = containerSize.height / 2;
      const pointTo = { x: (cx - pos.x) / scale, y: (cy - pos.y) / scale };
      setScale(clamped);
      setPos({ x: cx - pointTo.x * clamped, y: cy - pointTo.y * clamped });
    },
    zoomIn() {
      this.zoomTo(scale * 1.25);
    },
    zoomOut() {
      this.zoomTo(scale / 1.25);
    },
    centerTextLayerInBubble(id: string) {
      const layer = findLayer(layersRef.current, id);
      const img = imageRef.current;
      if (!layer?.text || !img) return;
      const lineCount = layer.text.content.split('\n').length || 1;
      const textHeight = lineCount * layer.text.fontSize * layer.text.lineHeight;
      const seedX = layer.text.x;
      const seedY = layer.text.y + textHeight / 2;
      const result = detectBubbleCenter(img, seedX, seedY);
      if (!result) {
        swalToast({ icon: 'info', title: 'No bubble detected — place the text over a light bubble first' });
        return;
      }
      onUpdateTextLayer(id, {
        x: result.x - layer.text.width / 2,
        y: result.y - textHeight / 2,
      });
      swalToast({ icon: 'success', title: 'Centered in bubble' });
    },
    detectBubbleBounds(x: number, y: number) {
      const img = imageRef.current;
      if (!img) return null;
      const result = detectBubbleCenter(img, x, y);
      if (!result) return null;
      return { centerX: result.x, centerY: result.y, width: result.width, height: result.height };
    },
    async commitCrop(rect) {
      if (!page) return null;
      const cw = page.original.width, ch = page.original.height;
      const rx = Math.max(0, Math.min(cw - 1, Math.round(Math.min(rect.x, rect.x + rect.width))));
      const ry = Math.max(0, Math.min(ch - 1, Math.round(Math.min(rect.y, rect.y + rect.height))));
      const rw = Math.max(0, Math.min(cw - rx, Math.round(Math.abs(rect.width))));
      const rh = Math.max(0, Math.min(ch - ry, Math.round(Math.abs(rect.height))));
      if (rw < 2 || rh < 2) return null;

      async function cropSource(pi: ProcessedImage): Promise<ProcessedImage> {
        const img = await loadImageFromSrc(pi.dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = rw;
        canvas.height = rh;
        canvas.getContext('2d')!.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh);
        return { ...pi, dataUrl: canvas.toDataURL(pi.mimeType || 'image/png'), width: rw, height: rh };
      }

      const newOriginal = await cropSource(page.original);
      const newCleaned = page.cleaned ? await cropSource(page.cleaned) : null;

      // Crop every raster layer's canvas in place — same registry object, so Konva's existing
      // <Image> references keep working, just pointing at newly-sized/redrawn pixel content.
      for (const layerId of Object.keys(paintCanvasRegistry.current)) {
        const old = paintCanvasRegistry.current[layerId];
        if (!old) continue;
        const cropped = document.createElement('canvas');
        cropped.width = rw;
        cropped.height = rh;
        cropped.getContext('2d')!.drawImage(old, rx, ry, rw, rh, 0, 0, rw, rh);
        old.width = rw;
        old.height = rh;
        old.getContext('2d')!.drawImage(cropped, 0, 0);
        redrawLayerNode(layerId);
      }

      return { original: newOriginal, cleaned: newCleaned };
    },
    async rotateCanvas(dir) {
      if (!page) return null;
      const cw = page.original.width, ch = page.original.height;
      const swapped = dir === 'cw' || dir === 'ccw';
      const nw = swapped ? ch : cw;
      const nh = swapped ? cw : ch;

      function drawTransformed(ctx: CanvasRenderingContext2D, source: CanvasImageSource) {
        ctx.save();
        switch (dir) {
          case 'cw': ctx.translate(nw, 0); ctx.rotate(Math.PI / 2); break;
          case 'ccw': ctx.translate(0, nh); ctx.rotate(-Math.PI / 2); break;
          case '180': ctx.translate(nw, nh); ctx.rotate(Math.PI); break;
          case 'flip-h': ctx.translate(nw, 0); ctx.scale(-1, 1); break;
          case 'flip-v': ctx.translate(0, nh); ctx.scale(1, -1); break;
        }
        ctx.drawImage(source, 0, 0);
        ctx.restore();
      }

      async function rotateSource(pi: ProcessedImage): Promise<ProcessedImage> {
        const img = await loadImageFromSrc(pi.dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = nw;
        canvas.height = nh;
        drawTransformed(canvas.getContext('2d')!, img);
        return { ...pi, dataUrl: canvas.toDataURL(pi.mimeType || 'image/png'), width: nw, height: nh };
      }

      const newOriginal = await rotateSource(page.original);
      const newCleaned = page.cleaned ? await rotateSource(page.cleaned) : null;

      // Same in-place-registry-object approach as commitCrop above, so existing Konva <Image>
      // references keep working. Masks aren't transformed here either — commitCrop doesn't touch
      // maskCanvasRegistry, a pre-existing scope limit this mirrors rather than fixes in passing.
      for (const layerId of Object.keys(paintCanvasRegistry.current)) {
        const old = paintCanvasRegistry.current[layerId];
        if (!old) continue;
        const rotated = document.createElement('canvas');
        rotated.width = nw;
        rotated.height = nh;
        drawTransformed(rotated.getContext('2d')!, old);
        old.width = nw;
        old.height = nh;
        old.getContext('2d')!.drawImage(rotated, 0, 0);
        redrawLayerNode(layerId);
      }

      return { original: newOriginal, cleaned: newCleaned, width: nw, height: nh };
    },
    seedLayerWithBackground(layerId: string) {
      const img = imageRef.current;
      if (!img) return;
      const canvas = getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      redrawLayerNode(layerId);
    },
    seedLayerWithMaskedImage(layerId: string, maskCanvas: HTMLCanvasElement) {
      // Sized from `maskCanvas` itself (already the target page's own dimensions, per
      // whitedDiff.ts), not `imageRef.current` — this can legitimately run for a page that
      // isn't the currently-displayed one, whose background image may not have loaded yet.
      const canvas = getOrCreateCanvasFor(paintCanvasRegistry.current, layerId, maskCanvas.width, maskCanvas.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(maskCanvas, 0, 0);
      redrawLayerNode(layerId);
    },
    commitQuickMask() {
      const canvas = quickMaskCanvasRef.current;
      quickMaskCanvasRef.current = null;
      return canvas ? alphaMaskToSelection(canvas) : null;
    },
    getMaskCanvas(maskId: string) {
      const img = imageRef.current;
      if (!img) return null;
      return getOrCreateCanvasFor(maskCanvasRegistry.current, maskId, img.width, img.height);
    },
    deleteMaskCanvas(maskId: string) {
      deleteCanvasFor(maskCanvasRegistry.current, maskId);
    },
    cloneMaskCanvases(idMap: Map<string, string>) {
      for (const [fromId, toId] of idMap) clonePaintCanvas(maskCanvasRegistry.current, fromId, toId);
    },
    exportMaskLayers() {
      const out: Record<string, string> = {};
      for (const [maskId, canvas] of Object.entries(maskCanvasRegistry.current)) {
        if (canvas) out[maskId] = canvas.toDataURL('image/png');
      }
      return out;
    },
    async loadMaskLayer(layerId: string, maskId: string, dataUrl: string) {
      const img = imageRef.current ?? await waitForImage(imageRef);
      if (!img) return;
      const source = new window.Image();
      await new Promise<void>((resolve, reject) => {
        source.onload = () => resolve();
        source.onerror = () => reject(new Error(`Failed to decode mask ${maskId}`));
        source.src = dataUrl;
      });
      const canvas = getOrCreateCanvasFor(maskCanvasRegistry.current, maskId, img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      redrawLayerNode(layerId);
    },
    createMask(maskId: string) {
      const img = imageRef.current;
      if (!img) return;
      let canvas: HTMLCanvasElement;
      if (hasSelection(selection)) {
        canvas = selectionToAlphaCanvas(selection, img.width, img.height);
      } else {
        // No selection: reveal everything, matching Photoshop's default "Add Layer Mask".
        canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      maskCanvasRegistry.current[maskId] = canvas;
    },
    getViewTransform() {
      return { pos, scale };
    },
  }), [onUpdateTextLayer, scale, pos, containerSize, page, selection]);

  const activeSource = showCleaned && page?.cleaned ? page.cleaned : page?.original ?? null;
  // Only meaningful when the cleaned page is the base — overlaying the original above itself is a no-op.
  const overlaySource = showCleaned && overlayOpacity > 0 && page?.cleaned && page?.original ? page.original : null;

  // Load the active image element for Konva.
  useEffect(() => {
    if (!activeSource) { setImage(null); return; }
    const img = new window.Image();
    img.src = activeSource.dataUrl;
    img.onload = () => setImage(img);
    return () => { img.onload = null; };
  }, [activeSource]);

  // Load the original-page overlay image (view-original-above-cleaned mode).
  useEffect(() => {
    if (!overlaySource) { setOverlayImage(null); return; }
    const img = new window.Image();
    img.src = overlaySource.dataUrl;
    img.onload = () => setOverlayImage(img);
    return () => { img.onload = null; };
  }, [overlaySource]);

  // Esc cancels an in-progress Pen path, polygonal lasso, or Transform Selection; Enter commits any of them (or a pending Crop).
  // Esc also clears the pixel selection itself while a marquee/lasso/crop tool is active — the
  // other, more surgical deselect paths (Ctrl+D, an explicit Deselect action) work regardless of
  // tool, but a bare Esc is scoped to the selection tools so it doesn't fight Pen/Transform's own
  // Esc handling above, or surprise-clear a selection a paint tool is deliberately clipped to.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && penDraft.length > 0) { setPenDraft([]); penPlacingRef.current = null; }
      if (e.key === 'Escape' && lassoPolyPoints.length > 0) setLassoPolyPoints([]);
      if (e.key === 'Escape' && transformingSelection) cancelTransformSelection();
      // Esc deselects while a plain marquee/lasso selection tool is active — but not Crop/Slice,
      // which use Esc for their own draft-cancel flow, and only once nothing else above already
      // consumed it (an in-progress pen/lasso-polygon draft or a live Transform Selection box).
      const isSelectionTool = (MARQUEE_TOOLS.has(activeTool) && activeTool !== 'crop' && activeTool !== 'slice') || LASSO_TOOLS.has(activeTool);
      if (
        e.key === 'Escape' && isSelectionTool && hasSelection(selection)
        && penDraft.length === 0 && lassoPolyPoints.length === 0 && !transformingSelection
      ) {
        onSelectionChange(NO_SELECTION);
      }
      if (e.key === 'Enter' && (activeTool === 'pen' || activeTool === 'curvature-pen') && penDraft.length > 1) commitPenLayer(false);
      if (e.key === 'Enter' && (activeTool === 'lasso-polygon' || activeTool === 'lasso-magnetic') && lassoPolyPoints.length > 2) commitLassoPolygon();
      if (e.key === 'Enter' && activeTool === 'crop') onCommitCrop?.();
      if (e.key === 'Enter' && transformingSelection) commitTransformSelection();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penDraft, lassoPolyPoints, activeTool, onCommitCrop, transformingSelection, transformBox, selection, onSelectionChange]);

  // Eyedropper samples from a hidden replica of the background image (approximation — doesn't include raster layers yet).
  useEffect(() => {
    if (!image) { sampleCanvasRef.current = null; return; }
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    sampleCanvasRef.current = canvas;
  }, [image]);

  // Track container size responsively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitToScreen = useCallback(() => {
    if (!image || containerSize.width === 0 || containerSize.height === 0) return;
    const padding = 32;
    const scaleX = (containerSize.width - padding * 2) / image.width;
    const scaleY = (containerSize.height - padding * 2) / image.height;
    // A container briefly shorter/narrower than the padding (a transient layout state during a
    // panel/dock animation, say) makes scaleX/scaleY negative — clamp so a bad measurement can
    // never jump the view to a nonsensical or negative zoom.
    const next = clampScale(Math.min(scaleX, scaleY, 1.5));
    setScale(next);
    setPos({
      x: (containerSize.width - image.width * next) / 2,
      y: (containerSize.height - image.height * next) / 2,
    });
  }, [image, containerSize]);

  // Only auto-fit once per page (or on an explicit Fit-to-Screen command via fitSignal) — not on
  // every container resize. Selecting a text/adjustment layer opens its dock panel and shrinks the
  // canvas container; without this gate, that resize alone would re-run fitToScreen and recentre
  // the whole view out from under an in-progress drag (e.g. moving a text layer with the Move tool).
  const didFitRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${page?.id ?? ''}:${fitSignal}`;
    if (didFitRef.current === key) return;
    if (!image || containerSize.width === 0 || containerSize.height === 0) return;
    didFitRef.current = key;
    fitToScreen();
  }, [fitToScreen, page?.id, fitSignal, image, containerSize]);

  /**
   * Each adjustment renders as a wrapper Group around everything below it (see
   * `layerTree.partitionAdjustments`), cached so `filters()` has a rasterised subtree to work on.
   * `adjustmentNodeRefs` holds those wrappers, keyed by the adjustment layer's id.
   */
  const adjustmentNodeRefs = useRef<Record<string, Konva.Group | null>>({});
  const adjustmentLayers = useMemo(
    () => flattenTree(layers).filter(l => l.type === 'adjustment' && l.adjustment),
    [layers],
  );
  const adjustmentKey = useMemo(
    () => adjustmentLayers.map(l => `${l.id}:${l.visible}:${l.opacity}:${JSON.stringify(l.adjustment)}`).join('|'),
    [adjustmentLayers],
  );

  /**
   * Param changes call `filters()` and **never** `cache()`.
   *
   * Konva's `filters` setter only marks `_filterUpToDate = false`; `_getCachedSceneCanvas` then
   * reuses the cached scene canvas and re-runs just getImageData -> filter -> putImageData, leaving
   * the children alone. Calling `cache()` here instead would redraw the whole subtree on every
   * slider tick, turning a filter pass into a full page render. The structural cache is set up in
   * the effect below, keyed so it can't fire on a param change.
   */
  useEffect(() => {
    for (const layer of adjustmentLayers) {
      const node = adjustmentNodeRefs.current[layer.id];
      if (!node) continue;
      // Hiding an adjustment means dropping its filter, never hiding the wrapper — the wrapper is
      // the stack it adjusts. Opacity is folded into the filter for the same reason: fading the
      // wrapper would fade the page to transparent instead of easing the grade.
      node.filters(layer.visible ? [withStrength(filterForAdjustment(layer.adjustment!), layer.opacity)] : []);
    }
    stageRef.current?.batchDraw();
  }, [adjustmentKey, adjustmentLayers]);

  /**
   * Whether a group is an isolation boundary — i.e. must be rasterized to its own canvas and blitted
   * once, rather than letting its children draw straight onto what's below.
   *
   * This mirrors Photoshop's two group modes, and `isolatesGroup` in `exportImage.ts` **must stay
   * identical** or the screen and the exported file disagree:
   *
   *  - opacity 1 + normal blend => *pass-through*: children composite against everything beneath the
   *    group, exactly as if it weren't there. This is Photoshop's default for a new group, and it
   *    falls out for free from an uncached Konva Group.
   *  - anything else => *isolated*: the subtree composites against nothing but itself, then blits
   *    through the group's own alpha/blend. A Multiply child inside an isolated group therefore has
   *    nothing to multiply with and washes out — surprising, but it is what Photoshop does once a
   *    group stops being pass-through.
   *
   * Child count is deliberately NOT a condition. It's tempting (with one child there's nothing to
   * overlap, so the cache looks redundant) but it's wrong: isolation changes what the child blends
   * *against*, not just how the results stack, so skipping it for single-child groups makes the
   * canvas disagree with the exporter.
   */
  const needsIsolation = useCallback((layer: StudioLayer) =>
    layer.type === 'group' && (layer.opacity < 1 || layer.blendMode !== 'normal'), []);

  /** True when `layerId` is a clip base with layers riding on it — i.e. it renders as a clip run. */
  const hasClippedFollowers = useCallback((layerId: string) => {
    const siblings = getSiblings(layersRef.current, layerId);
    return groupClipRuns(siblings).some(run => run.base.id === layerId && run.followers.length > 0);
  }, []);

  // Re-cache only when the *structure* changes — never on a param tick. `cache()` redraws the whole
  // subtree, so calling it per slider frame would turn a blit into a full page render.
  const groupStructureKey = useMemo(
    () => flattenTree(layers)
      .map(l => `${l.id}:${l.type}:${l.visible}:${l.opacity}:${l.blendMode}:${l.clipped ?? false}:${l.children?.length ?? 0}:${l.mask?.id ?? ''}:${l.mask?.enabled ?? false}`)
      .join('|'),
    [layers],
  );

  useEffect(() => {
    for (const layer of flattenTree(layersRef.current)) {
      const node = layerNodeRefs.current[layer.id];
      if (!node) continue;
      // An adjustment wrapper must be cached whatever its params: `filters()` runs over the cached
      // scene canvas, so without a cache there is nothing for the filter to read.
      //
      // A clip run must be cached too, and that one is a correctness requirement rather than a
      // fidelity one: its trailing `destination-in` pass would otherwise composite against the
      // shared stage canvas and erase every layer already drawn beneath it — the whole page.
      //
      // A layer with an enabled mask needs the identical reasoning: its mask filter (below) only
      // has something to read once the layer is cached — `renderLeaf`'s own content would otherwise
      // draw straight onto the shared canvas with nothing to trim it.
      const isolate = needsIsolation(layer)
        || (layer.type === 'adjustment' && layer.visible)
        || hasClippedFollowers(layer.id)
        || layer.mask?.enabled === true;
      if (isolate) {
        // pixelRatio 1 = page-space pixels. The stage scale is a transform above the cache, so
        // caching at devicePixelRatio would make cost (and memory) scale with zoom for no gain.
        node.cache({ pixelRatio: 1 });
      } else if (node.isCached()) {
        node.clearCache();
      }
      // Set in the same pass as the cache decision above, not a separate effect: `.filters()` only
      // does anything once a node is cached, so the two have to land in the same commit — two
      // effects each calling their own `batchDraw()` risks the browser painting a frame where one
      // updated and the other hasn't yet.
      refreshMaskFilter(layer.id);
    }
    stageRef.current?.batchDraw();
  }, [groupStructureKey, image, needsIsolation, refreshMaskFilter]);

  /**
   * A cached ancestor holds a stale snapshot of its subtree, so a brush stroke on a layer inside an
   * isolated group wouldn't appear until the cache is rebuilt — and rebuilding per stroke segment
   * is a full page redraw per pointermove. Instead, drop those caches for the duration of the
   * stroke and restore them on commit. The group is transiently un-isolated while drawing, which is
   * what Photoshop does on a heavy file too.
   *
   * Includes the paint target's *own* cache too, not just its ancestors': an ordinary clean-patch
   * layer never caches itself, so "ancestors only" used to be exactly every cache that could go
   * stale. A layer with an enabled mask breaks that assumption — masking makes the leaf isolate
   * (cache) itself, so painting its mask now has the identical stale-snapshot problem one level
   * lower, on the target rather than an ancestor.
   */
  const suspendedCachesRef = useRef<string[]>([]);

  const suspendAncestorCaches = useCallback((layerId: string | null) => {
    if (!layerId) return;
    const path = findPath(layersRef.current, layerId);
    if (!path) return;
    const ids: string[] = [];
    for (let i = 1; i <= path.length; i += 1) {
      const ancestor = getAtPath(layersRef.current, path.slice(0, i));
      const node = ancestor ? layerNodeRefs.current[ancestor.id] : null;
      if (ancestor && node?.isCached()) { node.clearCache(); ids.push(ancestor.id); }
    }
    suspendedCachesRef.current = ids;
  }, []);

  const restoreAncestorCaches = useCallback(() => {
    for (const id of suspendedCachesRef.current) layerNodeRefs.current[id]?.cache({ pixelRatio: 1 });
    suspendedCachesRef.current = [];
    stageRef.current?.batchDraw();
  }, []);

  // Freshly created text layers start empty — drop straight into editing mode.
  useEffect(() => {
    const layer = findLayer(layersRef.current, activeLayerId);
    if (layer?.type === 'text' && layer.text?.content === '') {
      setEditingLayerId(layer.id);
    }
  }, [activeLayerId]);

  // Keep the Transformer bound to every selected text node. Konva derives the combined bounding box
  // from the node list itself, so a multi-selection needs no separate box maths.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes = activeTool === 'select' && !editingLayerId
      ? selectionIds.map(id => textNodeRefs.current[id]).filter((n): n is Konva.Group => !!n)
      : [];
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectionIds, activeTool, editingLayerId, layers]);

  // Double-clicking one of the Transformer's own resize handles auto-fits a single selected box
  // (area) text layer's frame tightly to its content, matching Photoshop's bounding-box gesture.
  // Point text has no frame to fit (its width already *is* its content), so it's excluded.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    function onHandleDblClick() {
      if (selectionIds.length !== 1) return;
      const layer = findLayer(layers, selectionIds[0]);
      if (!layer || layer.type !== 'text' || !layer.text || layer.text.autoWidth) return;
      const natural = layoutText({ ...layer.text, autoWidth: true });
      onUpdateTextLayer(layer.id, { width: Math.max(20, natural.width) });
    }
    transformer.on('dblclick dbltap', onHandleDblClick);
    return () => { transformer.off('dblclick dbltap', onHandleDblClick); };
  }, [selectionIds, layers, onUpdateTextLayer]);

  // Seed Select > Transform Selection's box from the current selection's bounds the moment the
  // mode is entered — not every render, or a mid-transform re-render would snap the box back.
  useEffect(() => {
    if (!transformingSelection || !image) return;
    if (!transformOriginRef.current) {
      const bounds = rasterizeSelectionMask(selection, image.width, image.height).bounds;
      transformOriginRef.current = { selection, bounds };
      setTransformBox({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, width: bounds.width, height: bounds.height, rotation: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformingSelection, image]);

  // Keep the second Transformer bound to the transform-selection box while it's up.
  useEffect(() => {
    const transformer = transformerRef2.current;
    if (!transformer) return;
    transformer.nodes(transformBox && transformRectRef.current ? [transformRectRef.current] : []);
    transformer.getLayer()?.batchDraw();
  }, [transformBox]);

  const commitTransformSelection = () => {
    const origin = transformOriginRef.current;
    if (origin && transformBox && image && origin.bounds.width > 0 && origin.bounds.height > 0) {
      const pivotX = origin.bounds.x + origin.bounds.width / 2;
      const pivotY = origin.bounds.y + origin.bounds.height / 2;
      const scaleX = transformBox.width / origin.bounds.width;
      const scaleY = transformBox.height / origin.bounds.height;
      const rotationRad = (transformBox.rotation * Math.PI) / 180;
      const dx = transformBox.x - pivotX;
      const dy = transformBox.y - pivotY;
      onSelectionChange(transformSelectionMask(origin.selection, { dx, dy, scaleX, scaleY, rotationRad, pivotX, pivotY }, image.width, image.height));
    }
    transformOriginRef.current = null;
    setTransformBox(null);
    onExitTransformSelection?.();
  };

  const cancelTransformSelection = () => {
    transformOriginRef.current = null;
    setTransformBox(null);
    onExitTransformSelection?.();
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const targetClass = e.target.getClassName?.();
    // A text layer's hit area is a Rect too, so it must be excluded by name — otherwise clicking
    // text counts as clicking background and clears the selection the click just made.
    const clickedBackground = e.target === e.target.getStage() || targetClass === 'Image'
      || (targetClass === 'Rect' && !e.target.hasName(TEXT_HIT_NAME));

    if (activeTool === 'zoom') {
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;
      const factor = e.evt.altKey ? 1 / 1.5 : 1.5;
      const oldScale = scale;
      const newScale = clampScale(oldScale * factor);
      const pointTo = { x: (pointer.x - pos.x) / oldScale, y: (pointer.y - pos.y) / oldScale };
      setScale(newScale);
      setPos({ x: pointer.x - pointTo.x * newScale, y: pointer.y - pointTo.y * newScale });
      return;
    }

    if (activeTool === 'lasso-polygon' || activeTool === 'lasso-magnetic') {
      const p = imageSpacePointer();
      if (!p) return;
      setLassoPolyPoints(prev => {
        if (prev.length === 0) {
          combineBaseRef.current = selection;
          combineModeRef.current = combineModeFromModifiers(e.evt.shiftKey, e.evt.altKey);
          return [p];
        }
        // Magnetic Lasso: snap this new segment onto nearby strong edges (Dijkstra over a Sobel
        // gradient-magnitude cost field, see magneticLasso.ts) instead of taking the raw click point.
        if (activeTool === 'lasso-magnetic' && sampleCanvasRef.current) {
          const last = prev[prev.length - 1];
          const snapped = snapSegmentToEdges(sampleCanvasRef.current, last, p);
          return [...prev, ...snapped];
        }
        return [...prev, p];
      });
      return;
    }

    // Clicking empty canvas with the Select tool clears the selection — without this there'd be no
    // way to drop a multi-selection short of clicking another layer.
    if (activeTool === 'select') {
      if (objectMarqueeConsumedRef.current) { objectMarqueeConsumedRef.current = false; return; }
      if (clickedBackground) onSelectLayers?.([]);
      return;
    }

    if (activeTool !== 'text') return;
    if (textDragConsumedRef.current) { textDragConsumedRef.current = false; return; }
    if (!clickedBackground) return;
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    onAddTextLayer((pointer.x - pos.x) / scale, (pointer.y - pos.y) / scale);
  };

  const imageSpacePointer = (): { x: number; y: number } | null => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return { x: (pointer.x - pos.x) / scale, y: (pointer.y - pos.y) / scale };
  };

  const handlePaintPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    // A second touch point mid-gesture belongs to two-finger pan/pinch (handled by the Touch
    // handlers below), not tool dispatch — Pointer Events fire per-finger independently.
    if (e.evt.pointerType === 'touch' && touchCount >= 2) return;
    // Middle-mouse-button drag, or left-click while Space is held, pans regardless of the active tool.
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceDown)) {
      e.evt.preventDefault();
      panRef.current = { active: true, lastX: e.evt.clientX, lastY: e.evt.clientY };
      return;
    }
    // While transforming the selection box, only its own Konva drag/Transformer should respond —
    // no marquee/paint/lasso dispatch until it's committed (Enter) or cancelled (Escape).
    if (transformingSelection) return;
    // Type Region: a click landing inside an existing selection (made with any selection tool —
    // marquee, lasso, wand, pen-via-Make-Selection-from-Path) converts it straight into a text
    // container, ahead of whatever the currently active tool would otherwise do with the click.
    if (typeRegionArmed && onCreateTypeRegion && hasSelection(selection)) {
      const p = imageSpacePointer();
      if (p && selectionContainsPoint(selection, p.x, p.y)) {
        onCreateTypeRegion(selection);
        return;
      }
    }
    if (activeTool === 'select') {
      // Dragging inside an active selection on the active raster layer moves the pixel content
      // it encloses, rather than starting a text-multi-select marquee box over it. But a click that
      // lands directly on a text layer's own hit rect must let *that* layer's own Konva drag win —
      // otherwise an unrelated, leftover selection (e.g. from a prior Quick Mask/marquee/wand) that
      // happens to overlap the text would hijack the gesture into cutting/moving the raster layer's
      // pixels instead of repositioning the text, which looks like the page's artwork randomly
      // rearranging itself out from under the user.
      const clickedTextHit = e.target?.hasName?.(TEXT_HIT_NAME);
      const layerId = paintLayerIdRef.current;
      const paintCanvas = layerId ? getActivePaintCanvas() : null;
      if (paintCanvas && layerId && hasSelection(selection) && !clickedTextHit) {
        const p = imageSpacePointer();
        if (p && selectionContainsPoint(selection, p.x, p.y)) {
          const ctx = paintCanvas.getContext('2d')!;
          const before = ctx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
          const mask = rasterizeSelectionMask(selection, paintCanvas.width, paintCanvas.height);
          const { bounds } = mask;
          if (bounds.width > 0 && bounds.height > 0) {
            const content = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
            const erased = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
            for (let row = 0; row < bounds.height; row++) {
              for (let col = 0; col < bounds.width; col++) {
                const maskAlpha = mask.data[(bounds.y + row) * mask.width + (bounds.x + col)] / 255;
                const i = (row * bounds.width + col) * 4;
                content.data[i + 3] = content.data[i + 3] * maskAlpha;
                erased.data[i + 3] = erased.data[i + 3] * (1 - maskAlpha);
              }
            }
            const pieceCanvas = document.createElement('canvas');
            pieceCanvas.width = bounds.width;
            pieceCanvas.height = bounds.height;
            pieceCanvas.getContext('2d')!.putImageData(content, 0, 0);
            ctx.putImageData(erased, bounds.x, bounds.y);
            const cutBase = ctx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
            movingSelectionRef.current = {
              layerId,
              originalSelection: selection,
              before,
              pieceCanvas,
              origin: bounds,
              cutBase,
              dragStart: p,
              lastOffset: { dx: 0, dy: 0 },
            };
            redrawLayerNode(layerId);
          }
          return;
        }
      }
      // Only a drag starting on empty canvas marquees; starting on a layer means move it.
      const targetClass = e.target.getClassName?.();
      const onEmpty = e.target === e.target.getStage() || targetClass === 'Image';
      if (!onEmpty) return;
      const p = imageSpacePointer();
      if (!p) return;
      objectMarqueeRef.current = { x: p.x, y: p.y, additive: e.evt.shiftKey };
      return;
    }
    if (activeTool === 'patch') {
      const layerId = paintLayerIdRef.current;
      const paintCanvas = layerId ? getActivePaintCanvas() : null;
      if (!paintCanvas || !layerId || !hasSelection(selection)) return;
      const p = imageSpacePointer();
      if (!p || !selectionContainsPoint(selection, p.x, p.y)) return;
      const ctx = paintCanvas.getContext('2d')!;
      const before = ctx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
      const { bounds } = rasterizeSelectionMask(selection, paintCanvas.width, paintCanvas.height);
      if (bounds.width <= 0 || bounds.height <= 0) return;
      patchDragRef.current = { layerId, originalSelection: selection, originBounds: bounds, dragStart: p, before, lastOffset: { dx: 0, dy: 0 } };
      return;
    }
    if (activeTool === 'pen' || activeTool === 'curvature-pen') {
      const p = imageSpacePointer();
      if (!p) return;
      // Clicking back on the first anchor (once there's enough to make a real shape) closes the
      // path instead of adding a new one — the same gesture Photoshop uses to finish a closed path.
      if (penDraft.length >= 3) {
        const first = penDraft[0].point;
        if (Math.hypot(p.x - first.x, p.y - first.y) <= 8 / scale) {
          commitPenLayer(true);
          return;
        }
      }
      const newAnchor: PathAnchor = { id: genId('anchor'), point: p, type: 'corner' };
      const placedAt = penDraft.length;
      setPenDraft(prev => {
        const next = [...prev, newAnchor];
        return activeTool === 'curvature-pen' ? applyCurvatureSmoothing(next) : next;
      });
      // Curvature Pen doesn't use the click-drag handle gesture below (its smoothness comes from
      // applyCurvatureSmoothing instead, computed from neighboring anchors, not a drag vector).
      if (activeTool === 'pen') penPlacingRef.current = { index: placedAt, start: p };
      return;
    }
    if (activeTool === 'text') {
      const p = imageSpacePointer();
      if (p) textDragRef.current = p;
      setTextDragPreview(null);
      return;
    }
    if (activeTool === 'wand') {
      const p = imageSpacePointer();
      if (p) {
        const picked = paint.pickMagicWand(p.x, p.y, combineModeFromModifiers(e.evt.shiftKey, e.evt.altKey));
        // Type Region auto-bubble: a wand click has no separate drag-end, so this is its one
        // "the selection just completed" moment — same as the drag tools' pointerup and the
        // click-accumulate lassos' commit.
        if (picked && hasSelection(picked) && typeRegionArmed && onCreateTypeRegion) onCreateTypeRegion(picked);
      }
      return;
    }
    if (activeTool === 'eyedropper') {
      const p = imageSpacePointer();
      const canvas = sampleCanvasRef.current;
      if (!p || !canvas || !onEyedropperPick) return;
      const x = Math.max(0, Math.min(canvas.width - 1, Math.round(p.x)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(p.y)));
      const d = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
      onEyedropperPick(`#${[d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`);
      return;
    }
    if (MARQUEE_TOOLS.has(activeTool) && !quickMaskActive) {
      const p = imageSpacePointer();
      if (!p || !image) return;
      const mode = combineModeFromModifiers(e.evt.shiftKey, e.evt.altKey);
      if (activeTool === 'marquee-row') {
        const rect: Selection = { kind: 'rect', x: 0, y: p.y - 2, width: image.width, height: 4 };
        onSelectionChange(mode === 'replace' ? rect : combineSelections(selection, rect, mode, image.width, image.height));
        return;
      }
      if (activeTool === 'marquee-col') {
        const rect: Selection = { kind: 'rect', x: p.x - 2, y: 0, width: 4, height: image.height };
        onSelectionChange(mode === 'replace' ? rect : combineSelections(selection, rect, mode, image.width, image.height));
        return;
      }
      combineBaseRef.current = selection;
      combineModeRef.current = mode;
      marqueeStartRef.current = p;
      marqueeDraggedRef.current = false;
      return;
    }
    if (LASSO_TOOLS.has(activeTool) && !quickMaskActive) {
      const p = imageSpacePointer();
      if (!p) return;
      combineBaseRef.current = selection;
      combineModeRef.current = combineModeFromModifiers(e.evt.shiftKey, e.evt.altKey);
      lassoPointsRef.current = [p];
      lassoDraggedRef.current = false;
      return;
    }
    if (!isPaintTool) return;
    const p = imageSpacePointer();
    if (!p) return;
    // A real stylus reports actual pressure; mouse/touch report a flat 0.5 per spec, which isn't
    // meaningful pressure data, so only let pen input affect brush size.
    const pressure = e.evt.pointerType === 'pen' ? e.evt.pressure || 0.5 : 1;
    // Drop any cached ancestor group for the duration of the stroke, or its stale snapshot hides
    // every segment until commit and the brush reads as broken. Painting a *mask* deliberately
    // doesn't go through this at all: the mask's own cached scene (the layer's raster content) is
    // untouched by a mask edit, only the filter reading it needs to refresh — clearing and
    // re-establishing the scene cache around every mask stroke was pure overhead that (empirically)
    // raced with the filter update rather than protecting anything.
    if (editingMaskLayer) suspendedCachesRef.current = [];
    else suspendAncestorCaches(paintLayerIdRef.current);
    paint.pointerDown(activeTool as Parameters<typeof paint.pointerDown>[0], p.x, p.y, e.evt.altKey, pressure);
  };
  // Window-level mousemove/mouseup for middle-mouse/space-drag panning, so the drag keeps
  // tracking even if the pointer leaves the canvas bounds.
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const p = panRef.current;
      if (!p?.active) return;
      const dx = e.clientX - p.lastX;
      const dy = e.clientY - p.lastY;
      panRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      setPos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    }
    function onMouseUp() {
      if (panRef.current?.active) panRef.current = null;
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handlePaintPointerMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (panRef.current?.active) return;
    if (e.evt.pointerType === 'touch' && touchCount >= 2) return;
    if (transformingSelection) return;
    if (activeTool === 'text' && textDragRef.current) {
      const p = imageSpacePointer();
      const start = textDragRef.current;
      if (!p) return;
      setTextDragPreview({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      });
      return;
    }
    if (penPlacingRef.current) {
      const p = imageSpacePointer();
      const { index, start } = penPlacingRef.current;
      if (!p) return;
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      // Below the drag dead-zone this still reads as a plain click (corner anchor, no handles) —
      // matching Photoshop's own click-vs-click-drag pen gesture.
      if (Math.hypot(dx, dy) <= 3 / scale) return;
      setPenDraft(prev => prev.map((a, i) => i === index
        ? { ...a, type: 'smooth', handleOut: { x: dx, y: dy }, handleIn: { x: -dx, y: -dy } }
        : a));
      return;
    }
    if (patchDragRef.current) {
      const p = imageSpacePointer();
      const m = patchDragRef.current;
      if (!p || !image) return;
      const dx = Math.round(p.x - m.dragStart.x);
      const dy = Math.round(p.y - m.dragStart.y);
      if (dx === m.lastOffset.dx && dy === m.lastOffset.dy) return;
      m.lastOffset = { dx, dy };
      // Only the marquee slides live — no pixel redraw here, unlike movingSelectionRef's cut-preview.
      onSelectionChange(translateSelection(m.originalSelection, dx, dy, image.width, image.height));
      return;
    }
    if (movingSelectionRef.current) {
      const p = imageSpacePointer();
      const m = movingSelectionRef.current;
      const canvas = getActivePaintCanvas();
      if (!p || !canvas || !image) return;
      const dx = Math.round(p.x - m.dragStart.x);
      const dy = Math.round(p.y - m.dragStart.y);
      if (dx === m.lastOffset.dx && dy === m.lastOffset.dy) return;
      const ctx = canvas.getContext('2d')!;
      const prevRect = { x: m.origin.x + m.lastOffset.dx, y: m.origin.y + m.lastOffset.dy, width: m.origin.width, height: m.origin.height };
      const nextRect = { x: m.origin.x + dx, y: m.origin.y + dy, width: m.origin.width, height: m.origin.height };
      const unionX0 = Math.min(prevRect.x, nextRect.x);
      const unionY0 = Math.min(prevRect.y, nextRect.y);
      const unionX1 = Math.max(prevRect.x + prevRect.width, nextRect.x + nextRect.width);
      const unionY1 = Math.max(prevRect.y + prevRect.height, nextRect.y + nextRect.height);
      const clampX0 = Math.max(0, unionX0);
      const clampY0 = Math.max(0, unionY0);
      const clampX1 = Math.min(canvas.width, unionX1);
      const clampY1 = Math.min(canvas.height, unionY1);
      if (clampX1 > clampX0 && clampY1 > clampY0) {
        ctx.putImageData(m.cutBase, 0, 0, clampX0, clampY0, clampX1 - clampX0, clampY1 - clampY0);
      }
      ctx.drawImage(m.pieceCanvas, m.origin.x + dx, m.origin.y + dy);
      m.lastOffset = { dx, dy };
      redrawLayerNode(m.layerId);
      onSelectionChange(translateSelection(m.originalSelection, dx, dy, image.width, image.height));
      return;
    }
    if (objectMarqueeRef.current) {
      const p = imageSpacePointer();
      if (!p) return;
      const start = objectMarqueeRef.current;
      setObjectMarquee({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      });
      return;
    }
    if (MARQUEE_TOOLS.has(activeTool) && marqueeStartRef.current) {
      const p = imageSpacePointer();
      if (!p) return;
      const start = marqueeStartRef.current;
      if (!marqueeDraggedRef.current) {
        if (Math.hypot(p.x - start.x, p.y - start.y) * scale < DRAG_DEAD_ZONE_PX) return;
        marqueeDraggedRef.current = true;
      }
      let width = Math.abs(p.x - start.x);
      let height = Math.abs(p.y - start.y);
      // Shift constrains Rectangular/Elliptical Marquee to a perfect square/circle, Photoshop-style.
      if (e.evt.shiftKey) {
        const side = Math.max(width, height);
        width = side;
        height = side;
      }
      const rect = {
        x: p.x >= start.x ? start.x : start.x - width,
        y: p.y >= start.y ? start.y : start.y - height,
        width,
        height,
      };
      onSelectionChange(activeTool === 'marquee-ellipse' ? { kind: 'ellipse', ...rect } : { kind: 'rect', ...rect });
      return;
    }
    if (LASSO_TOOLS.has(activeTool) && lassoPointsRef.current) {
      const p = imageSpacePointer();
      if (!p) return;
      if (!lassoDraggedRef.current) {
        const start = lassoPointsRef.current[0];
        if (Math.hypot(p.x - start.x, p.y - start.y) * scale < DRAG_DEAD_ZONE_PX) return;
        lassoDraggedRef.current = true;
      }
      lassoPointsRef.current = [...lassoPointsRef.current, p];
      onSelectionChange({ kind: 'polygon', points: lassoPointsRef.current });
      return;
    }
    if (!isPaintTool) return;
    const p = imageSpacePointer();
    if (!p) return;
    const pressure = e.evt.pointerType === 'pen' ? e.evt.pressure || 0.5 : 1;
    paint.pointerMove(activeTool as Parameters<typeof paint.pointerMove>[0], p.x, p.y, pressure);
    redrawActivePaintTarget();
  };
  const handlePaintPointerUp = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (e.evt.pointerType === 'touch' && touchCount >= 2) return;
    if (panRef.current?.active) { panRef.current = null; return; }
    if (transformingSelection) return;
    if (penPlacingRef.current) {
      // The anchor was already committed into penDraft on pointerdown and kept up to date live on
      // pointermove — pointerup just ends the placement gesture, nothing left to commit here.
      penPlacingRef.current = null;
      return;
    }
    if (patchDragRef.current) {
      const m = patchDragRef.current;
      patchDragRef.current = null;
      onSelectionChange(m.originalSelection); // marquee always returns to its pre-drag spot, Photoshop-style
      if (m.lastOffset.dx === 0 && m.lastOffset.dy === 0) return; // click with no drag: no-op
      const canvas = getActivePaintCanvas();
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      applyPatch(ctx, m.originBounds, m.lastOffset.dx, m.lastOffset.dy);
      redrawLayerNode(m.layerId);
      onPaintStrokeEnd(m.layerId, m.before);
      return;
    }
    if (movingSelectionRef.current) {
      const m = movingSelectionRef.current;
      movingSelectionRef.current = null;
      // A click with no drag is not an intentional edit — revert the cut and skip history/autosave.
      if (m.lastOffset.dx === 0 && m.lastOffset.dy === 0) {
        const canvas = getActivePaintCanvas();
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          ctx.putImageData(m.before, 0, 0);
          redrawLayerNode(m.layerId);
        }
        onSelectionChange(m.originalSelection);
        return;
      }
      if (image) onSelectionChange(translateSelection(m.originalSelection, m.lastOffset.dx, m.lastOffset.dy, image.width, image.height));
      onPaintStrokeEnd(m.layerId, m.before);
      return;
    }
    if (objectMarqueeRef.current) {
      const { additive } = objectMarqueeRef.current;
      const box = objectMarquee;
      objectMarqueeRef.current = null;
      setObjectMarquee(null);
      // A tiny box is a click on empty canvas, not a drag — handleStageClick clears the selection.
      if (!box || box.width < 4 || box.height < 4) return;
      objectMarqueeConsumedRef.current = true;
      const hits = flattenTree(layers)
        .filter(l => l.type === 'text' && !l.locked && l.visible)
        .filter(l => {
          const r = textLayerRect(l.id);
          return !!r && r.x < box.x + box.width && r.x + r.width > box.x
            && r.y < box.y + box.height && r.y + r.height > box.y;
        })
        .map(l => l.id);
      // Shift keeps whatever was already selected, matching the marquee tools' add convention.
      const next = additive ? [...new Set([...selectionIds, ...hits])] : hits;
      onSelectLayers?.(next);
      return;
    }
    if (activeTool === 'text' && textDragRef.current) {
      const start = textDragRef.current;
      textDragRef.current = null;
      setTextDragPreview(null);
      const p = imageSpacePointer();
      const width = p ? Math.abs(p.x - start.x) : 0;
      const height = p ? Math.abs(p.y - start.y) : 0;
      // Below the threshold this was a click, not a drag — let handleStageClick
      // make point text instead. Either dimension crossing it is enough (a drag that's mostly
      // vertical still means "draw a box", not "place a point").
      if (p && (width >= 12 || height >= 12)) {
        textDragConsumedRef.current = true;
        onAddTextLayer(Math.min(start.x, p.x), Math.min(start.y, p.y), Math.max(width, 20), Math.max(height, 20));
      }
      return;
    }
    if (MARQUEE_TOOLS.has(activeTool)) {
      // A click with no real drag never touched the selection (see the dead-zone guard in
      // pointermove) — nothing to combine, and nothing to revert either.
      let finalShape: Selection | null = null;
      if (marqueeStartRef.current && marqueeDraggedRef.current) {
        if (combineModeRef.current !== 'replace' && image) {
          finalShape = combineSelections(combineBaseRef.current, selection, combineModeRef.current, image.width, image.height);
          onSelectionChange(finalShape);
        } else {
          finalShape = selection; // already the live rect/ellipse committed on the last pointermove
        }
      }
      marqueeStartRef.current = null;
      marqueeDraggedRef.current = false;
      // Type Region auto-bubble: only Rectangular/Elliptical Marquee (not row/col/Crop/Slice, which
      // aren't meant to become text containers) — a completed new selection becomes a text container
      // the instant it's drawn, with no separate click needed.
      if (finalShape && typeRegionArmed && onCreateTypeRegion && (activeTool === 'marquee-rect' || activeTool === 'marquee-ellipse')) {
        onCreateTypeRegion(finalShape);
      }
      return;
    }
    if (LASSO_TOOLS.has(activeTool)) {
      let finalShape: Selection | null = null;
      if (lassoPointsRef.current && lassoDraggedRef.current) {
        if (combineModeRef.current !== 'replace' && image) {
          finalShape = combineSelections(combineBaseRef.current, selection, combineModeRef.current, image.width, image.height);
          onSelectionChange(finalShape);
        } else {
          finalShape = { kind: 'polygon', points: lassoPointsRef.current };
        }
      }
      lassoPointsRef.current = null;
      lassoDraggedRef.current = false;
      if (finalShape && typeRegionArmed && onCreateTypeRegion) {
        onCreateTypeRegion(finalShape);
      }
      return;
    }
    if (!isPaintTool) return;
    const p = imageSpacePointer();
    if (!p) return;
    paint.pointerUp(activeTool as Parameters<typeof paint.pointerUp>[0], p.x, p.y);
    redrawActivePaintTarget();
    restoreAncestorCaches();
  };

  const commitPenLayer = (closed: boolean) => {
    if (penDraft.length < 2) { setPenDraft([]); penPlacingRef.current = null; return; }
    onAddPathLayer(penDraft, closed);
    setPenDraft([]);
    penPlacingRef.current = null;
  };

  const commitLassoPolygon = () => {
    if (lassoPolyPoints.length > 2 && image) {
      const shape: Selection = { kind: 'polygon', points: lassoPolyPoints };
      const finalShape = combineModeRef.current === 'replace' ? shape : combineSelections(combineBaseRef.current, shape, combineModeRef.current, image.width, image.height);
      onSelectionChange(finalShape);
      // Type Region auto-bubble: Polygonal/Magnetic Lasso commit here (Enter or click-back-to-first-
      // point), not on pointerup like the drag-based tools — same "completed selection becomes a
      // text container immediately" behavior, just triggered at this gesture's own commit moment.
      if (typeRegionArmed && onCreateTypeRegion) onCreateTypeRegion(finalShape);
    }
    setLassoPolyPoints([]);
  };

  const handleStageDblClick = () => {
    if (activeTool === 'pen' || activeTool === 'curvature-pen') {
      // Konva synthesizes 'dblclick' from any two 'click' events within its own timing window,
      // regardless of where they landed on the stage — and each click already placed its own
      // anchor via pointerdown/up, independent of this handler. Two ordinary clicks placing two
      // *different* anchors in quick succession (a real, not-even-that-fast usage pattern) can
      // therefore misfire this as a "finish" signal. Only treat it as a real double-click-to-finish
      // if the last two placed anchors are actually at (near) the same spot — what an actual
      // double-click always is — otherwise leave the path open for more anchors/Enter/closing-click.
      const n = penDraft.length;
      const last = penDraft[n - 1];
      const prev = penDraft[n - 2];
      const sameSpot = !prev || !last || Math.hypot(last.point.x - prev.point.x, last.point.y - prev.point.y) <= 3 / scale;
      if (sameSpot) commitPenLayer(false);
    }
    if (activeTool === 'lasso-polygon' || activeTool === 'lasso-magnetic') commitLassoPolygon();
    if (activeTool === 'crop') onCommitCrop?.();
  };

  const editingLayer = editingLayerId ? findLayer(layers, editingLayerId) ?? null : null;

  /**
   * The Select tool's drag-a-box-over-empty-canvas object marquee. Distinct from `selection`, which
   * is the *pixel* selection the paint tools clip to — this one picks layers.
   */
  const [objectMarquee, setObjectMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const objectMarqueeRef = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  /**
   * A completed marquee drag still fires a trailing stage click, which would immediately clear the
   * selection the drag just made. Mirrors `textDragConsumedRef`'s handling of the same problem.
   */
  const objectMarqueeConsumedRef = useRef(false);

  /**
   * These refs hold pixel data and geometry captured against the page being *left* — a page switch
   * mid-gesture (e.g. Move-tool cut-drag, Transform Selection, an in-progress marquee/lasso) must
   * not carry any of it onto the newly active page, or a later pointermove/up would apply a stale
   * cut/transform to the wrong page's canvas. A completed Move-tool drag is discarded (reverted to
   * its pre-drag pixels) rather than auto-committed, since by cleanup time there's no further user
   * input to confirm the edit was intentional — matches the existing "zero-movement click reverts"
   * convention on the pointerup path above, just triggered by a page switch instead of a release
   * with no movement. Quick Mask's scratch buffer is deliberately *not* reset here — Studio.tsx's
   * own activePageId-keyed effect already owns that (committing it into the outgoing page's stashed
   * selection before nulling it, via `commitQuickMask()`); duplicating the null-out here would race
   * it, since this cleanup can run before that effect gets a chance to read the buffer.
   */
  useEffect(() => {
    return () => {
      const m = movingSelectionRef.current;
      if (m) {
        const canvas = paintCanvasRegistry.current[m.layerId];
        if (canvas) {
          canvas.getContext('2d')!.putImageData(m.before, 0, 0);
          redrawLayerNode(m.layerId);
        }
        movingSelectionRef.current = null;
      }
      transformOriginRef.current = null;
      setTransformBox(null);
      marqueeStartRef.current = null;
      marqueeDraggedRef.current = false;
      lassoPointsRef.current = null;
      lassoDraggedRef.current = false;
      objectMarqueeRef.current = null;
      setObjectMarquee(null);
    };
  }, [page?.id, redrawLayerNode]);

  /** Page-space bounds of a text layer's node, rotation included (Konva gives it to us). */
  const textLayerRect = (id: string) => {
    const node = textNodeRefs.current[id];
    const konvaLayer = node?.getLayer();
    // Relative to its Konva layer, which carries no transform of its own — so this comes back in
    // page coords rather than screen coords, and stays correct under pan/zoom.
    return node && konvaLayer ? node.getClientRect({ relativeTo: konvaLayer }) : null;
  };


  const reportSelection = useCallback((el: HTMLTextAreaElement) => {
    if (!editingLayerId) return;
    onTextSelectionChange?.({ layerId: editingLayerId, start: el.selectionStart, end: el.selectionEnd });
  }, [editingLayerId, onTextSelectionChange]);

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = scale;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const zoomFactor = 1.08;
    const newScale = clampScale(direction > 0 ? oldScale * zoomFactor : oldScale / zoomFactor);

    const mousePointTo = {
      x: (pointer.x - pos.x) / oldScale,
      y: (pointer.y - pos.y) / oldScale,
    };

    setScale(newScale);
    setPos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length !== 2) return;
    e.evt.preventDefault();

    const [t1, t2] = [touches[0], touches[1]];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const center = {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
    const stage = stageRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!stage || !box) return;
    const stagePoint = { x: center.x - box.left, y: center.y - box.top };

    if (pinchDistRef.current == null || prevPinchCenterRef.current == null) {
      pinchDistRef.current = dist;
      prevPinchCenterRef.current = stagePoint;
      return;
    }

    const oldScale = scale;
    const newScale = clampScale(oldScale * (dist / pinchDistRef.current));
    pinchDistRef.current = dist;

    // Anchor on the previous frame's pinch center (not the current one) so that a plain
    // two-finger drag — no distance change — pans by the center's movement instead of no-op'ing.
    const prevCenter = prevPinchCenterRef.current;
    prevPinchCenterRef.current = stagePoint;
    const anchorWorld = {
      x: (prevCenter.x - pos.x) / oldScale,
      y: (prevCenter.y - pos.y) / oldScale,
    };
    setScale(newScale);
    setPos({
      x: stagePoint.x - anchorWorld.x * newScale,
      y: stagePoint.y - anchorWorld.y * newScale,
    });
  };

  const handleTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length < 2) {
      pinchDistRef.current = null;
      prevPinchCenterRef.current = null;
    }
    setTouchCount(e.evt.touches.length);
  };

  // Space/middle-mouse panning is handled manually via panRef (see handlePaintPointerDown and the
  // window mousemove/mouseup effect) so it works uniformly across tools without fighting Konva's
  // own native drag-handling for the Pan/Select tools.
  // Only the Pan tool drags the stage natively. The Select tool's drag is the object marquee
  // (Part E), so panning while it's active goes through the same Space-hold / middle-drag path
  // every other tool already uses.
  const draggable = activeTool === 'pan' && !spaceDown;
  const panning = panRef.current?.active || spaceDown;
  // Hide the OS cursor while a brush-sized tool is armed — the BrushCursor ring below
  // *is* the cursor, and showing both reads as a doubled pointer.
  const showBrushCursor = !panning && BRUSH_CURSOR_TOOLS.has(activeTool) && brushCursorPos !== null;
  // Move cursor over a text box's own body, away from its Transformer handles (which sit on top
  // and win the hit-test first, so hoveringTextBody never fires for those) — only meaningful with
  // the Select tool actually able to drag it right now.
  const showMoveCursor = !panning && activeTool === 'select' && hoveringTextBody;
  // Not gated on activeTool: the ⊞ indicator's click/dblclick handlers aren't tool-gated either
  // (it's visible/interactive regardless of selection or active tool), so the cursor matches.
  const showOverflowCursor = !panning && hoveringOverflowIndicator;
  const cursorClass = panning ? 'cursor-grab'
    : showBrushCursor ? 'cursor-none'
    : showOverflowCursor ? 'cursor-pointer'
    : showMoveCursor ? 'cursor-move'
    : '';

  /**
   * Renders a layer list (bottom-to-top) as nested Konva Groups.
   *
   * `visible` and `listening` are set from each layer's *own* flags, not effective ones: Konva
   * already cascades both down a Group, so a hidden or locked group hides and deafens its whole
   * subtree for free. (`layerTree`'s `isEffectivelyVisible/Locked` exist for the consumers that
   * don't get that for free — the exporter, mainly.)
   */
  function renderLayerNodes(list: StudioLayer[]) {
    // Adjustments become wrappers around the layers beneath them before anything is drawn.
    return renderNodes(partitionAdjustments(list));
  }

  /**
   * Renders the render-tree produced by `partitionAdjustments`.
   *
   * Clip runs are formed here, *after* the adjustment partition, over the plain-layer nodes only:
   * an adjustment is not a clip base, and clipping to one is meaningless.
   */
  function renderNodes(nodes: RenderNode<StudioLayer>[]) {
    const out: ReactNode[] = [];
    let pending: StudioLayer[] = [];

    const flushClipRuns = () => {
      for (const run of groupClipRuns(pending)) {
        out.push(run.followers.length > 0 ? renderClipRun(run) : renderLeaf(run.base));
      }
      pending = [];
    };

    for (const node of nodes) {
      if (node.kind === 'adjustment') {
        flushClipRuns();
        out.push(renderAdjustmentWrapper(node.layer, node.children));
      } else {
        pending.push(node.layer);
      }
    }
    flushClipRuns();
    return out;
  }

  /**
   * A base layer plus the layers clipped to it, drawn as one **cached** unit:
   * `[base, ...followers, base again with destination-in]`.
   *
   * The trailing re-draw of the base trims the followers to the base's alpha. The cache is a
   * correctness requirement, not an optimisation: `destination-in` against the shared stage canvas
   * would erase everything already painted below it (see `needsIsolation`, which returns true for
   * any run with followers).
   *
   * Why not `source-atop` on each follower? It would occupy the follower's own
   * `globalCompositeOperation` slot, and a clipped **Multiply** layer is *the* standard manga
   * shading idiom — followers have to keep their own blend mode. The run's opacity/blend are the
   * base's, matching Photoshop, where the base drives the group.
   *
   * Only `clean-patch` bases (see `canBeClipBase`): the trim pass re-draws the base as a single
   * `KonvaImage`, and single-child is what makes an uncached `destination-in` behave. A text base
   * would re-draw its hit rect *and* its glyphs, and the per-child composite would wipe the run on
   * the first (transparent) child instead of trimming to the glyphs.
   */
  function renderClipRun(run: ClipRun<StudioLayer>) {
    const { base, followers } = run;
    if (!image) return null;
    const baseCanvas = getOrCreateCanvasFor(paintCanvasRegistry.current, base.id, image.width, image.height);
    return (
      <Group
        key={`clip-${base.id}`}
        ref={(node) => { layerNodeRefs.current[base.id] = node; }}
        visible={base.visible}
        opacity={base.opacity}
        globalCompositeOperation={BLEND_TO_COMPOSITE[base.blendMode]}
        listening={base.visible && !base.locked}
      >
        <KonvaImage image={baseCanvas} width={image.width} height={image.height} listening={false} />
        {followers.map((f) => renderLeaf(f))}
        <KonvaImage
          image={baseCanvas}
          width={image.width}
          height={image.height}
          listening={false}
          globalCompositeOperation="destination-in"
        />
      </Group>
    );
  }

  /**
   * An adjustment layer: a cached Group enclosing everything below it, with the adjustment's filter
   * hung off it. The cache is what gives `filters()` a rasterised subtree to run over — and it's why
   * this is "affects everything below in the stack" rather than "filter the background".
   *
   * The wrapper's own opacity stays 1; the adjustment's opacity lives inside the filter (see the
   * effect above), and its blend mode isn't representable here at all — `LayersPanel` hides that
   * control for adjustments rather than offering one that does nothing.
   */
  function renderAdjustmentWrapper(layer: StudioLayer, children: RenderNode<StudioLayer>[]) {
    return (
      <Group
        key={layer.id}
        ref={(node) => {
          adjustmentNodeRefs.current[layer.id] = node;
          layerNodeRefs.current[layer.id] = node;
        }}
        // Deliberately NOT `visible={layer.visible}`. This Group *contains* everything the
        // adjustment affects, background included, so hiding it would blank the page rather than
        // switch the adjustment off. Hiding is expressed by dropping the filter instead — see the
        // filter effect, which clears `filters()` for a hidden adjustment.
      >
        {renderNodes(children)}
      </Group>
    );
  }

  function renderLeaf(layer: StudioLayer) {
    return (
      <Group
        key={layer.id}
        ref={(node) => { layerNodeRefs.current[layer.id] = node; }}
        visible={layer.visible}
        opacity={layer.opacity}
        globalCompositeOperation={BLEND_TO_COMPOSITE[layer.blendMode]}
        listening={layer.visible && !layer.locked}
      >
        {layer.type === 'group' && renderLayerNodes(layer.children ?? [])}

        {layer.type === 'background' && image && (
          <>
            <KonvaImage ref={bgImageNodeRef} image={image} width={image.width} height={image.height} />
            {/* View Original sits directly above the page and below every real layer. It's inside
                the background's group, so an adjustment above it grades the overlay too — correct,
                since the overlay is a second view of the same page and grading only one would make
                the comparison meaningless. */}
            {overlayImage && (
              <KonvaImage
                image={overlayImage}
                width={image.width}
                height={image.height}
                opacity={overlayOpacity}
                listening={false}
              />
            )}
          </>
        )}

        {layer.type === 'clean-patch' && image && (
          <KonvaImage
            image={getOrCreateCanvasFor(paintCanvasRegistry.current, layer.id, image.width, image.height)}
            width={image.width}
            height={image.height}
            listening={false}
          />
        )}

        {layer.type === 'text' && layer.text && (
          <TextLayerNode
            layer={layer}
            groupRef={(node) => { textNodeRefs.current[layer.id] = node; }}
            editing={layer.id === editingLayerId}
            selected={selectionIds.includes(layer.id) && activeTool === 'select'}
            draggable={activeTool === 'select' && !layer.locked && !spaceDown}
            onSelect={(mode) => onSelectLayer(layer.id, mode)}
            onEdit={() => { onSelectLayer(layer.id); setEditingLayerId(layer.id); }}
            onUpdate={(patch) => onUpdateTextLayer(layer.id, patch)}
            onSelectLine={onTextLineSelectionChange ? (lineIndex) => onTextLineSelectionChange({ layerId: layer.id, lineIndex }) : undefined}
            scale={scale}
            onHoverChange={setHoveringTextBody}
            onAutoFitHeight={() => onAutoFitTextHeight(layer.id)}
            onOverflowHoverChange={setHoveringOverflowIndicator}
          />
        )}

        {layer.type === 'path' && layer.path && (
          <PathLayerNode
            layer={layer}
            groupRef={(node) => { pathNodeRefs.current[layer.id] = node; }}
            selected={selectionIds.includes(layer.id)}
            draggable={activeTool === 'path-select' && !layer.locked}
            directSelect={activeTool === 'direct-select' && !layer.locked}
            onSelect={(mode) => onSelectLayer(layer.id, mode)}
            onUpdate={(patch) => onUpdatePathLayer(layer.id, patch)}
          />
        )}

      </Group>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`studio-canvas-bg relative w-full h-full overflow-hidden touch-none ${cursorClass}`}
      onPointerMove={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        onLiveCursorMove?.({ x: (cx - pos.x) / scale, y: (cy - pos.y) / scale });
        if (!BRUSH_CURSOR_TOOLS.has(activeTool)) return;
        setBrushCursorPos({ x: cx, y: cy });
      }}
      onPointerLeave={() => { setBrushCursorPos(null); onLiveCursorMove?.(null); }}
    >
      {containerSize.width > 0 && (
        <Stage
          ref={stageRef}
          width={containerSize.width}
          height={containerSize.height}
          scaleX={scale}
          scaleY={scale}
          x={pos.x}
          y={pos.y}
          draggable={draggable && touchCount < 2}
          onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchStart={(e) => setTouchCount(e.evt.touches.length)}
          onTouchEnd={handleTouchEnd}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onDblClick={handleStageDblClick}
          onPointerDown={handlePaintPointerDown}
          onPointerMove={handlePaintPointerMove}
          onPointerUp={handlePaintPointerUp}
        >
          {/*
            ONE Konva Layer for the page and its whole stack. Konva `Layer`s are separate canvas
            elements and cannot nest, so a layer-per-StudioLayer could express neither groups nor a
            working blend mode (see `layerNodeRefs`). Sharing one canvas gives both, and makes the
            screen agree with `exportImage.ts`, which has always composited onto a single canvas.
          */}
          <Layer>
            {image && (
              <>
                {/* Page backing + drop shadow. Deliberately outside the layer tree: it isn't a
                    StudioLayer, and it must never end up inside a group's or adjustment's cache. */}
                <Rect
                  x={-4}
                  y={-4}
                  width={image.width + 8}
                  height={image.height + 8}
                  fill="#000000"
                  shadowColor="black"
                  shadowBlur={20}
                  shadowOpacity={0.6}
                />
                {/* The whole stack, background included — the background is root index 0, so it has
                    to be inside the tree for an adjustment above it to enclose (and grade) it. */}
                {renderLayerNodes(layers)}
              </>
            )}
          </Layer>

          {quickMaskActive && image && (
            <Layer listening={false}>
              {/* Rubylith tint: red over everything NOT currently selected in the quick mask buffer.
                  Regenerated by redrawQuickMaskOverlay after every paint change, not on every render. */}
              <KonvaImage ref={quickMaskImageRef} image={quickMaskOverlayCanvasRef.current} width={image.width} height={image.height} />
            </Layer>
          )}

          <Layer listening={false}>
            {/* Object marquee — solid accent fill, deliberately unlike the dashed white *pixel*
                selection, since the two mean different things (pick layers vs clip paint). */}
            {objectMarquee && (
              <Rect
                x={objectMarquee.x} y={objectMarquee.y}
                width={objectMarquee.width} height={objectMarquee.height}
                fill="rgba(56, 189, 248, 0.12)"
                stroke="#38bdf8"
                strokeWidth={1 / scale}
              />
            )}
            {selection.kind === 'rect' && (
              <Rect x={selection.x} y={selection.y} width={selection.width} height={selection.height}
                stroke="#ffffff" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]} />
            )}
            {selection.kind === 'ellipse' && (
              <Ellipse x={selection.x + selection.width / 2} y={selection.y + selection.height / 2}
                radiusX={Math.abs(selection.width) / 2} radiusY={Math.abs(selection.height) / 2}
                stroke="#ffffff" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]} />
            )}
            {selection.kind === 'polygon' && selection.points.length > 1 && (
              <Line points={selection.points.flatMap(p => [p.x, p.y])} closed
                stroke="#ffffff" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]} />
            )}
            {selection.kind === 'mask' && (
              <Rect x={selection.bounds.x} y={selection.bounds.y} width={selection.bounds.width} height={selection.bounds.height}
                stroke="#ffffff" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]} opacity={0.8} />
            )}
            {queuedBubbleRects?.map((rect, i) => (
              <Rect key={i} x={rect.x} y={rect.y} width={rect.width} height={rect.height}
                stroke="#f59e0b" strokeWidth={1.5 / scale} dash={[4 / scale, 3 / scale]} />
            ))}
            {queuedSliceRects?.map((rect, i) => (
              <Rect key={i} x={rect.x} y={rect.y} width={rect.width} height={rect.height}
                stroke="#22d3ee" strokeWidth={1.5 / scale} dash={[4 / scale, 3 / scale]} />
            ))}
            {/* Live area-text drag preview — a dashed rect that tracks the drag exactly, plus a
                W×H readout at its bottom-left corner (Photoshop's own convention for this gesture).
                Font size is counter-scaled by 1/scale so the label reads the same physical size on
                screen at any zoom, matching every other zoom-compensated stroke width in this file. */}
            {textDragPreview && (
              <>
                <Rect
                  x={textDragPreview.x} y={textDragPreview.y}
                  width={textDragPreview.width} height={textDragPreview.height}
                  stroke="#38bdf8" strokeWidth={1 / scale} dash={[6 / scale, 4 / scale]}
                />
                <KonvaText
                  text={`W: ${Math.round(textDragPreview.width)} px / H: ${Math.round(textDragPreview.height)} px`}
                  x={textDragPreview.x}
                  y={textDragPreview.y + textDragPreview.height + 4 / scale}
                  fontSize={12 / scale}
                  fill="#38bdf8"
                  listening={false}
                />
              </>
            )}
            {penDraft.length > 0 && (
              <>
                {/* Live curved preview — real bezier via traceAnchors, the same function the
                    committed PathLayerNode and export/bake paths use, so what's shown while
                    placing anchors is exactly what gets persisted, not an approximation. */}
                <Shape
                  sceneFunc={(ctx, shape) => {
                    ctx.beginPath();
                    traceAnchors(ctx, penDraft, false);
                    ctx.fillStrokeShape(shape);
                  }}
                  stroke={paintSettings.color}
                  strokeWidth={2 / scale}
                  listening={false}
                />
                {penDraft.map((a, i) => (
                  <Group key={a.id}>
                    {(a.handleIn || a.handleOut) && (
                      <Line
                        points={[
                          a.point.x + (a.handleIn?.x ?? 0), a.point.y + (a.handleIn?.y ?? 0),
                          a.point.x + (a.handleOut?.x ?? 0), a.point.y + (a.handleOut?.y ?? 0),
                        ]}
                        stroke="#38bdf8" strokeWidth={1 / scale} listening={false}
                      />
                    )}
                    {a.handleOut && (
                      <Ellipse x={a.point.x + a.handleOut.x} y={a.point.y + a.handleOut.y} radiusX={3 / scale} radiusY={3 / scale} fill="#38bdf8" listening={false} />
                    )}
                    {a.handleIn && (
                      <Ellipse x={a.point.x + a.handleIn.x} y={a.point.y + a.handleIn.y} radiusX={3 / scale} radiusY={3 / scale} fill="#38bdf8" listening={false} />
                    )}
                    <Rect
                      x={a.point.x - 3 / scale} y={a.point.y - 3 / scale} width={6 / scale} height={6 / scale}
                      fill={i === 0 ? '#ffffff' : paintSettings.color} stroke="#000000" strokeWidth={0.5 / scale} listening={false}
                    />
                  </Group>
                ))}
              </>
            )}
            {lassoPolyPoints.length > 0 && (
              <>
                <Line points={lassoPolyPoints.flatMap(p => [p.x, p.y])} closed={lassoPolyPoints.length > 2}
                  stroke="#ffffff" strokeWidth={1.5 / scale} dash={[6 / scale, 4 / scale]} />
                {lassoPolyPoints.map((p, i) => (
                  <Rect key={i} x={p.x - 3 / scale} y={p.y - 3 / scale} width={6 / scale} height={6 / scale} fill="#ffffff" />
                ))}
              </>
            )}
          </Layer>

          {showGrid && image && (
            <Layer listening={false}>
              {Array.from({ length: Math.floor(image.width / GRID_SIZE) + 1 }, (_, i) => i * GRID_SIZE).map(x => (
                <Line key={`gx${x}`} points={[x, 0, x, image.height]} stroke="#00aaff" strokeWidth={1 / scale} opacity={0.35} />
              ))}
              {Array.from({ length: Math.floor(image.height / GRID_SIZE) + 1 }, (_, i) => i * GRID_SIZE).map(y => (
                <Line key={`gy${y}`} points={[0, y, image.width, y]} stroke="#00aaff" strokeWidth={1 / scale} opacity={0.35} />
              ))}
            </Layer>
          )}

          <Layer>
            {/* listening={false} while Space is held: a Transformer's resize/rotate handles are
                always internally draggable, independent of the selected node's own `draggable`
                prop (which the text Group already gates on spaceDown — see its `draggable` prop
                below). Without this, a Space-held pan-drag that happened to land on a visible
                handle (very plausible — the handles sit right around any selected text) started
                *both* the manual pan and Konva's own anchor-drag (a resize) from the same
                gesture, fighting each other and reading as the view jumping/the text warping. */}
            {/* keepRatio/centeredScaling: this Transformer's `nodes()` are always exactly the
                selected text layers (see the binding effect below), so these only ever govern
                text corner-drags — Shift constrains the box (and, since fontSize scales with
                scaleY in onTransformEnd, the type size) proportionally; Alt resizes around the
                box's own center instead of the opposite corner. Both are plain Konva props it
                re-reads every transform frame, so toggling the React state mid-drag (via the
                shiftHeld/altHeld keydown/keyup effect above) takes effect immediately. */}
            <Transformer
              ref={transformerRef}
              rotateEnabled
              listening={!spaceDown}
              keepRatio={shiftHeld}
              centeredScaling={altHeld}
              // Dashed, not Konva's default solid border — matches the dashed-outline convention
              // every other selection/preview overlay in this file already uses (marching ants,
              // Type Region's shape outline, the drag-preview rect above).
              borderDash={[4, 3]}
              anchorCornerRadius={2}
              enabledAnchors={['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 20 ? oldBox : newBox)}
            />
          </Layer>

          {transformingSelection && transformBox && (
            <Layer>
              {/* Select > Transform Selection: reshapes the selection's own geometry only, never the
                  pixels underneath — Enter commits (see commitTransformSelection), Escape cancels. */}
              <Rect
                ref={transformRectRef}
                x={transformBox.x}
                y={transformBox.y}
                width={transformBox.width}
                height={transformBox.height}
                offsetX={transformBox.width / 2}
                offsetY={transformBox.height / 2}
                rotation={transformBox.rotation}
                draggable
                fill="rgba(56, 189, 248, 0.08)"
                stroke="#38bdf8"
                strokeWidth={1 / scale}
                dash={[6 / scale, 4 / scale]}
                onDragEnd={(e) => setTransformBox(b => (b ? { ...b, x: e.target.x(), y: e.target.y() } : b))}
                onTransformEnd={(e) => {
                  const node = e.target as Konva.Rect;
                  const sX = node.scaleX();
                  const sY = node.scaleY();
                  node.scaleX(1);
                  node.scaleY(1);
                  setTransformBox(b => (b ? {
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(4, b.width * sX),
                    height: Math.max(4, b.height * sY),
                  } : b));
                }}
              />
              <Transformer
                ref={transformerRef2}
                rotateEnabled
                listening={!spaceDown}
                boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
              />
            </Layer>
          )}
        </Stage>
      )}
      {editingLayer?.text && (
        <textarea
          autoFocus
          // Marks this textarea so useStudioShortcuts can let Ctrl/Cmd+B / +I through while editing
          // dialogue text (that's exactly when they're needed) without opening up every other
          // shortcut — see isStudioTextEditor() there.
          data-studio-text-editor="true"
          // Right-aligned text is this app's existing proxy for "this layer is RTL" (see
          // isArabicMajority's auto-default in Studio.tsx) — `dir="rtl"` is what actually moves the
          // caret to the visual right and reverses arrow-key/typing direction to match. A freshly
          // created, still-empty box defaults to center align, so it starts `ltr` and only flips
          // once Arabic content is typed and align auto-switches, exactly mirroring that heuristic.
          dir={editingLayer.text.align === 'right' ? 'rtl' : 'ltr'}
          value={editingLayer.text.content}
          onChange={(e) => {
            const prev = editingLayer.text!;
            // Runs are indexed against `content`, so any content change has to re-anchor them or
            // styled spans would slide off their characters as you type.
            onUpdateTextLayer(editingLayer.id, {
              content: e.target.value,
              runs: reflowRunsForContent(prev.content, e.target.value, prev.runs ?? []),
            });
            reportSelection(e.target);
          }}
          onSelect={(e) => reportSelection(e.currentTarget)}
          onKeyUp={(e) => reportSelection(e.currentTarget)}
          onMouseUp={(e) => reportSelection(e.currentTarget)}
          // Triple-click selects the whole item (Part D). The textarea sits above the stage once
          // editing starts, so the third click never reaches the Konva node — it has to be handled
          // here, not on the shape.
          onClick={(e) => { if (e.detail === 3) e.currentTarget.select(); reportSelection(e.currentTarget); }}
          onBlur={() => { setEditingLayerId(null); onTextSelectionChange?.(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditingLayerId(null); }}
          className="absolute p-0 m-0 bg-black/20 border border-dashed border-white/50 outline-none resize-none overflow-hidden"
          style={{
            // Layout (width/fontSize) is intentionally left in unscaled page-space units and only
            // the *transform* scales it to match canvas zoom — mobile Safari/Chrome auto-zoom the
            // whole viewport when a focused input's computed font-size is under ~16px, which most
            // text layers' `fontSize * scale` dips under well before that at normal editing zoom
            // levels (a 24px bubble font at 50% zoom is a 12px textarea). A `transform: scale()`
            // changes only the rendered size, not the computed font-size the browser's heuristic
            // reads, so tapping into a small bubble at a zoomed-out view no longer yanks the whole
            // page's viewport zoom to somewhere else on screen.
            top: pos.y + editingLayer.text.y * scale,
            left: pos.x + editingLayer.text.x * scale,
            width: editingLayer.text.autoWidth ? layoutText(editingLayer.text).width : editingLayer.text.width,
            fontSize: editingLayer.text.fontSize,
            fontFamily: editingLayer.text.fontFamily,
            fontWeight: editingLayer.text.bold ? 'bold' : 'normal',
            fontStyle: editingLayer.text.italic ? 'italic' : 'normal',
            lineHeight: editingLayer.text.lineHeight,
            color: editingLayer.text.color,
            textAlign: editingLayer.text.align,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            zIndex: 20,
          }}
        />
      )}
      {editingLayer?.text && (() => {
        const t = editingLayer.text!;
        const w = t.autoWidth ? layoutText(t).width : t.width;
        const h = t.autoWidth ? layoutText(t).height : (t.fixedHeight ?? layoutText(t).height);
        return (
          <FloatingTextToolbar
            text={t}
            boxScreenRect={{ left: pos.x + t.x * scale, top: pos.y + t.y * scale, width: w * scale, height: h * scale }}
            containerHeight={containerSize.height}
            fontFamilies={fontFamilies}
            onUpdate={(patch) => onUpdateTextLayer(editingLayer.id, patch)}
          />
        );
      })()}
      {showBrushCursor && (
        <BrushCursor pos={brushCursorPos} scale={scale} settings={paintSettings} tool={activeTool} />
      )}
      {!page && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
          <ImageIcon size={28} className="text-white/25" strokeWidth={1.5} />
          <p className="text-title font-medium text-white/50">No page selected</p>
          <p className="text-ui text-white/30 max-w-xs">Pick a page from the Pages panel to start cleaning and typesetting.</p>
        </div>
      )}
      {showRulers && image && (
        <>
          <div className="absolute top-0 left-0 right-0 h-5 bg-black/60 border-b border-white/10 overflow-hidden pointer-events-none z-10" style={{ marginLeft: RULER_SIZE }}>
            {Array.from({ length: Math.floor(image.width / RULER_STEP) + 1 }, (_, i) => i * RULER_STEP).map(x => (
              <span key={x} className="absolute top-0 h-full flex items-center text-[9px] text-white/50 font-mono border-l border-white/20 pl-0.5"
                style={{ left: pos.x + x * scale }}>{x}</span>
            ))}
          </div>
          <div className="absolute top-0 left-0 bottom-0 w-5 bg-black/60 border-r border-white/10 overflow-hidden pointer-events-none z-10" style={{ marginTop: RULER_SIZE }}>
            {Array.from({ length: Math.floor(image.height / RULER_STEP) + 1 }, (_, i) => i * RULER_STEP).map(y => (
              <span key={y} className="absolute left-0 w-full text-[9px] text-white/50 font-mono border-t border-white/20 pt-0.5 text-center"
                style={{ top: pos.y + y * scale }}>{y}</span>
            ))}
          </div>
          <div className="absolute top-0 left-0 w-5 h-5 bg-black/70 z-20" />
        </>
      )}
      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-control liquid-glass text-micro font-mono text-white/80">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
});

export function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}

/**
 * A layer-mask trim, applied as a Konva filter rather than a `destination-in` sibling `KonvaImage`
 * inside the cached group. Konva's `filters()` reruns just `getImageData -> filter -> putImageData`
 * over the *already-cached* scene canvas (see the adjustment-filter effect above for the same
 * mechanism, proven live) — cheap, and safe to call again after every mask stroke. Compositing the
 * mask as a sibling image instead (drawn once, at `.cache()` time) turned out to go stale after a
 * live-edited mask was re-cached, because Konva's shape-level buffer-canvas draw path re-applies a
 * shape's own composite operation relative to whichever node is being cached — correct for a single
 * cache pass, but not something to re-derive per keystroke. A filter avoids the whole question: it
 * reads the mask canvas's current pixels fresh on every invocation.
 */
function maskAlphaFilter(maskCanvas: HTMLCanvasElement) {
  return function (this: Konva.Node, imageData: ImageData) {
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = (data[i] * maskData[i]) / 255;
    }
  };
}

function waitForImage(imageRef: { current: HTMLImageElement | null }, timeoutMs = 3000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    function check() {
      if (imageRef.current) { resolve(imageRef.current); return; }
      if (performance.now() - start > timeoutMs) { resolve(null); return; }
      requestAnimationFrame(check);
    }
    check();
  });
}

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}
