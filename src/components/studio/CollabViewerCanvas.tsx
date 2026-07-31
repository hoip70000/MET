import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
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
  /** Remote control: this viewer currently holds it, so pointer down/up (in the same page-space
   *  coordinates as onPointerMove) are worth relaying to the host — see
   *  StudioCanvasHandle.dispatchRemotePointerEvent on the receiving end. */
  hasControl?: boolean;
  onPointerDown?: (x: number, y: number, button: number) => void;
  onPointerUp?: (x: number, y: number, button: number) => void;
}

/**
 * Read-only spectator canvas for non-host participants of a live Studio session. Deliberately not
 * a second Konva Stage — a viewer never edits, so there's nothing to gain from shipping the real
 * paint/mask canvas registries and render pipeline here; it just displays the host's periodic
 * flattened snapshot, object-fit: contain style, with CollabCursors layered on top. When granted
 * remote control, pointer gestures are additionally relayed to the host rather than only tracked
 * for the cursor overlay.
 */
export function CollabViewerCanvas({ frameDataUrl, cursors, peers, onPointerMove, hasControl, onPointerDown, onPointerUp }: CollabViewerCanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setContainerSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onFullscreenChange() { setIsFullscreen(document.fullscreenElement === rootRef.current); }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      rootRef.current?.requestFullscreen().catch(() => {});
    }
  }

  const scale = naturalSize && containerSize.w && containerSize.h
    ? Math.min(containerSize.w / naturalSize.w, containerSize.h / naturalSize.h)
    : 1;
  const offsetX = naturalSize ? (containerSize.w - naturalSize.w * scale) / 2 : 0;
  const offsetY = naturalSize ? (containerSize.h - naturalSize.h * scale) / 2 : 0;

  function toContainer(x: number, y: number) {
    return { x: offsetX + x * scale, y: offsetY + y * scale };
  }

  function toPageSpace(e: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !naturalSize) return null;
    return { x: (e.clientX - rect.left - offsetX) / scale, y: (e.clientY - rect.top - offsetY) / scale };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!onPointerMove) return;
    const p = toPageSpace(e);
    if (p) onPointerMove(p.x, p.y);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!hasControl || !onPointerDown) return;
    const p = toPageSpace(e);
    if (p) onPointerDown(p.x, p.y, e.button);
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!hasControl || !onPointerUp) return;
    const p = toPageSpace(e);
    if (p) onPointerUp(p.x, p.y, e.button);
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    setNaturalSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }

  return (
    <div ref={rootRef} className="relative w-full h-full">
      <div
        ref={containerRef}
        className={`relative w-full h-full flex items-center justify-center bg-[#1b1b1f] overflow-hidden ${hasControl ? 'cursor-crosshair' : ''}`}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
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
      <button
        type="button"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={isFullscreen ? 'Exit fullscreen' : 'Fill the screen'}
        onClick={toggleFullscreen}
        className="absolute bottom-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-control bg-black/50 text-white hover:bg-black/70 transition-colors"
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
    </div>
  );
}
