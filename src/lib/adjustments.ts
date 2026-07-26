import type { AdjustmentLayerData, ColorBalanceRange, CurvePoint } from '../components/studio/studioTypes';
import { hexToRgb } from './color';

/**
 * Konva-compatible custom filters (`(imageData: ImageData) => void`, mutating `.data` in place).
 * Hand-rolled instead of pulling in an image-processing dependency (Jimp etc.) — Konva already
 * ships the caching/filter pipeline, so this is a single pass over one already-allocated buffer,
 * the cheapest option on low-end/mobile devices.
 */

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function brightnessContrastFilter(brightness: number, contrast: number) {
  const b = clamp255(128 + brightness) - 128; // -100..100 -> additive offset
  const c = (259 * (contrast + 255)) / (255 * (259 - contrast)); // classic contrast factor
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp255(c * (d[i] - 128) + 128 + b);
      d[i + 1] = clamp255(c * (d[i + 1] - 128) + 128 + b);
      d[i + 2] = clamp255(c * (d[i + 2] - 128) + 128 + b);
    }
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / delta) % 6; break;
      case g: h = (b - r) / delta + 2; break;
      default: h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

export function hueSaturationFilter(hue: number, saturation: number, lightness: number) {
  const satFactor = 1 + saturation / 100;
  const lightOffset = lightness / 200; // -100..100 -> -0.5..0.5
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const nh = (h + hue + 360) % 360;
      const ns = Math.min(1, Math.max(0, s * satFactor));
      const nl = Math.min(1, Math.max(0, l + lightOffset));
      const [r, g, b] = hslToRgb(nh, ns, nl);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  };
}

export function levelsFilter(inBlack: number, inWhite: number, gamma: number, outBlack: number, outWhite: number) {
  // Precompute a 256-entry lookup table once per filter instance instead of per-pixel math.
  const lut = new Uint8ClampedArray(256);
  const inRange = Math.max(1, inWhite - inBlack);
  const outRange = outWhite - outBlack;
  const invGamma = 1 / Math.max(0.01, gamma);
  for (let v = 0; v < 256; v++) {
    const normalized = Math.min(1, Math.max(0, (v - inBlack) / inRange));
    lut[v] = clamp255(outBlack + Math.pow(normalized, invGamma) * outRange);
  }
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
  };
}

/**
 * 256-entry input->output LUT through `points` via monotonic Catmull-Rom interpolation — the same
 * tangent technique `pathGeometry.ts`'s `applyCurvatureSmoothing` uses for the Pen tool's Curvature
 * mode, adapted from 2D path anchors to 1D input->output samples. Clamps (doesn't extrapolate)
 * outside the first/last point, matching Photoshop's own curve behaviour.
 *
 * Exported so `CurvesEditor.tsx` samples this directly for its on-screen curve preview — the editor
 * and the actual filter must never have two separate interpolation implementations to drift apart.
 */
export function curveLut(points: CurvePoint[]): Uint8ClampedArray {
  const pts = [...points].sort((a, b) => a.input - b.input);
  const lut = new Uint8ClampedArray(256);
  if (pts.length < 2) {
    for (let v = 0; v < 256; v++) lut[v] = v;
    return lut;
  }
  for (let v = 0; v < 256; v++) {
    if (v <= pts[0].input) { lut[v] = clamp255(pts[0].output); continue; }
    if (v >= pts[pts.length - 1].input) { lut[v] = clamp255(pts[pts.length - 1].output); continue; }
    let i = 0;
    while (i < pts.length - 2 && v > pts[i + 1].input) i++;
    const p1 = pts[i], p2 = pts[i + 1];
    // At a real boundary (no actual neighbor on that side) reflect the far point through the near
    // one instead of duplicating it — duplicating collapses the tangent formula's (next-prev)/2 to
    // half the segment's own slope, which visibly bows a plain 2-point "identity" curve instead of
    // leaving it dead straight.
    const p0 = i > 0 ? pts[i - 1] : { input: p1.input - (p2.input - p1.input), output: p1.output - (p2.output - p1.output) };
    const p3 = i + 2 < pts.length ? pts[i + 2] : { input: p2.input + (p2.input - p1.input), output: p2.output + (p2.output - p1.output) };
    const span = Math.max(1, p2.input - p1.input);
    const t = (v - p1.input) / span;
    const m0 = (p2.output - p0.output) / 2;
    const m1 = (p3.output - p1.output) / 2;
    const t2 = t * t, t3 = t2 * t;
    const out = (2 * t3 - 3 * t2 + 1) * p1.output + (t3 - 2 * t2 + t) * m0
      + (-2 * t3 + 3 * t2) * p2.output + (t3 - t2) * m1;
    lut[v] = clamp255(out);
  }
  return lut;
}

export function curvesFilter(rgb: CurvePoint[]) {
  const lut = curveLut(rgb);
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
  };
}

export function exposureFilter(exposure: number, offset: number, gamma: number) {
  // Photoshop's exposure operates in linear light: multiply by 2^exposure, add offset, then
  // gamma-correct — all in 0..1 float space, converting back to 0..255 at the end.
  const mult = Math.pow(2, exposure);
  const invGamma = 1 / Math.max(0.01, gamma);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const linear = (v / 255) * mult + offset;
    lut[v] = clamp255(Math.pow(Math.max(0, linear), invGamma) * 255);
  }
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
  };
}

