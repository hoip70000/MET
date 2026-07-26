import { BLEND_TO_COMPOSITE, type TextLayerData } from '../components/studio/studioTypes';
import { traceAnchors } from '../components/studio/pathGeometry';
import { gradientVector } from '../components/studio/textGradient';
import { layoutText, applyLetterSpacing } from '../components/studio/textLayout';
import { runFontString } from '../components/studio/textRuns';
import { partitionAdjustments, groupClipRuns, type RenderNode, type ClipRun } from '../components/studio/layerTree';
import { filterForAdjustment, withStrength } from './adjustments';
import type { ExportSnapshot } from '../components/studio/StudioCanvas';
import type { SerializedStudioLayer } from './studioProjectStore';

export type ImageExportFormat = 'png' | 'jpg' | 'webp';

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode an image while exporting'));
    img.src = dataUrl;
  });
}

/**
 * Draws a text layer using the same layout the canvas renders from (`layoutText`), so wrapping, the
 * box, alignment, kerning and per-run styling can't drift between screen and export. This used to
 * do its own wrapping, which is exactly how point text ended up exporting wrapped when it doesn't
 * wrap on screen.
 */
function drawTextLayer(ctx: CanvasRenderingContext2D, text: TextLayerData) {
  ctx.save();

  const layout = layoutText(text);

  const cx = text.x + layout.width / 2;
  const cy = text.y + layout.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((text.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  // Type Region: clips flattened export identically to what StudioCanvas/TextLayerNode's Konva
  // clipFunc shows on screen. Coordinates are already page-space here (this context was only
  // rotated, never translated to the layer's own origin), so they're used as stored, unlike the
  // Konva clipFunc which runs in the Group's local space and has to subtract text.x/y itself.
  if (text.clipShape) {
    ctx.beginPath();
    const shape = text.clipShape;
    if (shape.kind === 'ellipse') {
      ctx.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.abs(shape.width) / 2, Math.abs(shape.height) / 2, 0, 0, Math.PI * 2);
    } else {
      shape.points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    }
    ctx.closePath();
    ctx.clip();
  }

  // Fixed-height area frame: clips flattened export at the box's bottom edge, matching the live
  // canvas render (TextLayerNode.tsx's inner glyph-clip Group). Coordinates are page-space here
  // (this ctx was only rotated about the layer's center, never translated to the layer's own
  // origin), unlike Konva's local-space clipFunc — used as text.x/text.y/layout.width directly, no
  // subtraction needed. Unconditional on fixedHeight being set, not gated on layout.overflowing —
  // same reasoning as the live render. Native ctx.clip() intersects with whatever's already
  // clipped in this save() scope, so this correctly ANDs with the Type Region clip above.
  if (!text.autoWidth && text.fixedHeight != null) {
    ctx.beginPath();
    ctx.rect(text.x, text.y, layout.width, text.fixedHeight);
    ctx.closePath();
    ctx.clip();
  }

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; // alignment is already baked into each run's x by the layout

  if (text.shadow?.enabled) {
    ctx.shadowColor = text.shadow.color;
    ctx.shadowBlur = text.shadow.blur;
    ctx.shadowOffsetX = text.shadow.offsetX;
    ctx.shadowOffsetY = text.shadow.offsetY;
  }

  // One ramp across the whole layer, in page coords, so it spans every run rather than restarting
  // per run — matching how the canvas offsets each run's gradient points off the layer box.
  let gradientFill: CanvasGradient | null = null;
  if (text.gradient?.enabled) {
    const { start, end } = gradientVector(layout.width, layout.height, text.gradient.angle);
    gradientFill = ctx.createLinearGradient(
      text.x + start.x, text.y + start.y,
      text.x + end.x, text.y + end.y,
    );
    gradientFill.addColorStop(0, text.gradient.from);
    gradientFill.addColorStop(1, text.gradient.to);
  }

  for (const run of layout.runs) {
    const x = text.x + run.x;
    const y = text.y + run.y;
    ctx.font = runFontString(run.style);
    applyLetterSpacing(ctx, run.style.letterSpacing);
    if (text.strokeWidth > 0) {
      ctx.strokeStyle = text.strokeColor;
      ctx.lineWidth = text.strokeWidth;
      ctx.strokeText(run.text, x, y);
    }
    ctx.fillStyle = gradientFill ?? run.style.color;
    ctx.fillText(run.text, x, y);
  }
  ctx.restore();
}

/**
 * Whether a group composites as an isolated unit rather than letting its children draw straight
 * onto what's below.
 *
 * **Must stay identical to `needsIsolation` in `StudioCanvas.tsx`** — the two implement the same
 * rule for two renderers, and any drift shows up as an export that doesn't match the screen. See
 * that function for why child count is not a factor.
 */
const isolatesGroup = (layer: SerializedStudioLayer) =>
  layer.opacity < 1 || layer.blendMode !== 'normal';

/**
 * Composites `layers` (bottom-to-top) onto `ctx`: adjustments become wrappers around what's below
 * them, then the resulting render tree is drawn.
 *
 * The whole file mirrors `StudioCanvas`'s render — `partitionAdjustments`, `groupClipRuns` and
 * `isolatesGroup`/`needsIsolation` are shared or paired deliberately, because any divergence shows
 * up as an exported file that doesn't match what the user saw.
 */
async function compositeLayers(
  ctx: CanvasRenderingContext2D,
  layers: SerializedStudioLayer[],
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  await compositeNodes(ctx, partitionAdjustments(layers), width, height, background);
}

async function compositeNodes(
  ctx: CanvasRenderingContext2D,
  nodes: RenderNode<SerializedStudioLayer>[],
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  // Clip runs form over the plain-layer nodes between adjustments — an adjustment is never a
  // clip base. Mirrors `renderNodes` in StudioCanvas.
  let pending: SerializedStudioLayer[] = [];
  const flushClipRuns = async () => {
    for (const run of groupClipRuns(pending)) {
      if (run.followers.length === 0) await compositeLeaf(ctx, run.base, width, height, background);
      else await compositeClipRun(ctx, run, width, height, background);
    }
    pending = [];
  };

  for (const node of nodes) {
    if (node.kind !== 'adjustment') {
      pending.push(node.layer);
      continue;
    }
    await flushClipRuns();

    // Draw everything the adjustment encloses, then filter the accumulated pixels in place. This is
    // the one place export is *easier* than the canvas: what's below is already composited right
    // here, so there's nothing to cache — the wrapper is just a getImageData/putImageData pair.
    // A hidden adjustment still draws its children; it simply skips the filter.
    await compositeNodes(ctx, node.children, width, height, background);

    const adj = node.layer;
    if (!adj.visible || !adj.adjustment) continue;
    const imageData = ctx.getImageData(0, 0, width, height);
    withStrength(filterForAdjustment(adj.adjustment), adj.opacity)(imageData);
    ctx.putImageData(imageData, 0, 0);
  }

  await flushClipRuns();
}

/**
 * A clip run: base, its followers, then the base again with `destination-in` to trim them to its
 * alpha. Composited on its own canvas first — `destination-in` against the target would erase
 * everything already drawn below — then blitted through the base's opacity and blend mode.
 *
 * Same algorithm as `renderClipRun` on the canvas; the two must stay in step.
 */
async function compositeClipRun(
  ctx: CanvasRenderingContext2D,
  run: ClipRun<SerializedStudioLayer>,
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  const { base, followers } = run;
  if (!base.visible || !base.raster) return;

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  const baseImg = await loadImage(base.raster);
  sctx.drawImage(baseImg, 0, 0, width, height);
  for (const follower of followers) await compositeLeaf(sctx, follower, width, height, background);
  sctx.globalCompositeOperation = 'destination-in';
  sctx.drawImage(baseImg, 0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = base.opacity;
  ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[base.blendMode];
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

/** Draws a leaf's own content (background image / nested group / raster / text) with no opacity,
 *  blend, or mask applied — `compositeLeaf` decides how the result gets composited. */
async function drawLeafContent(
  ctx: CanvasRenderingContext2D,
  layer: SerializedStudioLayer,
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  if (layer.type === 'background') {
    if (background) ctx.drawImage(background, 0, 0, width, height);
  } else if (layer.type === 'group') {
    const group = document.createElement('canvas');
    group.width = width;
    group.height = height;
    const gctx = group.getContext('2d');
    if (gctx) {
      await compositeLayers(gctx, layer.children ?? [], width, height, background);
      ctx.drawImage(group, 0, 0);
    }
  } else if (layer.raster) {
    const img = await loadImage(layer.raster);
    ctx.drawImage(img, 0, 0, width, height);
  } else if (layer.type === 'text' && layer.text && layer.text.content) {
    drawTextLayer(ctx, layer.text);
  } else if (layer.type === 'path' && layer.path) {
    // Flattened export has no vector concept regardless of format, so rasterizing here at export
    // resolution is simply correct — the same reasoning text glyphs already get.
    ctx.beginPath();
    traceAnchors(ctx, layer.path.anchors, layer.path.closed);
    if (layer.path.fill.enabled) { ctx.fillStyle = layer.path.fill.color; ctx.fill(layer.path.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); }
    if (layer.path.stroke.enabled) { ctx.strokeStyle = layer.path.stroke.color; ctx.lineWidth = layer.path.stroke.width; ctx.stroke(); }
  }
}

async function compositeLeaf(
  ctx: CanvasRenderingContext2D,
  layer: SerializedStudioLayer,
  width: number,
  height: number,
  background?: HTMLImageElement,
): Promise<void> {
  if (!layer.visible) return;
  // A disabled mask has no effect at all, matching PSD's own `disabled` flag and the live canvas.
  const activeMaskRaster = layer.mask?.enabled ? layer.maskRaster : undefined;

  if (layer.type === 'group' && !isolatesGroup(layer) && !activeMaskRaster) {
    await compositeLayers(ctx, layer.children ?? [], width, height, background);
    return;
  }

  if (activeMaskRaster) {
    // Draw the leaf's own content into a scratch canvas, trim it to the mask's alpha, then blit
    // the trimmed result through this layer's own opacity/blend — same reasoning as
    // `compositeClipRun`: `destination-in` against the shared canvas would erase everything
    // already painted below it, not just this layer. Any layer type may carry a mask, so this
    // check sits above the type-specific branches rather than inside one of them.
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const sctx = scratch.getContext('2d');
    if (!sctx) return;
    await drawLeafContent(sctx, layer, width, height, background);
    const maskImg = await loadImage(activeMaskRaster);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(maskImg, 0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blendMode];
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blendMode];
  await drawLeafContent(ctx, layer, width, height, background);
  ctx.restore();
}

/** Builds the flattened page canvas a Studio export snapshot represents (background + visible
 *  layers, respecting opacity/blend mode/visibility). Shared by whole-page export and Slice export
 *  (`compositeFlattenedSlice`), which crops this same render N times instead of re-flattening per
 *  slice. `forJpg` pre-fills white since JPG has no alpha channel. */
async function renderFlattenedCanvas(snapshot: ExportSnapshot, forJpg: boolean): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  if (forJpg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // The background is root index 0 of the layer tree, not a special case drawn beforehand — an
  // adjustment above it has to be able to enclose and filter it, same as on the canvas.
  const background = await loadImage(snapshot.backgroundDataUrl);
  await compositeLayers(ctx, snapshot.layers, canvas.width, canvas.height, background);
  return canvas;
}

/** Flattens a Studio export snapshot into a single raster image blob. */
export async function compositeFlattenedImage(snapshot: ExportSnapshot, format: ImageExportFormat): Promise<Blob> {
  const canvas = await renderFlattenedCanvas(snapshot, format === 'jpg');
  const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
  const quality = format === 'jpg' ? 0.92 : undefined;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode exported image'))), mime, quality);
  });
}

/** Renders the whole flattened page once (for the Slice tool's export, so N queued rects don't each
 *  trigger a full re-flatten) — call once, then pass the result to `compositeFlattenedSlice` per rect. */
export async function renderFlattenedPage(snapshot: ExportSnapshot): Promise<HTMLCanvasElement> {
  return renderFlattenedCanvas(snapshot, false);
}

/** Crops a pre-rendered flattened page (from `renderFlattenedPage`) to `rect` and encodes it as a PNG. */
export async function compositeFlattenedSlice(fullCanvas: HTMLCanvasElement, rect: { x: number; y: number; width: number; height: number }): Promise<Blob> {
  const cropped = document.createElement('canvas');
  cropped.width = Math.max(1, Math.round(rect.width));
  cropped.height = Math.max(1, Math.round(rect.height));
  const ctx = cropped.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(fullCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, cropped.width, cropped.height);
  return new Promise((resolve, reject) => {
    cropped.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode slice'))), 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
