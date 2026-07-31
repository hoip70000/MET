import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CollabCursors } from './CollabCursors';
import type { StudioCollabPeer } from '../../lib/studioCollab';

interface RemoteCursor {
  userId: string;
  name: string;
  x: number;
  y: number;
}

interface CollabViewerCanvasProps {
  /** The host's latest broadcast raster snapshot — a plain data URL, re-set on every throttled frame. */
  frameDataUrl: string | null;
  cursors: RemoteCursor[];
  peers: StudioCollabPeer[];
  /** Page-space (unscaled image pixel) coordinates, so a viewer can point at the canvas too. */
  onPointerMove?: (x: number, y: number) => void;
}

/**
 * Read-only spectator canvas for non-host participants of a live Studio session. Deliberately not
 * a second Konva Stage — a viewer never edits, so there's nothing to gain from shipping the real
 * paint/mask canvas registries and render pipeline here; it just displays the host's periodic
 * flattened snapshot, object-fit: contain style, with CollabCursors layered on top.
 */
export function CollabViewerCanvas({ frameDataUrl, cursors, peers, onPointerMove }: CollabViewerCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setContainerSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const scale = naturalSize && containerSize.w && containerSize.h
    ? Math.min(containerSize.w / naturalSize.w, containerSize.h / naturalSize.h)
    : 1;
  const offsetX = naturalSize ? (containerSize.w - naturalSize.w * scale) / 2 : 0;
  const offsetY = naturalSize ? (containerSize.h - naturalSize.h * scale) / 2 : 0;

  function toContainer(x: number, y: number) {
    return { x: offsetX + x * scale, y: offsetY + y * scale };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!onPointerMove || !naturalSize) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    onPointerMove((e.clientX - rect.left - offsetX) / scale, (e.clientY - rect.top - offsetY) / scale);
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    setNaturalSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center bg-[#1b1b1f] overflow-hidden"
      onPointerMove={handlePointerMove}
    >
      {frameDataUrl ? (
        <img
          src={frameDataUrl}
          alt="Live canvas"
          className="select-none pointer-events-none"
          style={naturalSize ? { width: naturalSize.w * scale, height: naturalSize.h * scale } : undefined}
          onLoad={handleImageLoad}
          draggable={false}
        />
      ) : (
        <p className="text-ink-faint text-sm">Waiting for the host's first frame…</p>
      )}
      <CollabCursors cursors={cursors} peers={peers} toContainer={toContainer} />
    </div>
  );
}