export function vibranceFilter(vibrance: number) {
  const amt = vibrance / 100; // -1..1
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      // Boost is strongest on low-saturation pixels and tapers toward already-saturated ones — the
      // "smart"/skin-protective behaviour that differentiates vibrance from a flat saturation slider.
      const boost = amt >= 0 ? amt * (1 - s) : amt * s;
      const ns = Math.min(1, Math.max(0, s + boost));
      const [r, g, b] = hslToRgb(h, ns, l);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  };
}

export function colorBalanceFilter(cb: AdjustmentLayerData['colorBalance']) {
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = (r + g + b) / 3 / 255;
      // Classic Photoshop tonal-range weights: shadows peak near lum=0, highlights near lum=1,
      // midtones in between.
      const wShadow = Math.max(0, 1 - lum * 2);
      const wHighlight = Math.max(0, lum * 2 - 1);
      const wMid = 1 - wShadow - wHighlight;
      const apply = (channel: number, key: keyof ColorBalanceRange) => {
        const delta = (cb.shadows[key] * wShadow + cb.midtones[key] * wMid + cb.highlights[key] * wHighlight) * 0.5;
        return clamp255(channel + delta);
      };
      const nr = apply(r, 'cyanRed'), ng = apply(g, 'magentaGreen'), nb = apply(b, 'yellowBlue');
      if (cb.preserveLuminosity) {
        const newLum = (nr + ng + nb) / 3;
        const lumDelta = lum * 255 - newLum;
        d[i] = clamp255(nr + lumDelta); d[i + 1] = clamp255(ng + lumDelta); d[i + 2] = clamp255(nb + lumDelta);
      } else {
        d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      }
    }
  };
}

export function posterizeFilter(levels: number) {
  const n = Math.max(2, Math.min(255, Math.round(levels)));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = clamp255(Math.round((Math.round((v / 255) * (n - 1)) / (n - 1)) * 255));
  }
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
  };
}

export function thresholdFilter(threshold: number) {
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = lum >= threshold ? 255 : 0;
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
    }
  };
}

export function gradientMapFilter(from: { r: number; g: number; b: number }, to: { r: number; g: number; b: number }) {
  // 256x3-entry LUT, indexed by luminance — same LUT-then-apply approach as levels/curves, just 3
  // output bytes per entry instead of 1.
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    lut[v * 3] = clamp255(from.r + (to.r - from.r) * t);
    lut[v * 3 + 1] = clamp255(from.g + (to.g - from.g) * t);
    lut[v * 3 + 2] = clamp255(from.b + (to.b - from.b) * t);
  }
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = lut[lum * 3]; d[i + 1] = lut[lum * 3 + 1]; d[i + 2] = lut[lum * 3 + 2];
    }
  };
}

export function filterForAdjustment(data: AdjustmentLayerData): (imageData: ImageData) => void {
  switch (data.kind) {
    case 'brightness-contrast':
      return brightnessContrastFilter(data.brightness, data.contrast);
    case 'hue-saturation':
      return hueSaturationFilter(data.hue, data.saturation, data.lightness);
    case 'levels':
      return levelsFilter(data.levels.inBlack, data.levels.inWhite, data.levels.gamma, data.levels.outBlack, data.levels.outWhite);
    case 'curves':
      return curvesFilter(data.curves.rgb);
    case 'exposure':
      return exposureFilter(data.exposure, data.exposureOffset, data.exposureGamma);
    case 'vibrance':
      return vibranceFilter(data.vibrance);
    case 'color-balance':
      return colorBalanceFilter(data.colorBalance);
    case 'posterize':
      return posterizeFilter(data.posterizeLevels);
    case 'threshold':
      return thresholdFilter(data.threshold);
    case 'gradient-map':
      return gradientMapFilter(hexToRgb(data.gradientMap.from), hexToRgb(data.gradientMap.to));
  }
}

/**
 * Scales a filter's strength: `out = original*(1-alpha) + filtered*alpha`, per pixel, RGB only.
 *
 * This is how an adjustment layer's **own opacity** is implemented, and it has to happen inside the
 * filter rather than as the wrapper node's opacity. The wrapper *contains* the stack it adjusts
 * (background included), so fading the wrapper would fade the page itself to transparent and expose
 * the backing behind it — not "half the adjustment". Photoshop blends an adjustment's result with
 * its unadjusted backdrop, and doing that here would otherwise mean rendering everything below the
 * adjustment twice.
 *
 * Alpha is left untouched: this scales a colour grade, not coverage.
 */
export function withStrength(
  filter: (imageData: ImageData) => void,
  alpha: number,
): (imageData: ImageData) => void {
  if (alpha >= 1) return filter;
  return (imageData: ImageData) => {
    const original = imageData.data.slice();
    filter(imageData);
    if (alpha <= 0) { imageData.data.set(original); return; }
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = original[i] + (d[i] - original[i]) * alpha;
      d[i + 1] = original[i + 1] + (d[i + 1] - original[i + 1]) * alpha;
      d[i + 2] = original[i + 2] + (d[i + 2] - original[i + 2]) * alpha;
    }
  };
}
