import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, RotateCcw, ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { colord, extend } from 'colord';
import cmykPlugin from 'colord/plugins/cmyk';
import labPlugin from 'colord/plugins/lab';
import { IconButton, Input } from '../../ui';
import { swal, swalToast } from '../../../lib/swalTheme';
import { StudioPanel } from '../StudioPanel';
import { Menu } from '../menu/Menu';
import type { MenuItemDef } from '../menu/menuDefinitions';
import { useColor } from './ColorContext';
import { SvSquare } from './SvSquare';
import { ColorPickerModal } from './ColorPickerModal';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './colorConversions';

extend([cmykPlugin, labPlugin]);

const SV_SIZE = 160;
const WEB_SAFE_STEPS = [0, 51, 102, 153, 204, 255];
function snapWebSafe(v: number): number {
  return WEB_SAFE_STEPS.reduce((closest, step) => (Math.abs(step - v) < Math.abs(closest - v) ? step : closest));
}

type ColorViewMode =
  | 'wheel' | 'hueCube' | 'brightnessCube'
  | 'rgbSliders' | 'hsbSliders' | 'cmykSliders' | 'labSliders' | 'webSliders' | 'grayscaleSlider'
  | 'rgbSpectrum' | 'cmykSpectrum' | 'grayscaleRamp' | 'currentColors';

const VIEW_MODE_LABEL: Record<ColorViewMode, string> = {
  wheel: 'Color Wheel', hueCube: 'Hue Cube', brightnessCube: 'Brightness Cube',
  rgbSliders: 'RGB Sliders', hsbSliders: 'HSB Sliders', cmykSliders: 'CMYK Sliders',
  labSliders: 'Lab Sliders', webSliders: 'Web Color Sliders', grayscaleSlider: 'Grayscale Slider',
  rgbSpectrum: 'RGB Spectrum', cmykSpectrum: 'CMYK Spectrum', grayscaleRamp: 'Grayscale Ramp',
  currentColors: 'Current Colors',
};

interface ColorPanelProps {
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name
   *  and owns the collapse chevron (CollapsiblePanel) — this used to render its own chevron here. */
  hideTitle?: boolean;
}

/** One labeled slider + number input row, reused across every *Sliders view mode so each mode is
 *  just "which channels, which ranges, which track gradient" rather than repeated markup. */
function ColorSlider({ label, value, min, max, background, onChange }: {
  label: string; value: number; min: number; max: number; background: string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint">
      <span className="w-4 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--color-accent)]"
        style={{ background }}
      />
      <Input
        type="number" min={min} max={max} value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="!w-14 !px-1.5 !py-1 !text-ui shrink-0"
      />
    </label>
  );
}

/** A wide clickable gradient bar — backs Grayscale Ramp / RGB Spectrum / CMYK Spectrum. `webSafe`
 *  re-renders it as 6 hard-edged web-safe bands instead of a smooth ramp (Window menu's "Make
 *  Ramp Web Safe"), and picks snap to those same bands rather than the continuous color under t. */
function GradientRamp({ colorAt, webSafe, onPick }: {
  colorAt: (t: number) => { r: number; g: number; b: number };
  webSafe: boolean;
  onPick: (t: number) => void;
}) {
  function css(): string {
    if (!webSafe) {
      const steps = 12;
      const stops = Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        return `${rgbToHex(colorAt(t))} ${Math.round(t * 100)}%`;
      });
      return `linear-gradient(to right, ${stops.join(', ')})`;
    }
    const bands = 6;
    const parts: string[] = [];
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const c = colorAt(t);
      const hex = rgbToHex({ r: snapWebSafe(c.r), g: snapWebSafe(c.g), b: snapWebSafe(c.b) });
      parts.push(`${hex} ${(i / bands) * 100}%`, `${hex} ${((i + 1) / bands) * 100}%`);
    }
    return `linear-gradient(to right, ${parts.join(', ')})`;
  }
  function handlePick(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    onPick(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }
  return (
    <div
      className="w-full h-7 rounded-control border border-hairline cursor-crosshair"
      style={{ background: css() }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePick(e); }}
      onPointerMove={(e) => { if (e.buttons === 1) handlePick(e); }}
    />
  );
}

