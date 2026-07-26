import type { Psd, Layer as PsdLayer, LayerEffectGradientOverlay, TextStyleRun } from 'ag-psd';
import type { AdjustmentLayerData, TextGradient, TextLayerData } from '../components/studio/studioTypes';
import { normalizeRuns, resolveRunStyle } from '../components/studio/textRuns';
import type { ExportSnapshot } from '../components/studio/StudioCanvas';
import type { SerializedStudioLayer } from './studioProjectStore';
import { hexToRgb } from './color';

/**
 * Our angle is degrees clockwise from left-to-right in screen coords (y grows down), so 90 means
 * top-to-bottom. Photoshop measures gradient angle counter-clockwise with y up, where 90 means
 * bottom-to-top — so the two conventions are the same axis mirrored, and the angle negates.
 *
 * ag-psd normalizes stop `location`/`midpoint` to 0..1 and `opacity` to 0..1, scaling them on
 * write (see serializeGradient in ag-psd's descriptor.js) — these are not raw PSD 0..4096 units.
 */
function buildGradientOverlay(gradient: TextGradient): LayerEffectGradientOverlay {
  return {
    enabled: true,
    blendMode: 'normal',
    opacity: 1,
    align: true,
    scale: 1,
    type: 'linear',
    angle: -gradient.angle,
    gradient: {
      name: 'Text gradient',
      type: 'solid',
      colorStops: [
        { color: hexToRgb(gradient.from), location: 0, midpoint: 0.5 },
        { color: hexToRgb(gradient.to), location: 1, midpoint: 0.5 },
      ],
      opacityStops: [
        { opacity: 1, location: 0, midpoint: 0.5 },
        { opacity: 1, location: 1, midpoint: 0.5 },
      ],
    },
  };
}

/**
 * Our per-character runs -> Photoshop's `styleRuns`. Returns [] for plain text so the layer just
 * carries its default style, which is what pre-run chapters and unstyled text should produce.
 *
 * `kerning` is emitted with `autoKerning: false`: a manual kern and the font's own metric kerning
 * are alternatives in Photoshop, so leaving auto on would let the font fight the explicit value.
 */
function buildStyleRuns(t: TextLayerData): TextStyleRun[] {
  const runs = normalizeRuns(t.content, t.runs ?? []);
  if (runs.length === 0) return [];
  return runs.map(run => {
    const style = resolveRunStyle(t, run);
    return {
      length: run.length,
      style: {
        font: { name: style.fontFamily },
        fontSize: style.fontSize,
        fauxBold: style.fontWeight >= 600,
        fauxItalic: style.italic,
        fillColor: hexToRgb(style.color),
        tracking: style.letterSpacing,
        ...(style.kerning !== 0 ? { kerning: style.kerning, autoKerning: false } : {}),
        ...(style.baselineShift !== 0 ? { baselineShift: style.baselineShift } : {}),
      },
    };
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode an image while building the PSD'));
    img.src = dataUrl;
  });
}

async function dataUrlToCanvas(dataUrl: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return canvas;
}

/**
 * Our mask canvas stores the mask in the *alpha* channel (see `LayerMask`'s doc comment) — a plain
 * `destination-in` composite with no conversion is what makes live rendering cheap. ag-psd's
 * `LayerMaskData.canvas` wants a grayscale *channel* instead (Photoshop's own mask convention), so
 * the alpha -> grayscale conversion happens here, at the PSD boundary, and nowhere else.
 */
