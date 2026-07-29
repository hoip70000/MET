import { useCallback, useRef } from 'react';
import {
  applyFilterBrush, applyGradient, cloneSegment, healSegment, contentAwareFill, drawShape, floodFillAt, strokeSegment, liquify,
  type PaintSettings, type PaintTool,
} from './paintEngine';
import { magicWandMask, refineMaskedRegion, combineSelections, NO_SELECTION, type Selection, type SelectionCombineMode } from './selection';

export const PAINT_TOOLS: PaintTool[] = [
  'brush', 'pencil', 'eraser', 'bucket', 'gradient', 'clone', 'heal', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'contentAware',
  'shape-rect', 'shape-ellipse', 'shape-line', 'spot-heal', 'liquify',
];

interface UsePaintLayerArgs {
  getCanvas: () => HTMLCanvasElement | null;
  settings: PaintSettings;
  selection: Selection;
  onSelectionChange?: (sel: Selection) => void;
  /** Called once per committed stroke/fill with the layer's pixels as they were just before it, for undo. */
  onStrokeEnd: (before: ImageData) => void;
  /** Identifies the active raster layer, for keying `liquifySnapshots`. */
  getLayerId?: () => string | null;
  /** Mutable map owned by the caller (StudioCanvas) — a layer's pristine pre-liquify pixels,
   *  captured lazily on that layer's first-ever liquify edit, for the `reconstruct` mode. */
  liquifySnapshots?: Record<string, ImageData>;
  /** Magic Wand's source when no clean-patch layer is active (e.g. Background selected) — a
   *  read-only snapshot of the composited page art, so the wand can select from the actual
   *  manga art instead of silently no-op'ing against a nonexistent raster canvas. */
  getFallbackCanvas?: () => HTMLCanvasElement | null;
  /** Fired whenever Clone/Heal's alt-clicked sample source is (re)set, so the caller can drive a
   *  live source-point cursor indicator. Mirrors cloneSourceRef's own value; not cleared between
   *  strokes, matching that ref's intentional "persists across strokes" behavior. */
  onCloneSourceSet?: (pt: { x: number; y: number }) => void;
}

/**
 * Owns the pointer-drag lifecycle for every brush-family tool. StudioCanvas calls
 * `handlers.pointerDown/Move/Up` from the Stage's pointer events (in page-pixel
 * coordinates) only when `activeTool` is one of PAINT_TOOLS; select/pan/text keep
 * their existing, untouched code paths.
 */
