import { get, set } from 'idb-keyval';

export interface TextEditorDocStatus {
  inProgress: boolean;
  finished: boolean;
  reviewed: boolean;
}

export interface TextEditorDoc {
  id: string;
  title: string;
  dir: 'ltr' | 'rtl';
  /** Each entry is one A4 page's innerHTML. */
  pages: string[];
  updatedAt: number;
  status: TextEditorDocStatus;
}

const STORAGE_KEY = 'text_editor_docs';
const SCHEMA_VERSION = 2;

interface StoredWrapper {
  v: number;
  docs: unknown[];
}

export function defaultDocStatus(): TextEditorDocStatus {
  return { inProgress: false, finished: false, reviewed: false };
}

/** Backfills a doc of unknown vintage into the current shape — the v1 format
 *  saved a bare array whose entries never had `updatedAt`/`status`. Same
 *  shape-detection idiom migrate.ts's migrateChapter already uses (`?? `
 *  defaults) rather than a per-field version check, since only these two
 *  fields were ever added on top of the original shape. */
function migrateDoc(raw: unknown): TextEditorDoc {
  const doc = raw as Partial<TextEditorDoc> & Pick<TextEditorDoc, 'id' | 'title' | 'dir' | 'pages'>;
  return {
    id: doc.id,
    title: doc.title,
    dir: doc.dir,
    pages: doc.pages,
    updatedAt: doc.updatedAt ?? Date.now(),
    status: doc.status ?? defaultDocStatus(),
  };
}

export async function loadTextEditorDocs(): Promise<TextEditorDoc[] | null> {
  const saved = await get(STORAGE_KEY);
  if (!saved) return null;
  // v1 saved a bare array directly; v2+ wraps it as { v, docs }.
  const rawDocs: unknown = Array.isArray(saved) ? saved : (saved as StoredWrapper).docs;
  if (!Array.isArray(rawDocs)) return null;
  return rawDocs.map(migrateDoc);
}

export async function saveTextEditorDocs(docs: TextEditorDoc[]): Promise<void> {
  const stored: StoredWrapper = { v: SCHEMA_VERSION, docs };
  await set(STORAGE_KEY, stored);
}
