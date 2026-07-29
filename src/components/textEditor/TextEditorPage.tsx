import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Search, Download, FileType, Printer, Send, Heading1, Heading2,
  Check, Loader2, AlertCircle, Circle, PanelRight,
} from 'lucide-react';
import { Button, IconButton } from '../ui';
import { swal, swalToast } from '../../lib/swalTheme';
import { genId } from '../../lib/id';
import { loadTextEditorDocs, saveTextEditorDocs, type TextEditorDoc } from '../../lib/textEditorStore';
import { markMisspellings, stripSpellMarks, findSpellIssues } from '../../lib/spellCheck';
import { exportDocAsTxt, exportDocAsDocx, printDocAsPdf, downloadBlob } from '../../lib/textEditorExport';
import { SplitScreenPreview } from './SplitScreenPreview';
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
  return { id: genId('tedoc'), title, dir: 'ltr', pages: [''] };
}

interface EditablePageProps {
  initialHtml: string;
  pageRef: (el: HTMLDivElement | null) => void;
  onInput: () => void;
  onClick: (e: React.MouseEvent) => void;
}

/** Isolated behind `memo` deliberately — see the A2 note in the audit comment
 *  above. Must receive only stable/primitive props (a string, not a fresh
 *  `{__html}` wrapper object; stable callback references) or the memoization
 *  is defeated and every parent re-render still reaches into this DOM. */
const EditablePage = memo(function EditablePage({ initialHtml, pageRef, onInput, onClick }: EditablePageProps) {
  return (
    <div className="shrink-0 overflow-hidden rounded-sm shadow-2xl" style={{ width: PAGE_WIDTH }}>
      <div
        ref={pageRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        dangerouslySetInnerHTML={{ __html: initialHtml }}
        onInput={onInput}
        onClick={onClick}
        className="te-page bg-white text-black px-16 py-16 text-[15px] leading-relaxed outline-none overflow-hidden"
        style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, minHeight: PAGE_HEIGHT, colorScheme: 'light' }}
      />
    </div>
  );
});

interface TextEditorPageProps {
  onSendToTyper: (script: string) => void;
  workspaces: Workspace[];
}