export function usePaintLayer({ getCanvas, settings, selection, onSelectionChange, onStrokeEnd, getLayerId, liquifySnapshots, getFallbackCanvas, onCloneSourceSet }: UsePaintLayerArgs) {
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  // Intentionally shared between Clone Stamp and Healing Brush — Photoshop keeps one source point
  // across both tools too, so alt-clicking with one and painting with the other is expected, not a bug.
  const cloneSourceRef = useRef<{ x: number; y: number } | null>(null);
  const cloneOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const gradientStartRef = useRef<{ x: number; y: number } | null>(null);
  const contentAwareStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const sourceSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  const strokeBeforeRef = useRef<ImageData | null>(null);

  // --- Brush/Pencil/Eraser stroke buffer -------------------------------------
  // A whole stroke accumulates into this scratch canvas at `flow` alpha, then is
  // composited onto the layer at `opacity`. Without the buffer, overlapping
  // stamps within one stroke would keep darkening past the opacity cap (which is
  // exactly what the old `opacity * flow` per-stamp alpha did).
  const strokeBufferRef = useRef<HTMLCanvasElement | null>(null);
  /** Union of every stamp bbox this stroke, so compositing only touches dirty pixels. */
  const strokeBoxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  /** Pull-string smoothing anchor: the lagging point that actually gets painted. */
  const smoothRef = useRef<{ x: number; y: number } | null>(null);

  function getStrokeBuffer(w: number, h: number): HTMLCanvasElement {
    let buf = strokeBufferRef.current;
    if (!buf) {
      buf = document.createElement('canvas');
      strokeBufferRef.current = buf;
    }
    if (buf.width !== w || buf.height !== h) {
      buf.width = w;
      buf.height = h;
    } else {
      buf.getContext('2d')!.clearRect(0, 0, w, h);
    }
    return buf;
  }

  /** The buffer for the stroke in flight, sized to the layer. Null if pointerDown never ran. */
  function getStrokeBufferForStroke(ctx: CanvasRenderingContext2D): HTMLCanvasElement | null {
    const buf = strokeBufferRef.current;
    if (!buf) return null;
    if (buf.width !== ctx.canvas.width || buf.height !== ctx.canvas.height) return null;
    return buf;
  }

  function growBox(box: { minX: number; minY: number; maxX: number; maxY: number } | null) {
    if (!box) return;
    const cur = strokeBoxRef.current;
    strokeBoxRef.current = cur
      ? {
          minX: Math.min(cur.minX, box.minX),
          minY: Math.min(cur.minY, box.minY),
          maxX: Math.max(cur.maxX, box.maxX),
          maxY: Math.max(cur.maxY, box.maxY),
        }
      : box;
  }

  /**
   * Re-renders the dirty region of the layer as (pre-stroke pixels + stroke buffer @ opacity).
   * Called after each segment so the stroke is visible live while still obeying the opacity cap.
   */
  function compositeStroke(ctx: CanvasRenderingContext2D, tool: 'brush' | 'pencil' | 'eraser') {
    const before = strokeBeforeRef.current;
    const buf = strokeBufferRef.current;
    const box = strokeBoxRef.current;
    if (!before || !buf || !box) return;
    const x = Math.max(0, Math.floor(box.minX));
    const y = Math.max(0, Math.floor(box.minY));
    const w = Math.min(ctx.canvas.width - x, Math.ceil(box.maxX) - x + 1);
    const h = Math.min(ctx.canvas.height - y, Math.ceil(box.maxY) - y + 1);
    if (w <= 0 || h <= 0) return;

    // putImageData is a raw write (ignores alpha/composite), so this restores the
    // dirty region to its pre-stroke state before we lay the stroke back down.
    ctx.putImageData(before, 0, 0, x, y, w, h);
    ctx.save();
    ctx.globalAlpha = settings.opacity;
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.drawImage(buf, x, y, w, h, x, y, w, h);
    ctx.restore();
  }

  const pointerDown = useCallback((tool: PaintTool, x: number, y: number, altKey: boolean, pressure = 1) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if ((tool === 'clone' || tool === 'heal') && altKey) {
      cloneSourceRef.current = { x, y };
      onCloneSourceSet?.({ x, y });
      return;
    }
    if (tool === 'gradient') {
      gradientStartRef.current = { x, y };
      return;
    }
    if (tool === 'contentAware') {
      contentAwareStartRef.current = { x, y };
      return;
    }
    if (tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-line') {
      shapeStartRef.current = { x, y };
      return;
    }
    if (tool === 'bucket') {
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      floodFillAt(ctx, canvas.width, canvas.height, x, y, settings, selection);
      if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
      onStrokeEnd(before);
      return;
    }
    if ((tool === 'clone' || tool === 'heal') && cloneSourceRef.current) {
      cloneOffsetRef.current = { x: x - cloneSourceRef.current.x, y: y - cloneSourceRef.current.y };
      const snap = document.createElement('canvas');
      snap.width = canvas.width;
      snap.height = canvas.height;
      snap.getContext('2d')!.drawImage(canvas, 0, 0);
      sourceSnapshotRef.current = snap;
    }

    if (tool === 'liquify' && liquifySnapshots) {
      const layerId = getLayerId?.();
      if (layerId && !liquifySnapshots[layerId]) {
        liquifySnapshots[layerId] = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    }

    strokeBeforeRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    drawingRef.current = true;
    lastRef.current = { x, y };
    if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
      getStrokeBuffer(canvas.width, canvas.height);
      strokeBoxRef.current = null;
      smoothRef.current = { x, y };
    }
    applyStrokeSegment(ctx, tool, x, y, x, y, pressure);
  }, [getCanvas, settings, selection, onStrokeEnd, getLayerId, liquifySnapshots, onCloneSourceSet]);

  function applyStrokeSegment(ctx: CanvasRenderingContext2D, tool: PaintTool, lastX: number, lastY: number, x: number, y: number, pressure = 1) {
    if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
      // Stamps go into the stroke buffer at `flow`, never straight onto the layer;
      // compositeStroke then lays the buffer down at `opacity`. See the buffer
      // block above for why the two sliders need to stay separate.
      const buf = getStrokeBufferForStroke(ctx);
      if (!buf) return;
      const bufCtx = buf.getContext('2d')!;
      const w = ctx.canvas.width, h = ctx.canvas.height;

      growBox(strokeSegment(bufCtx, lastX, lastY, x, y, settings, tool, selection, pressure));
      // Symmetry mode: mirror the same segment across the canvas center. Real per-stamp
      // mirroring (not just a post-hoc flip), so it works mid-stroke exactly like Photoshop's.
      if (settings.symmetry === 'horizontal' || settings.symmetry === 'both') {
        growBox(strokeSegment(bufCtx, w - lastX, lastY, w - x, y, settings, tool, selection, pressure));
      }
      if (settings.symmetry === 'vertical' || settings.symmetry === 'both') {
        growBox(strokeSegment(bufCtx, lastX, h - lastY, x, h - y, settings, tool, selection, pressure));
      }
      if (settings.symmetry === 'both') {
        growBox(strokeSegment(bufCtx, w - lastX, h - lastY, w - x, h - y, settings, tool, selection, pressure));
      }
      compositeStroke(ctx, tool);
    } else if ((tool === 'clone' || tool === 'heal') && cloneOffsetRef.current && sourceSnapshotRef.current) {
      if (tool === 'clone') {
        cloneSegment(ctx, sourceSnapshotRef.current, lastX, lastY, x, y, settings.size, cloneOffsetRef.current.x, cloneOffsetRef.current.y, selection);
      } else {
        healSegment(ctx, sourceSnapshotRef.current, lastX, lastY, x, y, settings.size, cloneOffsetRef.current.x, cloneOffsetRef.current.y, selection);
      }
    } else if (tool === 'blur' || tool === 'sharpen' || tool === 'smudge' || tool === 'dodge' || tool === 'burn' || tool === 'sponge') {
      applyFilterBrush(ctx, x, y, settings.size, settings.flow, tool, x - lastX, y - lastY, selection);
    } else if (tool === 'liquify') {
      const pristine = liquifySnapshots && getLayerId ? liquifySnapshots[getLayerId() ?? ''] : null;
      liquify(ctx, x, y, settings.size, settings.flow, settings.liquifyMode, x - lastX, y - lastY, selection, pristine);
    } else if (tool === 'spot-heal') {
      const r = Math.max(4, settings.size / 2);
      contentAwareFill(ctx, { x: x - r, y: y - r, width: r * 2, height: r * 2 });
    }
  }

  const pointerMove = useCallback((tool: PaintTool, x: number, y: number, pressure = 1) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (tool === 'gradient' && gradientStartRef.current) return; // committed on pointerUp
    if (tool === 'contentAware' && contentAwareStartRef.current) return; // committed on pointerUp
    if ((tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-line') && shapeStartRef.current) return; // committed on pointerUp

    if (!drawingRef.current || !lastRef.current) return;
    const last = lastRef.current;

    // Pull-string smoothing: the painted point chases the raw pointer instead of
    // tracking it exactly, which damps hand jitter. smoothing=0 paints the raw
    // pointer (identical to the old behaviour); higher values lag further behind.
    let tx = x, ty = y;
    const isStrokeTool = tool === 'brush' || tool === 'pencil' || tool === 'eraser';
    if (isStrokeTool && settings.smoothing > 0 && smoothRef.current) {
      const follow = 1 - Math.min(0.95, settings.smoothing * 0.9);
      tx = smoothRef.current.x + (x - smoothRef.current.x) * follow;
      ty = smoothRef.current.y + (y - smoothRef.current.y) * follow;
      smoothRef.current = { x: tx, y: ty };
    } else if (isStrokeTool) {
      smoothRef.current = { x, y };
    }

    applyStrokeSegment(ctx, tool, last.x, last.y, tx, ty, pressure);
    lastRef.current = { x: tx, y: ty };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCanvas, settings, selection]);

  const pointerUp = useCallback((tool: PaintTool, x: number, y: number) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (tool === 'gradient' && gradientStartRef.current && ctx) {
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Foreground-to-background, matching Photoshop's default Gradient tool convention.
      applyGradient(ctx, canvas.width, canvas.height, gradientStartRef.current.x, gradientStartRef.current.y, x, y, settings.color, settings.bgColor, selection);
      if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
      gradientStartRef.current = null;
      onStrokeEnd(before);
      return;
    }
    if (tool === 'contentAware' && contentAwareStartRef.current && ctx) {
      const start = contentAwareStartRef.current;
      const rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
      contentAwareStartRef.current = null;
      if (rect.width > 4 && rect.height > 4) {
        const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
        contentAwareFill(ctx, rect);
        if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
        onStrokeEnd(before);
      }
      return;
    }
    if ((tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-line') && shapeStartRef.current && ctx) {
      const start = shapeStartRef.current;
      shapeStartRef.current = null;
      const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
      drawShape(ctx, tool, start.x, start.y, x, y, { fillColor: tool === 'shape-line' ? null : settings.color, strokeColor: settings.color, strokeWidth: Math.max(2, settings.size / 6) }, selection);
      if (selection.kind === 'mask') refineMaskedRegion(ctx, selection, before);
      onStrokeEnd(before);
      return;
    }

    if (drawingRef.current) {
      drawingRef.current = false;
      lastRef.current = null;
      if (strokeBeforeRef.current) {
        if (selection.kind === 'mask' && ctx) refineMaskedRegion(ctx, selection, strokeBeforeRef.current);
        onStrokeEnd(strokeBeforeRef.current);
      }
      strokeBeforeRef.current = null;
    }
  }, [getCanvas, settings, selection, onStrokeEnd]);

  /** Returns the final selection it committed (not just void) — Magic Wand fires on a single
   *  click with no separate drag-end moment, so a caller that needs "the shape this gesture just
   *  produced" (Type Region's auto-bubble) can't wait for a re-render and read the `selection`
   *  prop back, since that would still be the pre-click value in the same synchronous tick. */
  const pickMagicWand = useCallback((x: number, y: number, combineMode: SelectionCombineMode = 'replace'): Selection | null => {
    const canvas = getCanvas() ?? getFallbackCanvas?.() ?? null;
    if (!canvas || !onSelectionChange) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const mask = magicWandMask(ctx, canvas.width, canvas.height, x, y, settings.tolerance);
    const picked = mask.kind === 'mask' ? mask : NO_SELECTION;
    const final = combineMode === 'replace' ? picked : combineSelections(selection, picked, combineMode, canvas.width, canvas.height);
    onSelectionChange(final);
    return final;
  }, [getCanvas, getFallbackCanvas, settings.tolerance, selection, onSelectionChange]);

  const setCloneSource = useCallback((x: number, y: number) => {
    cloneSourceRef.current = { x, y };
  }, []);

  return { pointerDown, pointerMove, pointerUp, pickMagicWand, setCloneSource };
}
