import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Search, Download, FileType, Printer, Send, Heading1, Heading2,
  Check, Loader2, AlertCircle, Circle, PanelRight, Table as TableIcon,
  Pencil, Eye,
  Heading3, Heading4, AlignJustify, IndentIncrease, IndentDecrease,
  Strikethrough, Undo2, Redo2, Languages, ChevronUp, ChevronDown, Minus, Clock,
  Maximize2, Minimize2, Sun, Moon,
} from 'lucide-react';
import { Button, IconButton } from '../ui';
import { useTheme } from '../../contexts/ThemeContext';
import { swal, swalToast, Swal } from '../../lib/swalTheme';
import { genId } from '../../lib/id';
import { loadTextEditorDocs, saveTextEditorDocs, defaultDocStatus, type TextEditorDoc, type TextEditorDocStatus } from '../../lib/textEditorStore';
import { stripSpellMarks } from '../../lib/spellCheck';
import { exportDocAsTxt, exportDocAsDocx, printDocAsPdf, downloadBlob } from '../../lib/textEditorExport';
import { SplitScreenPreview } from './SplitScreenPreview';
import { DocumentLibrary } from './DocumentLibrary';
import { TableToolbar } from './TableToolbar';
import { ImageControls } from './ImageControls';
import {
  insertTableHtml, findEnclosingTable, findEnclosingCell, addRow, addColumn,
  deleteRow, deleteColumn, deleteTable, restoreCaretAt, navigateCell,
  type CaretRestorePoint,
} from '../../lib/textEditorTables';
import { markSelectionAs, stripStatusMarks, type MarkStatus } from '../../lib/textEditorMarks';
import { pushTextEditorVersion, listTextEditorVersions, restoreTextEditorVersion, type TextEditorVersionSnapshot } from '../../lib/textEditorVersionStore';
import { loadStoredFonts } from '../../lib/fontsStore';
import { registerStoredFont, readFileAsDataUrl } from '../../lib/fontLoader';
import { FONT_FAMILIES } from '../studio/studioTypes';
import { TextEditorMenuBar } from './TextEditorMenuBar';
import type { TextEditorMenuActions } from './textEditorMenuDefinitions';
import { useTextEditorShortcuts } from './useTextEditorShortcuts';
import { SendToTyperDialog, type SendToTyperChapterOption, type SendToTyperResult } from './SendToTyperDialog';
import type { TyperSendRequest } from '../../lib/typerBridge';
import type { Workspace } from '../../types';

/**
 * Section 0 architecture audit (see plan doc for full detail):
 * A1 storage — content lives in the live contentEditable DOM, read via
 *   `pageRefs.current[i].innerHTML`. React `docs` state is intentionally a stale
 *   snapshot while a page is being typed into, refreshed only at real structural
 *   transitions (doc switch/add/remove, spellcheck/replace, unmount) via
 *   `getDocsWithLiveContent()`.
 * A2 autosave — reads live DOM (`captureActiveDocPages`) and persists via
 *   `saveTextEditorDocs`, but must NEVER call `setDocs` for the active, mounted
 *   page's own content: doing so re-feeds a "new" string through
 *   `dangerouslySetInnerHTML` on the same node, forcibly resetting the live DOM
 *   subtree and destroying the caret (this was the actual text-vanishing bug).
 *   This turned out to be necessary but not sufficient: empirically, *any*
 *   re-render of `TextEditorPage` — even one that never touches `docs` at all
 *   (confirmed by instrumenting a real browser session) — was enough to clear
 *   the page's live content, because the contentEditable div was a plain
 *   inline host element inside the parent's own render function. Every parent
 *   re-render re-evaluates that JSX and reconciles a "new" element against the
 *   old one; a bare host div gets no bailout from that, regardless of whether
 *   its own `dangerouslySetInnerHTML` value actually changed. The fix is
 *   `EditablePage` below: a `memo`-wrapped component with fully stable props
 *   (a per-index ref-callback cache, and `handleInput`/`handleSpellClick`
 *   exposed as `useCallback`-stabilized wrappers around a "latest logic" ref)
 *   so React can skip re-rendering — and thus skip touching the DOM at all —
 *   for a page whose actual content hasn't changed, no matter what else in the
 *   parent re-renders (a save-status indicator, search panel, spellcheck
 *   count, or any future state).
 * A3 background — `.te-page` uses literal `bg-white text-black` (theme-proof).
 *   `.dark`'s `color-scheme: dark` (index.css) is an inherited property that
 *   still reaches it and is what browser/OS forced-dark heuristics key off, so
 *   it gets an explicit `color-scheme: light` opt-out.
 * A4 tables — no mechanism existed before this session.
 * A5 images — no dedicated insertion code, but contentEditable natively accepts
 *   pasted/dropped images (plain `<img>` tags in the page HTML, not tracked in
 *   `TextEditorDoc` separately).
 * A6 file management — was a flat, unversioned `TextEditorDoc[]`, no per-doc
 *   metadata or sidebar UI before this session.
 * A7 split preview — did not exist; `TextEditorPage` had no reference to
 *   workspaces/chapters before this session.
 */

const PAGE_WIDTH = 794; // A4 at 96dpi
const PAGE_HEIGHT = 1123;
const AUTOSAVE_MS = 1000;

function newDoc(title = 'Untitled'): TextEditorDoc {
  return { id: genId('tedoc'), title, dir: 'ltr', pages: [''], updatedAt: Date.now(), status: defaultDocStatus() };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** `command`/`blockTag` are only present on buttons with a real queryCommandState/Value-checkable
 *  active state — Undo/Redo/Insert Table/indent/outdent have no meaningful "is this on" concept,
 *  so they're left with neither and always render inactive. */
interface ToolbarButtonDef {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  run: () => void;
  command?: string;
  blockTag?: string;
}

interface EditablePageProps {
  initialHtml: string;
  pageRef: (el: HTMLDivElement | null) => void;
  onInput: () => void;
  onClick: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/** Isolated behind `memo` deliberately — see the A2 note in the audit comment
 *  above. Must receive only stable/primitive props (a string, not a fresh
 *  `{__html}` wrapper object; stable callback references) or the memoization
 *  is defeated and every parent re-render still reaches into this DOM.
 *
 *  This isn't just about *comparing* props cheaply — it turned out to be about whether
 *  `dangerouslySetInnerHTML` gets reapplied at all. `initialHtml` (from `docs` state) is
 *  intentionally stale while typing (state is never synced on every keystroke — see A2 above),
 *  so it can sit at `''` for a brand-new page indefinitely while the *live* DOM already has real
 *  typed content the browser put there directly. That's safe only as long as this component never
 *  actually re-renders past its initial mount: the FIRST time it does — for *any* reason, even an
 *  unrelated prop most would assume is harmless — React diffs and reapplies
 *  `dangerouslySetInnerHTML` against that stale value, wiping the live content back to it.
 *  Confirmed empirically (not assumed): adding a primitive `zoom`/`spellCheckActive` prop here
 *  and toggling it after typing reproduced exactly this wipe. Anything that needs to vary per
 *  render (zoom, the page-number footer, the spellcheck attribute) has to live *outside* this
 *  component (the parent's own wrapper JSX) or be applied imperatively via `pageRefs` in a
 *  `useEffect`, never as a prop that flows into this render. */
const EditablePage = memo(function EditablePage({ initialHtml, pageRef, onInput, onClick, onKeyDown, onContextMenu }: EditablePageProps) {
  return (
    <div
      ref={pageRef}
      contentEditable
      suppressContentEditableWarning
      dangerouslySetInnerHTML={{ __html: initialHtml }}
      onInput={onInput}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      className="te-page bg-white text-black px-16 py-16 text-[15px] leading-relaxed outline-none overflow-hidden"
      style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, minHeight: PAGE_HEIGHT, colorScheme: 'light' }}
    />
  );
});

interface TextEditorPageProps {
  onSendToTyper: (request: TyperSendRequest) => void;
  /** Full workspace tree, read-only — flattened into the Send-to-TypeR dialog's chapter picker.
   *  Nothing here is ever mutated; sending goes through onSendToTyper only. */
  workspaces: Workspace[];
  /** Whichever chapter the user had open in Studio most recently this session (or null), used to
   *  pre-select the Send-to-TypeR dialog's chapter dropdown and as the split-screen preview's
   *  default chapter — both still changeable/browsable either way. */
  activeChapterId: string | null;
  /** The page currently active *inside* Studio, live — null whenever Studio isn't actually mounted
   *  (this page and Studio are mutually-exclusive tabs, so that's most of the time). Drives the
   *  split-screen preview's initial page whenever it changes; the preview's own prev/next/page-
   *  number controls can still browse away from it independently afterward. */
  studioActivePageId: string | null;
}