export function TextEditorPage({ onSendToTyper, workspaces }: TextEditorPageProps) {
  const [splitScreenOpen, setSplitScreenOpen] = useState(false);
  const [docs, setDocs] = useState<TextEditorDoc[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renderKey, setRenderKey] = useState(0); // bump only on structural changes (doc switch, page add/remove)
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [spellReport, setSpellReport] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved');

  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dirtyRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mirrors `docs` state so the live content can be read/merged without waiting
   *  for (or forcing) a re-render — see `getDocsWithLiveContent`. */
  const docsRef = useRef<TextEditorDoc[]>([]);
  /** Mirrors `activeDocId` so helpers callable from a once-created closure
   *  (e.g. the unmount cleanup below) never read a stale id. */
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
  const runSpellClickLogicRef = useRef<(e: React.MouseEvent) => void>(() => {});

  useEffect(() => { activeDocIdRef.current = activeDocId; }, [activeDocId]);

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
  const handleSpellClick = useCallback((e: React.MouseEvent) => { runSpellClickLogicRef.current(e); }, []);

  /** Replaces every direct `setDocs(...)` call site so `docsRef` never drifts
   *  from `docs` state. */
  function updateDocs(next: TextEditorDoc[]) {
    docsRef.current = next;
    setDocs(next);
  }

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
      setDocs(initial);
      setActiveDocId(initial[0].id);
      setLoaded(true);
    });
    return () => { cancelled = true; };
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
    updateDocs(docsRef.current.map(d => d.id === activeDocId ? { ...d, pages } : d));
  }

  function scheduleAutosave() {
    dirtyRef.current = true;
    setSaveStatus('unsaved');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      void flushSave();
    }, AUTOSAVE_MS);
  }

  /** Persists the live content and updates `docsRef` — deliberately never calls
   *  `setDocs`/re-renders the active page, since that would force
   *  `dangerouslySetInnerHTML` to re-apply on the still-mounted, still-focused
   *  contentEditable node and destroy the caret (see Section 0 audit above). */
  async function flushSave(): Promise<void> {
    const nextDocs = getDocsWithLiveContent();
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
    if (dirtyRef.current) {
      saveTextEditorDocs(getDocsWithLiveContent()).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      let guard = 0;
      while (page.scrollHeight > page.clientHeight + 2 && page.lastElementChild && guard < 500) {
        guard += 1;
        next.insertBefore(page.lastElementChild, next.firstChild);
      }
    }

    for (let j = 0; j < els.length - 1; j++) {
      const page = els[j];
      const next = els[j + 1];
      let guard = 0;
      while (next.firstElementChild && guard < 500) {
        guard += 1;
        const candidate = next.firstElementChild;
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
    const neededCount = needsNewPage ? els.length + 1 : lastNonEmpty + 1;
    const currentCount = activeDoc?.pages.length ?? els.length;

    if (neededCount !== currentCount) {
      const docId = activeDocIdRef.current;
      // Only ever grows/truncates the pages array *length* — every untouched
      // page's string reference is preserved as-is, so this never disturbs a
      // live-edited page's dangerouslySetInnerHTML value (see Section 0 audit).
      updateDocs(docsRef.current.map((d) => {
        if (d.id !== docId) return d;
        const pages = [...d.pages];
        if (neededCount > pages.length) {
          while (pages.length < neededCount) pages.push('');
        } else {
          pages.length = Math.max(1, neededCount);
        }
        return { ...d, pages };
      }));
    }
  }

  // A page added/removed by reflow() only gets/loses a real DOM node on the next render —
  // re-run reflow once that's happened so overflow actually finishes moving.
  useEffect(() => {
    reflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.pages.length]);

  function runInputLogic() {
    scheduleAutosave();
    reflow();
  }
  runInputLogicRef.current = runInputLogic;

  function exec(command: string, value?: string) {
    document.execCommand(command, false, value);
  }

  function addDoc() {
    const based = getDocsWithLiveContent();
    const doc = newDoc(`Document ${based.length + 1}`);
    const next = [...based, doc];
    updateDocs(next);
    setActiveDocId(doc.id);
    setRenderKey(k => k + 1);
    saveTextEditorDocs(next).catch(console.error);
  }

  function closeDoc(id: string) {
    const based = getDocsWithLiveContent();
    if (based.length <= 1) return;
    const next = based.filter(d => d.id !== id);
    updateDocs(next);
    if (activeDocId === id) setActiveDocId(next[0].id);
    setRenderKey(k => k + 1);
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
    setActiveDocId(id);
    setRenderKey(k => k + 1);
  }

  function runSpellCheck() {
    if (!activeDoc) return;
    const pages = captureActiveDocPages().map(html => markMisspellings(stripSpellMarks(html)));
    const total = pages.reduce((sum, html) => {
      const container = document.createElement('div');
      container.innerHTML = html;
      return sum + findSpellIssues(container.innerText).length;
    }, 0);
    commitActiveDocPages(pages);
    setRenderKey(k => k + 1);
    setSpellReport(total);
    scheduleAutosave();
  }

  function clearSpellMarks() {
    if (!activeDoc) return;
    commitActiveDocPages(captureActiveDocPages().map(stripSpellMarks));
    setRenderKey(k => k + 1);
    setSpellReport(null);
  }

  function runSpellClickLogic(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('spell-miss')) return;
    target.replaceWith(document.createTextNode(target.dataset.fix ?? target.textContent ?? ''));
    scheduleAutosave();
  }
  runSpellClickLogicRef.current = runSpellClickLogic;

  function replaceInDoc() {
    if (!query.trim() || !activeDoc) return;
    const pages = captureActiveDocPages().map((html) => {
      const container = document.createElement('div');
      container.innerHTML = html;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) nodes.push(n as Text);
      for (const node of nodes) {
        if (node.textContent?.includes(query)) node.textContent = node.textContent.split(query).join(replacement);
      }
      return container.innerHTML;
    });
    commitActiveDocPages(pages);
    setRenderKey(k => k + 1);
    scheduleAutosave();
  }

  async function handleExportDocx() {
    if (!activeDoc) return;
    const pages = captureActiveDocPages();
    const doc = { ...activeDoc, pages };
    try {
      const blob = await exportDocAsDocx(doc);
      downloadBlob(blob, `${doc.title || 'Untitled'}.docx`);
    } catch (err) {
      swal({ icon: 'error', title: 'Export Failed', text: err instanceof Error ? err.message : 'Could not export DOCX.' });
    }
  }

  function handleSendToTyper() {
    if (!activeDoc) return;
    const pages = captureActiveDocPages();
    const text = pages.map((html) => {
      const container = document.createElement('div');
      container.innerHTML = stripSpellMarks(html);
      return container.innerText;
    }).join('\n');
    onSendToTyper(text);
    swalToast({ icon: 'success', title: 'Sent to TypeR — open the Studio to see it waiting there' });
  }

  const toolbarButtons = useMemo(() => [
    { icon: Bold, label: 'Bold', run: () => exec('bold') },
    { icon: Italic, label: 'Italic', run: () => exec('italic') },
    { icon: Underline, label: 'Underline', run: () => exec('underline') },
    { icon: Heading1, label: 'Heading 1', run: () => exec('formatBlock', 'H1') },
    { icon: Heading2, label: 'Heading 2', run: () => exec('formatBlock', 'H2') },
    { icon: List, label: 'Bulleted list', run: () => exec('insertUnorderedList') },
    { icon: ListOrdered, label: 'Numbered list', run: () => exec('insertOrderedList') },
    { icon: AlignLeft, label: 'Align left', run: () => exec('justifyLeft') },
    { icon: AlignCenter, label: 'Align center', run: () => exec('justifyCenter') },
    { icon: AlignRight, label: 'Align right', run: () => exec('justifyRight') },
  ], []);

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
      <div className="flex flex-col flex-1 min-w-0 h-full min-h-0">
      {/* Document tabs */}
      <div className="flex items-center gap-1 px-3 h-10 shrink-0 border-b border-hairline overflow-x-auto">
        {docs.map(d => (
          <button
            key={d.id}
            onClick={() => switchDoc(d.id)}
            className={`shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${
              d.id === activeDocId ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:bg-ink/5 hover:text-ink'
            }`}
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
        <span className={`flex items-center gap-1 text-[11px] shrink-0 px-1 ${saveStatusClassName}`}>
          <SaveStatusIcon size={12} className={saveStatus === 'saving' ? 'animate-spin' : ''} />
          {saveStatusLabel}
        </span>
        <IconButton size="sm" aria-label="Find & replace" onClick={() => setSearchOpen(v => !v)} className={`!bg-transparent shrink-0 ${searchOpen ? '!text-accent' : ''}`}>
          <Search size={14} />
        </IconButton>
        <IconButton size="sm" aria-label="Toggle split screen" onClick={() => setSplitScreenOpen(v => !v)} className={`!bg-transparent shrink-0 ${splitScreenOpen ? '!text-accent' : ''}`}>
          <PanelRight size={14} />
        </IconButton>
      </div>

      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 px-3 h-11 shrink-0 border-b border-hairline overflow-x-auto">
        {toolbarButtons.map(({ icon: Icon, label, run }) => (
          <IconButton key={label} size="sm" aria-label={label} title={label} onClick={run} className="!bg-transparent">
            <Icon size={14} />
          </IconButton>
        ))}
        <div className="w-px h-5 bg-hairline mx-1.5" />
        <Button size="sm" variant="secondary" onClick={runSpellCheck}>Spell Check</Button>
        {spellReport !== null && (
          <span className="text-[11px] text-ink-faint px-1">{spellReport === 0 ? 'No issues' : `${spellReport} issue(s)`}</span>
        )}
        {spellReport !== null && <Button size="sm" variant="ghost" onClick={clearSpellMarks}>Clear</Button>}
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={handleSendToTyper}><Send size={13} /> Send to TypeR</Button>
        <Button size="sm" variant="secondary" onClick={() => activeDoc && exportDocAsTxt({ ...activeDoc, pages: captureActiveDocPages() })}>
          <FileType size={13} /> TXT
        </Button>
        <Button size="sm" variant="secondary" onClick={handleExportDocx}><Download size={13} /> DOCX</Button>
        <Button size="sm" variant="secondary" onClick={() => activeDoc && printDocAsPdf({ ...activeDoc, pages: captureActiveDocPages() })}>
          <Printer size={13} /> PDF
        </Button>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find…" className="flex-1 bg-ink/5 border border-hairline rounded-md px-2 py-1 text-xs" />
          <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace with…" className="flex-1 bg-ink/5 border border-hairline rounded-md px-2 py-1 text-xs" />
          <Button size="sm" onClick={replaceInDoc} disabled={!query.trim()}>Replace All</Button>
        </div>
      )}

      {/* Pages */}
      <div className="flex-1 min-h-0 overflow-auto bg-[#e9e9ec] dark:bg-[#2a2a2a] flex flex-col items-center gap-6 py-8">
        {activeDoc && (
          <div key={`${activeDoc.id}-${renderKey}`} className="flex flex-col items-center gap-6" dir={activeDoc.dir}>
            {activeDoc.pages.map((html, i) => (
              <EditablePage
                key={i}
                initialHtml={html}
                pageRef={getPageRefCallback(i)}
                onInput={handleInput}
                onClick={handleSpellClick}
              />
            ))}
          </div>
        )}
      </div>
      </div>
      {splitScreenOpen && <SplitScreenPreview workspaces={workspaces} onClose={() => setSplitScreenOpen(false)} />}
    </div>
  );
}
