/**
 * Destructive Image > Apply Filter operations — one-shot ImageData mutators, matching
 * adjustments.ts's own `(param...) => (imageData: ImageData) => void` factory convention (a filter
 * is built once with its parameters, then run against a real buffer). Unlike adjustments.ts's
 * filters, most of these sample *neighboring* pixels (blur/sharpen/noise/edges/emboss), so each one
 * reads from a snapshot copy of the input and writes into the real buffer, never mutating while
 * still reading its own neighborhood.
 *
 * Threshold and Posterize deliberately have no filter here — Image > Apply Filter reuses
 * adjustments.ts's `thresholdFilter`/`posterizeFilter` directly (see filterDialogConfigs.ts), since
 * the math is identical and a destructive one-shot call is just "run the same mutator once instead
 * of wrapping it in a live adjustment layer."
 */

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Nearest-edge-clamped, rounded-to-integer pixel index, so a blur/convolution never darkens or
 *  blanks its own border — and never indexes a typed array with a non-integer coordinate (which
 *  silently reads back `undefined`/NaN instead of the intended pixel; `embossFilter`'s angled
 *  offsets are never whole numbers). */
function clampCoord(v: number, max: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r >= max ? max - 1 : r;
}

/**
 * Single-pass box blur, separable (horizontal then vertical), each a sliding-window running sum —
 * O(width*height) regardless of radius, which matters at the large end of a 0–250px UI range.
 */
export function boxBlurFilter(radius: number) {
  const r = Math.max(0, Math.round(radius));
  return (imageData: ImageData) => {
    if (r === 0) return;
    const { width: w, height: h, data: d } = imageData;
    const windowSize = r * 2 + 1;

    const tmp = new Float32Array(d.length);
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += d[rowOffset + clampCoord(k, w) * 4 + c];
        for (let x = 0; x < w; x++) {
          tmp[rowOffset + x * 4 + c] = sum / windowSize;
          const leaving = clampCoord(x - r, w);
          const entering = clampCoord(x + r + 1, w);
          sum += d[rowOffset + entering * 4 + c] - d[rowOffset + leaving * 4 + c];
        }
      }
    }

    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += tmp[(clampCoord(k, h) * w + x) * 4 + c];
        for (let y = 0; y < h; y++) {
          d[(y * w + x) * 4 + c] = clamp255(Math.round(sum / windowSize));
          const leaving = clampCoord(y - r, h);
          const entering = clampCoord(y + r + 1, h);
          sum += tmp[(entering * w + x) * 4 + c] - tmp[(leaving * w + x) * 4 + c];
        }
      }
    }
  };
}

/**
 * Three successive box-blur passes at a third of the radius each — the standard cheap approximation
 * of a true Gaussian (already referenced, for the same reason, in selection.ts's feather comment),
 * without needing a real per-pixel Gaussian kernel convolution.
 */
export function gaussianBlurFilter(radius: number) {
  const passRadius = Math.max(1, Math.round(radius / 3));
  const pass = boxBlurFilter(passRadius);
  return (imageData: ImageData) => {
    if (radius <= 0) return;
    pass(imageData);
    pass(imageData);
    pass(imageData);
  };
}

/** Averages samples along the blur direction through each pixel — a true directional smear, not a
 *  radial one. */
export function motionBlurFilter(angleDeg: number, distance: number) {
  return (imageData: ImageData) => {
    const dist = Math.max(0, distance);
    if (dist === 0) return;
    const { width: w, height: h, data: d } = imageData;
    const src = new Uint8ClampedArray(d);
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const steps = Math.max(1, Math.round(dist));
    const half = dist / 2;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let s = 0; s <= steps; s++) {
          const t = steps === 0 ? 0 : (s / steps) * dist - half;
          const sx = clampCoord(Math.round(x + dx * t), w);
          const sy = clampCoord(Math.round(y + dy * t), h);
          const i = (sy * w + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3];
        }
        const n = steps + 1;
        const i = (y * w + x) * 4;
        d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; d[i + 3] = a / n;
      }
    }
  };
}

/** Classic unsharp mask: subtract a blurred copy from the original and add the difference back in,
 *  scaled by `amount`, only where it exceeds `threshold` — flat areas stay untouched, edges pop. */
