import { useEffect, useState } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, Italic, AlignCenterHorizontal, MoreHorizontal, Plus, ChevronRight } from 'lucide-react';
import { IconButton, Textarea } from '../ui';
import { cn } from '../ui/cn';
import { StudioPanel } from './StudioPanel';
import { swal, swalToast } from '../../lib/swalTheme';
import { genId } from '../../lib/id';
import {
  loadTextStyles, saveTextStyles, captureStyleFields, styleToPatch,
  type TextStyle, type TextStyleKind,
} from '../../lib/textStyleStore';
import { FONT_FAMILIES, DEFAULT_TEXT_SHADOW, DEFAULT_TEXT_GRADIENT, type StudioLayer, type TextAlign, type TextLayerData, type LineStyleOverride } from './studioTypes';
import { applyCharPatch, resolveCharValue, type ResolvedRunStyle, type RunStylePatch } from './textRuns';
import type { TextSelection } from './StudioCanvas';

interface TextPanelProps {
  layer: StudioLayer;
  onUpdate: (id: string, patch: Partial<TextLayerData>) => void;
  onCenter: (id: string) => void;
  /** Built-in fonts plus any custom fonts installed via the Fonts panel. */
  fontFamilies?: string[];
  /** Character range selected on canvas, when this layer is being edited. */
  selection?: TextSelection | null;
  /** Wrapped-line index selected on canvas (click a line while the layer is selected, not editing). */
  selectedLineIndex?: number | null;
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name. */
  hideTitle?: boolean;
}

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export function TextPanel({ layer, onUpdate, onCenter, fontFamilies = FONT_FAMILIES, selection = null, selectedLineIndex = null, hideTitle }: TextPanelProps) {
  const [styles, setStyles] = useState<TextStyle[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<TextStyleKind, boolean>>({ character: true, paragraph: false });

  useEffect(() => { loadTextStyles().then(setStyles); }, []);

  const text = layer.text;

  const persistStyles = (next: TextStyle[]) => {
    setStyles(next);
    void saveTextStyles(next);
  };

  async function handleNewStyle(kind: TextStyleKind) {
    if (!text) return;
    const r = await swal({
      title: `New ${kind} style`,
      input: 'text',
      inputPlaceholder: kind === 'character' ? 'e.g. SFX Bold' : 'e.g. Centered Tight',
      showCancelButton: true,
      confirmButtonText: 'Create',
    });
    const name = (r.value || '').trim();
    if (!r.isConfirmed || !name) return;
    persistStyles([...styles, { id: genId('tstyle'), name, kind, fields: captureStyleFields(text, kind) }]);
  }

  async function handleStyleMenu(style: TextStyle) {
    const result = await swal({
      title: style.name,
      input: 'select',
      inputOptions: { update: 'Update from this layer', rename: 'Rename…', delete: 'Delete' },
      inputPlaceholder: 'Choose an action',
      showCancelButton: true,
      confirmButtonText: 'Go',
    });
    const action = result.value as string | undefined;
    if (!result.isConfirmed || !action) return;

    if (action === 'update') {
      if (!text) return;
      persistStyles(styles.map(s => s.id === style.id ? { ...s, fields: captureStyleFields(text, s.kind) } : s));
      swalToast({ icon: 'success', title: `“${style.name}” updated` });
      return;
    }
    if (action === 'delete') {
      persistStyles(styles.filter(s => s.id !== style.id));
      return;
    }
    if (action === 'rename') {
      const r = await swal({ title: 'Rename style', input: 'text', inputValue: style.name, showCancelButton: true, confirmButtonText: 'Rename' });
      const name = (r.value || '').trim();
      if (r.isConfirmed && name) persistStyles(styles.map(s => s.id === style.id ? { ...s, name } : s));
    }
  }

  if (!text) return null;

  const set = (patch: Partial<TextLayerData>) => onUpdate(layer.id, patch);

  const range = selection && selection.end > selection.start ? selection : null;

  // What the character controls should display: the value shared across the selection, falling back
  // to the run at its start when the range is mixed (showing the layer default there would claim a
  // value the selection doesn't actually have).
  const charValue = <K extends keyof ResolvedRunStyle>(key: K): ResolvedRunStyle[K] => resolveCharValue(text, range, key);

  /**
   * Applies a character property. With a range selected it writes run overrides for just that
   * range; with no range it applies to the whole layer — which is what Photoshop's Character panel
   * does when the layer rather than a range is selected. Shared with the Text menu's actions
   * (Studio.tsx) via `applyCharPatch` so the two can't drift.
   */
  const setChar = (patch: RunStylePatch) => set(applyCharPatch(text, range, patch));

  // A selected line's controls show its own override where set, falling back to the layer default
  // — not a resolved per-run style, since a line can span several differently-styled runs and there's
  // no single "shared" value to show the way character range controls do (styleOverRange exists
  // exactly to solve that for runs; lines don't need it, since an override here always wins outright).
  const lineOverride: LineStyleOverride | undefined = selectedLineIndex != null ? text.lineOverrides?.[selectedLineIndex] : undefined;
  const lineValue = <K extends keyof LineStyleOverride>(key: K, fallback: NonNullable<LineStyleOverride[K]>): NonNullable<LineStyleOverride[K]> =>
    (lineOverride?.[key] ?? fallback) as NonNullable<LineStyleOverride[K]>;
  const setLine = (patch: Partial<LineStyleOverride>) => {
    if (selectedLineIndex == null) return;
    const merged: LineStyleOverride = { ...lineOverride, ...patch };
    for (const key of Object.keys(merged) as (keyof LineStyleOverride)[]) {
      if (merged[key] === undefined) delete merged[key];
    }
    const nextOverrides = { ...(text.lineOverrides ?? {}) };
    if (Object.keys(merged).length === 0) delete nextOverrides[selectedLineIndex];
    else nextOverrides[selectedLineIndex] = merged;
    set({ lineOverrides: nextOverrides });
  };

  return (
    <StudioPanel
      title="Text"
      hideTitle={hideTitle}
      actions={
        <IconButton size="sm" aria-label="Center horizontally" title="Center in bubble" onClick={() => onCenter(layer.id)} className="!bg-transparent">
          <AlignCenterHorizontal size={14} />
        </IconButton>
      }
    >
        <Textarea
          value={text.content}
          onChange={(e) => set({ content: e.target.value })}
          placeholder="Type dialogue…"
          rows={3}
          className="!text-title"
        />

        <p className={cn('text-[10px] leading-snug rounded-control px-1.5 py-1', range ? 'bg-accent-soft text-accent' : 'text-ink-faint/70')}>
          {range
            ? `Character controls apply to ${range.end - range.start} selected character${range.end - range.start === 1 ? '' : 's'}.`
            : 'Character controls apply to the whole layer. Select characters on canvas to style part of it.'}
        </p>

        {selectedLineIndex != null && (
          <div className="flex flex-col gap-2 rounded-control border border-accent/30 bg-accent-soft/40 px-2 py-2">
            <div className="flex items-center justify-between text-micro text-accent font-medium">
              <span>Line {selectedLineIndex + 1}</span>
              <button type="button" className="text-ink-faint hover:text-ink text-[10px] underline" onClick={() => setLine({})}>
                Clear overrides
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                <span className="shrink-0">Size</span>
                <input
                  type="number"
                  min={6}
                  max={200}
                  value={Math.round(lineValue('fontSize', text.fontSize))}
                  onChange={(e) => setLine({ fontSize: Number(e.target.value) || undefined })}
                  className="w-full bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
                />
              </label>
              <label className="flex items-center gap-2 text-micro text-ink-faint">
                <span className="shrink-0">Color</span>
                <input
                  type="color"
                  value={lineValue('color', text.color)}
                  onChange={(e) => setLine({ color: e.target.value })}
                  className="w-8 h-7 rounded-control border border-hairline bg-transparent"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Font</span>
              <select
                value={lineValue('fontFamily', text.fontFamily)}
                onChange={(e) => setLine({ fontFamily: e.target.value })}
                className="bg-ink/5 border border-hairline rounded-control px-1.5 py-1.5 text-ink text-micro"
              >
                {fontFamilies.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <IconButton
                size="sm"
                active={lineValue('fontWeight', text.bold ? 700 : 400) >= 600}
                aria-label="Bold this line"
                onClick={() => setLine({ bold: !(lineValue('fontWeight', text.bold ? 700 : 400) >= 600), fontWeight: undefined })}
                className="!bg-transparent"
              >
                <Bold size={14} />
              </IconButton>
              <IconButton
                size="sm"
                active={lineValue('italic', text.italic)}
                aria-label="Italicize this line"
                onClick={() => setLine({ italic: !lineValue('italic', text.italic) })}
                className="!bg-transparent"
              >
                <Italic size={14} />
              </IconButton>
              <div className="w-px h-6 bg-hairline mx-1" />
              {([
                { id: 'left', icon: AlignLeft },
                { id: 'center', icon: AlignCenter },
                { id: 'right', icon: AlignRight },
                { id: 'justify', icon: AlignJustify },
              ] as { id: TextAlign; icon: typeof AlignLeft }[]).map(({ id, icon: Icon }) => (
                <IconButton
                  key={id}
                  size="sm"
                  active={lineValue('align', text.align) === id}
                  aria-label={`Align this line ${id}`}
                  onClick={() => setLine({ align: id })}
                  className="!bg-transparent"
                >
                  <Icon size={14} />
                </IconButton>
              ))}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Font</span>
          <select
            value={charValue('fontFamily')}
            onChange={(e) => setChar({ fontFamily: e.target.value })}
            className="bg-ink/5 border border-hairline rounded-control px-1.5 py-1.5 text-ink text-micro"
          >
            {fontFamilies.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
            <span className="shrink-0">Size</span>
            <input
              type="number"
              min={6}
              max={200}
              value={Math.round(charValue('fontSize'))}
              onChange={(e) => setChar({ fontSize: Number(e.target.value) || charValue('fontSize') })}
              className="w-full bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
            />
          </label>
          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <span className="shrink-0">Color</span>
            <input
              type="color"
              value={charValue('color')}
              onChange={(e) => setChar({ color: e.target.value })}
              className="w-8 h-7 rounded-control border border-hairline bg-transparent"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Weight</span>
          <select
            value={charValue('fontWeight')}
            onChange={(e) => setChar({ fontWeight: Number(e.target.value) })}
            className="studio-interactive flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
          >
            {FONT_WEIGHTS.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <IconButton size="sm" active={charValue('fontWeight') >= 600} aria-label="Bold" onClick={() => setChar({ bold: !(charValue('fontWeight') >= 600), fontWeight: undefined })} className="!bg-transparent">
            <Bold size={14} />
          </IconButton>
          <IconButton size="sm" active={charValue('italic')} aria-label="Italic" onClick={() => setChar({ italic: !charValue('italic') })} className="!bg-transparent">
            <Italic size={14} />
          </IconButton>
          <div className="w-px h-6 bg-hairline mx-1" />
          {([
            { id: 'left', icon: AlignLeft },
            { id: 'center', icon: AlignCenter },
            { id: 'right', icon: AlignRight },
            { id: 'justify', icon: AlignJustify },
          ] as { id: TextAlign; icon: typeof AlignLeft }[]).map(({ id, icon: Icon }) => (
            <IconButton
              key={id}
              size="sm"
              active={text.align === id}
              aria-label={`Align ${id}`}
              onClick={() => set({ align: id })}
              className="!bg-transparent"
            >
              <Icon size={14} />
            </IconButton>
          ))}
        </div>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Line height</span>
          <input
            type="range"
            min={0.8}
            max={2}
            step={0.05}
            value={text.lineHeight}
            onChange={(e) => set({ lineHeight: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-8 text-right tabular-nums">{text.lineHeight.toFixed(2)}</span>
        </label>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Tracking</span>
          <input
            type="range" min={-5} max={30} step={0.5}
            value={charValue('letterSpacing')}
            onChange={(e) => setChar({ letterSpacing: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-8 text-right tabular-nums">{charValue('letterSpacing')}</span>
        </label>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0" title="Extra space inserted before the selected characters">Kerning</span>
          <input
            type="range" min={-20} max={20} step={0.5}
            value={charValue('kerning')}
            onChange={(e) => setChar({ kerning: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-8 text-right tabular-nums">{charValue('kerning')}</span>
        </label>

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Baseline</span>
          <input
            type="range" min={-40} max={40} step={1}
            value={charValue('baselineShift')}
            onChange={(e) => setChar({ baselineShift: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-accent)]"
          />
          <span className="w-8 text-right tabular-nums">{charValue('baselineShift')}</span>
        </label>
        {!range && (
          <p className="text-[10px] text-ink-faint/70 leading-snug -mt-1">
            Kerning inserts space before a character and baseline shift raises it — both are
            per-character, so they only really pay off on a selection.
          </p>
        )}

        <label className="flex items-center gap-2 text-micro text-ink-faint">
          <span className="w-16 shrink-0">Wrap</span>
          <select
            value={text.autoWidth ? 'point' : 'box'}
            onChange={(e) => set({ autoWidth: e.target.value === 'point' })}
            className="studio-interactive flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
          >
            <option value="point">Point (grows to fit)</option>
            <option value="box">Box (wraps at width)</option>
          </select>
        </label>

        {!text.autoWidth && (
          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <span className="w-16 shrink-0">Height</span>
            <input
              type="checkbox"
              checked={text.fixedHeight != null}
              onChange={(e) => set({ fixedHeight: e.target.checked ? Math.round(text.fontSize * text.lineHeight * 3) : undefined })}
              className="accent-[var(--color-accent)]"
            />
            <span className="shrink-0">Fixed</span>
            {text.fixedHeight != null && (
              <input
                type="number"
                min={text.fontSize}
                value={Math.round(text.fixedHeight)}
                onChange={(e) => set({ fixedHeight: Number(e.target.value) || text.fixedHeight })}
                className="w-16 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
              />
            )}
          </label>
        )}

        <div className="flex flex-col gap-2 pt-2 border-t border-hairline/60">
          <label className="flex items-center justify-between text-micro text-ink-faint">
            <span>Shadow / Glow</span>
            <input
              type="checkbox"
              checked={text.shadow?.enabled ?? false}
              onChange={(e) => set({ shadow: { ...(text.shadow ?? DEFAULT_TEXT_SHADOW), enabled: e.target.checked } })}
              className="accent-[var(--color-accent)]"
            />
          </label>
          {text.shadow?.enabled && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={text.shadow.color}
                  onChange={(e) => set({ shadow: { ...text.shadow, color: e.target.value } })}
                  className="w-8 h-7 rounded-control border border-hairline bg-transparent"
                />
                <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                  <span className="shrink-0">Blur</span>
                  <input
                    type="range" min={0} max={40} step={1}
                    value={text.shadow.blur}
                    onChange={(e) => set({ shadow: { ...text.shadow, blur: Number(e.target.value) } })}
                    className="flex-1 accent-[var(--color-accent)]"
                  />
                  <span className="w-6 text-right tabular-nums">{text.shadow.blur}</span>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-micro text-ink-faint flex-1">
                  <span className="shrink-0">X</span>
                  <input
                    type="number" min={-40} max={40}
                    value={text.shadow.offsetX}
                    onChange={(e) => set({ shadow: { ...text.shadow, offsetX: Number(e.target.value) } })}
                    className="w-full bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-micro text-ink-faint flex-1">
                  <span className="shrink-0">Y</span>
                  <input
                    type="number" min={-40} max={40}
                    value={text.shadow.offsetY}
                    onChange={(e) => set({ shadow: { ...text.shadow, offsetY: Number(e.target.value) } })}
                    className="w-full bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
                  />
                </label>
              </div>
              <p className="text-[10px] text-ink-faint/70 leading-snug">
                A glow is a shadow at 0/0 with a wide blur.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-hairline/60">
          <label className="flex items-center justify-between text-micro text-ink-faint">
            <span>Gradient</span>
            <input
              type="checkbox"
              checked={text.gradient?.enabled ?? false}
              onChange={(e) => set({ gradient: { ...(text.gradient ?? DEFAULT_TEXT_GRADIENT), enabled: e.target.checked } })}
              className="accent-[var(--color-accent)]"
            />
          </label>
          {text.gradient?.enabled && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Gradient start colour"
                  value={text.gradient.from}
                  onChange={(e) => set({ gradient: { ...text.gradient, from: e.target.value } })}
                  className="w-8 h-7 rounded-control border border-hairline bg-transparent"
                />
                <input
                  type="color"
                  aria-label="Gradient end colour"
                  value={text.gradient.to}
                  onChange={(e) => set({ gradient: { ...text.gradient, to: e.target.value } })}
                  className="w-8 h-7 rounded-control border border-hairline bg-transparent"
                />
                <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                  <span className="shrink-0">Angle</span>
                  <input
                    type="range" min={0} max={360} step={5}
                    value={text.gradient.angle}
                    onChange={(e) => set({ gradient: { ...text.gradient, angle: Number(e.target.value) } })}
                    className="flex-1 accent-[var(--color-accent)]"
                  />
                  <span className="w-7 text-right tabular-nums">{text.gradient.angle}°</span>
                </label>
              </div>
              <p className="text-[10px] text-ink-faint/70 leading-snug">
                A gradient replaces the flat fill colour while it’s on.
              </p>
            </>
          )}
        </div>

        <div className={cn('flex flex-col gap-2 pt-2 border-t border-hairline/60')}>
          <span className="text-micro text-ink-faint">Stroke</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={text.strokeColor}
              onChange={(e) => set({ strokeColor: e.target.value })}
              className="w-8 h-7 rounded-control border border-hairline bg-transparent"
            />
            <input
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={text.strokeWidth}
              onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="w-8 text-right tabular-nums text-micro text-ink-faint">{text.strokeWidth}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1 pt-2 border-t border-hairline/60">
          <span className="text-micro text-ink-faint">Styles</span>
          {([
            { kind: 'character', label: 'Character' },
            { kind: 'paragraph', label: 'Paragraph' },
          ] as { kind: TextStyleKind; label: string }[]).map(({ kind, label }) => {
            const group = styles.filter(s => s.kind === kind);
            const open = openGroups[kind];
            return (
              <div key={kind} className="flex flex-col">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setOpenGroups(g => ({ ...g, [kind]: !g[kind] }))}
                    className="studio-interactive flex items-center gap-1 flex-1 text-left text-micro text-ink py-1"
                    aria-expanded={open}
                  >
                    <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
                    <span>{label}</span>
                    <span className="text-ink-faint">({group.length})</span>
                  </button>
                  <IconButton
                    size="sm"
                    aria-label={`New ${kind} style from this layer`}
                    title={kind === 'character'
                      ? 'New character style (font, colour, tracking, stroke, shadow, gradient)'
                      : 'New paragraph style (alignment, line height, wrap)'}
                    onClick={() => handleNewStyle(kind)}
                    className="!bg-transparent"
                  >
                    <Plus size={13} />
                  </IconButton>
                </div>
                {open && (
                  group.length === 0 ? (
                    <p className="text-[10px] text-ink-faint/70 leading-snug pl-4 pb-1">
                      No {kind} styles yet — “+” saves this layer’s {kind === 'character' ? 'appearance' : 'layout'}.
                    </p>
                  ) : (
                    <ul className="flex flex-col pl-4">
                      {group.map(style => (
                        <li key={style.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onUpdate(layer.id, styleToPatch(style))}
                            title={`Apply “${style.name}” to this layer`}
                            className="studio-interactive flex-1 text-left text-micro text-ink py-1 px-1 rounded-control hover:bg-ink/5 truncate"
                          >
                            {style.name}
                          </button>
                          <IconButton size="sm" aria-label={`${style.name} actions`} onClick={() => handleStyleMenu(style)} className="!bg-transparent">
                            <MoreHorizontal size={13} />
                          </IconButton>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            );
          })}
        </div>
    </StudioPanel>
  );
}