export function TextEditorPage({ onSendToTyper, workspaces, activeChapterId, studioActivePageId }: TextEditorPageProps) {
  const [splitScreenOpen, setSplitScreenOpen] = useState(false);
  // The app-wide theme (same one TopBar/SettingsPanel toggle) — not a second, editor-local theme
  // system. Pages themselves stay bg-white/text-black regardless (see the page div's own
  // className below), since they represent paper, not chrome.
  const { resolvedTheme, toggleTheme } = useTheme();
  const [docs, setDocs] = useState<TextEditorDoc[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renderKey, setRenderKey] = useState(0); // bump only on structural changes (doc switch, page add/remove)
  const [searchOpen, setSearchOpen] = useState(false);
  const [findMode, setFindMode] = useState<'find' | 'replace'>('find');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
  const [activeTable, setActiveTable] = useState<HTMLTableElement | null>(null);
  const [tableFullySelected, setTableFullySelected] = useState(false);
  const activeTableCellRef = useRef<HTMLTableCellElement | null>(null);
  /** Increments across the session so a deleted-then-recreated "Document N"
   *  never collides with an existing title, unlike a plain docs.length+1. */
  const docCounterRef = useRef(0);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [imageContextMenuPos, setImageContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const imageContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [markMenuPos, setMarkMenuPos] = useState<{ x: number; y: number } | null>(null);
  const markMenuRef = useRef<HTMLDivElement | null>(null);
  const markSelectionRef = useRef<{ root: HTMLElement; range: Range } | null>(null);
  const [sendToTyperOpen, setSendToTyperOpen] = useState(false);

  // Full screen: mirrors Studio.tsx's own studioRootRef/isFullscreen/toggleFullscreen idiom exactly,
  // scoped to this component's own root instead.
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    function onFullscreenChange() { setIsFullscreen(document.fullscreenElement === rootRef.current); }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      rootRef.current?.requestFullscreen().catch(() => {
        swalToast({ icon: 'error', title: "Couldn't enter fullscreen" });
      });
    }
  }

  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dirtyRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-current mirrors of `docs`/`activeDocId`, read from async callbacks (the debounced
  // autosave timeout, the unmount flush) instead of the closed-over state values, which go stale
  // the moment a callback outlives the render that created it.
  const docsRef = useRef<TextEditorDoc[]>([]);
  const activeDocIdRef = useRef<string | null>(null);
  /** Stable per-page-index ref callbacks — reusing the same function reference
   *  across renders is required for `EditablePage`'s `memo` to bail out (a
   *  fresh inline arrow function every render would look like a changed prop). */
  const pageRefCallbacksRef = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map());
  /** "Latest logic" refs backing the stable `handleInput`/`handleSpellClick`
   *  wrappers below — lets those exposed callbacks keep one identity forever
   *  (required for `EditablePage`'s `memo` to bail out) while always running
   *  the current render's actual logic, never a stale closure. */
  const runInputLogicRef = useRef<() => void>(() => {});
  const runPageClickLogicRef = useRef<(e: React.MouseEvent) => void>(() => {});
  const runKeyDownLogicRef = useRef<(e: React.KeyboardEvent) => void>(() => {});
  const runContextMenuLogicRef = useRef<(e: React.MouseEvent) => void>(() => {});

  useEffect(() => { docsRef.current = docs; activeDocIdRef.current = activeDocId; }, [docs, activeDocId]);

  function getPageRefCallback(i: number): (el: HTMLDivElement | null) => void {
    const cache = pageRefCallbacksRef.current;
    let cb = cache.get(i);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => { pageRefs.current[i] = el; };
      cache.set(i, cb);
    }
    return cb;
  }

  const handleInput = useCallback(() => { runInputLogicRef.current(); }, []);
  const handlePageClick = useCallback((e: React.MouseEvent) => { runPageClickLogicRef.current(e); }, []);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => { runKeyDownLogicRef.current(e); }, []);
  const handleContextMenu = useCallback((e: React.MouseEvent) => { runContextMenuLogicRef.current(e); }, []);

  /** Replaces every direct `setDocs(...)` call site so `docsRef` never drifts
   *  from `docs` state. */
  function updateDocs(next: TextEditorDoc[]) {
    docsRef.current = next;
    setDocs(next);
  }
  // The actual source of truth for what each page's `dangerouslySetInnerHTML` renders. Deliberately
  // NOT derived from `docs` on every render: `docs` (and thus `activeDoc.pages`) is intentionally
  // stale while typing (see reflow()'s own comment), and autosave eventually reconciles it with the
  // live DOM. If the page divs rendered straight from `docs`, that reconciliation would flip a
  // page's `__html` prop from stale to live on every autosave tick, and React would reset
  // `node.innerHTML` on the very node the user is typing into — wiping the caret, and under any
  // timing overlap with continued typing, dropping keystrokes. Only the handful of places below
  // that *intend* to replace on-screen content (doc load/switch/close, spell check, find & replace,
  // version restore) may write here; autosave must only ever read the DOM, never write it.
  const pageSeedRef = useRef<string[]>([]);

  useEffect(() => {
    // StrictMode double-invokes this effect in dev. Without the `cancelled`
    // guard, both invocations would independently call `newDoc()` (a fresh
    // random id each time) whenever no doc is saved yet, and whichever
    // resolves last would silently replace the other — including any content
    // already typed into it, since the page tree's key is keyed off the doc id.
    let cancelled = false;
    loadTextEditorDocs().then((saved) => {
      if (cancelled) return;
      const initial = saved && saved.length > 0 ? saved : [newDoc()];
      docsRef.current = initial;
      for (const d of initial) {
        const match = /^Document (\d+)$/.exec(d.title);
        if (match) docCounterRef.current = Math.max(docCounterRef.current, parseInt(match[1], 10));
      }
      pageSeedRef.current = initial[0].pages;
      setDocs(initial);
      setActiveDocId(initial[0].id);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Custom fonts are a page-global FontFace registration (document.fonts), but Studio's own
  // FontsPanel is what normally triggers loading them from storage — a user who opens the text
  // editor without ever opening Studio this session wouldn't otherwise have them registered.
  const [customFontFamilies, setCustomFontFamilies] = useState<string[]>([]);
  useEffect(() => {
    loadStoredFonts().then((fonts) => {
      fonts.forEach((f) => { registerStoredFont(f.family, f.dataUrl).catch(console.error); });
      setCustomFontFamilies(fonts.map(f => f.family));
    });
  }, []);

  const activeDoc = docs.find(d => d.id === activeDocId) ?? null;

  function captureActiveDocPages(): string[] {
    return pageRefs.current.filter((el): el is HTMLDivElement => !!el).map(el => el.innerHTML);
  }

  /** `docsRef.current` with the active doc's pages replaced by a fresh live-DOM
   *  read — the single source of truth for "docs, but honest about what's
   *  currently on screen." Reads only refs, so it's safe to call from a stale
   *  closure (e.g. the unmount cleanup) regardless of when it fires. */
  function getDocsWithLiveContent(): TextEditorDoc[] {
    const activeId = activeDocIdRef.current;
    if (!activeId) return docsRef.current;
    const pages = captureActiveDocPages();
    if (pages.length === 0) return docsRef.current;
    return docsRef.current.map(d => d.id === activeId ? { ...d, pages } : d);
  }

  function commitActiveDocPages(pages: string[]) {
    if (!activeDocId) return;
    updateDocs(docsRef.current.map(d => d.id === activeDocId ? { ...d, pages, updatedAt: Date.now() } : d));
    pageSeedRef.current = pages;
    setDocs(prev => prev.map(d => d.id === activeDocId ? { ...d, pages } : d));
  }

  function scheduleAutosave() {
    dirtyRef.current = true;
    setSaveStatus('unsaved');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      // Deliberately reads live DOM + the always-current refs, not the `docs`/`activeDocId`
      // closed over at schedule-time, and deliberately never writes `pageSeedRef` — see its own
      // comment above. This is what keeps a debounced autosave from ever touching the on-screen
      // contenteditable content.
      void flushSave();
      // Every debounced autosave also pushes a capped version snapshot — the same cadence
      // studioProjectStore.ts's flushAutosave already uses for Studio (save + pushVersionSnapshot
      // back-to-back), not a separately-invented interval. `flushSave` updates `docsRef`
      // synchronously before its first `await`, so it's already current here.
      const docId = activeDocIdRef.current;
      const activeAfterSave = docsRef.current.find(d => d.id === docId);
      if (activeAfterSave) pushTextEditorVersion(activeAfterSave.id, activeAfterSave).catch(console.error);
    }, AUTOSAVE_MS);
  }

  /** Persists the live content and updates `docsRef` — deliberately never calls
   *  `setDocs`/re-renders the active page, since that would force
   *  `dangerouslySetInnerHTML` to re-apply on the still-mounted, still-focused
   *  contentEditable node and destroy the caret (see Section 0 audit above). */
  async function flushSave(): Promise<void> {
    const activeId = activeDocIdRef.current;
    const nextDocs = getDocsWithLiveContent().map(d => d.id === activeId ? { ...d, updatedAt: Date.now() } : d);
    docsRef.current = nextDocs;
    setSaveStatus('saving');
    try {
      await saveTextEditorDocs(nextDocs);
      const readBack = await loadTextEditorDocs();
      const sentLen = nextDocs.reduce((n, d) => n + d.pages.join('').length, 0);
      const gotLen = (readBack ?? []).reduce((n, d) => n + d.pages.join('').length, 0);
      if (sentLen !== gotLen) {
        throw new Error('SAVE REGRESSION: saved content does not match source');
      }
      setSaveStatus('saved');
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
      swalToast({ icon: 'error', title: err instanceof Error ? err.message : 'Save failed' });
    }
  }

  useEffect(() => () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
    if (dirtyRef.current) {
      saveTextEditorDocs(getDocsWithLiveContent()).catch(console.error);
    }
  }, []);

  /** Block-level reflow: pushes overflowing trailing blocks to the next page, and pulls
   *  blocks back up from the next page to fill gaps, then drops empty trailing pages. */
  /** Block-level reflow, run after every edit: push overflowing trailing blocks down into
   *  existing pages, pull blocks back up from the next page to fill gaps. All of this is direct
   *  DOM manipulation on the live contenteditable nodes — it deliberately never rewrites an
   *  unaffected page's content back into React state (dangerouslySetInnerHTML would reset that
   *  page's DOM and destroy the caret mid-keystroke). State is only touched to change the page
   *  *count* (splicing the pages array, keeping every untouched entry's string reference as-is)
   *  when a page needs to be added or a trailing empty page dropped — the next render then gives
   *  the new/removed page a real DOM node, and the effect below re-runs reflow so overflow
   *  actually lands there (can't synthesize a properly laid-out page node outside of React's
   *  render, so this is a deliberate two-pass flow, not a single synchronous pagination pass). */
  function reflow() {
    const els = pageRefs.current.filter((el): el is HTMLDivElement => !!el);
    if (els.length === 0 || !activeDocId) return;

    for (let i = 0; i < els.length - 1; i++) {
      const page = els[i];
      const next = els[i + 1];

      // A hard page break (Ctrl+Enter) forces everything from the marker onward to the next page,
      // unconditionally — a real page break, not just an overflow consequence. The marker itself
      // travels along (never stripped), so it keeps enforcing the same split on every future pass
      // even if surrounding content shrinks. Skips a marker that's already this page's own very
      // first node — that one already correctly anchors *this* page's start (from a previous
      // pass); it's a *later* marker (e.g. two hard breaks typed back to back before either one
      // has been given its own page yet) that means "split again here."
      const childNodes = Array.from(page.childNodes);
      const startsWithBreak = childNodes[0] instanceof HTMLElement && childNodes[0].dataset.hardBreak === 'true';
      const hardBreak = childNodes.slice(startsWithBreak ? 1 : 0)
        .find((n): n is HTMLElement => n instanceof HTMLElement && n.dataset.hardBreak === 'true');
      if (hardBreak) {
        const toMove: ChildNode[] = [];
        for (let node: ChildNode | null = hardBreak; node; node = node.nextSibling) toMove.push(node);
        for (let k = toMove.length - 1; k >= 0; k--) next.insertBefore(toMove[k], next.firstChild);
      }

      // .lastChild/.firstChild (not .lastElementChild/.firstElementChild) deliberately: plain
      // typed text with no wrapping block — a lone Text node directly inside the page, which is
      // exactly what a contenteditable div holds until the user presses Enter — has no *element*
      // children at all, so the element-only version could never push an overflowing run of raw
      // text to the next page.
      let guard = 0;
      while (page.scrollHeight > page.clientHeight + 2 && page.lastChild && guard < 500) {
        guard += 1;
        next.insertBefore(page.lastChild, next.firstChild);
      }
    }

    for (let j = 0; j < els.length - 1; j++) {
      const page = els[j];
      const next = els[j + 1];
      let guard = 0;
      while (next.firstChild && guard < 500) {
        guard += 1;
        const candidate = next.firstChild;
        // Never pull a hard-break marker (or anything after it) back across the boundary it
        // enforces — it must stay the first thing on whichever page it currently anchors.
        if (candidate instanceof HTMLElement && candidate.dataset.hardBreak === 'true') break;
        page.appendChild(candidate);
        if (page.scrollHeight > page.clientHeight + 2) {
          next.insertBefore(candidate, next.firstChild);
          break;
        }
      }
    }

    let lastNonEmpty = els.length - 1;
    while (lastNonEmpty > 0 && els[lastNonEmpty].innerHTML.trim() === '') lastNonEmpty -= 1;
    const lastEl = els[els.length - 1];
    const needsNewPage = lastEl.scrollHeight > lastEl.clientHeight + 2;
    // A hard break unconditionally demands its own page boundary even when nothing is anywhere
    // near overflowing — count every marker across all current pages (not just the last one) so
    // e.g. a single Ctrl+Enter on an otherwise-empty page still grows the page list; the two
    // passes above can only actually relocate a marker's content once its target page exists as a
    // real DOM node, which happens on the *next* render (see the effect below).
    const hardBreakCount = els.reduce((sum, el) => sum + el.querySelectorAll('[data-hard-break="true"]').length, 0);
    const neededCount = Math.max(needsNewPage ? els.length + 1 : lastNonEmpty + 1, hardBreakCount + 1);
    const currentCount = activeDoc?.pages.length ?? els.length;

    if (neededCount !== currentCount) {
      const docId = activeDocIdRef.current;
      // Only ever grows/truncates the pages array *length* — every untouched
      // page's string reference is preserved as-is, so this never disturbs a
      // live-edited page's dangerouslySetInnerHTML value (see Section 0 audit).
      // Rebuild from each existing page's *current live DOM content*, not the possibly-stale
      // `d.pages` React state, purely for persistence bookkeeping — page content itself no longer
      // renders from `d.pages` (see pageSeedRef's own comment), but keeping it fresh here still
      // matters for whatever the *next* save/export/close reads.
      const freshPages = captureActiveDocPages();
      updateDocs(docsRef.current.map((d) => {
        if (d.id !== docId) return d;
        const pages = [...freshPages];
        if (neededCount > pages.length) {
          while (pages.length < neededCount) pages.push('');
        } else {
          pages.length = Math.max(1, neededCount);
        }
        return { ...d, pages };
      }));
      // pageSeedRef grows/shrinks in lockstep with the page *count* so a newly-mounted page gets a
      // seed value and a dropped one is discarded — but existing entries are left untouched (not
      // overwritten with freshPages): this count change doesn't remount any existing page's div
      // (only the `.map()`'s length changes), so there's nothing to re-seed for pages that are
      // still on screen.
      const seed = [...pageSeedRef.current];
      if (neededCount > seed.length) {
        while (seed.length < neededCount) seed.push('');
      } else {
        seed.length = Math.max(1, neededCount);
      }
      pageSeedRef.current = seed;
    }
  }

  /** A hard break just inserted, awaiting its real page: a fresh Ctrl+Enter always wants the
   *  caret in the empty paragraph right after its marker, but when it's first inserted, the page
   *  it ultimately belongs on doesn't exist as a DOM node yet (see the effect below) — and a page
   *  whose *content* changes as part of that same update gets its whole subtree re-parsed from
   *  the HTML string (`dangerouslySetInnerHTML`), which throws away the original marker/paragraph
   *  *objects* even though structurally-equivalent new ones take their place. A plain node
   *  reference would already be stale by the time this runs, so the marker carries a one-off id
   *  instead — a real HTML attribute, which survives the string round-trip untouched — and the
   *  effect re-finds it live rather than trusting any object identity captured earlier. */
  const pendingHardBreakIdRef = useRef<string | null>(null);

  // A page added/removed by reflow() only gets/loses a real DOM node on the next render —
  // re-run reflow once that's happened so overflow actually finishes moving.
  useEffect(() => {
    reflow();

    const pendingId = pendingHardBreakIdRef.current;
    if (pendingId) {
      pendingHardBreakIdRef.current = null;
      const marker = document.querySelector<HTMLElement>(`[data-break-id="${pendingId}"]`);
      const target = marker?.nextElementSibling as HTMLElement | null;
      const hostPage = target && pageRefs.current.find((p): p is HTMLDivElement => !!p && p.contains(target));
      if (hostPage && target) {
        hostPage.focus();
        const range = document.createRange();
        // setStartBefore(target), not setStart(target, 0): the latter is a boundary point
        // *inside* target (before its own first child), which isCaretAtPageStart's own
        // setStartBefore(marker.nextSibling) check ranks as *after* this position per the DOM
        // Range boundary-point-comparison algorithm — Backspace-to-merge would never fire on a
        // freshly-created page otherwise.
        range.setStartBefore(target);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.pages.length]);

  // The active table lives as a raw DOM node inside dangerouslySetInnerHTML
  // content, not a React-managed element — its "selected" outline is applied
  // imperatively rather than via a class from a stylesheet.
  useEffect(() => {
    if (!activeTable) return;
    if (tableFullySelected) {
      activeTable.style.outline = '2px solid #007AFF';
      activeTable.style.outlineOffset = '1px';
    } else {
      activeTable.style.outline = '';
      activeTable.style.outlineOffset = '';
    }
    return () => {
      activeTable.style.outline = '';
      activeTable.style.outlineOffset = '';
    };
  }, [activeTable, tableFullySelected]);

  useEffect(() => {
    if (!imageContextMenuPos) return;
    function dismiss(e: PointerEvent) {
      if (imageContextMenuRef.current?.contains(e.target as Node)) return;
      setImageContextMenuPos(null);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setImageContextMenuPos(null); }
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [imageContextMenuPos]);

  useEffect(() => {
    if (!markMenuPos) return;
    function dismiss(e: PointerEvent) {
      if (markMenuRef.current?.contains(e.target as Node)) return;
      setMarkMenuPos(null);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMarkMenuPos(null); }
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [markMenuPos]);

  // Deselecting an image on outside click is already handled inside
  // runPageClickLogic (a click anywhere in the page that isn't the image
  // itself clears selectedImage) — this covers clicking outside the page
  // entirely (e.g. onto chrome/toolbars), which that handler never sees.
  useEffect(() => {
    if (!selectedImage) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (target === selectedImage || (target instanceof Node && selectedImage.contains(target))) return;
      const withinPage = pageRefs.current.some(el => el?.contains(target));
      if (!withinPage) setSelectedImage(null);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [selectedImage]);

  function runInputLogic() {
    scheduleAutosave();
    reflow();
    scheduleContentAnalysis();
  }
  runInputLogicRef.current = runInputLogic;

  function exec(command: string, value?: string) {
    document.execCommand(command, false, value);
  }

  /** Clicking a heading button while the block is already that heading reverts it to a plain
   *  paragraph instead of re-applying the same heading — matches every other rich text editor's
   *  toggle convention. */
  function toggleFormatBlock(tag: string) {
    const current = document.queryCommandValue('formatBlock').toLowerCase();
    exec('formatBlock', current === tag.toLowerCase() ? 'P' : tag);
  }

  function activePageEl(): HTMLElement | null {
    const el = document.activeElement;
    return el instanceof HTMLElement && el.classList.contains('te-page') ? el : null;
  }

  /** `execCommand('fontSize', ...)` only supports the legacy 1-7 scale, not arbitrary px sizes —
   *  the standard workaround is applying size "7" then fixing up the resulting `<font>` tag(s) to
   *  a real pixel value directly. */
  function applyFontSize(px: number) {
    // The font-size input/steppers necessarily steal focus before this runs (typing a value,
    // clicking a stepper button) — activePageEl() would otherwise see the input/button, not the
    // page, and silently no-op. Restore the selection captured on the control's own mousedown.
    if (!activePageEl()) restoreFormatSelection();
    const page = activePageEl();
    if (!page) return;
    document.execCommand('fontSize', false, '7');
    page.querySelectorAll('font[size="7"]').forEach((el) => {
      el.removeAttribute('size');
      (el as HTMLElement).style.fontSize = `${px}px`;
    });
    handleInput();
  }

  // Free-text font size box: accepts any typed value (not just presets), applied via the same
  // applyFontSize() above. lastFontSizeRef is the last successfully-applied value — both the
  // up/down step buttons' base and what an invalid typed value silently reverts to.
  const [fontSizeInput, setFontSizeInput] = useState('12');
  const lastFontSizeRef = useRef(12);
  const FONT_SIZE_MIN = 1;
  const FONT_SIZE_MAX = 999;
  const FONT_SIZE_STEP = 1;

  function commitFontSizeInput(raw: string) {
    const parsed = Number(raw);
    if (!raw.trim() || !Number.isFinite(parsed) || parsed < FONT_SIZE_MIN || parsed > FONT_SIZE_MAX) {
      setFontSizeInput(String(lastFontSizeRef.current));
      return;
    }
    const clamped = Math.round(parsed);
    lastFontSizeRef.current = clamped;
    setFontSizeInput(String(clamped));
    applyFontSize(clamped);
  }

  function stepFontSize(delta: number) {
    const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, lastFontSizeRef.current + delta));
    lastFontSizeRef.current = next;
    setFontSizeInput(String(next));
    applyFontSize(next);
  }

  /** Firefox uses `hiliteColor`, older Chromium builds only support `backColor` for a text
   *  background — try the standard one first and fall back if it's not supported. */
  function applyHighlight(color: string) {
    if (document.queryCommandSupported('hiliteColor')) {
      document.execCommand('hiliteColor', false, color);
    } else {
      document.execCommand('backColor', false, color);
    }
    handleInput();
  }

  function closestBlockAncestor(node: Node, page: HTMLElement): HTMLElement {
    let el: Node | null = node;
    while (el && el !== page) {
      if (el instanceof HTMLElement) {
        const display = getComputedStyle(el).display;
        if (display === 'block' || display === 'list-item') return el;
      }
      el = el.parentNode;
    }
    return page;
  }

  /** Line spacing has no execCommand equivalent — applied directly as an inline style on the
   *  selection's nearest block ancestor, consistent with this editor's "execCommand first, direct
   *  DOM as a fallback" convention. */
  function applyLineSpacing(value: number) {
    const page = activePageEl();
    const sel = window.getSelection();
    if (!page || !sel || sel.rangeCount === 0) return;
    const block = closestBlockAncestor(sel.getRangeAt(0).startContainer, page);
    block.style.lineHeight = String(value);
    handleInput();
  }

  function toggleDir() {
    if (!activeDocId) return;
    setDocs(prev => prev.map(d => d.id === activeDocId ? { ...d, dir: d.dir === 'rtl' ? 'ltr' : 'rtl' } : d));
    scheduleAutosave();
  }

  function showShortcuts() {
    swal({
      title: 'Keyboard Shortcuts',
      html: `
        <div style="text-align:left;font-size:13px;line-height:1.7">
          <b>Ctrl+N</b> New document &nbsp; <b>Ctrl+S</b> Save now<br/>
          <b>Ctrl+B/I/U</b> Bold/Italic/Underline &nbsp; <b>Ctrl+Shift+X</b> Strikethrough<br/>
          <b>Ctrl+Enter</b> Hard page break<br/>
          <b>Ctrl+F</b> Find &nbsp; <b>Ctrl+H</b> Find &amp; Replace<br/>
          <b>Ctrl+Z</b> Undo &nbsp; <b>Ctrl+Y</b> Redo<br/>
          <b>Ctrl+Shift+L/E/R/J</b> Align left/center/right/justify<br/>
          <b>Ctrl+Alt+1..4</b> Heading 1-4 &nbsp; <b>Ctrl+0</b> Normal<br/>
          <b>Alt+Shift+S</b> Send to TypeR<br/>
          <b>Esc</b> Close Find panel
        </div>`,
      confirmButtonText: 'Close',
    });
  }

  // --- Word-style page-model extensions: hard breaks, cross-page caret nav, empty-page merge ---

  const [zoom, setZoom] = useState(1);
  /** Set right before a renderKey-driven structural remount that changes which page the caret
   *  should land on (currently only the empty-page Backspace-merge) — pageRefs only gets fresh DOM
   *  nodes for the new page list on the *next* render, so the actual caret placement has to wait
   *  for that render rather than happening synchronously in the same handler. */
  const pendingCaretRef = useRef<{ pageIndex: number; edge: 'start' | 'end' } | null>(null);

  function moveCaretToPageEdge(pageIndex: number, edge: 'start' | 'end') {
    const page = pageRefs.current[pageIndex];
    if (!page) return;
    page.focus();
    const range = document.createRange();
    range.selectNodeContents(page);
    range.collapse(edge === 'start');
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function isCaretAtPageStart(page: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const startRange = document.createRange();
    // A hard-break marker that's this page's own first child is invisible chrome (zero height,
    // never a place a caret can visually sit) — reflow()'s own hardBreak handling already treats a
    // leading marker specially for the same reason. Without skipping it here, the caret the
    // hard-break's own focus-follow effect places (at the start of the fresh paragraph *right
    // after* the marker) reads as one position past "page start," so Backspace there would never
    // trigger the merge — it's the first real position on the page in every way that matters to
    // the user, who never sees the marker at all.
    const firstChild = page.firstChild;
    const marker = firstChild instanceof HTMLElement && firstChild.dataset.hardBreak === 'true' ? firstChild : null;
    if (marker && marker.nextSibling) {
      startRange.setStartBefore(marker.nextSibling);
    } else {
      startRange.selectNodeContents(page);
      startRange.collapse(true);
    }
    return range.compareBoundaryPoints(Range.START_TO_START, startRange) === 0;
  }

  function isCaretAtPageEnd(page: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const endRange = document.createRange();
    endRange.selectNodeContents(page);
    endRange.collapse(false);
    return range.compareBoundaryPoints(Range.END_TO_END, endRange) === 0;
  }

  function getCaretPosition(): { node: Node; offset: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return { node: range.startContainer, offset: range.startOffset };
  }

  /** The most recent real caret position inside a page, tracked continuously (not just captured
   *  at one call site) — reaching a menu action like Insert > Table takes at least one click on a
   *  menu button first, which moves focus away from the page *before* the action's own handler
   *  ever runs, so reading `document.activeElement`/the live selection at that point would only
   *  ever see the menu button, never the page. */
  const lastPageSelectionRef = useRef<{ page: HTMLDivElement; range: Range } | null>(null);
  // Bumped on every selectionchange purely to force a re-render — the toolbar reads
  // document.queryCommandState/Value fresh at render time (see toolbarButtons' active prop
  // below), so it has no state of its own to update; it just needs to be told when to re-check.
  const [formatTick, setFormatTick] = useState(0);
  useEffect(() => {
    function onSelectionChange() {
      setFormatTick(t => t + 1);
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      let node: Node | null = sel.getRangeAt(0).startContainer;
      while (node && !(node instanceof HTMLElement)) node = node.parentNode;
      const page = (node as HTMLElement | null)?.closest('.te-page') as HTMLDivElement | null;
      if (page) lastPageSelectionRef.current = { page, range: sel.getRangeAt(0).cloneRange() };
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  /** Restores the most recent real in-page selection as the live one — used by controls that
   *  necessarily steal focus before applying (the font family/size controls below), so the
   *  browser has something to actually apply the change to instead of nothing. */
  function restoreLastPageSelection(): boolean {
    const saved = lastPageSelectionRef.current;
    if (!saved) return false;
    saved.page.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(saved.range);
    return true;
  }

  /** A second, deliberately *separate* snapshot from `lastPageSelectionRef` above — that one is
   *  continuously overwritten on every `selectionchange`, which includes the one a form control
   *  (a `<select>`, a color `<input>`) fires the instant it steals focus, collapsing the document
   *  selection *before* that control's own `onChange` ever runs. By the time `onChange` fires,
   *  `lastPageSelectionRef` would already hold that collapsed, useless selection instead of the
   *  user's real one. This ref is only ever written explicitly, from a control's own `onMouseDown`
   *  (still ahead of the focus shift, but not subject to being silently overwritten again after). */
  const savedFormatSelectionRef = useRef<{ page: HTMLDivElement; range: Range } | null>(null);

  function captureFormatSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && !(node instanceof HTMLElement)) node = node.parentNode;
    const page = (node as HTMLElement | null)?.closest('.te-page') as HTMLDivElement | null;
    if (page) savedFormatSelectionRef.current = { page, range: sel.getRangeAt(0).cloneRange() };
  }

  function restoreFormatSelection(): boolean {
    const saved = savedFormatSelectionRef.current;
    if (!saved) return false;
    saved.page.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(saved.range);
    return true;
  }

  /** Inserts `content` directly at the last real page position via the `Range` API, rather than
   *  restoring focus/selection and going through `execCommand` — deliberately, after finding that
   *  SweetAlert2's own popup keeps its accessibility focus-trap attached for as long as its own
   *  closing animation runs (empirically well over a second in this environment, not the ~200ms
   *  one might assume), well after its `swal()` promise already resolved. `Range.insertNode()`
   *  doesn't require the document or any element to have focus at all, sidestepping that whole
   *  timing question. `caretAnchor` (a node inside — or equal to — `content`) is what the caret
   *  gets placed after once inserted, as a best-effort UX nicety only.
   *
   *  Critically, this also syncs React's `pages` state to match the live DOM immediately —
   *  *before* returning control to a caller that's about to trigger further state updates
   *  (`scheduleAutosave`'s own `setSaveStatus`, in particular). A menu-triggered insertion runs
   *  outside a React synthetic event (it's continuing after an awaited `swal()` promise), and any
   *  state update in that continuation was found to force an immediate, synchronous re-render —
   *  which re-applies `dangerouslySetInnerHTML` for *every* page from `pages[i]`. That's normally
   *  harmless (typing never syncs state on every keystroke either), but only because the value
   *  being re-applied is *stale-but-still-correct* until the next autosave flush. Here, without
   *  this sync, the value would be stale-and-wrong (still the pre-insertion string), silently
   *  wiping the table/image that was just inserted the moment any later state update forces that
   *  first re-render. */
  function insertNodeAtLastPageSelection(content: Node, caretAnchor: Node): boolean {
    const saved = lastPageSelectionRef.current;
    if (!saved) return false;
    saved.range.deleteContents();
    saved.range.insertNode(content);
    saved.page.focus();
    const after = document.createRange();
    after.setStartAfter(caretAnchor);
    after.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
    commitActiveDocPages(captureActiveDocPages());
    return true;
  }

  /** Ctrl+Enter: a real hard page break, distinct from natural reflow overflow — everything after
   *  the marker moves to a fresh page regardless of how full the current one is (see reflow()). */
  function insertHardBreak(pageIndex: number) {
    const page = pageRefs.current[pageIndex];
    const sel = window.getSelection();
    if (!page || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();

    const marker = document.createElement('div');
    marker.dataset.hardBreak = 'true';
    marker.dataset.breakId = `hb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Zero visible height on screen; `break-before: page` only does anything under print media,
    // so the same markup drives both the live reflow split and the printed-PDF page break.
    marker.style.cssText = 'height:0;overflow:hidden;break-before:page;';
    const freshPara = document.createElement('div');
    freshPara.appendChild(document.createElement('br'));

    const frag = document.createDocumentFragment();
    frag.appendChild(marker);
    frag.appendChild(freshPara);
    range.insertNode(frag);

    const caretRange = document.createRange();
    // setStartBefore, not setStart(freshPara, 0) — see the matching comment on the
    // pendingHardBreakIdRef effect below, which re-derives this same position after reflow.
    caretRange.setStartBefore(freshPara);
    caretRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caretRange);
    // If reflow ends up growing the page list, the pages.length effect re-finds this exact break
    // (by id, not object reference — see pendingHardBreakIdRef's own comment) and re-focuses
    // whichever page it actually lands on.
    pendingHardBreakIdRef.current = marker.dataset.breakId ?? null;

    handleInput();
  }

  /** Backspace with the caret collapsed at the very start of a page merges that page's content
   *  onto the end of the previous one and removes it outright — an explicit, discrete action, so
   *  (unlike live typing) bumping renderKey here is safe; the caret lands once the remount gives
   *  the previous page's content a fresh DOM node (see the renderKey effect below). */
  function mergeIntoPreviousPage(pageIndex: number) {
    const page = pageRefs.current[pageIndex];
    const prev = pageRefs.current[pageIndex - 1];
    if (!page || !prev || pageIndex === 0) return;

    // A page that starts right after a hard break carries that break's own marker as its first
    // child. Merging back must remove it, not carry it along — reflow()'s hardBreakCount-forced
    // page-count floor would otherwise see the same marker on the very next pass and immediately
    // recreate the page this merge just removed, undoing the Backspace the user just pressed.
    if (page.firstChild instanceof HTMLElement && page.firstChild.dataset.hardBreak === 'true') {
      page.firstChild.remove();
    }

    while (page.firstChild) prev.appendChild(page.firstChild);

    const pages = captureActiveDocPages();
    pages.splice(pageIndex, 1);
    commitActiveDocPages(pages);
    setRenderKey(k => k + 1);
    pendingCaretRef.current = { pageIndex: pageIndex - 1, edge: 'end' };
    scheduleAutosave();
  }

  useEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    pendingCaretRef.current = null;
    moveCaretToPageEdge(pending.pageIndex, pending.edge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  // --- Tables: plain <table> HTML manipulated directly, matching this editor's existing
  // execCommand-first / direct-DOM-fallback philosophy. No virtual table data model. ---
  //
  // Row/column insert/delete goes through the imported findEnclosingCell/addRow/addColumn/
  // deleteRow/deleteColumn/navigateCell (textEditorTables.ts) — the same functions TableToolbar's
  // own buttons already call — rather than a second, parallel local implementation. Merge/split
  // have no library equivalent, so they stay local below.

  function makeTableCell(): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = 'te-table-cell';
    // A completely empty <td> can't reliably show/hold a caret in every browser — an empty-cell
    // convention, not visible content.
    td.appendChild(document.createElement('br'));
    return td;
  }

  /** Merge is scoped to "this cell + its right neighbor" and Split to undoing a colSpan — a
   *  bounded simplification of arbitrary rectangular-selection merge/split, which would need real
   *  multi-cell selection tracking this editor doesn't have. */
  function mergeTableCellRight(cell: HTMLTableCellElement) {
    const next = cell.nextElementSibling as HTMLTableCellElement | null;
    if (!next) return;
    cell.innerHTML = `${cell.innerHTML} ${next.innerHTML}`;
    cell.colSpan = (cell.colSpan || 1) + (next.colSpan || 1);
    next.remove();
    handleInput();
  }

  function splitTableCell(cell: HTMLTableCellElement) {
    const extraCols = (cell.colSpan || 1) - 1;
    if (extraCols <= 0) return;
    cell.colSpan = 1;
    for (let i = 0; i < extraCols; i++) cell.parentElement?.insertBefore(makeTableCell(), cell.nextSibling);
    handleInput();
  }

  /** Insert > Table: a simple two-number-input picker (rows/columns), matching this app's existing
   *  low-chrome swal-input precedent — a visual hover-grid picker would be a nicer follow-up but
   *  isn't required for a working Insert Table. Captures the current selection before the dialog
   *  steals focus, and restores it afterward so the table lands where the user actually was. */
  async function insertTable() {
    const result = await swal({
      title: 'Insert Table',
      html: `<div style="display:flex;flex-direction:column;gap:8px;text-align:left">
        <label style="display:flex;justify-content:space-between;gap:8px">Rows <input id="te-table-rows" type="number" min="1" max="20" value="3" style="width:64px"></label>
        <label style="display:flex;justify-content:space-between;gap:8px">Columns <input id="te-table-cols" type="number" min="1" max="10" value="3" style="width:64px"></label>
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Insert',
      preConfirm: () => {
        const rowsEl = document.getElementById('te-table-rows') as HTMLInputElement | null;
        const colsEl = document.getElementById('te-table-cols') as HTMLInputElement | null;
        return {
          rows: Math.max(1, Math.min(20, Number(rowsEl?.value) || 3)),
          cols: Math.max(1, Math.min(10, Number(colsEl?.value) || 3)),
        };
      },
    });
    if (!result.isConfirmed || !result.value) return;
    const { rows, cols } = result.value as { rows: number; cols: number };

    const table = document.createElement('table');
    table.className = 'te-table';
    const tbody = document.createElement('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c++) tr.appendChild(makeTableCell());
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const trailingPara = document.createElement('div');
    trailingPara.appendChild(document.createElement('br'));
    const frag = document.createDocumentFragment();
    frag.appendChild(table);
    frag.appendChild(trailingPara);

    if (!insertNodeAtLastPageSelection(frag, trailingPara)) return;
    handleInput();
  }

  const [tableMenu, setTableMenu] = useState<{ cell: HTMLTableCellElement; x: number; y: number } | null>(null);

  function addDoc() {
    const based = getDocsWithLiveContent();
    docCounterRef.current += 1;
    const doc = newDoc(`Document ${docCounterRef.current}`);
    const next = [...based, doc];
    pageSeedRef.current = doc.pages;
    updateDocs(next);
    setActiveDocId(doc.id);
    setRenderKey(k => k + 1);
    saveTextEditorDocs(next).catch(console.error);
  }

  /** Flush-then-close: the autosave debounce is only 1000ms, so there's a near-zero real
   *  data-loss window — a confirmation dialog on every single tab close would be more annoying
   *  than Word's own "once per session" unsaved-changes prompt, so this flushes the outgoing
   *  doc's live content first and only surfaces anything if that flush itself fails. */
  function closeDoc(id: string) {
    const based = getDocsWithLiveContent();
    if (based.length <= 1) return;
    const next = based.filter(d => d.id !== id);
    updateDocs(next);
    if (activeDocId === id) {
      pageSeedRef.current = next[0].pages;
      setActiveDocId(next[0].id);
    }
    setRenderKey(k => k + 1);
    saveTextEditorDocs(next).catch(() => {
      swalToast({ icon: 'error', title: 'Could not save before closing — recent changes may be lost' });
    });
  }

  function closeOtherDocs(id: string) {
    const kept = docs.find(d => d.id === id);
    if (!kept) return;
    const sourceKept = id === activeDocId ? { ...kept, pages: captureActiveDocPages() } : kept;
    pageSeedRef.current = sourceKept.pages;
    setDocs([sourceKept]);
    setActiveDocId(id);
    setRenderKey(k => k + 1);
    saveTextEditorDocs([sourceKept]).catch(console.error);
  }

  function closeAllDocs() {
    const fresh = [newDoc()];
    pageSeedRef.current = fresh[0].pages;
    setDocs(fresh);
    setActiveDocId(fresh[0].id);
    setRenderKey(k => k + 1);
    saveTextEditorDocs(fresh).catch(console.error);
  }

  async function renameDocPrompt(id: string) {
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    const result = await swal({ title: 'Rename document', input: 'text', inputValue: doc.title, showCancelButton: true, confirmButtonText: 'Rename' });
    const title = (result.value as string | undefined)?.trim();
    if (!result.isConfirmed || !title) return;
    renameDoc(id, title);
  }

  function renameDoc(id: string, title: string) {
    const next = docsRef.current.map(d => d.id === id ? { ...d, title, updatedAt: Date.now() } : d);
    updateDocs(next);
    saveTextEditorDocs(next).catch(console.error);
  }

  function duplicateDoc(id: string) {
    const based = getDocsWithLiveContent();
    const source = based.find(d => d.id === id);
    if (!source) return;
    const copy: TextEditorDoc = { ...structuredClone(source), id: genId('tedoc'), title: `${source.title} copy`, updatedAt: Date.now() };
    const next = [...based, copy];
    updateDocs(next);
    saveTextEditorDocs(next).catch(console.error);
  }

  function toggleDocStatus(id: string, key: keyof TextEditorDocStatus) {
    const next = docsRef.current.map(d => d.id === id ? { ...d, status: { ...d.status, [key]: !d.status[key] } } : d);
    updateDocs(next);
    saveTextEditorDocs(next).catch(console.error);
  }

  function switchDoc(id: string) {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (dirtyRef.current) {
      updateDocs(getDocsWithLiveContent());
      dirtyRef.current = false;
    }
    const target = docs.find(d => d.id === id);
    pageSeedRef.current = target?.pages ?? [''];
    setActiveDocId(id);
    setRenderKey(k => k + 1);
    // Every one of these references a DOM node or Range that belongs to the outgoing document's
    // pages, which are about to unmount (renderKey bump above). Left set, they'd point at
    // detached nodes — a stray/broken selection or resize overlay bleeding onto whichever
    // document is switched to next.
    setSelectedImage(null);
    setImageContextMenuPos(null);
    setActiveTable(null);
    setTableFullySelected(false);
    setTableMenu(null);
    setMarkMenuPos(null);
  }

  const [dragTabId, setDragTabId] = useState<string | null>(null);

  function handleTabDrop(targetId: string) {
    const sourceId = dragTabId;
    setDragTabId(null);
    if (!sourceId || sourceId === targetId) return;
    const from = docs.findIndex(d => d.id === sourceId);
    const to = docs.findIndex(d => d.id === targetId);
    if (from === -1 || to === -1) return;
    const reordered = [...docs];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setDocs(reordered);
    saveTextEditorDocs(reordered).catch(console.error);
  }

  const [tabMenu, setTabMenu] = useState<{ docId: string; x: number; y: number } | null>(null);

  /** Native browser spellcheck only — toggles the `spellcheck` DOM property directly on every
   *  page's contentEditable, imperatively, rather than passing it down as an EditablePage prop.
   *  EditablePage must never re-render past its initial mount (see its own comment) — a prop here
   *  would trigger exactly that. The browser underlines misspelled words and offers its own
   *  right-click suggestions; nothing here ever touches page content, so there's nothing that can
   *  lose or corrupt text the way the old dictionary-based implementation could (it rewrote every
   *  page's innerHTML and forced a full remount just to apply/clear marks). */
  const [spellCheckActive, setSpellCheckActive] = useState(true);
  function toggleSpellCheck() {
    setSpellCheckActive(v => !v);
  }
  useEffect(() => {
    pageRefs.current.forEach((p) => { if (p) p.spellcheck = spellCheckActive; });
  });

  function runPageClickLogic(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      setSelectedImage(target as HTMLImageElement);
      setActiveTable(null);
      setTableFullySelected(false);
      return;
    }
    if (selectedImage) setSelectedImage(null);
    const table = findEnclosingTable(target);
    if (table) {
      setActiveTable(table);
      activeTableCellRef.current = findEnclosingCell(target);
      setTableFullySelected(false);
    } else if (activeTable) {
      setActiveTable(null);
      setTableFullySelected(false);
    }
  }
  runPageClickLogicRef.current = runPageClickLogic;

  function deleteSelectedImage() {
    if (!selectedImage) return;
    const parent = selectedImage.parentNode;
    const nextSibling = selectedImage.nextSibling;
    selectedImage.remove();
    setSelectedImage(null);
    if (parent) restoreCaretAt({ parent, nextSibling });
    scheduleAutosave();
    reflow();
  }

  function runKeyDownLogic(e: React.KeyboardEvent) {
    if (selectedImage) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedImage();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedImage(null);
        return;
      }
    }
    if (activeTable) {
      if (e.key === 'Tab') {
        const cell = findEnclosingCell(window.getSelection()?.anchorNode ?? null);
        if (cell) {
          e.preventDefault();
          navigateCell(activeTable, cell, e.shiftKey ? 'prev' : 'next');
          scheduleAutosave();
          reflow();
          return;
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && tableFullySelected) {
        e.preventDefault();
        const restore = deleteTable(activeTable);
        setActiveTable(null);
        setTableFullySelected(false);
        if (restore) restoreCaretAt(restore);
        scheduleAutosave();
        reflow();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const cell = findEnclosingCell(window.getSelection()?.anchorNode ?? null);
        if (cell) {
          e.preventDefault();
          setTableFullySelected(true);
          return;
        }
      }
    }

    // Page-level navigation (formerly a separate handlePageKeyDown taking an explicit page
    // index) — derives which page the event landed on from the live DOM instead, since
    // EditablePage's onKeyDown prop must stay a single stable callback for its memo to hold
    // (see the audit comment above EditablePage).
    const pageIndex = pageRefs.current.indexOf(e.currentTarget as HTMLDivElement);
    if (pageIndex === -1) return;

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      insertHardBreak(pageIndex);
      return;
    }

    const page = pageRefs.current[pageIndex];
    if (!page) return;

    if (e.key === 'Backspace' && pageIndex > 0) {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && isCaretAtPageStart(page)) {
        e.preventDefault();
        mergeIntoPreviousPage(pageIndex);
        return;
      }
    }

    const isVertical = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    const isHorizontal = e.key === 'ArrowRight' || e.key === 'ArrowLeft';
    if (!isVertical && !isHorizontal) return;

    const goingForward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const neighborIndex = goingForward ? pageIndex + 1 : pageIndex - 1;
    if (!pageRefs.current[neighborIndex]) return;

    if (isHorizontal) {
      const atEdge = goingForward ? isCaretAtPageEnd(page) : isCaretAtPageStart(page);
      if (atEdge) {
        e.preventDefault();
        moveCaretToPageEdge(neighborIndex, goingForward ? 'start' : 'end');
      }
      return;
    }

    // Vertical nav: let the browser's normal line-based movement run first (don't preventDefault),
    // then check next frame whether the caret actually moved — if it's exactly where it started,
    // the browser had nowhere further to go (already the first/last visual line on this page).
    const before = getCaretPosition();
    requestAnimationFrame(() => {
      const after = getCaretPosition();
      if (before && after && before.node === after.node && before.offset === after.offset) {
        moveCaretToPageEdge(neighborIndex, goingForward ? 'start' : 'end');
      }
    });
  }
  runKeyDownLogicRef.current = runKeyDownLogic;

  function runContextMenuLogic(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      e.preventDefault();
      setSelectedImage(target as HTMLImageElement);
      setImageContextMenuPos({ x: e.clientX, y: e.clientY });
      return;
    }
    const table = findEnclosingTable(target);
    if (table) {
      e.preventDefault();
      setActiveTable(table);
      const cell = findEnclosingCell(target);
      activeTableCellRef.current = cell;
      // Insert/delete row/column/table are already reachable via TableToolbar (which appears
      // whenever activeTable is set, right above) — this popover only needs to cover what
      // TableToolbar can't: merge/split, which need a specific target cell.
      if (cell) setTableMenu({ cell, x: e.clientX, y: e.clientY });
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const root = pageRefs.current.find((el): el is HTMLDivElement => !!el && el.contains(range.commonAncestorContainer));
      if (root) {
        e.preventDefault();
        markSelectionRef.current = { root, range: range.cloneRange() };
        setMarkMenuPos({ x: e.clientX, y: e.clientY });
      }
    }
  }
  runContextMenuLogicRef.current = runContextMenuLogic;

  function applyMark(status: MarkStatus) {
    const saved = markSelectionRef.current;
    setMarkMenuPos(null);
    if (!saved) return;
    const count = markSelectionAs(saved.root, saved.range, status);
    if (count > 0) scheduleAutosave();
  }

  function alignSelectedImage(align: 'left' | 'center' | 'right') {
    if (!selectedImage) return;
    if (align === 'left') {
      // "Left" is the default, plain-inline state — flows inline with surrounding text like any
      // other inline element (the same state a freshly-inserted image already starts in), not a
      // float. Floating left would instead wrap text around the image's right edge.
      selectedImage.style.cssFloat = 'none';
      selectedImage.style.display = 'inline';
      selectedImage.style.margin = '';
    } else if (align === 'right') {
      selectedImage.style.cssFloat = 'right';
      selectedImage.style.display = 'inline-block';
      selectedImage.style.margin = '0 0 8px 8px';
    } else {
      selectedImage.style.cssFloat = 'none';
      selectedImage.style.display = 'block';
      selectedImage.style.margin = '0 auto';
    }
    scheduleAutosave();
    reflow();
  }

  async function copySelectedImage() {
    if (!selectedImage) return;
    try {
      const response = await fetch(selectedImage.src);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      swalToast({ icon: 'success', title: 'Image copied' });
    } catch (err) {
      swalToast({ icon: 'error', title: err instanceof Error ? err.message : 'Could not copy image' });
    }
  }

  function tableRowActionTarget(): { row: HTMLTableRowElement } | null {
    if (!activeTable) return null;
    const cell = activeTableCellRef.current;
    const row = (cell?.parentElement as HTMLTableRowElement | null) ?? activeTable.querySelector('tr');
    return row ? { row } : null;
  }

  function tableColIndex(): number {
    const cell = activeTableCellRef.current;
    if (!cell?.parentElement) return 0;
    return Array.from(cell.parentElement.children).indexOf(cell);
  }

  function applyTableRestore(restore: CaretRestorePoint | null) {
    if (restore) {
      setActiveTable(null);
      setTableFullySelected(false);
      restoreCaretAt(restore);
    }
    scheduleAutosave();
    reflow();
  }

  function handleAddRowAbove() {
    const target = tableRowActionTarget();
    if (!activeTable || !target) return;
    addRow(activeTable, target.row, 'above');
    scheduleAutosave();
    reflow();
  }

  function handleAddRowBelow() {
    const target = tableRowActionTarget();
    if (!activeTable || !target) return;
    addRow(activeTable, target.row, 'below');
    scheduleAutosave();
    reflow();
  }

  function handleAddColLeft() {
    if (!activeTable) return;
    addColumn(activeTable, tableColIndex(), 'left');
    scheduleAutosave();
    reflow();
  }

  function handleAddColRight() {
    if (!activeTable) return;
    addColumn(activeTable, tableColIndex(), 'right');
    scheduleAutosave();
    reflow();
  }

  function handleDeleteRowAction() {
    const target = tableRowActionTarget();
    if (!target) return;
    applyTableRestore(deleteRow(target.row));
  }

  function handleDeleteColAction() {
    if (!activeTable) return;
    applyTableRestore(deleteColumn(activeTable, tableColIndex()));
  }

  function handleDeleteTableAction() {
    if (!activeTable) return;
    applyTableRestore(deleteTable(activeTable));
  }

  async function handleInsertTable() {
    // By the time this handler runs, document.activeElement is already the
    // toolbar button that was clicked (not the contentEditable) — the caret's
    // Range is still valid though, so use it (rather than activeElement) to
    // find which page to restore focus/selection into after the swal dialog
    // (which steals focus) closes.
    const sel = window.getSelection();
    const savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    const targetPageEl = savedRange
      ? pageRefs.current.find((el): el is HTMLDivElement => !!el && el.contains(savedRange.commonAncestorContainer))
      : null;

    const result = await swal({
      title: 'Insert Table',
      html: `<div style="display:flex;gap:8px;justify-content:center;">
        <input id="te-table-rows" type="number" min="1" max="20" value="3" placeholder="Rows" style="width:80px;padding:6px;border:1px solid #ccc;border-radius:6px;" />
        <input id="te-table-cols" type="number" min="1" max="20" value="3" placeholder="Cols" style="width:80px;padding:6px;border:1px solid #ccc;border-radius:6px;" />
      </div>`,
      showCancelButton: true,
      confirmButtonText: 'Insert',
      preConfirm: () => {
        const rowsEl = document.getElementById('te-table-rows') as HTMLInputElement | null;
        const colsEl = document.getElementById('te-table-cols') as HTMLInputElement | null;
        const rows = Math.max(1, Math.min(20, parseInt(rowsEl?.value ?? '3', 10) || 3));
        const cols = Math.max(1, Math.min(20, parseInt(colsEl?.value ?? '3', 10) || 3));
        return { rows, cols };
      },
    });
    if (!result.isConfirmed || !result.value) return;
    const { rows, cols } = result.value as { rows: number; cols: number };

    // SweetAlert2's own dialog teardown (and any focus trap it holds) can still
    // be in progress for a tick after the confirm promise resolves — refocusing
    // the page immediately risks losing to it. Give it a beat to finish first.
    await new Promise(resolve => setTimeout(resolve, 50));

    const focusTarget = targetPageEl ?? pageRefs.current.find((el): el is HTMLDivElement => !!el);
    if (focusTarget) {
      focusTarget.focus();
      const restoredSel = window.getSelection();
      restoredSel?.removeAllRanges();
      if (savedRange) {
        restoredSel?.addRange(savedRange);
      } else {
        const endRange = document.createRange();
        endRange.selectNodeContents(focusTarget);
        endRange.collapse(false);
        restoredSel?.addRange(endRange);
      }
    }
    document.execCommand('insertHTML', false, insertTableHtml(rows, cols));
    scheduleAutosave();
    reflow();
  }

  /** Insert > Image: reads the chosen file as a data URL (embedding it directly in the page's own
   *  HTML, which is what's already persisted/exported everywhere else) and inserts it at the
   *  user's last real position in the page — same restoreLastPageSelection() insertTable() needs,
   *  since reaching this via the Insert menu means focus has already moved to a menu button by
   *  the time this runs. */
  const imageInputRef = useRef<HTMLInputElement>(null);

  function insertImage() {
    imageInputRef.current?.click();
  }

  async function handleImageFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // FileList is live — file is already snapshotted above before clearing.
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const img = document.createElement('img');
    img.src = dataUrl;
    img.className = 'te-image';
    img.style.maxWidth = '100%';
    if (!insertNodeAtLastPageSelection(img, img)) return;
    handleInput();
  }

  /** Insert > File Attachment: any file type, embedded as a data URL the same way Insert > Image
   *  already is right above — no separate storage layer needed, since a page's content is already
   *  just persisted HTML. Rendered as a `contenteditable="false"` "chip" (the same atomic
   *  non-editable-inline-widget technique the resize handle overlay and page-number footer already
   *  rely on elsewhere in this file) so it reads as one object to type around rather than editable
   *  text. It's a real `<a href="data:...">` with a native `download` attribute, so clicking it
   *  downloads the file with zero extra JS — no click handler needed here at all. */
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  function insertFileAttachment() {
    attachmentInputRef.current?.click();
  }

  async function handleAttachmentFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // FileList is live — file is already snapshotted above before clearing.
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const chip = document.createElement('a');
    chip.href = dataUrl;
    chip.download = file.name;
    chip.contentEditable = 'false';
    chip.className = 'te-file-chip';
    chip.textContent = `📎 ${file.name} (${formatFileSize(file.size)})`;
    if (!insertNodeAtLastPageSelection(chip, chip)) return;
    handleInput();
  }

  function alignImage(img: HTMLImageElement, align: 'left' | 'center' | 'right') {
    if (align === 'center') {
      img.style.float = 'none';
      img.style.display = 'block';
      img.style.marginLeft = 'auto';
      img.style.marginRight = 'auto';
    } else {
      img.style.display = '';
      img.style.marginLeft = '';
      img.style.marginRight = '';
      img.style.float = align;
    }
    handleInput();
  }

  // Live, 800ms-debounced word/char count — reads the live page DOM directly (no
  // captureActiveDocPages/commitActiveDocPages/renderKey bump) so it never disrupts the caret
  // mid-keystroke. Spell checking itself is the browser's own native `spellCheck` attribute (see
  // EditablePage/toggleSpellCheck) — this pass no longer does any of its own DOM marking.
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [charCountNoSpaces, setCharCountNoSpaces] = useState(0);
  const spellTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleContentAnalysis() {
    if (spellTimeoutRef.current) clearTimeout(spellTimeoutRef.current);
    spellTimeoutRef.current = setTimeout(() => {
      let text = '';
      pageRefs.current.forEach((page) => {
        if (!page) return;
        text += `${page.innerText}\n`;
      });
      const words = text.trim().split(/\s+/).filter(Boolean);
      setWordCount(words.length);
      setCharCount(text.length);
      setCharCountNoSpaces(text.replace(/\s/g, '').length);
    }, 800);
  }

  // Recompute word/char counts right after switching documents or an explicit structural
  // remount, not just after the next keystroke — otherwise the status bar would show stale
  // (or zeroed) counts for a doc that was never actually empty.
  useEffect(() => {
    scheduleContentAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId, renderKey]);

  // Tracks which page currently has focus for the status bar's "Page N of M" — a plain
  // document-level `focusin` listener rather than per-page onFocus handlers, since it needs to
  // recognize *any* page gaining focus, including ones added/removed by reflow.
  const [activePageIndex, setActivePageIndex] = useState(0);
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const target = e.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('te-page')) return;
      const idx = pageRefs.current.indexOf(target as HTMLDivElement);
      if (idx !== -1) setActivePageIndex(idx);
    }
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // The suggestion/"Ignore" action in the global right-click menu (ContextMenu.tsx) can't reach
  // into this component directly — it dispatches this custom event on the fixed span instead.
  useEffect(() => {
    function onSpellFix() { scheduleAutosave(); }
    document.addEventListener('te-spell-fix', onSpellFix);
    return () => document.removeEventListener('te-spell-fix', onSpellFix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildFindRegex(): RegExp | null {
    const q = query.trim();
    if (!q) return null;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
    try {
      return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  }

  /** Strips the live `.te-find-hit` highlight spans back to plain text on every page — must run
   *  before closing the panel, changing the query, or any autosave/export/send capture, exactly
   *  the same discipline `stripSpellMarks` already requires for spell-check marks (see the string
   *  variant below, used at export/send call sites instead of this live-DOM one). */
  function stripFindHighlightsLive() {
    pageRefs.current.forEach((page) => {
      if (!page) return;
      page.querySelectorAll('.te-find-hit').forEach((el) => {
        el.replaceWith(document.createTextNode(el.textContent ?? ''));
      });
    });
  }

  function stripFindHighlights(html: string): string {
    const container = document.createElement('div');
    container.innerHTML = html;
    container.querySelectorAll('.te-find-hit').forEach((el) => {
      el.replaceWith(document.createTextNode(el.textContent ?? ''));
    });
    return container.innerHTML;
  }

  function highlightMatch(index: number) {
    pageRefs.current.forEach((page) => {
      if (!page) return;
      page.querySelectorAll('.te-find-hit').forEach((el) => {
        el.classList.toggle('te-find-hit-active', el.getAttribute('data-match-index') === String(index));
      });
    });
    document.querySelector(`.te-find-hit[data-match-index="${index}"]`)?.scrollIntoView({ block: 'center' });
  }

  /** Re-scans every page's live text for the current query, wrapping each hit in a
   *  `.te-find-hit` span — a live-DOM annotation like spell-check's, not a state/renderKey
   *  rewrite, since the user may still be adjusting the search while pages keep their own focus. */
  function scanFindMatches() {
    stripFindHighlightsLive();
    const regex = buildFindRegex();
    if (!regex) { setMatchCount(0); return; }

    let globalIndex = 0;
    pageRefs.current.forEach((page) => {
      if (!page) return;
      const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) nodes.push(n as Text);

      for (const node of nodes) {
        const text = node.textContent ?? '';
        regex.lastIndex = 0;
        const matches: { start: number; end: number }[] = [];
        let m: RegExpExecArray | null;
        while ((m = regex.exec(text))) {
          if (m[0].length === 0) { regex.lastIndex += 1; continue; }
          matches.push({ start: m.index, end: m.index + m[0].length });
        }
        if (matches.length === 0) continue;

        const frag = document.createDocumentFragment();
        let cursor = 0;
        for (const match of matches) {
          if (match.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, match.start)));
          const span = document.createElement('span');
          span.className = 'te-find-hit';
          span.dataset.matchIndex = String(globalIndex);
          span.textContent = text.slice(match.start, match.end);
          frag.appendChild(span);
          globalIndex += 1;
          cursor = match.end;
        }
        if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
        node.parentNode?.replaceChild(frag, node);
      }
    });

    setMatchCount(globalIndex);
    setCurrentMatchIndex(0);
    if (globalIndex > 0) highlightMatch(0);
  }

  function goToMatch(delta: number) {
    if (matchCount === 0) return;
    const next = (currentMatchIndex + delta + matchCount) % matchCount;
    setCurrentMatchIndex(next);
    highlightMatch(next);
  }

  /** Replaces only the current match in place (a single span node swap — no remount) and rescans,
   *  since the remaining matches' indices shift by one. */
  function replaceCurrentMatch() {
    if (matchCount === 0) return;
    const span = document.querySelector(`.te-find-hit[data-match-index="${currentMatchIndex}"]`);
    if (span) {
      span.replaceWith(document.createTextNode(replacement));
      scheduleAutosave();
    }
    scanFindMatches();
  }

  /** Replace All is a discrete, explicit bulk action — unlike live highlighting, a full remount
   *  here is fine (same category as inserting a table or a hard page break). */
  function replaceInDoc() {
    if (!query.trim() || !activeDoc) return;
    const regex = buildFindRegex();
    if (!regex) return;
    const pages = captureActiveDocPages().map((html) => {
      const container = document.createElement('div');
      container.innerHTML = stripFindHighlights(html);
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) nodes.push(n as Text);
      for (const node of nodes) {
        regex.lastIndex = 0;
        if (node.textContent && regex.test(node.textContent)) {
          node.textContent = node.textContent.replace(regex, replacement);
        }
      }
      return container.innerHTML;
    });
    commitActiveDocPages(pages);
    setRenderKey(k => k + 1);
    setMatchCount(0);
    scheduleAutosave();
  }

  function closeFindPanel() {
    stripFindHighlightsLive();
    setSearchOpen(false);
    setMatchCount(0);
  }

  function openFindPanel(mode: 'find' | 'replace') {
    setFindMode(mode);
    setSearchOpen(true);
  }

  // Live-rescans on query/case/whole-word change while the panel is open, debounced lightly —
  // matches spell-check's "annotate the live DOM, don't touch React state" convention, just on a
  // much shorter delay since there's no shared caret risk (focus is in the find input, not a page).
  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(scanFindMatches, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, query, caseSensitive, wholeWord]);

  /** `captureActiveDocPages()`, but also stripping the live `.te-find-hit` highlight spans — the
   *  single choke point every export/send path should read through instead of the raw capture,
   *  so a search left open when exporting never leaks highlight markup into the output. */
  function capturePagesForExport(): string[] {
    return captureActiveDocPages().map(stripFindHighlights);
  }

  function previewVersion(v: TextEditorVersionSnapshot) {
    swal({
      title: `Preview — ${new Date(v.timestamp).toLocaleString()}`,
      html: `<div dir="${v.dir}" style="max-height:400px;overflow-y:auto;text-align:left;background:#fff;color:#000;padding:8px;border-radius:8px">${
        v.pages.map(p => `<div style="border-bottom:1px dashed #ccc;margin-bottom:8px;padding-bottom:8px">${p}</div>`).join('')
      }</div>`,
      confirmButtonText: 'Close',
    });
  }

  async function restoreVersionAndClose(v: TextEditorVersionSnapshot) {
    if (!activeDoc) return;
    const restored = await restoreTextEditorVersion(activeDoc.id, v.id);
    if (!restored) return;
    pageSeedRef.current = restored.pages;
    setDocs(prev => prev.map(d => d.id === activeDoc.id ? { ...d, title: restored.title, dir: restored.dir, pages: restored.pages } : d));
    setRenderKey(k => k + 1);
    scheduleAutosave();
    Swal.close();
    swalToast({ icon: 'success', title: 'Version restored' });
  }

  /** File > Version History: lists the capped auto-save snapshots (newest first) with Preview
   *  (read-only, in a nested dialog) and Restore. Restoring goes through the existing renderKey
   *  structural-remount path — a real, explicit, discrete user action, so that's safe here even
   *  though the same remount would destroy an in-progress typing caret if it happened live. */
  async function openVersionHistory() {
    if (!activeDoc) return;
    const versions = await listTextEditorVersions(activeDoc.id);
    if (versions.length === 0) {
      swalToast({ icon: 'info', title: 'No saved versions yet' });
      return;
    }
    const newestFirst = [...versions].reverse();
    const rowsHtml = newestFirst.map((v, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.2)">
        <span style="font-size:12px">${new Date(v.timestamp).toLocaleString()}${v.label ? ` — ${v.label}` : ''}</span>
        <span>
          <button type="button" data-preview="${i}" style="margin-right:6px;font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid currentColor;background:transparent;cursor:pointer">Preview</button>
          <button type="button" data-restore="${i}" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid currentColor;background:transparent;cursor:pointer">Restore</button>
        </span>
      </div>`).join('');

    await swal({
      title: 'Version History',
      html: `<div style="max-height:320px;overflow-y:auto;text-align:left">${rowsHtml}</div>`,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: 'Close',
      didOpen: (popup: HTMLElement) => {
        popup.querySelectorAll<HTMLButtonElement>('[data-preview]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const v = newestFirst[Number(btn.dataset.preview)];
            if (v) previewVersion(v);
          });
        });
        popup.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const v = newestFirst[Number(btn.dataset.restore)];
            if (v) void restoreVersionAndClose(v);
          });
        });
      },
    });
  }

  async function handleExportDocx() {
    if (!activeDoc) return;
    const pages = capturePagesForExport();
    const doc = { ...activeDoc, pages };
    try {
      const blob = await exportDocAsDocx(doc);
      downloadBlob(blob, `${doc.title || 'Untitled'}.docx`);
    } catch (err) {
      swal({ icon: 'error', title: 'Export Failed', text: err instanceof Error ? err.message : 'Could not export DOCX.' });
    }
  }

  /** Flattened `workspace → manga → volume → chapter` list for the Send-to-TypeR
   *  dialog's chapter picker — that's the only place a chapter needs a globally-unique,
   *  human-readable label; nowhere else in this file needs to look outside the current doc. */
  const chapterOptions = useMemo<SendToTyperChapterOption[]>(() => {
    const options: SendToTyperChapterOption[] = [];
    for (const ws of workspaces) {
      for (const manga of ws.mangas) {
        for (const vol of manga.volumes) {
          for (const ch of vol.chapters) {
            options.push({ id: ch.id, label: `${manga.title} / ${vol.name} / ${ch.name}` });
          }
        }
      }
    }
    return options;
  }, [workspaces]);

  function handleSendToTyper() {
    if (chapterOptions.length === 0) {
      swalToast({ icon: 'info', title: 'Create a chapter in Library first' });
      return;
    }
    setSendToTyperOpen(true);
  }

  /** Dialog confirm handler: builds the text for exactly the pages the user chose (never the whole
   *  document unless "Entire Document" was actually picked) and hands the request off — nothing
   *  is sent until this runs. */
  function confirmSendToTyper(result: SendToTyperResult) {
    const pages = capturePagesForExport();
    const selectedPages = result.pageRange === 'all'
      ? pages
      : result.pageRange === 'current'
      ? pages.slice(activePageIndex, activePageIndex + 1)
      : pages.slice(result.pageRange.from - 1, result.pageRange.to);
    const text = selectedPages.map((html) => {
      const container = document.createElement('div');
      container.innerHTML = stripStatusMarks(stripSpellMarks(html));
      return container.innerText;
    }).join('\n');
    setSendToTyperOpen(false);
    onSendToTyper({ chapterId: result.chapterId, text, mode: result.mode });
    swalToast({ icon: 'success', title: 'Sent to TypeR — opening the Studio…' });
  }

  const toolbarButtons: ToolbarButtonDef[] = useMemo(() => [
    { icon: Undo2, label: 'Undo', run: () => exec('undo') },
    { icon: Redo2, label: 'Redo', run: () => exec('redo') },
    { icon: Bold, label: 'Bold', run: () => exec('bold'), command: 'bold' },
    { icon: Italic, label: 'Italic', run: () => exec('italic'), command: 'italic' },
    { icon: Underline, label: 'Underline', run: () => exec('underline'), command: 'underline' },
    { icon: Strikethrough, label: 'Strikethrough', run: () => exec('strikeThrough'), command: 'strikeThrough' },
    { icon: Heading1, label: 'Heading 1', run: () => toggleFormatBlock('H1'), blockTag: 'H1' },
    { icon: Heading2, label: 'Heading 2', run: () => toggleFormatBlock('H2'), blockTag: 'H2' },
    { icon: Heading3, label: 'Heading 3', run: () => toggleFormatBlock('H3'), blockTag: 'H3' },
    { icon: Heading4, label: 'Heading 4', run: () => toggleFormatBlock('H4'), blockTag: 'H4' },
    { icon: List, label: 'Bulleted list', run: () => exec('insertUnorderedList'), command: 'insertUnorderedList' },
    { icon: ListOrdered, label: 'Numbered list', run: () => exec('insertOrderedList'), command: 'insertOrderedList' },
    { icon: AlignLeft, label: 'Align left', run: () => exec('justifyLeft'), command: 'justifyLeft' },
    { icon: AlignCenter, label: 'Align center', run: () => exec('justifyCenter'), command: 'justifyCenter' },
    { icon: AlignRight, label: 'Align right', run: () => exec('justifyRight'), command: 'justifyRight' },
    { icon: TableIcon, label: 'Insert Table', run: () => void handleInsertTable() },
    { icon: AlignJustify, label: 'Justify', run: () => exec('justifyFull'), command: 'justifyFull' },
    { icon: IndentIncrease, label: 'Increase indent', run: () => exec('indent') },
    { icon: IndentDecrease, label: 'Decrease indent', run: () => exec('outdent') },
  ], []);

  const menuActions: TextEditorMenuActions = {
    newDoc: addDoc,
    closeDoc: () => activeDocId && closeDoc(activeDocId),
    saveNow: () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); scheduleAutosave(); },
    openVersionHistory: () => void openVersionHistory(),
    exportTxt: () => activeDoc && exportDocAsTxt({ ...activeDoc, pages: capturePagesForExport() }),
    exportDocx: handleExportDocx,
    printPdf: () => activeDoc && printDocAsPdf({ ...activeDoc, pages: capturePagesForExport() }),
    sendToTyper: handleSendToTyper,
    undo: () => exec('undo'),
    redo: () => exec('redo'),
    openFind: () => openFindPanel('find'),
    openFindReplace: () => openFindPanel('replace'),
    toggleSpellCheck,
    zoomIn: () => setZoom(z => Math.min(2, Math.round((z + 0.1) * 10) / 10)),
    zoomOut: () => setZoom(z => Math.max(0.5, Math.round((z - 0.1) * 10) / 10)),
    zoomReset: () => setZoom(1),
    toggleDir,
    isRtl: activeDoc?.dir === 'rtl',
    exec,
    applyLineSpacing,
    insertTable: () => void insertTable(),
    insertImage,
    insertFileAttachment,
    insertHardBreak: () => {
      const focusedIndex = pageRefs.current.findIndex(el => el === document.activeElement);
      insertHardBreak(focusedIndex >= 0 ? focusedIndex : 0);
    },
    showShortcuts,
  };

  useTextEditorShortcuts({
    onBold: () => exec('bold'),
    onItalic: () => exec('italic'),
    onUnderline: () => exec('underline'),
    onStrikethrough: () => exec('strikeThrough'),
    onSave: menuActions.saveNow,
    onNewDoc: addDoc,
    onFind: () => openFindPanel('find'),
    onFindReplace: () => openFindPanel('replace'),
    onUndo: () => exec('undo'),
    onRedo: () => exec('redo'),
    onAlignLeft: () => exec('justifyLeft'),
    onAlignCenter: () => exec('justifyCenter'),
    onAlignRight: () => exec('justifyRight'),
    onAlignJustify: () => exec('justifyFull'),
    onHeading1: () => exec('formatBlock', 'H1'),
    onHeading2: () => exec('formatBlock', 'H2'),
    onHeading3: () => exec('formatBlock', 'H3'),
    onHeading4: () => exec('formatBlock', 'H4'),
    onNormal: () => exec('formatBlock', 'P'),
    onSendToTyper: handleSendToTyper,
    onCloseFind: closeFindPanel,
  });

  if (!loaded) {
    return <div className="flex-1 flex items-center justify-center text-ink-faint text-sm">Loading…</div>;
  }

  const saveStatusDisplay: Record<typeof saveStatus, { icon: typeof Check; label: string; className: string }> = {
    saved: { icon: Check, label: 'Saved', className: 'text-ink-faint' },
    unsaved: { icon: Circle, label: 'Unsaved changes', className: 'text-warning' },
    saving: { icon: Loader2, label: 'Saving…', className: 'text-accent' },
    error: { icon: AlertCircle, label: 'Save failed', className: 'text-danger' },
  };
  const { icon: SaveStatusIcon, label: saveStatusLabel, className: saveStatusClassName } = saveStatusDisplay[saveStatus];

  return (
    <div className="flex h-full min-h-0">
      <DocumentLibrary
        docs={docs}
        activeDocId={activeDocId}
        onOpen={switchDoc}
        onNew={addDoc}
        onRename={renameDoc}
        onDuplicate={duplicateDoc}
        onDelete={closeDoc}
        onToggleStatus={toggleDocStatus}
      />
      <div ref={rootRef} className="flex flex-col flex-1 min-w-0 h-full min-h-0">
    <div className="flex flex-col h-full min-h-0">
      <TextEditorMenuBar actions={menuActions} />

      {/* Document tabs */}
      <div className="flex items-center gap-1 px-3 h-10 shrink-0 border-b border-hairline overflow-x-auto">
        {docs.map(d => (
          <button
            key={d.id}
            draggable
            onDragStart={() => setDragTabId(d.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleTabDrop(d.id); }}
            onDragEnd={() => setDragTabId(null)}
            onClick={() => switchDoc(d.id)}
            onContextMenu={(e) => { e.preventDefault(); setTabMenu({ docId: d.id, x: e.clientX, y: e.clientY }); }}
            className={`shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${
              d.id === activeDocId ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:bg-ink/5 hover:text-ink'
            } ${dragTabId === d.id ? 'opacity-40' : ''}`}
          >
            {d.title}
            {docs.length > 1 && (
              <span onClick={(e) => { e.stopPropagation(); closeDoc(d.id); }} className="hover:text-danger">
                <X size={11} />
              </span>
            )}
          </button>
        ))}
        <IconButton size="sm" aria-label="New document" onClick={addDoc} className="!bg-transparent shrink-0">
          <Plus size={14} />
        </IconButton>
        <div className="flex-1" />
        {activeDoc && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              aria-label="Toggle In Progress"
              title="In Progress"
              onClick={() => toggleDocStatus(activeDoc.id, 'inProgress')}
              className={`w-4 h-4 rounded-full flex items-center justify-center ${activeDoc.status.inProgress ? 'bg-[#0A84FF] text-white' : 'bg-ink/10 text-ink-faint'}`}
            >
              <Pencil size={9} />
            </button>
            <button
              aria-label="Toggle Finished"
              title="Finished"
              onClick={() => toggleDocStatus(activeDoc.id, 'finished')}
              className={`w-4 h-4 rounded-full flex items-center justify-center ${activeDoc.status.finished ? 'bg-[#30D158] text-white' : 'bg-ink/10 text-ink-faint'}`}
            >
              <Check size={9} />
            </button>
            <button
              aria-label="Toggle Reviewed"
              title="Reviewed"
              onClick={() => toggleDocStatus(activeDoc.id, 'reviewed')}
              className={`w-4 h-4 rounded-full flex items-center justify-center ${activeDoc.status.reviewed ? 'bg-[#BF5AF2] text-white' : 'bg-ink/10 text-ink-faint'}`}
            >
              <Eye size={9} />
            </button>
          </div>
        )}
        <span className={`flex items-center gap-1 text-[11px] shrink-0 px-1 ${saveStatusClassName}`}>
          <SaveStatusIcon size={12} className={saveStatus === 'saving' ? 'animate-spin' : ''} />
          {saveStatusLabel}
        </span>
        <IconButton size="sm" aria-label="Toggle split screen" onClick={() => setSplitScreenOpen(v => !v)} className={`!bg-transparent shrink-0 ${splitScreenOpen ? '!text-accent' : ''}`}>
          <PanelRight size={14} />
        </IconButton>
        <IconButton size="sm" aria-label="Find & replace" onClick={() => (searchOpen ? closeFindPanel() : openFindPanel('replace'))} className={`!bg-transparent shrink-0 ${searchOpen ? '!text-accent' : ''}`}>
          <Search size={14} />
        </IconButton>
        <IconButton size="sm" aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme} className="!bg-transparent shrink-0">
          {resolvedTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </IconButton>
        <IconButton size="sm" aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'} title={isFullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen} className="!bg-transparent shrink-0">
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
      </div>

      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 px-3 h-11 shrink-0 border-b border-hairline overflow-x-auto">
        <select
          defaultValue=""
          onMouseDown={captureFormatSelection}
          onChange={(e) => {
            // Opening/using the dropdown steals focus from the page, same issue font size has —
            // restore the selection captured on this control's own mousedown, above, before it
            // had the chance to steal focus.
            if (e.target.value) { restoreFormatSelection(); exec('fontName', e.target.value); }
            e.target.value = '';
          }}
          className="h-7 bg-ink/5 border border-hairline rounded-md px-1.5 text-xs text-ink"
          aria-label="Font family"
        >
          <option value="" disabled>Font</option>
          {[...FONT_FAMILIES, ...customFontFamilies].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className="flex items-center h-7 bg-ink/5 border border-hairline rounded-md overflow-hidden shrink-0" title="Font size">
          <input
            type="text"
            inputMode="numeric"
            aria-label="Font size"
            value={fontSizeInput}
            onMouseDown={captureFormatSelection}
            onChange={(e) => setFontSizeInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => commitFontSizeInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitFontSizeInput(e.currentTarget.value); } }}
            className="w-9 h-full bg-transparent px-1 text-xs text-ink text-center outline-none"
          />
          <div className="flex flex-col border-l border-hairline shrink-0">
            <button
              type="button" aria-label="Increase font size" onMouseDown={captureFormatSelection} onClick={() => stepFontSize(FONT_SIZE_STEP)}
              className="h-3.5 w-4 flex items-center justify-center text-ink-faint hover:text-ink hover:bg-ink/10 leading-none"
            >
              <ChevronUp size={9} />
            </button>
            <button
              type="button" aria-label="Decrease font size" onMouseDown={captureFormatSelection} onClick={() => stepFontSize(-FONT_SIZE_STEP)}
              className="h-3.5 w-4 flex items-center justify-center text-ink-faint hover:text-ink hover:bg-ink/10 leading-none border-t border-hairline"
            >
              <ChevronDown size={9} />
            </button>
          </div>
        </div>
        <input type="color" title="Text color" onMouseDown={captureFormatSelection} onChange={(e) => { restoreFormatSelection(); exec('foreColor', e.target.value); }} className="w-6 h-6 rounded cursor-pointer border border-hairline bg-transparent" />
        <input type="color" title="Highlight color" defaultValue="#ffff00" onMouseDown={captureFormatSelection} onChange={(e) => { restoreFormatSelection(); applyHighlight(e.target.value); }} className="w-6 h-6 rounded cursor-pointer border border-hairline bg-transparent" />
        <div className="w-px h-5 bg-hairline mx-1.5" />
        {toolbarButtons.map(({ icon: Icon, label, run, command, blockTag }) => {
          const active = command
            ? document.queryCommandState(command)
            : blockTag
            ? document.queryCommandValue('formatBlock').toLowerCase() === blockTag.toLowerCase()
            : false;
          return (
            <IconButton
              key={label}
              size="sm"
              aria-label={label}
              title={label}
              active={active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={run}
              className="!bg-transparent"
            >
              <Icon size={14} />
            </IconButton>
          );
        })}
        <IconButton
          size="sm"
          aria-label="Right to left"
          title="Toggle Right-to-Left"
          active={activeDoc?.dir === 'rtl'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleDir}
          className="!bg-transparent"
        >
          <Languages size={14} />
        </IconButton>
        <div className="w-px h-5 bg-hairline mx-1.5" />
        <Button
          size="sm"
          variant={spellCheckActive ? 'primary' : 'secondary'}
          aria-pressed={spellCheckActive}
          title={spellCheckActive ? 'Spell check on — click to turn off' : 'Spell check off — click to turn on'}
          onClick={toggleSpellCheck}
        >
          Spell Check
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={handleSendToTyper}><Send size={13} /> Send to TypeR</Button>
        <Button size="sm" variant="secondary" onClick={() => activeDoc && exportDocAsTxt({ ...activeDoc, pages: capturePagesForExport() })}>
          <FileType size={13} /> TXT
        </Button>
        <Button size="sm" variant="secondary" onClick={handleExportDocx}><Download size={13} /> DOCX</Button>
        <Button size="sm" variant="secondary" onClick={() => activeDoc && printDocAsPdf({ ...activeDoc, pages: capturePagesForExport() })}>
          <Printer size={13} /> PDF
        </Button>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline flex-wrap">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') goToMatch(e.shiftKey ? -1 : 1); }}
            placeholder="Find…"
            className="flex-1 min-w-[120px] bg-ink/5 border border-hairline rounded-md px-2 py-1 text-xs"
          />
          {findMode === 'replace' && (
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace with…"
              className="flex-1 min-w-[120px] bg-ink/5 border border-hairline rounded-md px-2 py-1 text-xs"
            />
          )}
          <span className="text-[11px] text-ink-faint whitespace-nowrap px-1">
            {matchCount > 0 ? `${currentMatchIndex + 1} of ${matchCount}` : query.trim() ? '0 matches' : ''}
          </span>
          <IconButton size="sm" aria-label="Previous match" title="Previous match" onClick={() => goToMatch(-1)} disabled={matchCount === 0} className="!bg-transparent">
            <ChevronUp size={14} />
          </IconButton>
          <IconButton size="sm" aria-label="Next match" title="Next match" onClick={() => goToMatch(1)} disabled={matchCount === 0} className="!bg-transparent">
            <ChevronDown size={14} />
          </IconButton>
          <IconButton
            size="sm" aria-label="Match case" title="Match case" active={caseSensitive}
            onClick={() => setCaseSensitive(v => !v)} className="!bg-transparent !text-[11px] font-semibold"
          >
            Aa
          </IconButton>
          <IconButton
            size="sm" aria-label="Whole word" title="Whole word" active={wholeWord}
            onClick={() => setWholeWord(v => !v)} className="!bg-transparent !text-[11px] font-semibold"
          >
            “ab”
          </IconButton>
          {findMode === 'replace' && (
            <>
              <Button size="sm" onClick={replaceCurrentMatch} disabled={matchCount === 0}>Replace</Button>
              <Button size="sm" onClick={replaceInDoc} disabled={!query.trim()}>Replace All</Button>
            </>
          )}
          <IconButton size="sm" aria-label="Close find panel" title="Close" onClick={closeFindPanel} className="!bg-transparent">
            <X size={14} />
          </IconButton>
        </div>
      )}

      {/* Pages */}
      <div className="flex-1 min-h-0 overflow-auto bg-[#e5e7eb] dark:bg-[#1e1e1e] flex flex-col items-center gap-6 py-8">
        {activeDoc && (
          <div key={`${activeDoc.id}-${renderKey}`} className="flex flex-col items-center gap-6" dir={activeDoc.dir}>
            {activeDoc.pages.map((html, i) => (
              <div key={i} className="shrink-0 relative" style={{ width: PAGE_WIDTH * zoom, height: PAGE_HEIGHT * zoom }}>
                <div
                  className="overflow-hidden rounded-sm shadow-2xl"
                  style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                >
                  <EditablePage
                    initialHtml={html}
                    pageRef={getPageRefCallback(i)}
                    onInput={handleInput}
                    onClick={handlePageClick}
                    onKeyDown={handleKeyDown}
                    onContextMenu={handleContextMenu}
                  />
                </div>
                <div className="absolute bottom-1 inset-x-0 text-center text-[11px] text-ink-faint pointer-events-none select-none">
                  {i + 1} / {activeDoc.pages.length}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      {splitScreenOpen && <SplitScreenPreview workspaces={workspaces} onClose={() => setSplitScreenOpen(false)} />}
      {activeTable && (
        <TableToolbar
          table={activeTable}
          fullySelected={tableFullySelected}
          onToggleFullySelected={() => {
            setTableFullySelected(v => !v);
            // Belt-and-suspenders alongside the handle button's own
            // onMouseDown preventDefault: force focus/keydown routing back
            // onto the contentEditable regardless of any focus quirks, so
            // the very next Delete/Backspace reliably reaches runKeyDownLogic.
            const table = activeTable;
            const containingPage = pageRefs.current.find((el): el is HTMLDivElement => !!el && !!table && el.contains(table));
            containingPage?.focus();
          }}
          onAddRowAbove={handleAddRowAbove}
          onAddRowBelow={handleAddRowBelow}
          onAddColLeft={handleAddColLeft}
          onAddColRight={handleAddColRight}
          onDeleteRow={handleDeleteRowAction}
          onDeleteCol={handleDeleteColAction}
          onDeleteTable={handleDeleteTableAction}
        />
      )}
      {selectedImage && (
        <ImageControls
          image={selectedImage}
          onDelete={deleteSelectedImage}
          onResizeCommit={() => { scheduleAutosave(); reflow(); }}
        />
      )}
      {imageContextMenuPos && (
        <div
          ref={imageContextMenuRef}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-50 bg-elevated border border-hairline rounded-md shadow-panel py-1"
          style={{ top: imageContextMenuPos.y, left: imageContextMenuPos.x }}
        >
          <button className="block w-full text-left text-[12px] px-3 py-1.5 hover:bg-ink/10 text-danger whitespace-nowrap" onClick={() => { deleteSelectedImage(); setImageContextMenuPos(null); }}>
            Delete Image
          </button>
          <button className="block w-full text-left text-[12px] px-3 py-1.5 hover:bg-ink/10 text-ink whitespace-nowrap" onClick={() => { void copySelectedImage(); setImageContextMenuPos(null); }}>
            Copy Image
          </button>
          <div className="h-px bg-hairline my-1" />
          <button className="block w-full text-left text-[12px] px-3 py-1.5 hover:bg-ink/10 text-ink whitespace-nowrap" onClick={() => { alignSelectedImage('left'); setImageContextMenuPos(null); }}>
            Align Left
          </button>
          <button className="block w-full text-left text-[12px] px-3 py-1.5 hover:bg-ink/10 text-ink whitespace-nowrap" onClick={() => { alignSelectedImage('center'); setImageContextMenuPos(null); }}>
            Align Center
          </button>
          <button className="block w-full text-left text-[12px] px-3 py-1.5 hover:bg-ink/10 text-ink whitespace-nowrap" onClick={() => { alignSelectedImage('right'); setImageContextMenuPos(null); }}>
            Align Right
          </button>
        </div>
      )}
      {markMenuPos && (
        <div
          ref={markMenuRef}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-50 bg-elevated border border-hairline rounded-md shadow-panel py-1"
          style={{ top: markMenuPos.y, left: markMenuPos.x }}
        >
          <div className="px-3 py-1 text-[10px] text-ink-faint uppercase tracking-wide whitespace-nowrap">Mark as…</div>
          <button className="block w-full text-left text-[12px] px-3 py-1.5 hover:bg-ink/10 text-ink whitespace-nowrap" onClick={() => applyMark('inProgress')}>
            🔵 In Progress
          </button>
          <button className="block w-full text-left text-[12px] px-3 py-1.5 hover:bg-ink/10 text-ink whitespace-nowrap" onClick={() => applyMark('finished')}>
            🟢 Finished
          </button>
          <button className="block w-full text-left text-[12px] px-3 py-1.5 hover:bg-ink/10 text-ink whitespace-nowrap" onClick={() => applyMark('reviewed')}>
            🟣 Reviewed
          </button>
        </div>
      )}

      {/* Status bar */}
      {activeDoc && (
        <div className="flex items-center gap-3 px-3 h-7 shrink-0 border-t border-hairline text-[11px] text-ink-faint overflow-x-auto">
          <span className="whitespace-nowrap">
            Page {Math.min(activePageIndex, activeDoc.pages.length - 1) + 1} of {activeDoc.pages.length}
          </span>
          <span className="whitespace-nowrap">{wordCount} word{wordCount === 1 ? '' : 's'}</span>
          <span className="whitespace-nowrap">{charCount.toLocaleString()} characters / {charCountNoSpaces.toLocaleString()} without spaces</span>
          <span className="whitespace-nowrap flex items-center gap-1"><Clock size={11} /> ~{Math.max(1, Math.ceil(wordCount / 200))} min read</span>
          <button type="button" onClick={toggleDir} className="whitespace-nowrap hover:text-ink transition-colors" title="Toggle text direction">
            {activeDoc.dir === 'rtl' ? 'AR-RTL' : 'EN-LTR'}
          </button>
          <span className="flex-1" />
          <div className="flex items-center gap-1 shrink-0">
            <IconButton size="sm" aria-label="Zoom out" onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} className="!bg-transparent !w-5 !h-5">
              <Minus size={11} />
            </IconButton>
            <button type="button" onClick={() => setZoom(1)} className="w-10 text-center hover:text-ink transition-colors" title="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <IconButton size="sm" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(2, Math.round((z + 0.1) * 10) / 10))} className="!bg-transparent !w-5 !h-5">
              <Plus size={11} />
            </IconButton>
          </div>
        </div>
      )}

      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          onRename={() => renameDocPrompt(tabMenu.docId)}
          onDuplicate={() => duplicateDoc(tabMenu.docId)}
          onCloseOthers={() => closeOtherDocs(tabMenu.docId)}
          onCloseAll={closeAllDocs}
        />
      )}

      {tableMenu && (
        <SimplePopoverMenu
          x={tableMenu.x}
          y={tableMenu.y}
          onClose={() => setTableMenu(null)}
          items={[
            { label: 'Merge with Right Cell', onSelect: () => mergeTableCellRight(tableMenu.cell) },
            { label: 'Split Cell', onSelect: () => splitTableCell(tableMenu.cell), disabled: (tableMenu.cell.colSpan || 1) <= 1 },
          ]}
        />
      )}

      {selectedImage && selectedImage.isConnected && (
        <ImageResizeOverlay img={selectedImage} onResized={scheduleAutosave} />
      )}

      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleImageFileChosen(e)} />
      <input ref={attachmentInputRef} type="file" className="hidden" onChange={(e) => void handleAttachmentFileChosen(e)} />

      <SendToTyperDialog
        open={sendToTyperOpen}
        onClose={() => setSendToTyperOpen(false)}
        chapters={chapterOptions}
        defaultChapterId={activeChapterId}
        currentPageNumber={activePageIndex + 1}
        pageCount={activeDoc?.pages.length ?? 1}
        onConfirm={confirmSendToTyper}
      />
      </div>
    </div>
  );
}

interface TabContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}

/** A small local popover for tab actions — deliberately not routed through the app-wide
 *  `AppContextMenu` singleton (ContextMenu.tsx), since that component's whole purpose is
 *  covering what the browser's *native* right-click menu would otherwise have offered (Cut/Copy/
 *  Paste/Select-All over a text selection or editable field); tab actions aren't that. */
function TabContextMenu({ x, y, onClose, onRename, onDuplicate, onCloseOthers, onCloseAll }: TabContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const itemClass = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-accent/15 hover:text-accent transition-colors';
  const menuWidth = 168;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - 148);

  return (
    <div ref={ref} className="liquid-glass-heavy fixed z-[999] min-w-[168px] rounded-2xl p-1" style={{ left, top }}>
      <button type="button" className={itemClass} onClick={() => { onRename(); onClose(); }}>Rename…</button>
      <button type="button" className={itemClass} onClick={() => { onDuplicate(); onClose(); }}>Duplicate</button>
      <button type="button" className={itemClass} onClick={() => { onCloseOthers(); onClose(); }}>Close Others</button>
      <button type="button" className={itemClass} onClick={() => { onCloseAll(); onClose(); }}>Close All</button>
    </div>
  );
}

interface SimplePopoverMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  items: { label: string; onSelect: () => void; disabled?: boolean }[];
}

/** A generic version of the same local-popover pattern `TabContextMenu` already established —
 *  used here for table cell row/column/merge actions, which (like tab actions) aren't things the
 *  browser's own native right-click menu would ever have offered, so `AppContextMenu` isn't the
 *  right place for them either. */
function SimplePopoverMenu({ x, y, onClose, items }: SimplePopoverMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const itemClass = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-accent/15 hover:text-accent transition-colors disabled:opacity-40 disabled:pointer-events-none';
  const menuWidth = 190;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - items.length * 36 - 16);

  return (
    <div ref={ref} className="liquid-glass-heavy fixed z-[999] min-w-[190px] rounded-2xl p-1" style={{ left, top }}>
      {items.map(item => (
        <button key={item.label} type="button" disabled={item.disabled} className={itemClass} onClick={() => { item.onSelect(); onClose(); }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A single bottom-right resize handle, rendered as a fixed-position overlay *outside* the
 *  contenteditable DOM (mirrors the page-number footer's own sibling-not-descendant trick) so the
 *  handle itself never becomes part of `innerHTML` and is never persisted/exported. Dragging
 *  applies `img.style.width/height` directly — aspect-ratio-locked by default, Shift releases it. */
function ImageResizeOverlay({ img, onResized }: { img: HTMLImageElement; onResized: () => void }) {
  const [rect, setRect] = useState(() => img.getBoundingClientRect());

  useEffect(() => {
    function update() { setRect(img.getBoundingClientRect()); }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [img]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = img.getBoundingClientRect();
    const aspect = startRect.width / startRect.height;

    function onMove(ev: PointerEvent) {
      const newWidth = Math.max(20, startRect.width + (ev.clientX - startX));
      const newHeight = ev.shiftKey ? Math.max(20, startRect.height + (ev.clientY - startY)) : newWidth / aspect;
      img.style.width = `${newWidth}px`;
      img.style.height = `${newHeight}px`;
      setRect(img.getBoundingClientRect());
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onResized();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div className="fixed pointer-events-none z-40 border-2 border-accent" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <div
        onPointerDown={startResize}
        className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-accent border border-white rounded-sm pointer-events-auto cursor-nwse-resize"
      />
    </div>
  );
}
