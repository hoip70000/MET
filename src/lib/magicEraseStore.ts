import { get, set } from 'idb-keyval';

const STORAGE_KEY = 'magic_erase_server';

/**
 * The Magic Erase server address, pasted by the user in Settings. Stored as a bare string, not an
 * object with a schemaVersion — there's nothing here to migrate, just one field.
 */
export async function loadMagicEraseServer(): Promise<string> {
  const saved = await get(STORAGE_KEY);
  return typeof saved === 'string' ? saved : '';
}

export async function saveMagicEraseServer(url: string): Promise<void> {
  await set(STORAGE_KEY, url.trim());
}
