import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../ui';
import type { FilterConfig } from './filterDialogConfigs';

interface FilterDialogProps {
  config: FilterConfig;
  /** The active raster layer's live canvas — the exact same accessor paint-stroke commits already
   *  use (`StudioCanvasHandle.getPaintCanvas`), so the preview mutates the real thing on screen. */
  canvas: HTMLCanvasElement;
  /** Snapshotted once, before the dialog opened — what Cancel restores and what OK's history entry
   *  records as "before". */
  before: ImageData;
  /** Forces Konva to redraw this layer after the canvas was mutated directly (paints bypass React). */
  onRedraw: () => void;
  onCancel: () => void;
  /** Pixels are already finalized on `canvas` by the time this fires — the caller just needs to
   *  snapshot "after" and push history/autosave, the same shape as a committed paint stroke. */
  onApply: () => void;
}

/**
 * Generic Image > Apply Filter dialog: live full-canvas preview (mutating the real layer canvas,
 * not a separate small inset renderer — more faithful to "live," and reuses the exact preview
 * mechanism brush strokes already use), numeric controls, Preview toggle, Enter=OK/Esc=Cancel.
 */
export function FilterDialog({ config, canvas, before, onRedraw, onCancel, onApply }: FilterDialogProps) {
  const [params, setParams] = useState<Record<string, number>>(() =>
    Object.fromEntries(config.controls.map(c => [c.key, c.default]))
  );
  const [preview, setPreview] = useState(true);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  function renderInto(imageData: ImageData) {
    config.run(imageData, paramsRef.current);
  }

  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (preview) {
      // A real `ImageData`, not a plain `{data,width,height}` object (filters.ts's own vitest-safe
      // convention) — `ctx.putImageData` does a strict `instanceof ImageData` check in the browser
      // and rejects a same-shaped plain object outright.
      const scratch = new ImageData(new Uint8ClampedArray(before.data), before.width, before.height);
      renderInto(scratch);
      ctx.putImageData(scratch, 0, 0);
    } else {
      ctx.putImageData(before, 0, 0);
    }
    onRedraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, preview]);

  function handleCancel() {
    const ctx = canvas.getContext('2d');
    ctx?.putImageData(before, 0, 0);
    onRedraw();
    onCancel();
  }

  function handleOk() {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Regardless of whether Preview is currently checked — OK always commits the filter with the
      // current params, never "whatever happens to already be on screen".
      const result = new ImageData(new Uint8ClampedArray(before.data), before.width, before.height);
      renderInto(result);
      ctx.putImageData(result, 0, 0);
      onRedraw();
    }
    onApply();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); handleOk(); }
      else if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, preview]);

  return (
    <Modal open onClose={handleCancel} title={config.title} size="sm" footer={
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className="h-8 px-3 rounded-control text-ui font-medium border border-hairline bg-ink/5 text-ink hover:bg-ink/10 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleOk}
          className="h-8 px-3 rounded-control text-ui font-medium bg-accent text-white hover:opacity-90 transition-opacity"
        >
          OK
        </button>
      </div>
    }>
      <div className="flex flex-col gap-3">
        {config.controls.map(control => {
          const isFlag = control.min === 0 && control.max === 1 && control.step === 1 && !control.unit;
          if (isFlag) {
            return (
              <label key={control.key} className="flex items-center justify-between text-ui text-ink">
                <span>{control.label}</span>
                <input
                  type="checkbox"
                  checked={params[control.key] === 1}
                  onChange={(e) => setParams(p => ({ ...p, [control.key]: e.target.checked ? 1 : 0 }))}
                  className="accent-[var(--color-accent)]"
                />
              </label>
            );
          }
          return (
            <label key={control.key} className="flex items-center gap-2 text-ui text-ink">
              <span className="w-20 shrink-0 text-ink-faint">{control.label}</span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step ?? 1}
                value={params[control.key]}
                onChange={(e) => setParams(p => ({ ...p, [control.key]: Number(e.target.value) }))}
                className="flex-1 accent-[var(--color-accent)]"
              />
              <input
                type="number"
                min={control.min}
                max={control.max}
                step={control.step ?? 1}
                value={params[control.key]}
                onChange={(e) => setParams(p => ({ ...p, [control.key]: Number(e.target.value) }))}
                className="w-16 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
              />
              {control.unit && <span className="w-10 shrink-0 text-micro text-ink-faint">{control.unit}</span>}
            </label>
          );
        })}
        {config.controls.length === 0 && (
          <p className="text-micro text-ink-faint">This filter has no parameters — OK applies it directly.</p>
        )}
        <label className="flex items-center gap-2 text-ui text-ink pt-2 border-t border-hairline/60">
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-[var(--color-accent)]" />
          <span>Preview</span>
        </label>
      </div>
    </Modal>
  );
}
