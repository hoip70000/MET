import { useMemo } from 'react';
import { Group, Rect, Line, Ellipse, Text as KonvaText } from 'react-konva';
import type Konva from 'konva';
import type { StudioLayer, TextLayerData, LayerSelectMode } from './studioTypes';
import { layoutText } from './textLayout';
import { gradientVector } from './textGradient';

interface TextLayerNodeProps {
  layer: StudioLayer;
  groupRef: (node: Konva.Group | null) => void;
  editing: boolean;
  selected: boolean;
  draggable: boolean;
  onSelect: (mode: LayerSelectMode) => void;
  onEdit: () => void;
  onUpdate: (patch: Partial<TextLayerData>) => void;
  /** Click a wrapped line (while selected, not editing) to apply per-line style overrides to it —
   *  independent of the character-range selection the editing textarea drives. */
  onSelectLine?: (lineIndex: number) => void;
  /** The Stage's current zoom — only needed to counter-scale the W×H readout's font size so it
   *  reads as a fixed on-screen size at any zoom, matching StudioCanvas.tsx's own live drag-preview
   *  readout. Defaults to 1 (readout scales with content) if omitted. */
  scale?: number;
  /** Hovering the box body (not a Transformer handle, which sits on top and wins the hit-test
   *  first) vs. leaving it — drives the move-cursor StudioCanvas.tsx shows over the container. */
  onHoverChange?: (hovering: boolean) => void;
  /** Double-clicking the ⊞ overflow indicator auto-fits the box's fixedHeight to its content —
   *  undoable, separate from the Transformer-handle dblclick in StudioCanvas.tsx which only
   *  auto-fits width. Only reachable while `layout.overflowing` is true (the indicator that calls
   *  this doesn't render otherwise). */
  onAutoFitHeight?: () => void;
  /** Hovering the ⊞ overflow indicator itself (not the box body) — drives a pointer cursor over
   *  the canvas container, taking priority over the box-body move cursor since the indicator sits
   *  at/on the box's bottom edge. Mirrors onHoverChange's shape. */
  onOverflowHoverChange?: (hovering: boolean) => void;
}

/**
 * Konva name on a text layer's invisible hit rect. The stage's "did I click empty canvas?" test goes
 * by class name, and the page's drop-shadow backing is a Rect too — so without a name to tell them
 * apart, clicking text reads as clicking background and clears the selection it just made.
 */
export const TEXT_HIT_NAME = 'text-hit';

/** Shift or Ctrl/Cmd adds to (or removes from) the selection; a plain click replaces it. */
function selectModeFor(evt: MouseEvent | TouchEvent): LayerSelectMode {
  const e = evt as MouseEvent;
  return e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace';
}

/**
 * A text layer on the Konva stage.
 *
 * Konva has no rich text — `Konva.Text` renders one uniform style — so per-character runs mean we
 * own line-breaking and positioning (`textLayout.ts`) and render **one Konva.Text per positioned
 * run** inside a Group. Konva still paints the glyphs; we only place them. A custom `sceneFunc`
 * would have meant reimplementing stroke/shadow/gradient painting from scratch.
 *
 * The Group is the interactive/transform target; the run nodes are inert.
 */
