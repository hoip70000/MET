import { useEffect, useState } from 'react';
import { colord } from 'colord';
import { Modal, Input } from '../../ui';
import { SvSquare } from './SvSquare';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './colorConversions';

const SV_SIZE = 220;
const WEB_SAFE_STEPS = [0, 51, 102, 153, 204, 255];
function snapWebSafe(v: number): number {
  return WEB_SAFE_STEPS.reduce((closest, step) => (Math.abs(step - v) < Math.abs(closest - v) ? step : closest));
}

type PickerMode = 'hsb' | 'rgb' | 'lab' | 'cmyk';

interface ColorPickerModalProps {
  open: boolean;
  onClose: () => void;
  target: 'fg' | 'bg';
  initialHex: string;
  onCommit: (hex: string) => void;
  /** Undefined when no palette is active — the button disables rather than silently no-opping. */
  addSwatch?: (hex: string) => void;
}

/**
 * The full Photoshop-style Color Picker dialog — large SV square + vertical hue slider + a
 * switchable H/S/B, R/G/B, L/a/b, C/M/Y/K input group + hex + web-safe snap + New/Current preview.
 * Owns its own local color state until OK commits it, mirroring FilterDialog's
 * own-state-until-commit pattern (Cancel/Esc discards, never touching the real fg/bg color).
 */
