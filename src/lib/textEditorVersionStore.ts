import { get, set } from 'idb-keyval';
import { genId } from './id';
import type { TextEditorDoc } from './textEditorStore';

/** Mirrors studioProjectStore.ts's own versioning scheme exactly (MAX_VERSIONS, a per-entity key,
 *  push/list/restore) rather than inventing a separate one — same cadence, same cap. */
const MAX_VERSIONS = 10;

function versionsKey(docId: string) {
  return `text_editor_versions_${docId}`;
}

export interface TextEditorVersionSnapshot {
  id: string;
  timestamp: string;
  label?: string;
  title: string;
  dir: 'ltr' | 'rtl';
  pages: string[];
}

export async function pushTextEditorVersion(docId: string, doc: TextEditorDoc, label?: string): Promise<void> {
  const existing = (await get(versionsKey(docId))) as TextEditorVersionSnapshot[] | undefined;
  const versions = Array.isArray(existing) ? existing : [];
  const snapshot: TextEditorVersionSnapshot = {
    id: genId('tever'),
    timestamp: new Date().toISOString(),
    label,
    title: doc.title,
    dir: doc.dir,
    pages: doc.pages,
  };
  const next = [...versions, snapshot].slice(-MAX_VERSIONS);
  await set(versionsKey(docId), next);
}

export async function listTextEditorVersions(docId: string): Promise<TextEditorVersionSnapshot[]> {
  const saved = await get(versionsKey(docId));
  return Array.isArray(saved) ? saved : [];
}

export async function restoreTextEditorVersion(docId: string, versionId: string): Promise<TextEditorVersionSnapshot | null> {
  const versions = await listTextEditorVersions(docId);
  return versions.find(v => v.id === versionId) ?? null;
}
