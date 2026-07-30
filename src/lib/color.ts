/** Hex string ("#rgb" or "#rrggbb") to 0-255 RGB — shared by exportPsd.ts (every hex-color PSD
 *  field) and adjustments.ts (gradientMapFilter's two stop colors). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean.padEnd(6, '0');
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Pulls a color into a readable lightness range against typical chat-bubble backgrounds — a raw
 *  average can come out too dark or too light to read, so this clamps perceived luminance to a
 *  mid band rather than using the sampled color verbatim. */
function clampForReadability(r: number, g: number, b: number): string {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const MIN = 0.35;
  const MAX = 0.75;
  let factor = 1;
  if (luminance < MIN) factor = MIN / Math.max(luminance, 0.05);
  else if (luminance > MAX) factor = MAX / luminance;
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c * factor)));
  return rgbToHex(clamp(r), clamp(g), clamp(b));
}

/** Samples an image (typically a user avatar) down to a handful of pixels and averages them —
 *  cheap and good enough for "tint the username to match the avatar", not a precise dominant-color
 *  extraction. Used to derive a per-user chat name color (see `idbCache.ts`'s avatar-color cache,
 *  which memoizes this by URL so it isn't recomputed per message). */
function sampleAvatarColor(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 8; // downsample hard — only an average is needed, not detail
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D context unavailable');
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 16) continue; // skip near-transparent pixels
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          count++;
        }
        if (count === 0) throw new Error('Image had no opaque pixels');
        resolve(clampForReadability(Math.round(r / count), Math.round(g / count), Math.round(b / count)));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

/** Derives a readable text color from an avatar image, idb-cached by URL (see `idbCache.ts`).
 *  Falls back to `fallback` if the image can't be loaded/sampled (empty avatar, CORS-blocked
 *  host, etc.) — this must never throw. */
export async function dominantColorFromImage(url: string, fallback: string): Promise<string> {
  if (!url) return fallback;
  const { getCachedAvatarColor, setCachedAvatarColor } = await import('./idbCache');
  const cached = await getCachedAvatarColor(url);
  if (cached) return cached;
  try {
    const color = await sampleAvatarColor(url);
    await setCachedAvatarColor(url, color);
    return color;
  } catch {
    return fallback;
  }
}
