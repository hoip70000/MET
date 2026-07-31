import { get, set } from 'idb-keyval';
import { genId } from './id';

export interface TextEditorDoc {
  id: string;
  title: string;
  dir: 'ltr' | 'rtl';
  /** Each entry is one A4 page's innerHTML. */
  pages: string[];
  /** Links this doc to a Library chapter, so opening it from that chapter reopens the same doc. Optional: pre-existing docs have none. */
  chapterId?: string;
}

const STORAGE_KEY = 'text_editor_docs';

export async function loadTextEditorDocs(): Promise<TextEditorDoc[] | null> {
  const saved = await get(STORAGE_KEY);
  return Array.isArray(saved) ? saved : null;
}

export async function saveTextEditorDocs(docs: TextEditorDoc[]): Promise<void> {
  await set(STORAGE_KEY, docs);
}

/** Returns the doc already linked to `chapterId`, or appends a new one for it. */
export function findOrCreateChapterDoc(
  docs: TextEditorDoc[],
  chapterId: string,
  defaultTitle: string,
): { docs: TextEditorDoc[]; doc: TextEditorDoc } {
  const existing = docs.find((d) => d.chapterId === chapterId);
  if (existing) return { docs, doc: existing };
  const doc: TextEditorDoc = {
    id: genId('tedoc'),
    title: defaultTitle,
    dir: 'ltr',
    pages: [''],
    chapterId,
  };
  return { docs: [...docs, doc], doc };
}
