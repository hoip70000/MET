import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, MoreHorizontal, ChevronLeft, ChevronRight, Pencil, Check, Eye } from 'lucide-react';
import { IconButton } from '../ui';
import { swal } from '../../lib/swalTheme';
import type { TextEditorDoc, TextEditorDocStatus } from '../../lib/textEditorStore';
import { exportDocAsTxt, exportDocAsDocx, printDocAsPdf, downloadBlob } from '../../lib/textEditorExport';

const COLLAPSE_KEY = 'text_editor_library_collapsed';
type StatusFilter = 'all' | 'inProgress' | 'finished' | 'reviewed';

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inProgress', label: '🔵 In Progress' },
  { key: 'finished', label: '🟢 Finished' },
  { key: 'reviewed', label: '🟣 Reviewed' },
];

function countWords(pages: string[]): number {
  return pages.reduce((sum, html) => {
    const container = document.createElement('div');
    container.innerHTML = html;
    const text = container.innerText.trim();
    return sum + (text ? text.split(/\s+/).length : 0);
  }, 0);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface DocumentLibraryProps {
  docs: TextEditorDoc[];
  activeDocId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string, key: keyof TextEditorDocStatus) => void;
}

export function DocumentLibrary({ docs, activeDocId, onOpen, onNew, onRename, onDuplicate, onDelete, onToggleStatus }: DocumentLibraryProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* not fatal */ }
  }, [collapsed]);

  useEffect(() => {
    if (!menuOpenId) return;
    function dismiss(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpenId(null);
    }
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [menuOpenId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (q && !d.title.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && !d.status[statusFilter]) return false;
      return true;
    });
  }, [docs, query, statusFilter]);

  if (collapsed) {
    return (
      <div className="w-10 shrink-0 border-r border-hairline flex flex-col items-center py-2 gap-2">
        <IconButton size="sm" aria-label="Expand document library" onClick={() => setCollapsed(false)} className="!bg-transparent">
          <ChevronRight size={14} />
        </IconButton>
      </div>
    );
  }

  async function handleDelete(doc: TextEditorDoc) {
    const result = await swal({
      icon: 'warning',
      title: 'Delete this document?',
      text: `This will permanently remove "${doc.title}".`,
      showCancelButton: true,
      confirmButtonText: 'Delete Document',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    onDelete(doc.id);
  }

  function commitRename() {
    if (renamingId) onRename(renamingId, renameValue.trim() || 'Untitled');
    setRenamingId(null);
  }

  return (
    <div className="w-64 shrink-0 border-r border-hairline flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 h-10 shrink-0 border-b border-hairline">
        <IconButton size="sm" aria-label="New document" onClick={onNew} className="!bg-transparent">
          <Plus size={14} />
        </IconButton>
        <div className="flex-1 flex items-center gap-1 bg-ink/5 border border-hairline rounded-md px-2 h-7 min-w-0">
          <Search size={12} className="text-ink-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            className="flex-1 min-w-0 bg-transparent text-xs outline-none"
          />
        </div>
        <IconButton size="sm" aria-label="Collapse document library" onClick={() => setCollapsed(true)} className="!bg-transparent">
          <ChevronLeft size={14} />
        </IconButton>
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-hairline overflow-x-auto">
        {STATUS_CHIPS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`shrink-0 text-[10px] px-2 py-1 rounded-full border whitespace-nowrap ${
              statusFilter === key ? 'bg-accent-soft text-accent border-accent' : 'border-hairline text-ink-faint hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-[11px] text-ink-faint text-center py-6 px-3">No documents match.</div>
        )}
        {filtered.map((doc) => {
          const words = countWords(doc.pages);
          const isActive = doc.id === activeDocId;
          return (
            <div
              key={doc.id}
              onClick={() => onOpen(doc.id)}
              className={`relative px-3 py-2 border-b border-hairline cursor-pointer ${isActive ? 'bg-accent-soft' : 'hover:bg-ink/5'}`}
            >
              {renamingId === doc.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                  className="w-full bg-ink/5 border border-hairline rounded px-1 py-0.5 text-xs"
                />
              ) : (
                <div
                  onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(doc.id); setRenameValue(doc.title); }}
                  className={`text-xs font-medium truncate ${isActive ? 'text-accent' : 'text-ink'}`}
                >
                  {doc.title}
                </div>
              )}
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-ink-faint truncate">{formatDate(doc.updatedAt)} · {doc.pages.length}p · {words}w</span>
                <IconButton
                  size="sm"
                  aria-label="Document actions"
                  onClick={(e) => { e.stopPropagation(); setMenuOpenId(m => m === doc.id ? null : doc.id); }}
                  className="!bg-transparent !h-5 !w-5 shrink-0"
                >
                  <MoreHorizontal size={12} />
                </IconButton>
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <button
                  aria-label="Toggle In Progress"
                  onClick={(e) => { e.stopPropagation(); onToggleStatus(doc.id, 'inProgress'); }}
                  className={`w-4 h-4 rounded-full flex items-center justify-center ${doc.status.inProgress ? 'bg-[#0A84FF] text-white' : 'bg-ink/10 text-ink-faint'}`}
                >
                  <Pencil size={9} />
                </button>
                <button
                  aria-label="Toggle Finished"
                  onClick={(e) => { e.stopPropagation(); onToggleStatus(doc.id, 'finished'); }}
                  className={`w-4 h-4 rounded-full flex items-center justify-center ${doc.status.finished ? 'bg-[#30D158] text-white' : 'bg-ink/10 text-ink-faint'}`}
                >
                  <Check size={9} />
                </button>
                <button
                  aria-label="Toggle Reviewed"
                  onClick={(e) => { e.stopPropagation(); onToggleStatus(doc.id, 'reviewed'); }}
                  className={`w-4 h-4 rounded-full flex items-center justify-center ${doc.status.reviewed ? 'bg-[#BF5AF2] text-white' : 'bg-ink/10 text-ink-faint'}`}
                >
                  <Eye size={9} />
                </button>
              </div>

              {menuOpenId === doc.id && (
                <div
                  ref={menuRef}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute right-2 top-8 z-30 bg-elevated border border-hairline rounded-md shadow-panel py-1 w-36"
                >
                  <button className="block w-full text-left text-[11px] px-3 py-1.5 hover:bg-ink/10" onClick={() => { onOpen(doc.id); setMenuOpenId(null); }}>Open</button>
                  <button className="block w-full text-left text-[11px] px-3 py-1.5 hover:bg-ink/10" onClick={() => { setRenamingId(doc.id); setRenameValue(doc.title); setMenuOpenId(null); }}>Rename</button>
                  <button className="block w-full text-left text-[11px] px-3 py-1.5 hover:bg-ink/10" onClick={() => { onDuplicate(doc.id); setMenuOpenId(null); }}>Duplicate</button>
                  <button className="block w-full text-left text-[11px] px-3 py-1.5 hover:bg-ink/10 text-danger" onClick={() => { setMenuOpenId(null); void handleDelete(doc); }}>Delete</button>
                  <div className="h-px bg-hairline my-1" />
                  <button className="block w-full text-left text-[11px] px-3 py-1.5 hover:bg-ink/10" onClick={() => { exportDocAsTxt(doc); setMenuOpenId(null); }}>Export TXT</button>
                  <button className="block w-full text-left text-[11px] px-3 py-1.5 hover:bg-ink/10" onClick={() => { void exportDocAsDocx(doc).then(blob => downloadBlob(blob, `${doc.title || 'Untitled'}.docx`)); setMenuOpenId(null); }}>Export DOCX</button>
                  <button className="block w-full text-left text-[11px] px-3 py-1.5 hover:bg-ink/10" onClick={() => { printDocAsPdf(doc); setMenuOpenId(null); }}>Export PDF</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