export function TextLayerNode({
  layer, groupRef, editing, selected, draggable, onSelect, onEdit, onUpdate, onSelectLine, scale = 1, onHoverChange,
  onAutoFitHeight, onOverflowHoverChange,
}: TextLayerNodeProps) {
  const text = layer.text!;
  const layout = useMemo(() => layoutText(text), [text]);
  // Area text with a fixed frame: clips glyph content at the box's bottom edge. Unconditional on
  // fixedHeight being set, not gated on layout.overflowing — the boundary this rect draws is the
  // same one naturalHeight > fixedHeight checks, so there's no discontinuity right at the threshold.
  const fixedHeightClip = !text.autoWidth && text.fixedHeight != null;

  const gradient = text.gradient?.enabled ? text.gradient : null;
  // One ramp across the whole layer, not one per run: the vector is computed on the layout box and
  // each run subtracts its own offset, because Konva gradient points are node-local. Without that
  // subtraction every run would restart the ramp.
  const ramp = gradient ? gradientVector(layout.width, layout.height, gradient.angle) : null;

  // Type Region: clips the whole node to the shape the container was created from, in the Group's
  // own local space (its clipShape is stored in the same image-space coords as text.x/y, so each
  // point is offset back by them). Konva's clipFunc runs on every draw, so this stays correct as
  // the layer moves — nothing needs to re-translate the stored shape itself.
  const clip = text.clipShape;
  const clipFunc = useMemo(() => {
    if (!clip) return undefined;
    return (ctx: Konva.Context) => {
      ctx.beginPath();
      if (clip.kind === 'ellipse') {
        const cx = clip.x + clip.width / 2 - text.x;
        const cy = clip.y + clip.height / 2 - text.y;
        ctx.ellipse(cx, cy, Math.abs(clip.width) / 2, Math.abs(clip.height) / 2, 0, 0, Math.PI * 2);
      } else {
        clip.points.forEach((p, i) => {
          const lx = p.x - text.x, ly = p.y - text.y;
          if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
        });
      }
      ctx.closePath();
    };
  }, [clip, text.x, text.y]);

  return (
    <>
    <Group
      ref={groupRef}
      visible={!editing}
      clipFunc={clipFunc}
      x={text.x}
      y={text.y}
      rotation={text.rotation}
      draggable={draggable}
      onClick={(e) => onSelect(selectModeFor(e.evt))}
      onTap={(e) => onSelect(selectModeFor(e.evt))}
      onDblClick={onEdit}
      onDblTap={onEdit}
      // Stops the browser's own touch-scroll/gesture handling from fighting a text drag on touch
      // devices — Konva's own drag machinery (document-level move/up listeners) already takes care
      // of tracking the pointer past the node's bounds, so nothing else is needed here.
      onDragStart={(e) => e.evt?.preventDefault?.()}
      // Konva's Transformer already moves every attached node when a multi-selection is dragged, so
      // each node just commits its own final position — propagating the delta by hand here would
      // double-apply it and the followers would overshoot.
      onDragEnd={(e) => onUpdate({ x: e.target.x(), y: e.target.y() })}
      // Live reflow: fires continuously while a handle is being dragged, not just once on
      // release. Each frame absorbs the node's current scale into real width/(height or fontSize)
      // data (the same conversion onTransformEnd does) and immediately zeroes the scale back out,
      // so the *next* frame's `layout` is computed from the true new size rather than a Konva
      // visual stretch — the text actually re-wraps as you drag, instead of visibly stretching
      // until you let go. No history label (matches the other continuous-drag controls, e.g.
      // opacity), so this doesn't spam an undo entry per frame; only the final position/size
      // sticks.
      //
      // Point vs area text scale *different* things, matching Photoshop exactly: point text has
      // no frame of its own — resizing it *is* resizing the type, so scale converts to fontSize.
      // Area text has a real frame independent of its type size — resizing changes the box only
      // (width from scaleX, height from scaleY, becoming/updating `fixedHeight`) and reflows the
      // existing fontSize into it; the type size never moves, not even by 1px.
      onTransform={(e) => {
        const node = e.target as Konva.Group;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onUpdate(
          text.autoWidth
            ? { width: Math.max(20, layout.width * scaleX), fontSize: Math.max(6, text.fontSize * scaleY) }
            : { width: Math.max(20, layout.width * scaleX), fixedHeight: Math.max(20, (text.fixedHeight ?? layout.height) * scaleY) }
        );
      }}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Group;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        // Scale must not stay baked on the node — it's converted into width/(height or fontSize)
        // instead, so the next layout starts from a clean transform. (Usually already 1 by this
        // point, since onTransform above zeroes it every frame — kept here too for the rare case
        // this fires without an intervening onTransform, e.g. a transform with no actual movement.)
        node.scaleX(1);
        node.scaleY(1);
        onUpdate({
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          width: Math.max(20, layout.width * scaleX),
          ...(text.autoWidth
            ? { fontSize: Math.max(6, text.fontSize * scaleY) }
            : { fixedHeight: Math.max(20, (text.fixedHeight ?? layout.height) * scaleY) }),
        });
      }}
    >
      {/* Hit area + the Group's bounds, so clicking gaps between glyphs still selects the layer and
          the Transformer frames the text box rather than the glyph extents. A `transparent` fill is
          still drawn to the hit canvas (Konva substitutes its own colour key there), so this is
          invisible but clickable. */}
      <Rect
        name={TEXT_HIT_NAME}
        width={Math.max(layout.width, 4)}
        height={Math.max(layout.height, 4)}
        fill="transparent"
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
      />

      {/* Glyphs only — clipped to the fixed-height frame when one is set. Scoped to this inner
          Group rather than the outer Group above: the outer Group also carries UI chrome (the W×H
          readout, the ⊞ indicator, per-line hit rects) that must stay visible/clickable even while
          content past fixedHeight is being clipped away. Konva clip areas nest via ordinary canvas
          save/clip/restore, so this composes for free with the outer Group's own Type Region
          clipFunc without any manual path-combining. */}
      <Group
        listening={false}
        clipX={0}
        clipY={0}
        clipWidth={fixedHeightClip ? Math.max(layout.width, 4) : undefined}
        clipHeight={fixedHeightClip ? text.fixedHeight : undefined}
      >
        {layout.runs.map((run, i) => (
          <KonvaText
            key={i}
            x={run.x}
            y={run.y}
            text={run.text}
            fontFamily={run.style.fontFamily}
            fontSize={run.style.fontSize}
            fontStyle={`${run.style.italic ? 'italic ' : ''}${run.style.fontWeight}`}
            letterSpacing={run.style.letterSpacing}
            // Already laid out: one line, no wrapping, no alignment box.
            wrap="none"
            lineHeight={1}
            fill={run.style.color}
            fillPriority={gradient ? 'linear-gradient' : 'color'}
            fillLinearGradientColorStops={gradient ? [0, gradient.from, 1, gradient.to] : undefined}
            fillLinearGradientStartPoint={ramp ? { x: ramp.start.x - run.x, y: ramp.start.y - run.y } : undefined}
            fillLinearGradientEndPoint={ramp ? { x: ramp.end.x - run.x, y: ramp.end.y - run.y } : undefined}
            shadowEnabled={text.shadow?.enabled ?? false}
            shadowColor={text.shadow?.color}
            shadowBlur={text.shadow?.blur}
            shadowOffsetX={text.shadow?.offsetX}
            shadowOffsetY={text.shadow?.offsetY}
            stroke={text.strokeWidth > 0 ? text.strokeColor : undefined}
            strokeWidth={text.strokeWidth}
            listening={false}
          />
        ))}
      </Group>

      {selected && !editing && (
        <Line
          points={[0, layout.firstBaselineY, Math.max(layout.width, 4), layout.firstBaselineY]}
          stroke="#38bdf8"
          strokeWidth={1}
          dash={[4, 3]}
          opacity={0.7}
          listening={false}
        />
      )}

      {/* Per-line hit targets — only while selected and not mid-edit, so they never fight the
          editing textarea's own character-range selection or the Group's own drag/select click. */}
      {selected && !editing && onSelectLine && layout.lines.map((line, i) => (
        <Rect
          key={i}
          y={line.y}
          width={Math.max(layout.width, 4)}
          height={line.height}
          fill="transparent"
          onClick={(e) => { e.cancelBubble = true; onSelectLine(i); }}
          onTap={(e) => { e.cancelBubble = true; onSelectLine(i); }}
        />
      ))}

      {/* Overflow indicator for a fixed-height area frame — laid-out content exceeds it and is
          actually being clipped at the bottom edge (see the inner glyph-clip Group above), not
          just silently lost off-frame. Bottom-center, straddling the box's bottom edge, matching
          Photoshop's own placement. Sized in /scale units so the square reads as a fixed ~16
          on-screen px square at any zoom — this file's convention is dividing individual size/
          offset values by scale (as the W×H readout below already does), not wrapping in a
          counter-scaled Group. Not gated on `selected`: visible whether or not the layer is
          selected. A single click/tap is a deliberate no-op (cancelBubble stops it reaching the
          parent Group's own onClick/onDblClick, which would otherwise select/deselect or enter
          edit mode); a double-click/tap auto-fits the frame height to content, undoably. */}
      {layout.overflowing && (
        <Group
          x={Math.max(layout.width, 4) / 2}
          y={text.fixedHeight ?? layout.height}
          onClick={(e) => {
            e.cancelBubble = true;
            e.evt?.preventDefault();
            e.evt?.stopPropagation();
            // TODO: text threading — clicking ⊞ will link this box to another text box
            //       so overflow content flows into the linked box automatically.
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            e.evt?.preventDefault();
            e.evt?.stopPropagation();
            // TODO: text threading — clicking ⊞ will link this box to another text box
            //       so overflow content flows into the linked box automatically.
          }}
          onDblClick={(e) => { e.cancelBubble = true; onAutoFitHeight?.(); }}
          onDblTap={(e) => { e.cancelBubble = true; onAutoFitHeight?.(); }}
          onMouseEnter={() => onOverflowHoverChange?.(true)}
          onMouseLeave={() => onOverflowHoverChange?.(false)}
        >
          <Rect
            x={-8 / scale}
            y={-8 / scale}
            width={16 / scale}
            height={16 / scale}
            fill="#fffbeb"
            stroke="#78350f"
            strokeWidth={1 / scale}
          />
          <KonvaText
            text="⊞"
            x={-7 / scale}
            y={-7.5 / scale}
            fontSize={14 / scale}
            fill="#78350f"
            listening={false}
          />
        </Group>
      )}

      {/* W×H readout while selected (not mid-edit, not mid-drag — the live drag has its own
          preview in StudioCanvas.tsx). This Group already lives inside the zoomed/panned Stage, so
          its position needs no adjustment — but the *font size* is in the same image-space units
          as everything else here, so it would visibly grow/shrink with zoom unless counter-scaled
          by 1/scale, matching the drag-preview readout's own convention. */}
      {selected && !editing && (
        <KonvaText
          text={`W: ${Math.round(layout.width)} px / H: ${Math.round(text.fixedHeight ?? layout.height)} px`}
          x={0}
          y={(text.fixedHeight ?? layout.height) + 6 / scale}
          fontSize={11 / scale}
          fill="#38bdf8"
          listening={false}
        />
      )}
    </Group>

    {/* Type Region's own shape outline. A sibling of the main Group (not a child of it) since that
        Group hides entirely while editing — the outline is exactly what needs to stay visible then,
        so the container's real shape is still readable on canvas behind the editing textarea. Shown
        while editing, hidden once the layer is deselected entirely. */}
    {clip && (editing || selected) && (
      <Group x={text.x} y={text.y} rotation={text.rotation} listening={false}>
        {clip.kind === 'ellipse' ? (
          <Ellipse
            x={clip.x + clip.width / 2 - text.x}
            y={clip.y + clip.height / 2 - text.y}
            radiusX={Math.abs(clip.width) / 2}
            radiusY={Math.abs(clip.height) / 2}
            stroke="#f59e0b"
            strokeWidth={1}
            dash={[5, 4]}
          />
        ) : (
          <Line
            points={clip.points.flatMap(p => [p.x - text.x, p.y - text.y])}
            closed
            stroke="#f59e0b"
            strokeWidth={1}
            dash={[5, 4]}
          />
        )}
      </Group>
    )}
    </>
  );
}
