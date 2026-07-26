import { Undo2, Redo2 } from 'lucide-react';
import { IconButton } from '../../ui';
import { cn } from '../../ui/cn';
import { StudioPanel } from '../StudioPanel';
import { useHistory } from './HistoryContext';

interface HistoryPanelProps {
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name. */
  hideTitle?: boolean;
}

export function HistoryPanel({ hideTitle }: HistoryPanelProps = {}) {
  const { entries, cursor, undo, redo, jumpTo, canUndo, canRedo } = useHistory();

  return (
    <StudioPanel
      title="History"
      hideTitle={hideTitle}
      bare
      bodyClassName="py-1.5 px-1.5 flex flex-col gap-0.5"
      actions={
        <>
          <IconButton size="sm" aria-label="Undo" disabled={!canUndo} onClick={undo} className="!bg-transparent">
            <Undo2 size={13} />
          </IconButton>
          <IconButton size="sm" aria-label="Redo" disabled={!canRedo} onClick={redo} className="!bg-transparent">
            <Redo2 size={13} />
          </IconButton>
        </>
      }
    >
      <button
        onClick={() => jumpTo(-1)}
        className={cn(
          'studio-interactive studio-focusable text-left px-2.5 py-1.5 rounded-control text-ui',
          cursor === -1 ? 'bg-accent-soft text-accent font-medium' : 'text-ink-faint hover:bg-ink/5'
        )}
      >
        Opened document
      </button>
      {entries.map((entry, i) => (
        <button
          key={i}
          onClick={() => jumpTo(i)}
          className={cn(
            'studio-interactive studio-focusable text-left px-2.5 py-1.5 rounded-control text-ui truncate',
            i === cursor ? 'bg-accent-soft text-accent font-medium' : 'text-ink-faint hover:bg-ink/5'
          )}
        >
          {entry.label}
        </button>
      ))}
      {entries.length === 0 && (
        <p className="px-2.5 pt-2 text-micro text-ink-faint/60 leading-snug">
          Edits you make will stack up here — click any step to jump back to it.
        </p>
      )}
    </StudioPanel>
  );
}
