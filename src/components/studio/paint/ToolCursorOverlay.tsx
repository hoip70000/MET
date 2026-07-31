import { effectiveTip, type PaintSettings } from './paintEngine';

interface ToolCursorOverlayProps {
  /** Pointer position in *container* (CSS) pixels, or null when the pointer is off-canvas. */
  pos: { x: number; y: number } | null;
  /** Stage zoom, so the ring matches the pixels the brush will actually cover. */
  scale: number;
  settings: PaintSettings;
  tool: string;
  /** Live-sampled hex color under the pointer — Eyedropper only. */
  eyedropperColor: string | null;
  /** Clone/Heal's alt-clicked sample source, in container px — null until one is set. */
  cloneSource: { x: number; y: number } | null;
}

const STROKE_TOOLS = new Set(['brush', 'pencil', 'eraser']);
/** Tools that are brush-sized but don't use the brush tip geometry (no angle/roundness). */
const ROUND_SIZED_TOOLS = new Set(['clone', 'heal', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'spot-heal', 'contentAware', 'liquify']);
const SOURCE_CROSSHAIR_TOOLS = new Set(['clone', 'heal']);
const PATCH_ICON_TOOLS = new Set(['spot-heal', 'contentAware']);

/**
 * Live per-tool cursor preview that tracks the pointer, drawn in container space above the
 * Konva stage. One overlay, switched by `tool`, so every brush-family/sampling tool gets a
 * consistent single source of cursor chrome instead of each tool wiring its own.
 *
 * Rendered as SVG rather than a Konva node so it never lands in exports or the layer stack, and
 * so moving it can't dirty the paint canvas. Tools with no bespoke chrome here (marquee, lasso,
 * shapes, pan, zoom, text, bucket, ...) get a plain CSS cursor class instead — see StudioCanvas's
 * `cursorClass`, which is the other half of this system.
 */
