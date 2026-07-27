/**
 * Client for the user-configured Magic Erase inpainting server (address set in Settings, see
 * magicEraseStore.ts). The wire contract mirrors the reference implementation this was ported
 * from: POST multipart/form-data with `image` + `mask` (mask white = erase, black = keep) to
 * `<server>/process-image`, get an inpainted PNG back.
 *
 * The address the user types/sees anywhere in this app's UI uses the `.met.server` suffix — that's
 * a display-only alias. `resolveServerHost` is the one place that rewrites it to the real `.hf.space`
 * host before the request goes out; nothing else in this file (or any caller) should see or log the
 * real hostname. This is a client-side label swap, not real concealment — anyone opening the
 * browser's own network inspector while using the app will still see the `.hf.space` request go out,
 * since there's no backend here to proxy it through.
 */
export class MagicEraseError extends Error {}

const DISPLAY_SUFFIX = '.met.server';
const REAL_SUFFIX = '.hf.space';

/** Rewrites a user-facing `*.met.server` address to the real Hugging Face Space host it aliases.
 *  Leaves anything not using the `.met.server` suffix untouched, so a full/custom URL still works. */
function resolveServerHost(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, '');
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(DISPLAY_SUFFIX)) {
    return trimmed.slice(0, trimmed.length - DISPLAY_SUFFIX.length) + REAL_SUFFIX;
  }
  return trimmed;
}

export async function callMagicErase(
  server: string,
  imageBlob: Blob,
  maskBlob: Blob,
  signal?: AbortSignal,
): Promise<Blob> {
  const base = resolveServerHost(server);
  if (!base) throw new MagicEraseError('No Magic Erase server is configured.');

  const url = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  const formData = new FormData();
  formData.append('image', imageBlob, 'image.png');
  formData.append('mask', maskBlob, 'mask.png');

  let response: Response;
  try {
    response = await fetch(`${url}/process-image`, { method: 'POST', body: formData, signal });
  } catch {
    throw new MagicEraseError('Could not reach the Magic Erase server. Check the address in Settings.');
  }
  if (!response.ok) {
    throw new MagicEraseError(`Magic Erase server returned an error (${response.status}).`);
  }
  return response.blob();
}