export function ColorPanel({ hideTitle }: ColorPanelProps = {}) {
  const {
    foreground, background, recent, setForeground, setBackground, swap, reset,
    palettes, activePaletteId, setActivePaletteId, createPalette, deletePalette, addSwatch, removeSwatch,
  } = useColor();
  const [active, setActive] = useState<'fg' | 'bg'>('fg');
  const activeColor = active === 'fg' ? foreground : background;
  const setActiveColor = active === 'fg' ? setForeground : setBackground;

  // Presentation-only and not persisted — the task doesn't require the chosen view to survive a
  // reload, so this stays local rather than widening ColorContext's surface for it.
  const [viewMode, setViewMode] = useState<ColorViewMode>('wheel');
  const [webSafeRamp, setWebSafeRamp] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<'fg' | 'bg'>('fg');

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuWrapperRef.current && !menuWrapperRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const hsv = rgbToHsv(hexToRgb(activeColor));
  const rgb = hexToRgb(activeColor);
  const c = colord(activeColor);
  const cmyk = c.toCmyk();
  const lab = c.toLab();
  // Photoshop's Grayscale Slider convention: 0% = white, 100% = black (a "K" percentage, not raw
  // brightness) — derived from the average channel value, not stored separately.
  const grayPercent = 100 - Math.round(((rgb.r + rgb.g + rgb.b) / 3 / 255) * 100);

  function setFromHsv(patch: Partial<{ h: number; s: number; v: number }>) {
    setActiveColor(rgbToHex(hsvToRgb({ ...hsv, ...patch })));
  }
  function setFromRgb(patch: Partial<{ r: number; g: number; b: number }>, webSnap = false) {
    const next = { ...rgb, ...patch };
    const final = webSnap ? { r: snapWebSafe(next.r), g: snapWebSafe(next.g), b: snapWebSafe(next.b) } : next;
    setActiveColor(rgbToHex(final));
  }
  function setFromCmyk(patch: Partial<{ c: number; m: number; y: number; k: number }>) {
    setActiveColor(colord({ ...cmyk, ...patch }).toHex());
  }
  function setFromLab(patch: Partial<{ l: number; a: number; b: number }>) {
    setActiveColor(colord({ ...lab, ...patch }).toHex());
  }
  function setFromGrayPercent(percent: number) {
    const v = Math.round((100 - percent) * 2.55);
    setActiveColor(rgbToHex({ r: v, g: v, b: v }));
  }

  const activePalette = palettes.find(p => p.id === activePaletteId) ?? null;

  async function handleNewPalette() {
    const result = await swal({ title: 'New Palette', input: 'text', inputLabel: 'Palette name', showCancelButton: true, confirmButtonText: 'Create' });
    const name = (result.value || '').trim();
    if (result.isConfirmed && name) createPalette(name);
  }

  async function handleDeletePalette() {
    if (!activePalette) return;
    const result = await swal({ icon: 'warning', title: `Delete "${activePalette.name}"?`, showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (result.isConfirmed) deletePalette(activePalette.id);
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      swalToast({ icon: 'success', title: `${label} copied` });
    } catch {
      swalToast({ icon: 'error', title: 'Could not copy to clipboard' });
    }
  }

  function openPicker(target: 'fg' | 'bg') {
    setPickerTarget(target);
    setPickerOpen(true);
  }

  const isWheelMode = viewMode === 'wheel' || viewMode === 'hueCube' || viewMode === 'brightnessCube';
  const isRampMode = viewMode === 'rgbSpectrum' || viewMode === 'cmykSpectrum' || viewMode === 'grayscaleRamp';

  function menuItem(mode: ColorViewMode): MenuItemDef {
    return { id: mode, label: VIEW_MODE_LABEL[mode], checked: viewMode === mode, action: () => setViewMode(mode) };
  }

  // Matches Photoshop's own Color panel menu order exactly (see CLAUDE.md's task spec) — Hue/
  // Brightness Cube intentionally render identically to Color Wheel (see isWheelMode above); a true
  // cube-projection UI is out of scope for what this app's manga-typesetting workflow needs.
  const menuItems: MenuItemDef[] = [
    menuItem('hueCube'), menuItem('brightnessCube'), menuItem('wheel'), menuItem('grayscaleSlider'),
    menuItem('rgbSliders'), menuItem('hsbSliders'), menuItem('cmykSliders'), menuItem('labSliders'), menuItem('webSliders'),
    { id: 'sep1', label: '', separator: true },
    { id: 'copyHtml', label: 'Copy Color as HTML', action: () => copyToClipboard(`color: ${activeColor}`, 'CSS color') },
    { id: 'copyHex', label: "Copy Color's Hex Code", action: () => copyToClipboard(activeColor, 'Hex code') },
    { id: 'sep2', label: '', separator: true },
    menuItem('rgbSpectrum'), menuItem('cmykSpectrum'), menuItem('grayscaleRamp'), menuItem('currentColors'),
    { id: 'sep3', label: '', separator: true },
    {
      id: 'websafe', label: 'Make Ramp Web Safe', checked: webSafeRamp, disabled: !isRampMode,
      action: () => setWebSafeRamp(v => !v),
    },
  ];

  return (
    <StudioPanel
      title="Color"
      hideTitle={hideTitle}
      actions={
        <div className="flex items-center gap-1">
          <div ref={menuWrapperRef} className="relative">
            <IconButton size="sm" aria-label="Color panel menu" title="View options" onClick={() => setMenuOpen(v => !v)} className="!bg-transparent">
              <MoreHorizontal size={13} />
            </IconButton>
            {menuOpen && <Menu items={menuItems} onItemClick={(action) => { action?.(); setMenuOpen(false); }} />}
          </div>
          <IconButton size="sm" aria-label="Reset colors" title="Reset to black/white" onClick={reset} className="!bg-transparent">
            <RotateCcw size={13} />
          </IconButton>
        </div>
      }
    >
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 shrink-0">
            <button
              aria-label="Background color"
              title="Click to edit, double-click for full picker"
              onClick={() => setActive('bg')}
              onDoubleClick={() => openPicker('bg')}
              className="absolute right-0 bottom-0 w-8 h-8 rounded-control border-2 shadow-sm"
              style={{ background, borderColor: active === 'bg' ? 'var(--color-accent)' : 'var(--color-hairline)' }}
            />
            <button
              aria-label="Foreground color"
              title="Click to edit, double-click for full picker"
              onClick={() => setActive('fg')}
              onDoubleClick={() => openPicker('fg')}
              className="absolute left-0 top-0 w-8 h-8 rounded-control border-2 shadow-sm"
              style={{ background: foreground, borderColor: active === 'fg' ? 'var(--color-accent)' : 'var(--color-hairline)' }}
            />
          </div>
          <IconButton size="sm" aria-label="Swap foreground/background" onClick={swap} className="!bg-transparent">
            <ArrowLeftRight size={14} />
          </IconButton>
          <span className="text-micro text-ink-faint">Editing {active === 'fg' ? 'Foreground' : 'Background'}</span>
        </div>

        {isWheelMode && (
          <>
            <SvSquare hue={hsv.h} sat={hsv.s} val={hsv.v} onPick={(s, v) => setFromHsv({ s, v })} size={SV_SIZE} />
            <input
              type="range" min={0} max={360} value={hsv.h}
              onChange={(e) => setFromHsv({ h: Number(e.target.value) })}
              className="w-full accent-[var(--color-accent)]"
              style={{ background: 'linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)' }}
            />
          </>
        )}

        {viewMode === 'grayscaleSlider' && (
          <ColorSlider label="K" value={grayPercent} min={0} max={100} onChange={setFromGrayPercent}
            background="linear-gradient(to right, #ffffff, #000000)" />
        )}

        {viewMode === 'rgbSliders' && (
          <div className="flex flex-col gap-2">
            <ColorSlider label="R" value={rgb.r} min={0} max={255} onChange={(v) => setFromRgb({ r: v })}
              background={`linear-gradient(to right, ${rgbToHex({ ...rgb, r: 0 })}, ${rgbToHex({ ...rgb, r: 255 })})`} />
            <ColorSlider label="G" value={rgb.g} min={0} max={255} onChange={(v) => setFromRgb({ g: v })}
              background={`linear-gradient(to right, ${rgbToHex({ ...rgb, g: 0 })}, ${rgbToHex({ ...rgb, g: 255 })})`} />
            <ColorSlider label="B" value={rgb.b} min={0} max={255} onChange={(v) => setFromRgb({ b: v })}
              background={`linear-gradient(to right, ${rgbToHex({ ...rgb, b: 0 })}, ${rgbToHex({ ...rgb, b: 255 })})`} />
          </div>
        )}

        {viewMode === 'webSliders' && (
          <div className="flex flex-col gap-2">
            <ColorSlider label="R" value={rgb.r} min={0} max={255} onChange={(v) => setFromRgb({ r: v }, true)}
              background={`linear-gradient(to right, ${rgbToHex({ ...rgb, r: 0 })}, ${rgbToHex({ ...rgb, r: 255 })})`} />
            <ColorSlider label="G" value={rgb.g} min={0} max={255} onChange={(v) => setFromRgb({ g: v }, true)}
              background={`linear-gradient(to right, ${rgbToHex({ ...rgb, g: 0 })}, ${rgbToHex({ ...rgb, g: 255 })})`} />
            <ColorSlider label="B" value={rgb.b} min={0} max={255} onChange={(v) => setFromRgb({ b: v }, true)}
              background={`linear-gradient(to right, ${rgbToHex({ ...rgb, b: 0 })}, ${rgbToHex({ ...rgb, b: 255 })})`} />
            <p className="text-micro text-ink-faint">Values snap to the nearest web-safe step.</p>
          </div>
        )}

        {viewMode === 'hsbSliders' && (
          <div className="flex flex-col gap-2">
            <ColorSlider label="H" value={hsv.h} min={0} max={360} onChange={(v) => setFromHsv({ h: v })}
              background="linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)" />
            <ColorSlider label="S" value={hsv.s} min={0} max={100} onChange={(v) => setFromHsv({ s: v })}
              background={`linear-gradient(to right, ${rgbToHex(hsvToRgb({ h: hsv.h, s: 0, v: hsv.v }))}, ${rgbToHex(hsvToRgb({ h: hsv.h, s: 100, v: hsv.v }))})`} />
            <ColorSlider label="B" value={hsv.v} min={0} max={100} onChange={(v) => setFromHsv({ v })}
              background={`linear-gradient(to right, ${rgbToHex(hsvToRgb({ h: hsv.h, s: hsv.s, v: 0 }))}, ${rgbToHex(hsvToRgb({ h: hsv.h, s: hsv.s, v: 100 }))})`} />
          </div>
        )}

        {viewMode === 'cmykSliders' && (
          <div className="flex flex-col gap-2">
            <ColorSlider label="C" value={cmyk.c} min={0} max={100} onChange={(v) => setFromCmyk({ c: v })}
              background={`linear-gradient(to right, ${colord({ ...cmyk, c: 0 }).toHex()}, ${colord({ ...cmyk, c: 100 }).toHex()})`} />
            <ColorSlider label="M" value={cmyk.m} min={0} max={100} onChange={(v) => setFromCmyk({ m: v })}
              background={`linear-gradient(to right, ${colord({ ...cmyk, m: 0 }).toHex()}, ${colord({ ...cmyk, m: 100 }).toHex()})`} />
            <ColorSlider label="Y" value={cmyk.y} min={0} max={100} onChange={(v) => setFromCmyk({ y: v })}
              background={`linear-gradient(to right, ${colord({ ...cmyk, y: 0 }).toHex()}, ${colord({ ...cmyk, y: 100 }).toHex()})`} />
            <ColorSlider label="K" value={cmyk.k} min={0} max={100} onChange={(v) => setFromCmyk({ k: v })}
              background={`linear-gradient(to right, ${colord({ ...cmyk, k: 0 }).toHex()}, ${colord({ ...cmyk, k: 100 }).toHex()})`} />
          </div>
        )}

        {viewMode === 'labSliders' && (
          <div className="flex flex-col gap-2">
            <ColorSlider label="L" value={lab.l} min={0} max={100} onChange={(v) => setFromLab({ l: v })}
              background={`linear-gradient(to right, ${colord({ ...lab, l: 0 }).toHex()}, ${colord({ ...lab, l: 100 }).toHex()})`} />
            <ColorSlider label="a" value={lab.a} min={-128} max={127} onChange={(v) => setFromLab({ a: v })}
              background={`linear-gradient(to right, ${colord({ ...lab, a: -128 }).toHex()}, ${colord({ ...lab, a: 127 }).toHex()})`} />
            <ColorSlider label="b" value={lab.b} min={-128} max={127} onChange={(v) => setFromLab({ b: v })}
              background={`linear-gradient(to right, ${colord({ ...lab, b: -128 }).toHex()}, ${colord({ ...lab, b: 127 }).toHex()})`} />
          </div>
        )}

        {viewMode === 'grayscaleRamp' && (
          <GradientRamp
            webSafe={webSafeRamp}
            colorAt={(t) => { const v = Math.round((1 - t) * 255); return { r: v, g: v, b: v }; }}
            onPick={(t) => setFromGrayPercent(Math.round(t * 100))}
          />
        )}

        {viewMode === 'rgbSpectrum' && (
          <GradientRamp
            webSafe={webSafeRamp}
            colorAt={(t) => hsvToRgb({ h: t * 360, s: hsv.s || 100, v: hsv.v || 100 })}
            onPick={(t) => setFromHsv({ h: t * 360, s: hsv.s || 100, v: hsv.v || 100 })}
          />
        )}

        {viewMode === 'cmykSpectrum' && (
          <GradientRamp
            webSafe={webSafeRamp}
            colorAt={(t) => {
              // A "print-simulated" spectrum: full-saturation hues run through the CMYK round-trip
              // (K pinned to 0) rather than a genuine 4-channel spectrum control, which Photoshop
              // itself doesn't render as a single 2D picker either.
              const full = hsvToRgb({ h: t * 360, s: 100, v: 100 });
              const sim = colord(full).toCmyk();
              return hexToRgb(colord({ ...sim, k: 0 }).toHex());
            }}
            onPick={(t) => setFromHsv({ h: t * 360, s: hsv.s || 100, v: hsv.v || 100 })}
          />
        )}

        {viewMode === 'currentColors' && (
          <div className="flex flex-wrap gap-2">
            {recent.length === 0 && <p className="text-micro text-ink-faint">No recent colors yet.</p>}
            {recent.map((rc, i) => (
              <button
                key={`${rc}-${i}`}
                aria-label={`Recent color ${rc}`}
                onClick={() => setActiveColor(rc)}
                className="w-9 h-9 rounded-control border border-hairline"
                style={{ background: rc }}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-micro text-ink-faint flex-1 min-w-0">
            <span className="w-8 shrink-0">Hex</span>
            <Input
              value={activeColor}
              onChange={(e) => /^#?[0-9a-fA-F]{6}$/.test(e.target.value) && setActiveColor(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)}
              className="!px-2 !py-1 !text-ui font-mono"
            />
          </label>
          <IconButton
            size="sm"
            aria-label="Add to swatches"
            title="Add current color to the active palette"
            onClick={() => activePaletteId && addSwatch(activePaletteId, activeColor)}
            disabled={!activePaletteId}
            className="!bg-transparent shrink-0"
          >
            <Plus size={14} />
          </IconButton>
        </div>

        {recent.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-micro text-ink-faint">Recent</span>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((rc, i) => (
                <button
                  key={`${rc}-${i}`}
                  aria-label={`Recent color ${rc}`}
                  onClick={() => setActiveColor(rc)}
                  className="w-6 h-6 rounded-control border border-hairline"
                  style={{ background: rc }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5 pt-2 border-t border-hairline/60">
          <div className="flex items-center justify-between gap-2">
            <select
              value={activePaletteId ?? ''}
              onChange={(e) => setActivePaletteId(e.target.value || null)}
              className="flex-1 min-w-0 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
            >
              <option value="" disabled>{palettes.length === 0 ? 'No palettes yet' : 'Select a palette'}</option>
              {palettes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <IconButton size="sm" aria-label="New palette" title="New palette" onClick={handleNewPalette} className="!bg-transparent !w-6 !h-6">
              <Plus size={13} />
            </IconButton>
            {activePalette && (
              <IconButton size="sm" aria-label="Delete palette" title="Delete palette" onClick={handleDeletePalette} className="!bg-transparent !w-6 !h-6 hover:!text-danger">
                <Trash2 size={12} />
              </IconButton>
            )}
          </div>

          {activePalette && (
            <div className="flex flex-wrap gap-1.5">
              {activePalette.colors.map(c2 => (
                <button
                  key={c2}
                  aria-label={`Palette color ${c2}`}
                  title="Click to apply, right-click to remove"
                  onClick={() => setActiveColor(c2)}
                  onContextMenu={(e) => { e.preventDefault(); removeSwatch(activePalette.id, c2); }}
                  className="w-6 h-6 rounded-control border border-hairline"
                  style={{ background: c2 }}
                />
              ))}
              <IconButton
                size="sm"
                aria-label="Save current color to palette"
                title="Save current color to palette"
                onClick={() => addSwatch(activePalette.id, activeColor)}
                className="!bg-transparent !w-6 !h-6 !border !border-dashed !border-hairline"
              >
                <Plus size={13} />
              </IconButton>
            </div>
          )}
        </div>

        <ColorPickerModal
          open={pickerOpen}
          target={pickerTarget}
          initialHex={pickerTarget === 'fg' ? foreground : background}
          onCommit={pickerTarget === 'fg' ? setForeground : setBackground}
          onClose={() => setPickerOpen(false)}
          addSwatch={activePaletteId ? (hex) => addSwatch(activePaletteId, hex) : undefined}
        />
    </StudioPanel>
  );
}
