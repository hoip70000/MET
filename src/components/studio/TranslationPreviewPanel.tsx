import { useMemo, useState } from 'react';
import { Search, ArrowRight, MessageSquare } from 'lucide-react';
import type { Page } from '../../types';
import { StudioPanel } from './StudioPanel';
import { flattenTree } from './layerTree';
import type { StudioLayer, TranslationStatus } from './studioTypes';

interface DialogueRow {
  pageId: string;
  pageLabel: string;
  layerId: string;
  content: string;
  status: TranslationStatus;
  comment: string;
}

interface TranslationPreviewPanelProps {
  pages: Page[];
  layersByPage: Record<string, StudioLayer[]>;
  activePageId: string | null;
  onJumpToBubble: (pageId: string, layerId: string) => void;
  onUpdateText: (pageId: string, layerId: string, patch: { content?: string; status?: TranslationStatus; comment?: string }) => void;
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name. */
  hideTitle?: boolean;
}

const STATUS_LABEL: Record<TranslationStatus, string> = { draft: 'Draft', translated: 'Translated', reviewed: 'Reviewed' };
const STATUS_CLASS: Record<TranslationStatus, string> = {
  draft: 'bg-ink/10 text-ink-faint',
  translated: 'bg-accent-soft text-accent',
  reviewed: 'bg-success/15 text-success',
};

export function TranslationPreviewPanel({ pages, layersByPage, activePageId, onJumpToBubble, onUpdateText, hideTitle }: TranslationPreviewPanelProps) {
  const [query, setQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rows = useMemo<DialogueRow[]>(() => {
    const out: DialogueRow[] = [];
    pages.forEach((page, i) => {
      // Flattened: text nested inside a group is still dialogue, and must not vanish from the list.
      const layers = flattenTree(layersByPage[page.id] ?? []);
      for (const l of layers) {
        if (l.type === 'text' && l.text) {
          out.push({
            pageId: page.id,
            pageLabel: `Page ${i + 1}`,
            layerId: l.id,
            content: l.text.content,
            status: l.text.status,
            comment: l.text.comment,
          });
        }
      }
    });
    return out;
  }, [pages, layersByPage]);

  const filtered = query.trim()
    ? rows.filter(r => r.content.toLowerCase().includes(query.trim().toLowerCase()))
    : rows;

  function replaceAll() {
    if (!query.trim()) return;
    const needle = query.trim();
    for (const row of rows) {
      if (row.content.toLowerCase().includes(needle.toLowerCase())) {
        const next = row.content.split(needle).join(replaceWith);
        onUpdateText(row.pageId, row.layerId, { content: next });
      }
    }
  }

  return (
    <StudioPanel
      title="Translation Preview"
      hideTitle={hideTitle}
      bare
      actions={<span className="text-micro text-ink-faint pr-1">{rows.length} dialogue{rows.length !== 1 ? 's' : ''}</span>}
    >
      <div className="px-3 py-2.5 border-b border-hairline flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Search size={12} className="text-ink-faint shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all pages…"
            className="flex-1 bg-ink/5 border border-hairline rounded-control px-2 py-1 text-ui text-ink"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowRight size={12} className="text-ink-faint shrink-0" />
          <input
            value={replaceWith}
            onChange={(e) => setReplaceWith(e.target.value)}
            placeholder="Replace with…"
            className="flex-1 bg-ink/5 border border-hairline rounded-control px-2 py-1 text-ui text-ink"
          />
          <button
            onClick={replaceAll}
            disabled={!query.trim()}
            className="shrink-0 px-2 py-1 rounded-control text-micro font-medium bg-ink/5 border border-hairline text-ink disabled:opacity-40 disabled:pointer-events-none hover:bg-ink/10"
          >
            Replace All
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-4 text-center text-ui text-ink-faint">
            {rows.length === 0 ? 'No dialogue placed yet.' : 'No matches.'}
          </div>
        )}
        {filtered.map(row => {
          const expanded = expandedId === `${row.pageId}:${row.layerId}`;
          return (
            <div
              key={`${row.pageId}:${row.layerId}`}
              className={`border-b border-hairline/60 px-3 py-2 ${row.pageId === activePageId ? 'bg-accent-soft/30' : ''}`}
            >
              <div className="flex items-start gap-2">
                <button
                  onClick={() => onJumpToBubble(row.pageId, row.layerId)}
                  className="flex-1 text-left min-w-0"
                  title="Jump to this bubble"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-micro text-ink-faint font-mono">{row.pageLabel}</span>
                    <span className={`text-micro px-1.5 py-0.5 rounded-full ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                    {row.comment && <MessageSquare size={10} className="text-ink-faint" />}
                  </div>
                  <p className="text-ui text-ink truncate">{row.content || <span className="italic text-ink-faint">(empty)</span>}</p>
                </button>
                <button
                  onClick={() => setExpandedId(expanded ? null : `${row.pageId}:${row.layerId}`)}
                  className="text-micro text-ink-faint hover:text-ink shrink-0 px-1"
                >
                  {expanded ? 'Hide' : 'Edit'}
                </button>
              </div>
              {expanded && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="flex gap-1">
                    {(['draft', 'translated', 'reviewed'] as TranslationStatus[]).map(s => (
                      <button
                        key={s}
                        onClick={() => onUpdateText(row.pageId, row.layerId, { status: s })}
                        className={`flex-1 text-micro py-1 rounded-control border transition-colors ${
                          row.status === s ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-faint hover:bg-ink/5'
                        }`}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={row.comment}
                    onChange={(e) => onUpdateText(row.pageId, row.layerId, { comment: e.target.value })}
                    placeholder="Translator comment…"
                    rows={2}
                    className="bg-ink/5 border border-hairline rounded-control px-2 py-1 text-micro text-ink resize-none"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </StudioPanel>
  );
}