export function ColorPickerModal({ open, onClose, target, initialHex, onCommit, addSwatch }: ColorPickerModalProps) {
  const [localHex, setLocalHex] = useState(initialHex);
  const [mode, setMode] = useState<PickerMode>('hsb');
  const [webSafeOnly, setWebSafeOnly] = useState(false);

  useEffect(() => {
    if (open) { setLocalHex(initialHex); setMode('hsb'); setWebSafeOnly(false); }
  }, [open, initialHex]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); handleOk(); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, localHex]);

  if (!open) return null;

  const hsv = rgbToHsv(hexToRgb(localHex));
  const rgb = hexToRgb(localHex);
  const c = colord(localHex);
  const lab = c.toLab();
  const cmyk = c.toCmyk();

  function applyRgb(next: { r: number; g: number; b: number }) {
    const final = webSafeOnly ? { r: snapWebSafe(next.r), g: snapWebSafe(next.g), b: snapWebSafe(next.b) } : next;
    setLocalHex(rgbToHex(final));
  }
  function setFromHsv(patch: Partial<{ h: number; s: number; v: number }>) {
    applyRgb(hsvToRgb({ ...hsv, ...patch }));
  }
  function setFromRgb(patch: Partial<{ r: number; g: number; b: number }>) {
    applyRgb({ ...rgb, ...patch });
  }
  function setFromLab(patch: Partial<{ l: number; a: number; b: number }>) {
    setLocalHex(colord({ ...lab, ...patch }).toHex());
  }
  function setFromCmyk(patch: Partial<{ c: number; m: number; y: number; k: number }>) {
    setLocalHex(colord({ ...cmyk, ...patch }).toHex());
  }

  function handleOk() {
    onCommit(localHex);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Color Picker" size="lg" footer={
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => addSwatch?.(localHex)}
          disabled={!addSwatch}
          className="h-8 px-3 rounded-control text-ui font-medium border border-hairline bg-ink/5 text-ink hover:bg-ink/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add to Swatches
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
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
      </div>
    }>
      <div className="flex gap-4">
        <div className="flex gap-2">
          <SvSquare hue={hsv.h} sat={hsv.s} val={hsv.v} onPick={(s, v) => setFromHsv({ s, v })} size={SV_SIZE} />
          <div className="relative shrink-0" style={{ width: 24, height: SV_SIZE }}>
            <input
              type="range"
              min={0}
              max={360}
              value={hsv.h}
              onChange={(e) => setFromHsv({ h: Number(e.target.value) })}
              className="absolute accent-[var(--color-accent)]"
              style={{
                width: SV_SIZE,
                height: 20,
                top: (SV_SIZE - 20) / 2,
                left: -(SV_SIZE - 20) / 2,
                transform: 'rotate(-90deg)',
                background: 'linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)',
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-micro text-ink-faint">New</span>
              <div className="w-14 h-8 rounded-control border border-hairline" style={{ background: localHex }} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-micro text-ink-faint">Current</span>
              <button
                type="button"
                aria-label="Revert to current color"
                onClick={() => setLocalHex(initialHex)}
                className="w-14 h-8 rounded-control border border-hairline"
                style={{ background: initialHex }}
              />
            </div>
            <span className="text-micro text-ink-faint self-end pb-1.5">Editing {target === 'fg' ? 'Foreground' : 'Background'}</span>
          </div>

          <div className="flex items-center gap-3 text-micro text-ink-faint">
            {(['hsb', 'rgb', 'lab', 'cmyk'] as const).map(m => (
              <label key={m} className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="picker-mode" checked={mode === m} onChange={() => setMode(m)} className="accent-[var(--color-accent)]" />
                <span>{m === 'hsb' ? 'H/S/B' : m === 'rgb' ? 'R/G/B' : m === 'lab' ? 'L/a/b' : 'C/M/Y/K'}</span>
              </label>
            ))}
          </div>

          {mode === 'hsb' && (
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="H" value={hsv.h} min={0} max={360} onChange={(v) => setFromHsv({ h: v })} />
              <NumberField label="S" value={hsv.s} min={0} max={100} onChange={(v) => setFromHsv({ s: v })} />
              <NumberField label="B" value={hsv.v} min={0} max={100} onChange={(v) => setFromHsv({ v })} />
            </div>
          )}
          {mode === 'rgb' && (
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="R" value={rgb.r} min={0} max={255} onChange={(v) => setFromRgb({ r: v })} />
              <NumberField label="G" value={rgb.g} min={0} max={255} onChange={(v) => setFromRgb({ g: v })} />
              <NumberField label="B" value={rgb.b} min={0} max={255} onChange={(v) => setFromRgb({ b: v })} />
            </div>
          )}
          {mode === 'lab' && (
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="L" value={lab.l} min={0} max={100} onChange={(v) => setFromLab({ l: v })} />
              <NumberField label="a" value={lab.a} min={-128} max={127} onChange={(v) => setFromLab({ a: v })} />
              <NumberField label="b" value={lab.b} min={-128} max={127} onChange={(v) => setFromLab({ b: v })} />
            </div>
          )}
          {mode === 'cmyk' && (
            <div className="grid grid-cols-4 gap-2">
              <NumberField label="C" value={cmyk.c} min={0} max={100} onChange={(v) => setFromCmyk({ c: v })} />
              <NumberField label="M" value={cmyk.m} min={0} max={100} onChange={(v) => setFromCmyk({ m: v })} />
              <NumberField label="Y" value={cmyk.y} min={0} max={100} onChange={(v) => setFromCmyk({ y: v })} />
              <NumberField label="K" value={cmyk.k} min={0} max={100} onChange={(v) => setFromCmyk({ k: v })} />
            </div>
          )}

          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <span className="w-8 shrink-0">Hex</span>
            <Input
              value={localHex}
              onChange={(e) => /^#?[0-9a-fA-F]{6}$/.test(e.target.value) && setLocalHex(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)}
              className="!px-2 !py-1 !text-ui font-mono"
            />
          </label>

          <label className="flex items-center gap-2 text-ui text-ink">
            <input
              type="checkbox"
              checked={webSafeOnly}
              onChange={(e) => {
                setWebSafeOnly(e.target.checked);
                if (e.target.checked) applyRgb(rgb);
              }}
              className="accent-[var(--color-accent)]"
            />
            <span>Only Web Colors</span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-micro text-ink-faint">
      <span>{label}</span>
      <Input type="number" min={min} max={max} value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))} className="!px-2 !py-1 !text-ui" />
    </label>
  );
}
