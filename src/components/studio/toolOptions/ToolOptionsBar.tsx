import { findTool } from '../toolGroups';
import type { LiquifyMode, SymmetryMode } from '../paint/paintEngine';
import type { BrushShape } from '../paint/brushTip';
import { PAINT_TOOLS } from '../paint/usePaintLayer';

interface ToolOptionsBarProps {
  layoutMode?: 'desktop' | 'tablet' | 'phone';
  activeTool: string;
  size: number;
  onSizeChange: (v: number) => void;
  hardness: number;
  onHardnessChange: (v: number) => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
  flow: number;
  onFlowChange: (v: number) => void;
  tolerance: number;
  onToleranceChange: (v: number) => void;
  liquifyMode: LiquifyMode;
  onLiquifyModeChange: (v: LiquifyMode) => void;
  symmetry: SymmetryMode;
  onSymmetryChange: (v: SymmetryMode) => void;
  spacing: number;
  onSpacingChange: (v: number) => void;
  brushShape: BrushShape | 'image';
  onBrushShapeChange: (v: BrushShape) => void;
  angle: number;
  onAngleChange: (v: number) => void;
  roundness: number;
  onRoundnessChange: (v: number) => void;
  scatter: number;
  onScatterChange: (v: number) => void;
  smoothing: number;
  onSmoothingChange: (v: number) => void;
  sliceRectCount: number;
  onAddSliceRect: () => void;
  onExportSlices: () => void;
  hasSelection: boolean;
  onDeselect: () => void;
}

const SIZE_TOOLS = new Set(['brush', 'pencil', 'eraser', 'clone', 'heal', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'spot-heal', 'shape-rect', 'shape-ellipse', 'shape-line', 'liquify']);
const HARDNESS_TOOLS = new Set(['brush', 'clone', 'heal']);
const FLOW_TOOLS = new Set(['brush', 'pencil', 'eraser', 'heal', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'liquify']);
const OPACITY_TOOLS = new Set(['brush', 'pencil', 'eraser', 'bucket', 'gradient']);
const TOLERANCE_TOOLS = new Set(['wand', 'bucket']);
const SYMMETRY_TOOLS = new Set(['brush', 'pencil', 'eraser']);
const SELECTION_TOOLS = new Set(['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col', 'lasso-freehand', 'lasso-polygon', 'lasso-magnetic', 'wand']);

const LIQUIFY_MODES: { id: LiquifyMode; label: string }[] = [
  { id: 'push', label: 'Push' },
  { id: 'swirl', label: 'Swirl' },
  { id: 'pinch', label: 'Pinch' },
  { id: 'bloat', label: 'Bloat' },
  { id: 'crystalize', label: 'Crystalize' },
  { id: 'reconstruct', label: 'Reconstruct' },
];

const BRUSH_SHAPES: { id: BrushShape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'square', label: 'Square' },
];

const SYMMETRY_MODES: { id: SymmetryMode; label: string }[] = [
  { id: 'none', label: 'Off' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'both', label: 'Both' },
];

function Slider({ label, value, min, max, step, onChange, format, phone }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; phone?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
      <span className="uppercase tracking-wide text-[10px] opacity-70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`studio-focusable accent-[var(--color-accent)] ${phone ? 'w-24 h-6' : 'w-20'}`}
      />
      <span className="w-8 text-right tabular-nums text-ink font-mono text-[10px]">{format ? format(value) : Math.round(value)}</span>
    </label>
  );
}