export function unsharpMaskFilter(amount: number, radius: number, threshold: number) {
  return (imageData: ImageData) => {
    const { data: d, width, height } = imageData;
    const original = new Uint8ClampedArray(d);
    // A plain object shaped like ImageData, not `new ImageData(...)` — that's a DOM constructor
    // unavailable in the (node) vitest environment these filters are unit-tested under, and the
    // filter functions here only ever touch `.data`/`.width`/`.height` anyway.
    const blurred = { data: new Uint8ClampedArray(d), width, height } as ImageData;
    gaussianBlurFilter(radius)(blurred);
    const bd = blurred.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = original[i + c] - bd[i + c];
        d[i + c] = Math.abs(diff) >= threshold ? clamp255(Math.round(original[i + c] + diff * amount)) : original[i + c];
      }
    }
  };
}

/** Box–Muller-ish sum-of-uniforms approximates a normal distribution without a real Gaussian RNG —
 *  good enough for a cosmetic noise filter, not a statistical one. */
function gaussianRandom(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

export function addNoiseFilter(amount: number, distribution: 'uniform' | 'gaussian', monochromatic: boolean) {
  const scale = (amount / 100) * 255;
  return (imageData: ImageData) => {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const shared = distribution === 'gaussian' ? gaussianRandom() * scale : (Math.random() * 2 - 1) * scale;
      for (let c = 0; c < 3; c++) {
        const n = monochromatic ? shared : (distribution === 'gaussian' ? gaussianRandom() * scale : (Math.random() * 2 - 1) * scale);
        d[i + c] = clamp255(Math.round(d[i + c] + n));
      }
    }
  };
}

/** Averages every cell into one flat colour — the defining look of Mosaic/Pixelate. */
export function mosaicFilter(cellSize: number) {
  const size = Math.max(1, Math.round(cellSize));
  return (imageData: ImageData) => {
    const { width: w, height: h, data: d } = imageData;
    for (let cy = 0; cy < h; cy += size) {
      const ch = Math.min(size, h - cy);
      for (let cx = 0; cx < w; cx += size) {
        const cw = Math.min(size, w - cx);
        let r = 0, g = 0, b = 0, a = 0;
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            const i = ((cy + y) * w + (cx + x)) * 4;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3];
          }
        }
        const n = cw * ch;
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n); a = Math.round(a / n);
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            const i = ((cy + y) * w + (cx + x)) * 4;
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
          }
        }
      }
    }
  };
}

/** Sobel gradient magnitude over luminance, inverted (Photoshop's own Find Edges reads as dark lines
 *  on a light background, not bright lines on black — the opposite of a raw magnitude map). */
export function findEdgesFilter() {
  return (imageData: ImageData) => {
    const { width: w, height: h, data: d } = imageData;
    const src = new Uint8ClampedArray(d);
    const lum = (x: number, y: number) => {
      const i = (clampCoord(y, h) * w + clampCoord(x, w)) * 4;
      return 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = -lum(x - 1, y - 1) - 2 * lum(x - 1, y) - lum(x - 1, y + 1)
          + lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1);
        const gy = -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1)
          + lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        const v = clamp255(255 - Math.round(magnitude));
        const i = (y * w + x) * 4;
        d[i] = v; d[i + 1] = v; d[i + 2] = v;
      }
    }
  };
}

/**
 * Directional emboss: a luminance derivative along `angleDeg`, scaled by `height`/`amount` and
 * offset to mid-grey — the classic bump-map look, greyscale by construction (no colour channel has
 * an independent "direction" to emboss).
 */
export function embossFilter(angleDeg: number, height: number, amount: number) {
  return (imageData: ImageData) => {
    const { width: w, height: h, data: d } = imageData;
    const src = new Uint8ClampedArray(d);
    const lum = (x: number, y: number) => {
      const i = (clampCoord(y, h) * w + clampCoord(x, w)) * 4;
      return 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    };
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const derivative = lum(x + dx * height, y + dy * height) - lum(x - dx * height, y - dy * height);
        const v = clamp255(Math.round(128 + derivative * amount));
        const i = (y * w + x) * 4;
        d[i] = v; d[i + 1] = v; d[i + 2] = v;
      }
    }
  };
}