export function ToolCursorOverlay({ pos, scale, settings, tool, eyedropperColor, cloneSource }: ToolCursorOverlayProps) {
  if (!pos) return null;

  if (tool === 'wand') {
    return (
      <svg className="pointer-events-none absolute inset-0 w-full h-full z-10" aria-hidden>
        <g transform={`translate(${pos.x} ${pos.y})`}>
          <line x1={-9} y1={9} x2={2} y2={-2} stroke="#000" strokeWidth={3} strokeOpacity={0.5} strokeLinecap="round" />
          <line x1={-9} y1={9} x2={2} y2={-2} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
          {[[3, -8], [8, -3], [1, -12]].map(([dx, dy], i) => (
            <line key={i} x1={dx - 2} y1={dy} x2={dx + 2} y2={dy} stroke="#fbbf24" strokeWidth={1.5} strokeLinecap="round" />
          ))}
        </g>
      </svg>
    );
  }

  if (tool === 'eyedropper') {
    return (
      <svg className="pointer-events-none absolute inset-0 w-full h-full z-10" aria-hidden>
        <g transform={`translate(${pos.x} ${pos.y})`}>
          <line x1={-10} y1={10} x2={4} y2={-4} stroke="#000" strokeWidth={3} strokeOpacity={0.5} strokeLinecap="round" />
          <line x1={-10} y1={10} x2={4} y2={-4} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
          {eyedropperColor && (
            <>
              <rect x={8} y={-18} width={14} height={14} rx={2} fill={eyedropperColor} stroke="#000" strokeWidth={1.5} />
              <rect x={8} y={-18} width={14} height={14} rx={2} fill="none" stroke="#fff" strokeWidth={0.75} />
            </>
          )}
        </g>
      </svg>
    );
  }

  if (tool === 'pen' || tool === 'curvature-pen') {
    return (
      <svg className="pointer-events-none absolute inset-0 w-full h-full z-10" aria-hidden>
        <g transform={`translate(${pos.x} ${pos.y})`}>
          <path d="M -1 -10 L 3 -10 L 1 -1 L -3 -1 Z" fill="#fff" stroke="#000" strokeWidth={0.75} />
          <line x1={-1} y1={-1} x2={-4} y2={2} stroke="#000" strokeWidth={2} strokeOpacity={0.5} strokeLinecap="round" />
          <line x1={-1} y1={-1} x2={-4} y2={2} stroke="#fff" strokeWidth={1} strokeLinecap="round" />
        </g>
      </svg>
    );
  }

  const isStroke = STROKE_TOOLS.has(tool);
  if (!isStroke && !ROUND_SIZED_TOOLS.has(tool)) return null;

  const geom = isStroke
    ? effectiveTip(settings, tool as 'brush' | 'pencil' | 'eraser')
    : { size: settings.size, hardness: 1, angle: 0, roundness: 1 };

  const screenSize = geom.size * scale;

  // Below a few px the ring is smaller than the cursor itself and just reads as
  // noise — fall back to a crosshair, which is what it's actually useful as.
  if (screenSize < 4) {
    return (
      <svg className="pointer-events-none absolute inset-0 w-full h-full z-10" aria-hidden>
        <g stroke="#fff" strokeWidth={1} opacity={0.9}>
          <line x1={pos.x - 6} y1={pos.y} x2={pos.x + 6} y2={pos.y} />
          <line x1={pos.x} y1={pos.y - 6} x2={pos.x} y2={pos.y + 6} />
        </g>
        <g stroke="#000" strokeWidth={1} opacity={0.35}>
          <line x1={pos.x - 6} y1={pos.y + 1} x2={pos.x + 6} y2={pos.y + 1} />
          <line x1={pos.x + 1} y1={pos.y - 6} x2={pos.x + 1} y2={pos.y + 6} />
        </g>
      </svg>
    );
  }

  const rx = screenSize / 2;
  const ry = (screenSize / 2) * geom.roundness;
  const transform = `translate(${pos.x} ${pos.y}) rotate(${geom.angle})`;
  const isSquare = isStroke && settings.brushShape === 'square';
  // A soft tip's paint starts fading at `hardness` of the radius — draw that as a
  // second, dimmer ring so "hardness" is visible before you commit a stroke.
  const showInner = geom.hardness < 0.95;

  return (
    <svg className="pointer-events-none absolute inset-0 w-full h-full z-10" aria-hidden>
      <g transform={transform}>
        {isSquare ? (
          <>
            {/* Double-stroked (dark under light) so the outline stays legible on any art. */}
            <rect x={-rx} y={-ry} width={rx * 2} height={ry * 2} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={2} />
            <rect x={-rx} y={-ry} width={rx * 2} height={ry * 2} fill="none" stroke="#fff" strokeOpacity={0.95} strokeWidth={1} />
            {showInner && (
              <rect
                x={-rx * geom.hardness} y={-ry * geom.hardness}
                width={rx * 2 * geom.hardness} height={ry * 2 * geom.hardness}
                fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3"
              />
            )}
          </>
        ) : (
          <>
            <ellipse rx={rx} ry={ry} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={2} />
            <ellipse rx={rx} ry={ry} fill="none" stroke="#fff" strokeOpacity={0.95} strokeWidth={1} />
            {showInner && (
              <ellipse
                rx={rx * geom.hardness} ry={ry * geom.hardness}
                fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3"
              />
            )}
          </>
        )}
        {/* Content-Aware/Spot Heal: a small band-aid glyph offset from center so it never obscures
            the brush footprint itself. */}
        {PATCH_ICON_TOOLS.has(tool) && (
          <g transform={`translate(${rx * 0.55} ${ry * 0.55})`}>
            <rect x={-5} y={-2.5} width={10} height={5} rx={2.5} fill="#fff" stroke="#000" strokeWidth={0.75} transform="rotate(45)" />
            <line x1={-2} y1={0} x2={2} y2={0} stroke="#000" strokeWidth={0.75} transform="rotate(45)" />
          </g>
        )}
      </g>
      {/* Clone/Heal: the alt-clicked sample source, tracked independently of the brush ring so the
          two can visibly move in sync (aligned mode) as the stroke progresses. */}
      {SOURCE_CROSSHAIR_TOOLS.has(tool) && cloneSource && (
        <g transform={`translate(${cloneSource.x} ${cloneSource.y})`} stroke="#fff" strokeWidth={1.5}>
          <circle r={6} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={2.5} />
          <circle r={6} fill="none" />
          <line x1={-9} y1={0} x2={9} y2={0} />
          <line x1={0} y1={-9} x2={0} y2={9} />
        </g>
      )}
    </svg>
  );
}
