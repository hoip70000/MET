import { useLayoutEffect, useState } from 'react';

interface ImageControlsProps {
  image: HTMLImageElement;
  onDelete: () => void;
  onResizeCommit: () => void;
}

type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const CORNER_SIZE = 8;
const EDGE_SIZE = 6;
const MIN_SIZE = 20;

const HANDLES: { pos: HandlePos; size: number; cursor: string }[] = [
  { pos: 'nw', size: CORNER_SIZE, cursor: 'nwse-resize' },
  { pos: 'n', size: EDGE_SIZE, cursor: 'ns-resize' },
  { pos: 'ne', size: CORNER_SIZE, cursor: 'nesw-resize' },
  { pos: 'e', size: EDGE_SIZE, cursor: 'ew-resize' },
  { pos: 'se', size: CORNER_SIZE, cursor: 'nwse-resize' },
  { pos: 's', size: EDGE_SIZE, cursor: 'ns-resize' },
  { pos: 'sw', size: CORNER_SIZE, cursor: 'nesw-resize' },
  { pos: 'w', size: EDGE_SIZE, cursor: 'ew-resize' },
];

interface Rect { top: number; left: number; width: number; height: number }

/** Selection overlay for an <img> living inside the contentEditable page —
 *  positioned via getBoundingClientRect() like TableToolbar, since the editor
 *  has no zoom/pan to account for. Resizing writes directly to img.style,
 *  which persists automatically as part of the page's captured innerHTML,
 *  same principle as every other formatting concern in this editor. */
export function ImageControls({ image, onDelete, onResizeCommit }: ImageControlsProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragDims, setDragDims] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    function update() {
      const r = image.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [image]);

  if (!rect) return null;

  function startResize(handle: HandlePos, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = image.getBoundingClientRect();
    const startW = startRect.width;
    const startH = startRect.height;
    const ratio = startH === 0 ? 1 : startW / startH;
    const signX = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
    const signY = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let newW = startW + (signX !== 0 ? dx * signX : 0);
      let newH = startH + (signY !== 0 ? dy * signY : 0);

      if (!ev.shiftKey) {
        if (signX !== 0 && signY !== 0) {
          if (Math.abs(dx) > Math.abs(dy)) newH = newW / ratio; else newW = newH * ratio;
        } else if (signX !== 0) {
          newH = newW / ratio;
        } else if (signY !== 0) {
          newW = newH * ratio;
        }
      }

      newW = Math.max(MIN_SIZE, newW);
      newH = Math.max(MIN_SIZE, newH);

      image.style.width = `${newW}px`;
      image.style.height = `${newH}px`;
      setDragDims({ w: Math.round(newW), h: Math.round(newH) });
      const r = image.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragDims(null);
      onResizeCommit();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function handleStyle(pos: HandlePos, size: number): React.CSSProperties {
    const half = size / 2;
    const style: React.CSSProperties = { position: 'fixed', width: size, height: size };
    if (pos.includes('n')) style.top = rect.top - half;
    else if (pos.includes('s')) style.top = rect.top + rect.height - half;
    else style.top = rect.top + rect.height / 2 - half;
    if (pos.includes('w')) style.left = rect.left - half;
    else if (pos.includes('e')) style.left = rect.left + rect.width - half;
    else style.left = rect.left + rect.width / 2 - half;
    return style;
  }

  return (
    <>
      <div
        className="fixed z-40 border-2 border-accent pointer-events-none"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      />
      {HANDLES.map(h => (
        <div
          key={h.pos}
          onPointerDown={(e) => startResize(h.pos, e)}
          className="fixed z-40 bg-white border border-accent"
          style={{ ...handleStyle(h.pos, h.size), cursor: h.cursor }}
        />
      ))}
      <button
        aria-label="Delete image"
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={onDelete}
        className="fixed z-40 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center text-[10px] leading-none"
        style={{ top: rect.top - 8, left: rect.left + rect.width - 8 }}
      >
        ✕
      </button>
      {dragDims && (
        <div
          className="fixed z-40 bg-elevated border border-hairline rounded px-1.5 py-0.5 text-[10px] text-ink whitespace-nowrap"
          style={{ top: rect.top + rect.height + 4, left: Math.max(4, rect.left + rect.width - 70) }}
        >
          {dragDims.w} × {dragDims.h}px
        </div>
      )}
    </>
  );
}
