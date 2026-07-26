import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { IconButton } from '../ui';
import { curveLut } from '../../lib/adjustments';
import type { CurvePoint } from './studioTypes';

interface CurvesEditorProps {
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
}

/** Square graph, input/output both 0-255 mapped to 0-SIZE px, y flipped so output grows upward. */
const SIZE = 200;

function toSvg(p: CurvePoint) {
  return { x: (p.input / 255) * SIZE, y: SIZE - (p.output / 255) * SIZE };
}
function fromSvg(x: number, y: number): CurvePoint {
  return {
    input: Math.round(Math.min(255, Math.max(0, (x / SIZE) * 255))),
    output: Math.round(Math.min(255, Math.max(0, (1 - y / SIZE) * 255))),
  };
}

/**
 * An inline SVG control-point graph for the Curves adjustment — click empty graph space to add a
 * point, drag a point to move it, double-click (or the delete button on the selected point) to
 * remove a non-endpoint one. SVG rather than canvas: each point needs to be individually
 * hit-testable/draggable, which SVG gives for free via per-`<circle>` handlers, and the curve path
 * only needs to be rebuilt when the data changes, not per animation frame — canvas's imperative
 * redraw-loop strength isn't needed here. Drag mechanics mirror StudioCanvas.tsx's Space-hold-pan
 * idiom (window-level mousemove/mouseup), the same pattern TyperFloatingWindow's drag uses too.
 */
export function CurvesEditor({ points, onChange }: CurvesEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const sorted = useMemo(() => [...points].sort((a, b) => a.input - b.input), [points]);
  const pathD = useMemo(() => {
    // Samples the exact same LUT the filter applies, so the on-screen curve can never drift from
    // what painting the adjustment actually does.
    const lut = curveLut(sorted);
    return Array.from(lut).map((out, i) => {
      const { x, y } = toSvg({ input: i, output: out });
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  }, [sorted]);

  function clientToLocal(e: { clientX: number; clientY: number }) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointDown(index: number, e: React.MouseEvent) {
    e.stopPropagation();
    setSelected(index);
    dragIndexRef.current = index;
  }

  function handleGraphClick(e: React.MouseEvent) {
    const { x, y } = clientToLocal(e);
    const newPoint = fromSvg(x, y);
    // Don't stack a near-duplicate control point on top of an existing one.
    if (sorted.some(p => Math.abs(p.input - newPoint.input) < 4)) return;
    const next = [...sorted, newPoint].sort((a, b) => a.input - b.input);
    onChange(next);
    setSelected(next.findIndex(p => p === newPoint));
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const idx = dragIndexRef.current;
      if (idx === null) return;
      const { x, y } = clientToLocal(e);
      // Endpoints keep their input pinned to 0/255 — only their output moves, matching
      // Photoshop's own curve behaviour of not letting you drag the ends past the graph edges.
      const isEndpoint = idx === 0 || idx === sorted.length - 1;
      const raw = fromSvg(x, y);
      const next = sorted.map((p, i) => (i === idx ? { input: isEndpoint ? p.input : raw.input, output: raw.output } : p));
      onChange([...next].sort((a, b) => a.input - b.input));
    }
    function onMouseUp() {
      dragIndexRef.current = null;
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [sorted, onChange]);

  function removePoint(index: number) {
    if (index === 0 || index === sorted.length - 1) return; // endpoints can't be deleted
    onChange(sorted.filter((_, i) => i !== index));
    setSelected(null);
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <svg
        ref={svgRef}
        data-testid="curves-graph"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="rounded-control border border-hairline bg-ink/5 cursor-crosshair"
        onClick={handleGraphClick}
      >
        <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="3 3" />
        <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />
        {sorted.map((p, i) => {
          const { x, y } = toSvg(p);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={selected === i ? 5 : 4}
              fill={selected === i ? 'var(--color-accent)' : 'white'}
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              onMouseDown={(e) => handlePointDown(i, e)}
              onDoubleClick={(e) => { e.stopPropagation(); removePoint(i); }}
            />
          );
        })}
      </svg>
      <div className="flex items-center justify-between text-micro text-ink-faint">
        <span>Click to add a point, drag to move, double-click to remove.</span>
        {selected !== null && selected !== 0 && selected !== sorted.length - 1 && (
          <IconButton size="sm" aria-label="Delete point" title="Delete selected point" onClick={() => removePoint(selected)} className="!bg-transparent !w-6 !h-6">
            <Trash2 size={11} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
