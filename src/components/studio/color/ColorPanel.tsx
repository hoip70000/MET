import { useEffect, useRef, useState } from 'react';
import { RotateCcw, ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { colord, extend } from 'colord';
import cmykPlugin from 'colord/plugins/cmyk';
import { IconButton, Input } from '../../ui';
import { swal } from '../../../lib/swalTheme';
import { StudioPanel } from '../StudioPanel';
import { useColor } from './ColorContext';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './colorConversions';

extend([cmykPlugin]);

const SV_SIZE = 160;

interface ColorPanelProps {
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name
   *  and owns the collapse chevron (CollapsiblePanel) — this used to render its own chevron here. */
  hideTitle?: boolean;
}

export function ColorPanel({ hideTitle }: ColorPanelProps = {}) {
  const {
    foreground, background, recent, setForeground, setBackground, swap, reset,
    palettes, activePaletteId, setActivePaletteId, createPalette, deletePalette, addSwatch, removeSwatch,
  } = useColor();
  const [active, setActive] = useState<'fg' | 'bg'>('fg');
  const activeColor = active === 'fg' ? foreground : background;
  const setActiveColor = active === 'fg' ? setForeground : setBackground;

  const hsv = rgbToHsv(hexToRgb(activeColor));
  const svCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { r, g, b } = hsvToRgb({ h: hsv.h, s: 100, v: 100 });
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, SV_SIZE, SV_SIZE);
    const whiteGrad = ctx.createLinearGradient(0, 0, SV_SIZE, 0);
    whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, SV_SIZE, SV_SIZE);
    const blackGrad = ctx.createLinearGradient(0, 0, 0, SV_SIZE);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, SV_SIZE, SV_SIZE);
  }, [hsv.h]);

  function handleSvPick(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100;
    const v = 100 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) * 100;
    const { r, g, b } = hsvToRgb({ h: hsv.h, s, v });
    setActiveColor(rgbToHex({ r, g, b }));
  }

  function handleHuePick(e: React.ChangeEvent<HTMLInputElement>) {
    const h = Number(e.target.value);
    const { r, g, b } = hsvToRgb({ h, s: hsv.s, v: hsv.v });
    setActiveColor(rgbToHex({ r, g, b }));
  }

  const rgb = hexToRgb(activeColor);
  const c = colord(activeColor);
  const hsl = c.toHsl();
  const cmyk = c.toCmyk();

  function setFromHsl(patch: Partial<{ h: number; s: number; l: number }>) {
    setActiveColor(colord({ ...hsl, ...patch }).toHex());
  }
  function setFromCmyk(patch: Partial<{ c: number; m: number; y: number; k: number }>) {
    setActiveColor(colord({ ...cmyk, ...patch }).toHex());
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

  return (
    <StudioPanel
      title="Color"
      hideTitle={hideTitle}
      actions={
        <IconButton size="sm" aria-label="Reset colors" title="Reset to black/white" onClick={reset} className="!bg-transparent">
          <RotateCcw size={13} />
        </IconButton>
      }
    >
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 shrink-0">
            <button
              aria-label="Background color"
              onClick={() => setActive('bg')}
              className="absolute right-0 bottom-0 w-8 h-8 rounded-control border-2 shadow-sm"
              style={{ background, borderColor: active === 'bg' ? 'var(--color-accent)' : 'var(--color-hairline)' }}
            />
            <button
              aria-label="Foreground color"
              onClick={() => setActive('fg')}
              className="absolute left-0 top-0 w-8 h-8 rounded-control border-2 shadow-sm"
              style={{ background: foreground, borderColor: active === 'fg' ? 'var(--color-accent)' : 'var(--color-hairline)' }}
            />
          </div>
          <IconButton size="sm" aria-label="Swap foreground/background" onClick={swap} className="!bg-transparent">
            <ArrowLeftRight size={14} />
          </IconButton>
          <span className="text-micro text-ink-faint">Editing {active === 'fg' ? 'Foreground' : 'Background'}</span>
        </div>

        <canvas
          ref={svCanvasRef}
          width={SV_SIZE}
          height={SV_SIZE}
          className="w-full rounded-control border border-hairline cursor-crosshair"
          style={{ aspectRatio: '1 / 1' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleSvPick(e); }}
          onPointerMove={(e) => { if (e.buttons === 1) handleSvPick(e); }}
        />

        <input
          type="range"
          min={0}
          max={360}
          value={hsv.h}
          onChange={handleHuePick}
          className="w-full accent-[var(--color-accent)]"
          style={{ background: 'linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)' }}
        />

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-micro text-ink-faint">
            <span>R</span>
            <Input type="number" min={0} max={255} value={Math.round(rgb.r)} onChange={(e) => setActiveColor(rgbToHex({ ...rgb, r: Number(e.target.value) }))} className="!px-2 !py-1 !text-ui" />
          </label>
          <label className="flex flex-col gap-1 text-micro text-ink-faint">
            <span>G</span>
            <Input type="number" min={0} max={255} value={Math.round(rgb.g)} onChange={(e) => setActiveColor(rgbToHex({ ...rgb, g: Number(e.target.value) }))} className="!px-2 !py-1 !text-ui" />
          </label>
          <label className="flex flex-col gap-1 text-micro text-ink-faint">
            <span>B</span>
            <Input type="number" min={0} max={255} value={Math.round(rgb.b)} onChange={(e) => setActiveColor(rgbToHex({ ...rgb, b: Number(e.target.value) }))} className="!px-2 !py-1 !text-ui" />
          </label>
        </div>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-8 shrink-0">Hex</span>
          <Input value={activeColor} onChange={(e) => /^#?[0-9a-fA-F]{6}$/.test(e.target.value) && setActiveColor(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)} className="!px-2 !py-1 !text-ui font-mono" />
        </label>

        <div className="pt-1 border-t border-hairline/60">
          <span className="text-micro text-ink-faint">HSL</span>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>H</span>
              <Input type="number" min={0} max={360} value={Math.round(hsl.h)} onChange={(e) => setFromHsl({ h: Number(e.target.value) })} className="!px-2 !py-1 !text-ui" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>S</span>
              <Input type="number" min={0} max={100} value={Math.round(hsl.s)} onChange={(e) => setFromHsl({ s: Number(e.target.value) })} className="!px-2 !py-1 !text-ui" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>L</span>
              <Input type="number" min={0} max={100} value={Math.round(hsl.l)} onChange={(e) => setFromHsl({ l: Number(e.target.value) })} className="!px-2 !py-1 !text-ui" />
            </label>
          </div>
        </div>

        <div>
          <span className="text-micro text-ink-faint">CMYK</span>
          <div className="grid grid-cols-4 gap-2 mt-1">
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>C</span>
              <Input type="number" min={0} max={100} value={Math.round(cmyk.c)} onChange={(e) => setFromCmyk({ c: Number(e.target.value) })} className="!px-2 !py-1 !text-ui" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>M</span>
              <Input type="number" min={0} max={100} value={Math.round(cmyk.m)} onChange={(e) => setFromCmyk({ m: Number(e.target.value) })} className="!px-2 !py-1 !text-ui" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Y</span>
              <Input type="number" min={0} max={100} value={Math.round(cmyk.y)} onChange={(e) => setFromCmyk({ y: Number(e.target.value) })} className="!px-2 !py-1 !text-ui" />
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>K</span>
              <Input type="number" min={0} max={100} value={Math.round(cmyk.k)} onChange={(e) => setFromCmyk({ k: Number(e.target.value) })} className="!px-2 !py-1 !text-ui" />
            </label>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-micro text-ink-faint">Recent</span>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((c, i) => (
                <button
                  key={`${c}-${i}`}
                  aria-label={`Recent color ${c}`}
                  onClick={() => setActiveColor(c)}
                  className="w-6 h-6 rounded-control border border-hairline"
                  style={{ background: c }}
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
              {activePalette.colors.map(c => (
                <button
                  key={c}
                  aria-label={`Palette color ${c}`}
                  title="Click to apply, right-click to remove"
                  onClick={() => setActiveColor(c)}
                  onContextMenu={(e) => { e.preventDefault(); removeSwatch(activePalette.id, c); }}
                  className="w-6 h-6 rounded-control border border-hairline"
                  style={{ background: c }}
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
    </StudioPanel>
  );
}
