import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Search, Download, FileType, Printer, Send, Heading1, Heading2,
} from 'lucide-react';
import { Button, IconButton } from '../ui';
import { swal, swalToast } from '../../lib/swalTheme';
import { genId } from '../../lib/id';
import { loadTextEditorDocs, saveTextEditorDocs, type TextEditorDoc } from '../../lib/textEditorStore';
import { markMisspellings, stripSpellMarks, findSpellIssues } from '../../lib/spellCheck';
import { exportDocAsTxt, exportDocAsDocx, printDocAsPdf, downloadBlob } from '../../lib/textEditorExport';

const PAGE_WIDTH = 794; // A4 at 96dpi
const PAGE_HEIGHT = 1123;
const AUTOSAVE_MS = 1000;

function newDoc(title = 'Untitled'): TextEditorDoc {
  return { id: genId('tedoc'), title, dir: 'ltr', pages: [''] };
}

interface TextEditorPageProps {
  onSendToTyper: (script: string) => void;
  /** Whether a Studio chapter is currently open — Send to TypeR switches the top-level view to
   *  Library either way, but only actually lands on the Studio (where the script is waiting) if
   *  one is; the toast wording reflects which case this is instead of always claiming success. */
  hasActiveChapter: boolean;
}

export function TextEditorPage({ onSendToTyper, hasActiveChapter }: TextEditorPageProps) {
  const [docs, setDocs] = useState<TextEditorDoc[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renderKey, setRenderKey] = useState(0); // bump only on structural changes (doc switch, page add/remove)
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [spellReport, setSpellReport] = useState<number | null>(null);

  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dirtyRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadTextEditorDocs().then((saved) => {
      const initial = saved && saved.length > 0 ? saved : [newDoc()];
      setDocs(initial);
      setActiveDocId(initial[0].id);
      setLoaded(true);
    });
  }, []);

  const activeDoc = docs.find(d => d.id === activeDocId) ?? null;

  function captureActiveDocPages(): string[] {
    return pageRefs.current.filter((el): el is HTMLDivElement => !!el).map(el => el.innerHTML);
  }

  function commitActiveDocPages(pages: string[]) {
    if (!activeDocId) return;
    setDocs(prev => prev.map(d => d.id === activeDocId ? { ...d, pages } : d));
  }

  function scheduleAutosave() {
    dirtyRef.current = true;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const pages = captureActiveDocPages();
      const nextDocs = docs.map(d => d.id === activeDocId ? { ...d, pages } : d);
      setDocs(nextDocs);
      saveTextEditorDocs(nextDocs).catch(console.error);
    }, AUTOSAVE_MS);
  }

  useEffect(() => () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (dirtyRef.current && activeDocId) {
      const pages = captureActiveDocPages();
      saveTextEditorDocs(docs.map(d => d.id === activeDocId ? { ...d, pages } : d)).catch(console.error);
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
      const docId = activeDocId;
      setDocs(prev => prev.map((d) => {
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

  function handleInput() {
    scheduleAutosave();
    reflow();
  }

  function exec(command: string, value?: string) {
    document.execCommand(command, false, value);
  }

  function addDoc() {
    const doc = newDoc(`Document ${docs.length + 1}`);
    const next = [...docs, doc];
    setDocs(next);
    setActiveDocId(doc.id);
    setRenderKey(k => k + 1);
    saveTextEditorDocs(next).catch(console.error);
  }

  function closeDoc(id: string) {
    if (docs.length <= 1) return;
    const next = docs.filter(d => d.id !== id);
    setDocs(next);
    if (activeDocId === id) setActiveDocId(next[0].id);
    setRenderKey(k => k + 1);
    saveTextEditorDocs(next).catch(console.error);
  }

  function switchDoc(id: string) {
    if (dirtyRef.current && activeDocId) {
      const pages = captureActiveDocPages();
      setDocs(prev => prev.map(d => d.id === activeDocId ? { ...d, pages } : d));
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

  function handleSpellClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('spell-miss')) return;
    target.replaceWith(document.createTextNode(target.dataset.fix ?? target.textContent ?? ''));
    scheduleAutosave();
  }

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
    swalToast({
      icon: 'success',
      title: hasActiveChapter
        ? 'Sent to TypeR — opening the Studio…'
        : 'Sent to TypeR — open a chapter in Library to see it waiting there',
    });
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

  return (
    <div className="flex flex-col h-full min-h-0">
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
        <IconButton size="sm" aria-label="Find & replace" onClick={() => setSearchOpen(v => !v)} className={`!bg-transparent shrink-0 ${searchOpen ? '!text-accent' : ''}`}>
          <Search size={14} />
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
      <div className="flex-1 min-h-0 overflow-auto bg-ink/[0.03] flex flex-col items-center gap-6 py-8">
        {activeDoc && (
          <div key={`${activeDoc.id}-${renderKey}`} className="flex flex-col items-center gap-6" dir={activeDoc.dir}>
            {activeDoc.pages.map((html, i) => (
              <div key={i} className="shrink-0 overflow-hidden rounded-sm shadow-2xl" style={{ width: PAGE_WIDTH }}>
                <div
                  ref={(el) => { pageRefs.current[i] = el; }}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck
                  dangerouslySetInnerHTML={{ __html: html }}
                  onInput={handleInput}
                  onClick={handleSpellClick}
                  className="te-page bg-white text-black px-16 py-16 text-[15px] leading-relaxed outline-none overflow-hidden"
                  style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, minHeight: PAGE_HEIGHT }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
