import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Modal, Button } from '../ui';
import type { TyperInsertMode } from '../../lib/typerBridge';

export interface SendToTyperChapterOption {
  id: string;
  label: string;
}

export type SendToTyperPageRange = 'all' | 'current' | { from: number; to: number };

export interface SendToTyperResult {
  chapterId: string;
  mode: TyperInsertMode;
  pageRange: SendToTyperPageRange;
}

interface SendToTyperDialogProps {
  open: boolean;
  onClose: () => void;
  chapters: SendToTyperChapterOption[];
  /** Pre-selected chapter — the last one the user had open, if any; still shown/changeable even
   *  when there's only one chapter in the whole project. */
  defaultChapterId: string | null;
  /** 1-based, for the "Current Page (N)" button label and as the range default. */
  currentPageNumber: number;
  pageCount: number;
  onConfirm: (result: SendToTyperResult) => void;
}

const MODE_OPTIONS: { id: TyperInsertMode; label: string; hint: string }[] = [
  { id: 'replace', label: 'Replace All', hint: 'Clears the chapter’s existing TypeR script and replaces it with this text.' },
  { id: 'append', label: 'Append', hint: 'Adds this text after whatever is already in TypeR.' },
  // Not "current line": TypeR only has a live cursor while its own Studio session is open, and
  // sending here always happens from a different tab where no such session exists — see
  // App.tsx's handleSendToTyper for why "the top" is the honest target, not an approximation.
  { id: 'insert-line', label: 'Insert at Top', hint: 'Inserts before the chapter’s existing TypeR script — where a freshly-opened TypeR session starts.' },
];

/** Confirmation dialog for "Send to TypeR": which chapter, how to combine with what's already
 *  there, and how much of the current document to send. Nothing is sent until Confirm. */
export function SendToTyperDialog({ open, onClose, chapters, defaultChapterId, currentPageNumber, pageCount, onConfirm }: SendToTyperDialogProps) {
  const [chapterId, setChapterId] = useState('');
  const [mode, setMode] = useState<TyperInsertMode>('replace');
  const [rangeKind, setRangeKind] = useState<'all' | 'current' | 'range'>('all');
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(pageCount);

  useEffect(() => {
    if (!open) return;
    setChapterId(defaultChapterId ?? chapters[0]?.id ?? '');
    setMode('replace');
    setRangeKind('all');
    setRangeFrom(1);
    setRangeTo(pageCount);
  }, [open, defaultChapterId, chapters, pageCount]);

  if (!open) return null;

  function confirm() {
    if (!chapterId) return;
    const pageRange: SendToTyperPageRange =
      rangeKind === 'all' ? 'all'
      : rangeKind === 'current' ? 'current'
      : { from: Math.max(1, Math.min(rangeFrom, rangeTo)), to: Math.min(pageCount, Math.max(rangeFrom, rangeTo)) };
    onConfirm({ chapterId, mode, pageRange });
  }

  const rangeButtonClass = (active: boolean) =>
    `py-2 rounded-xl border text-xs font-medium transition-colors ${active ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted'}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send to TypeR"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={!chapterId}><Send size={13} /> Send to TypeR</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Chapter</label>
          <select
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value)}
            className="w-full bg-ink/5 border border-hairline rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-accent"
          >
            {chapters.length === 0 && <option value="">No chapters yet</option>}
            {chapters.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-accent font-semibold">Insert Position</label>
          <div className="grid grid-cols-3 gap-2">
            {MODE_OPTIONS.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                title={m.hint}
                className={rangeButtonClass(mode === m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-faint">{MODE_OPTIONS.find(m => m.id === mode)?.hint}</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-accent font-semibold">Pages</label>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setRangeKind('all')} className={rangeButtonClass(rangeKind === 'all')}>
              Entire Document
            </button>
            <button type="button" onClick={() => setRangeKind('current')} className={rangeButtonClass(rangeKind === 'current')}>
              Current Page ({currentPageNumber})
            </button>
            <button type="button" onClick={() => setRangeKind('range')} className={rangeButtonClass(rangeKind === 'range')}>
              Page Range
            </button>
          </div>
          {rangeKind === 'range' && (
            <div className="flex items-center gap-2">
              <input
                type="number" min={1} max={pageCount} value={rangeFrom}
                onChange={(e) => setRangeFrom(Math.max(1, Math.min(pageCount, Number(e.target.value) || 1)))}
                className="w-16 bg-ink/5 border border-hairline rounded-md px-2 py-1.5 text-xs text-ink"
              />
              <span className="text-xs text-ink-faint">to</span>
              <input
                type="number" min={1} max={pageCount} value={rangeTo}
                onChange={(e) => setRangeTo(Math.max(1, Math.min(pageCount, Number(e.target.value) || pageCount)))}
                className="w-16 bg-ink/5 border border-hairline rounded-md px-2 py-1.5 text-xs text-ink"
              />
              <span className="text-xs text-ink-faint">of {pageCount}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
