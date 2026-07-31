export interface LoadedFont {
  family: string;
  dataUrl: string;
}

/** A generic file-to-data-URL reader — lives here since font loading was its first user, but
 *  has no font-specific logic in it (the Text Editor's image insert reuses it verbatim). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Parses an uploaded font file's embedded family name (falls back to the filename) and
 *  registers it with the browser via the FontFace API so it's immediately usable.
 *  opentype.js is dynamically imported — it's only needed the moment someone uploads a font. */
export async function loadCustomFont(file: File): Promise<LoadedFont> {
  const dataUrl = await readFileAsDataUrl(file);
  const buffer = dataUrlToArrayBuffer(dataUrl);

  let family = file.name.replace(/\.[^.]+$/, '');
  try {
    const opentype = await import('opentype.js');
    const parsed = opentype.parse(buffer.slice(0));
    const names = parsed.names.fontFamily;
    family = names.en || Object.values(names)[0] || family;
  } catch (err) {
    console.error('Could not read font metadata, using filename instead', err);
  }

  const fontFace = new FontFace(family, buffer.slice(0));
  await fontFace.load();
  document.fonts.add(fontFace);

  return { family, dataUrl };
}

/** Re-registers a font already persisted from a previous session (skips re-parsing metadata
 *  since the family name is already known and stored). */
export async function registerStoredFont(family: string, dataUrl: string): Promise<void> {
  const buffer = dataUrlToArrayBuffer(dataUrl);
  const fontFace = new FontFace(family, buffer);
  await fontFace.load();
  document.fonts.add(fontFace);
}