async function buildPsdMaskCanvas(dataUrl: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = await dataUrlToCanvas(dataUrl, width, height);
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    data[i] = a;
    data[i + 1] = a;
    data[i + 2] = a;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Maps our adjustment data onto ag-psd's own adjustment types, so the layer stays live and editable
 * in Photoshop rather than being baked into pixels.
 *
 * Field names verified against the installed `ag-psd/dist/psd.d.ts` — they are not the obvious ones:
 * levels uses `shadowInput`/`midtoneInput` (not `inputBlack`/`gamma`), and hue/saturation wants a
 * full channel record. `a`–`d` are hue-range markers, irrelevant for `master`.
 *
 * `useLegacy: true` is load-bearing, not cosmetic: ag-psd only writes the modern `CgEd` descriptor
 * when it's false, and our `brightnessContrastFilter` is a legacy-style linear op, not Photoshop's
 * modern curve. The legacy flag is both the honest mapping and the one that round-trips.
 */
function psdAdjustment(data: AdjustmentLayerData): PsdLayer['adjustment'] {
  switch (data.kind) {
    case 'brightness-contrast':
      return { type: 'brightness/contrast', brightness: data.brightness, contrast: data.contrast, useLegacy: true };
    case 'hue-saturation':
      return {
        type: 'hue/saturation',
        master: { a: 0, b: 0, c: 0, d: 0, hue: data.hue, saturation: data.saturation, lightness: data.lightness },
      };
    case 'levels':
      return {
        type: 'levels',
        rgb: {
          shadowInput: data.levels.inBlack,
          highlightInput: data.levels.inWhite,
          shadowOutput: data.levels.outBlack,
          highlightOutput: data.levels.outWhite,
          midtoneInput: data.levels.gamma,
        },
      };
    case 'curves':
      // ag-psd's CurvesAdjustmentChannel is exactly {input,output}[] — a direct passthrough.
      return { type: 'curves', rgb: data.curves.rgb };
    case 'exposure':
      return { type: 'exposure', exposure: data.exposure, offset: data.exposureOffset, gamma: data.exposureGamma };
    case 'vibrance':
      return { type: 'vibrance', vibrance: data.vibrance };
    case 'color-balance':
      // ag-psd's ColorBalanceValues is exactly {cyanRed,magentaGreen,yellowBlue} — direct passthrough.
      return {
        type: 'color balance',
        shadows: data.colorBalance.shadows,
        midtones: data.colorBalance.midtones,
        highlights: data.colorBalance.highlights,
        preserveLuminosity: data.colorBalance.preserveLuminosity,
      };
    case 'posterize':
      return { type: 'posterize', levels: data.posterizeLevels };
    case 'threshold':
      return { type: 'threshold', level: data.threshold };
    case 'gradient-map':
      // Same location:0..1 convention already verified for LayerEffectGradientOverlay above (both
      // use ag-psd's one shared ColorStop type) — a real write/read round-trip is still worth doing
      // for GradientMapAdjustment specifically once this ships, same diligence the text-gradient
      // work above already applied.
      return {
        type: 'gradient map',
        gradientType: 'solid',
        colorStops: [
          { color: hexToRgb(data.gradientMap.from), location: 0, midpoint: 0.5 },
          { color: hexToRgb(data.gradientMap.to), location: 1, midpoint: 0.5 },
        ],
      };
  }
}

async function buildPsdLayer(layer: SerializedStudioLayer, width: number, height: number): Promise<PsdLayer> {
  const base: PsdLayer = {
    name: layer.name,
    opacity: layer.opacity,
    hidden: !layer.visible,
    blendMode: layer.blendMode,
    // PSD's own clipping flag — the layer stays clipped to the one below it when reopened, rather
    // than being flattened into it here.
    clipping: layer.clipped === true,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
  };

  // Orthogonal to type — any layer (groups included) may carry a mask, per `StudioLayer.mask`'s
  // doc comment — so this sits above the type-branch chain rather than inside one of its arms.
  if (layer.mask && layer.maskRaster) {
    base.mask = {
      canvas: await buildPsdMaskCanvas(layer.maskRaster, width, height),
      disabled: !layer.mask.enabled,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
    };
  }

  if (layer.type === 'group') {
    // ag-psd models a group as a layer with `children` in the same bottom-to-top order we use, so
    // this maps across directly and the group stays a real, collapsible folder in Photoshop.
    base.children = await Promise.all((layer.children ?? []).map(c => buildPsdLayer(c, width, height)));
    base.opened = !layer.collapsed;
  } else if (layer.type === 'adjustment' && layer.adjustment) {
    // Adjustment layers used to fall through every branch here and emit an empty named layer —
    // the adjustment silently vanished from the PSD and nobody was told.
    base.adjustment = psdAdjustment(layer.adjustment);
  } else if (layer.raster) {
    base.canvas = await dataUrlToCanvas(layer.raster, width, height);
  } else if (layer.type === 'text' && layer.text) {
    const t = layer.text;
    const runs = buildStyleRuns(t);
    const lineCount = t.content.split('\n').length || 1;
    // Editable text layer per ag-psd's LayerTextData — Photoshop can re-edit this directly.
    // Font family names pass through as-is; Photoshop substitutes if that font isn't installed
    // (documented limitation, not something we can resolve from the browser).
    base.text = {
      text: t.content,
      left: t.x,
      top: t.y,
      right: t.x + t.width,
      bottom: t.y + t.fontSize * t.lineHeight * lineCount,
      style: {
        font: { name: t.fontFamily },
        fontSize: t.fontSize,
        fauxBold: t.bold,
        fauxItalic: t.italic,
        fillColor: hexToRgb(t.color),
        ...(t.strokeWidth > 0 ? { strokeColor: hexToRgb(t.strokeColor), strokeFlag: true, outlineWidth: t.strokeWidth } : {}),
      },
      // Per-character runs map onto Photoshop's own style runs, so mixed-size/colour text stays
      // editable there rather than being flattened to the layer's default style.
      ...(runs.length > 0 ? { styleRuns: runs } : {}),
    };
    // A gradient overlay is how gradient text is done by hand in Photoshop, and it stays editable
    // there. `style.fillColor` above is left as the flat colour underneath, so the layer still
    // degrades sensibly if the effect is switched off.
    if (t.gradient?.enabled) {
      base.effects = { gradientOverlay: [buildGradientOverlay(t.gradient)] };
    }
  } else if (layer.type === 'path' && layer.path) {
    // Real vector path support, not a rasterize fallback — ag-psd's BezierKnot format was
    // confirmed with an actual writePsd/readPsd round-trip during implementation: each knot's
    // `points` is [inHandleX, inHandleY, anchorX, anchorY, outHandleX, outHandleY] in absolute
    // page-pixel coordinates (ag-psd normalizes by width/height internally on write/read).
    const p = layer.path;
    base.vectorMask = {
      paths: [{
        open: !p.closed,
        fillRule: p.fillRule === 'evenodd' ? 'even-odd' : 'non-zero',
        knots: p.anchors.map(a => ({
          linked: a.type === 'smooth',
          points: [
            a.point.x + (a.handleIn?.x ?? 0), a.point.y + (a.handleIn?.y ?? 0),
            a.point.x, a.point.y,
            a.point.x + (a.handleOut?.x ?? 0), a.point.y + (a.handleOut?.y ?? 0),
          ],
        })),
      }],
    };
    if (p.fill.enabled) {
      base.vectorFill = { type: 'color', color: hexToRgb(p.fill.color) };
    }
    if (p.stroke.enabled) {
      base.vectorStroke = {
        strokeEnabled: true,
        fillEnabled: false,
        lineWidth: { units: 'Pixels', value: p.stroke.width },
        content: { type: 'color', color: hexToRgb(p.stroke.color) },
      };
    }
  }

  return base;
}

/** Builds a layered, editable-text PSD from a Studio export snapshot. Layer order in `snapshot.layers`
 *  is bottom-to-top (matching the Layers panel), which lines up with ag-psd's expected `children` order.
 *  ag-psd is a large dependency, so it's dynamically imported here rather than bundled into the main
 *  chunk — it only loads the moment someone actually exports a PSD. */
export async function exportPsd(snapshot: ExportSnapshot): Promise<Blob> {
  const { writePsdBuffer } = await import('ag-psd');
  const backgroundCanvas = await dataUrlToCanvas(snapshot.backgroundDataUrl, snapshot.width, snapshot.height);
  const layers = await Promise.all(
    snapshot.layers.filter(l => !l.isBackground).map(l => buildPsdLayer(l, snapshot.width, snapshot.height))
  );

  const psd: Psd = {
    width: snapshot.width,
    height: snapshot.height,
    children: [
      { name: 'Background', canvas: backgroundCanvas, top: 0, left: 0, bottom: snapshot.height, right: snapshot.width },
      ...layers,
    ],
  };

  const buffer = writePsdBuffer(psd);
  return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' });
}
