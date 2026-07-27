import type { StudioLayer } from '../components/studio/studioTypes';

/**
 * A module-level (not React state) clipboard for Edit > Cut/Copy/Paste — deliberately outside any
 * component so it survives whatever re-renders happen between a Copy and a later Paste. The stashed
 * layer is always a fully independent clone (its own id, its own raster/mask canvas backing already
 * created via `layerTree.cloneSubtree` + `StudioCanvasHandle.clonePaintCanvases`/`cloneMaskCanvases`
 * — the exact pairing CLAUDE.md calls load-bearing), never a reference into the live layer tree, so
 * deleting the original (Cut) or editing it afterwards can never reach back into the clipboard.
 */
let clipboardEntry: StudioLayer | null = null;

export function getClipboardLayer(): StudioLayer | null {
  return clipboardEntry;
}

/** Replaces the clipboard entry, returning whatever was there before (so the caller can free its
 *  canvas backing — the clipboard module itself has no canvas-registry access). */
export function setClipboardLayer(layer: StudioLayer | null): StudioLayer | null {
  const previous = clipboardEntry;
  clipboardEntry = layer;
  return previous;
}
