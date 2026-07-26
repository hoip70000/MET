/** Hex string ("#rgb" or "#rrggbb") to 0-255 RGB — shared by exportPsd.ts (every hex-color PSD
 *  field) and adjustments.ts (gradientMapFilter's two stop colors). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean.padEnd(6, '0');
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