export function ToolOptionsBar({
  layoutMode = 'desktop',
  activeTool, size, onSizeChange, hardness, onHardnessChange, opacity, onOpacityChange,
  flow, onFlowChange, tolerance, onToleranceChange, liquifyMode, onLiquifyModeChange,
  symmetry, onSymmetryChange, spacing, onSpacingChange, brushShape, onBrushShapeChange,
  angle, onAngleChange, roundness, onRoundnessChange, scatter, onScatterChange,
  smoothing, onSmoothingChange,
  sliceRectCount, onAddSliceRect, onExportSlices,
  hasSelection, onDeselect,
}: ToolOptionsBarProps) {
  const phone = layoutMode === 'phone';
  const tool = findTool(activeTool);
  const showSize = SIZE_TOOLS.has(activeTool);
  const showHardness = HARDNESS_TOOLS.has(activeTool);
  const showFlow = FLOW_TOOLS.has(activeTool);
  const showOpacity = OPACITY_TOOLS.has(activeTool);
  const showTolerance = TOLERANCE_TOOLS.has(activeTool);
  const showLiquifyMode = activeTool === 'liquify';
  const showSymmetry = SYMMETRY_TOOLS.has(activeTool);
  const showSlice = activeTool === 'slice';
  const showDeselect = SELECTION_TOOLS.has(activeTool) && hasSelection;
  const showSelectionHint = (PAINT_TOOLS as readonly string[]).includes(activeTool) && hasSelection;

  if (!tool || (!showSize && !showHardness && !showFlow && !showOpacity && !showTolerance && !showLiquifyMode && !showSymmetry && !showSlice && !showDeselect && !showSelectionHint)) return null;

  const controlClass = `studio-interactive studio-focusable bg-ink/5 border border-hairline rounded-control text-ink text-micro shrink-0 ${phone ? 'min-h-11 px-3' : 'px-2 py-1'}`;
  const selectClass = `bg-ink/5 border border-hairline rounded-control text-ink text-micro ${phone ? 'min-h-11 px-2' : 'px-1.5 py-1'}`;

  return (
    <div className={`liquid-glass-bar flex items-center gap-4 px-3 shrink-0 border-b border-hairline overflow-x-auto ${phone ? 'min-h-14' : 'h-10'}`}>
      <span className="text-ui font-medium text-ink shrink-0 min-w-[5.5rem]">{tool.label}</span>
      <div className="w-px h-4 bg-hairline shrink-0" />
      {showLiquifyMode && (
        <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
          <span>Mode</span>
          <select
            value={liquifyMode}
            onChange={(e) => onLiquifyModeChange(e.target.value as LiquifyMode)}
            className={selectClass}
          >
            {LIQUIFY_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      )}
      {showDeselect && (
        <button
          className={controlClass}
          onClick={onDeselect}
        >
          Deselect
        </button>
      )}
      {showSelectionHint && (
        <span className="text-micro text-ink-faint shrink-0 whitespace-nowrap">
          Editing inside selection — Ctrl+D to deselect
        </span>
      )}
      {showSize && <Slider label="Size" value={size} min={1} max={200} step={1} onChange={onSizeChange} phone={phone} />}
      {showHardness && <Slider label="Hardness" value={hardness * 100} min={0} max={100} step={1} onChange={(v) => onHardnessChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />}
      {showFlow && <Slider label="Flow" value={flow * 100} min={0} max={100} step={1} onChange={(v) => onFlowChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />}
      {showOpacity && <Slider label="Opacity" value={opacity * 100} min={0} max={100} step={1} onChange={(v) => onOpacityChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />}
      {showTolerance && <Slider label="Tolerance" value={tolerance} min={0} max={100} step={1} onChange={onToleranceChange} phone={phone} />}
      {showSlice && (
        <>
          <button
            className={controlClass}
            onClick={onAddSliceRect}
          >
            Add Rect ({sliceRectCount})
          </button>
          <button
            className={`${controlClass} disabled:opacity-40 disabled:cursor-not-allowed`}
            onClick={onExportSlices}
            disabled={sliceRectCount === 0}
          >
            Export Slices…
          </button>
        </>
      )}
      {showSymmetry && (
        <>
          <Slider label="Spacing" value={spacing * 100} min={1} max={100} step={1} onChange={(v) => onSpacingChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />
          <Slider label="Smoothing" value={smoothing * 100} min={0} max={100} step={1} onChange={(v) => onSmoothingChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />
          <Slider label="Scatter" value={scatter * 100} min={0} max={100} step={1} onChange={(v) => onScatterChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />
          <Slider label="Angle" value={angle} min={-180} max={180} step={1} onChange={onAngleChange} format={(v) => `${Math.round(v)}°`} phone={phone} />
          <Slider label="Round" value={roundness * 100} min={5} max={100} step={1} onChange={(v) => onRoundnessChange(v / 100)} format={(v) => `${Math.round(v)}%`} phone={phone} />
          <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
            <span className="uppercase tracking-wide text-[10px] opacity-70">Tip</span>
            <select
              value={brushShape}
              onChange={(e) => onBrushShapeChange(e.target.value as BrushShape)}
              className={`studio-interactive studio-focusable ${selectClass}`}
            >
              {/* 'Image' only appears while an imported tip is active — picking a
                  procedural shape here is how you switch back off it. */}
              {brushShape === 'image' && <option value="image">Image</option>}
              {BRUSH_SHAPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className={`flex items-center gap-2 text-micro text-ink-faint shrink-0 ${phone ? 'min-h-11' : ''}`}>
            <span className="uppercase tracking-wide text-[10px] opacity-70">Symmetry</span>
            <select
              value={symmetry}
              onChange={(e) => onSymmetryChange(e.target.value as SymmetryMode)}
              className={`studio-interactive studio-focusable ${selectClass}`}
            >
              {SYMMETRY_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
