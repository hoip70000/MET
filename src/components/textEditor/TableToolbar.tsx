import { useLayoutEffect, useState } from 'react';

interface TableToolbarProps {
  table: HTMLTableElement;
  fullySelected: boolean;
  onToggleFullySelected: () => void;
  onAddRowAbove: () => void;
  onAddRowBelow: () => void;
  onAddColLeft: () => void;
  onAddColRight: () => void;
  onDeleteRow: () => void;
  onDeleteCol: () => void;
  onDeleteTable: () => void;
}

const TOOLBAR_HEIGHT = 32;
const GAP = 4;
const HANDLE_SIZE = 14;

/** Floating toolbar positioned above (or below, if clipped) the active table,
 *  plus a small top-left "select whole table" handle — the same "measure the
 *  real rect, flip on viewport-edge collision" idea used elsewhere in this
 *  app's floating chrome, reimplemented locally here rather than imported,
 *  since it's Studio-only code. */
export function TableToolbar({ table, fullySelected, onToggleFullySelected, onAddRowAbove, onAddRowBelow, onAddColLeft, onAddColRight, onDeleteRow, onDeleteCol, onDeleteTable }: TableToolbarProps) {
  const [pos, setPos] = useState<{ top: number; left: number; tableTop: number; tableLeft: number } | null>(null);

  useLayoutEffect(() => {
    function update() {
      const r = table.getBoundingClientRect();
      const fitsAbove = r.top >= TOOLBAR_HEIGHT + GAP;
      setPos({
        top: fitsAbove ? r.top - TOOLBAR_HEIGHT - GAP : r.bottom + GAP,
        left: Math.max(4, Math.min(r.left, window.innerWidth - 320)),
        tableTop: r.top,
        tableLeft: r.left,
      });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [table]);

  if (!pos) return null;

  const btnClass = 'text-[11px] px-2 py-1 rounded hover:bg-ink/10 text-ink whitespace-nowrap';

  return (
    <>
      <div
        className="fixed z-40 flex items-center gap-0.5 bg-elevated border border-hairline rounded-md shadow-panel px-1 py-0.5"
        style={{ top: pos.top, left: pos.left }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button className={btnClass} onClick={onAddRowAbove}>Row+ Above</button>
        <button className={btnClass} onClick={onAddRowBelow}>Row+ Below</button>
        <button className={btnClass} onClick={onAddColLeft}>Col+ Left</button>
        <button className={btnClass} onClick={onAddColRight}>Col+ Right</button>
        <div className="w-px h-4 bg-hairline mx-0.5" />
        <button className={`${btnClass} text-danger`} onClick={onDeleteRow}>Delete Row</button>
        <button className={`${btnClass} text-danger`} onClick={onDeleteCol}>Delete Col</button>
        <button className={`${btnClass} text-danger`} onClick={onDeleteTable}>Delete Table</button>
      </div>
      <button
        aria-label="Select whole table"
        title="Select whole table"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleFullySelected}
        className={`fixed z-40 rounded-sm border ${fullySelected ? 'bg-accent border-accent' : 'bg-elevated border-hairline hover:bg-ink/10'}`}
        style={{ top: pos.tableTop - HANDLE_SIZE / 2, left: pos.tableLeft - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }}
      />
    </>
  );
}
