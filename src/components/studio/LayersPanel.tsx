import { useEffect, useState } from 'react';
import {
  Eye, EyeOff, Lock, Unlock, Plus, Copy, Trash2, SlidersHorizontal, ChevronUp, ChevronDown,
  FolderPlus, ChevronRight, FolderOpen, CornerDownRight, Contrast, Settings2,
} from 'lucide-react';
import { IconButton } from '../ui';
import { cn } from '../ui/cn';
import { StudioPanel } from './StudioPanel';
import { swal } from '../../lib/swalTheme';
import {
  flattenWithPaths, canMove, findLayer, getParent, getSiblings, isDescendantOf, canBeClipBase, type LayerPath,
} from './layerTree';
import { LAYER_TYPE_ICON, BLEND_MODES, type StudioLayer, type LayerSelectMode } from './studioTypes';

/** Where a drop lands relative to the row under the cursor. */
type DropZone = 'above' | 'into' | 'below';

/** The layer immediately beneath `id` among its own siblings — a clipped layer's base. */
function layerBelow(layers: StudioLayer[], id: string): StudioLayer | null {
  const siblings = getSiblings(layers, id);
  const index = siblings.findIndex(l => l.id === id);
  return index > 0 ? siblings[index - 1] : null;
}

interface LayersPanelProps {
  layers: StudioLayer[];
  /** The primary layer — the one the single-layer panels follow. Always the last of `selectedLayerIds`. */
  activeLayerId: string | null;
  /** The full canvas selection; the primary is highlighted more strongly than the rest. */
  selectedLayerIds?: string[];
  onSelect: (id: string, mode?: LayerSelectMode) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onBlendChange: (id: string, blendMode: StudioLayer['blendMode']) => void;
  onAdd: () => void;
  /** Alt-click on the Add-layer button — a truly empty layer, no background copy. */
  onAddBlank: () => void;
  onAddAdjustment: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteMany?: (ids: string[]) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onGroup?: () => void;
  onUngroup?: (id: string) => void;
  onToggleCollapsed?: (id: string) => void;
  /** Clip this layer to the raster layer directly below it, or release it. */
  onToggleClipped?: (id: string) => void;
  /** Adds a mask to this layer if it has none, or removes its existing one. Any layer type may
   *  carry a mask (groups included), so unlike clipping there's no eligibility gate. */
  onToggleMask?: (id: string) => void;
  /** Toggles an existing mask's `enabled` flag without removing it. */
  onToggleMaskEnabled?: (id: string) => void;
  /** Makes this layer's mask (rather than its own content) the current paint target. */
  onSelectMask?: (id: string) => void;
  /** The layer whose mask is currently the paint target, or null. */
  activeMaskLayerId?: string | null;
  /** `index` is read against the destination list *after* the dragged layer is detached. */
  onReparent?: (id: string, newParentId: string | null, index: number) => void;
  /** Explicit "open full settings" intent (the Text/Adjustment panel) — separate from onSelect, so
   *  a plain click never navigates away from this list. No-ops for layer types without a panel. */
  onOpenSettings?: (id: string) => void;
  /**
   * Which row has its properties (opacity/blend/actions) disclosed.
   *
   * Lifted to `Studio` rather than kept here: selecting a text or adjustment layer used to
   * auto-switch the dock to that layer's panel, which shared a region with this one — so this
   * panel would unmount and local state would be lost. Selecting a layer no longer does that (see
   * Studio.tsx's `selectLayer`), but `expandedLayerId` stays lifted since other dock tabs can still
   * come and go around this panel.
   */
  expandedLayerId: string | null;
  onToggleExpanded: (id: string) => void;
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name.
   *  Layers has no collapse chevron of its own — the panel stack keeps it always expanded, filling
   *  remaining column space, per its "never fully hide the layer list" design goal. */
  hideTitle?: boolean;
}

export function LayersPanel({
  layers, activeLayerId, selectedLayerIds, onSelect, onToggleVisible, onToggleLocked,
  onOpacityChange, onBlendChange, onAdd, onAddBlank, onAddAdjustment, onDuplicate, onDelete, onDeleteMany, onRename, onMove,
  onGroup, onUngroup, onToggleCollapsed, onToggleClipped, onToggleMask, onToggleMaskEnabled, onSelectMask,
  activeMaskLayerId, onReparent, onOpenSettings, expandedLayerId, onToggleExpanded,
  hideTitle,
}: LayersPanelProps) {
  const selected = selectedLayerIds ?? (activeLayerId ? [activeLayerId] : []);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function commitRename() {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const trimmed = renameValue.trim();
    if (trimmed) onRename(id, trimmed);
  }

  // Esc while a row's inline settings are open just closes them back to the plain list — it never
  // needed to navigate anywhere to begin with, so there's nothing else to restore.
  useEffect(() => {
    if (!expandedLayerId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onToggleExpanded(expandedLayerId!);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedLayerId, onToggleExpanded]);

  function deleteLayerOrSelection(id: string) {
    const ids = selected.includes(id) && selected.length > 1 ? selected : [id];
    if (ids.length > 1 && onDeleteMany) onDeleteMany(ids);
    else onDelete(id);
  }

  async function openContextMenu(e: React.MouseEvent, layer: StudioLayer) {
    e.preventDefault();
    e.stopPropagation();
    const options: Record<string, string> = {
      select: 'Select',
      rename: 'Rename…',
      duplicate: 'Duplicate',
      visibility: layer.visible ? 'Hide' : 'Show',
      ...(layer.isBackground ? {} : { lock: layer.locked ? 'Unlock' : 'Lock' }),
      moveUp: 'Move Up',
      moveDown: 'Move Down',
      ...(layer.isBackground ? {} : { delete: 'Delete' }),
    };
    const result = await swal({
      title: layer.name,
      input: 'select',
      inputOptions: options,
      inputPlaceholder: 'Choose an action',
      showCancelButton: true,
      confirmButtonText: 'Go',
    });
    if (!result.isConfirmed || !result.value) return;
    switch (result.value as string) {
      case 'select': onSelect(layer.id, 'replace'); break;
      case 'rename': {
        const renamed = await swal({
          title: 'Rename Layer',
          input: 'text',
          inputValue: layer.name,
          showCancelButton: true,
          confirmButtonText: 'Rename',
        });
        if (renamed.isConfirmed && typeof renamed.value === 'string' && renamed.value.trim()) {
          onRename(layer.id, renamed.value.trim());
        }
        break;
      }
      case 'duplicate': onDuplicate(layer.id); break;
      case 'visibility': onToggleVisible(layer.id); break;
      case 'lock': onToggleLocked(layer.id); break;
      case 'moveUp': onMove(layer.id, 'up'); break;
      case 'moveDown': onMove(layer.id, 'down'); break;
      case 'delete': deleteLayerOrSelection(layer.id); break;
    }
  }

  // Render top-most layer first, matching Photoshop's stacking convention. Reversing the flattened
  // walk puts a group directly above its own children, which is the order the panel wants to indent.
  const ordered = [...flattenWithPaths(layers)]
    .reverse()
    .filter(({ path }) => !isInsideCollapsedGroup(layers, path));

  /** True when any ancestor of `path` is a collapsed group — those rows stay hidden. */
  function isInsideCollapsedGroup(list: StudioLayer[], path: LayerPath): boolean {
    let current = list;
    for (let i = 0; i < path.length - 1; i += 1) {
      const ancestor = current[path[i]];
      if (!ancestor) return false;
      if (ancestor.collapsed) return true;
      current = ancestor.children ?? [];
    }
    return false;
  }

  /** Splits the row into three drop zones by cursor position: outer quarters insert above/below,
   *  the middle half drops *into* a group. Only groups accept 'into'. */
  function zoneFor(e: React.DragEvent, layer: StudioLayer): DropZone {
    const rect = e.currentTarget.getBoundingClientRect();
    const offset = (e.clientY - rect.top) / rect.height;
    if (layer.type === 'group' && offset > 0.25 && offset < 0.75) return 'into';
    // The panel is top-most-first, so visually "above" is a *higher* index in the data.
    return offset < 0.5 ? 'above' : 'below';
  }

  /** Whether a drop is even conceivable. `layerTree.reparent` is the real authority and no-ops on
   *  anything illegal; this only exists so the UI doesn't advertise a drop that can't happen. */
  function canDrop(id: string, target: StudioLayer, zone: DropZone): boolean {
    if (id === target.id) return false;
    if (target.isBackground && zone !== 'above') return false;
    if (findLayer(layers, id)?.isBackground) return false;
    if (isDescendantOf(layers, target.id, id)) return false;
    if (zone === 'into' && target.type !== 'group') return false;
    return true;
  }

  function handleDrop(target: StudioLayer, zone: DropZone) {
    const id = dragId;
    setDragId(null);
    setDropTarget(null);
    if (!id || !onReparent || !canDrop(id, target, zone)) return;

    if (zone === 'into') {
      // Drop on top of the group's existing children.
      onReparent(id, target.id, (target.children ?? []).length);
      return;
    }

    const parent = getParent(layers, target.id);
    const siblings = parent ? parent.children ?? [] : layers;
    const targetIndex = siblings.findIndex(s => s.id === target.id);
    if (targetIndex < 0) return;

    // `reparent` detaches before inserting, so an index past the dragged layer's own old slot in
    // the same list shifts down by one. Computing this against the pre-move list is the classic
    // off-by-one here.
    const draggedIndex = siblings.findIndex(s => s.id === id);
    let index = zone === 'above' ? targetIndex + 1 : targetIndex;
    if (draggedIndex >= 0 && draggedIndex < index) index -= 1;

    onReparent(id, parent?.id ?? null, index);
  }

  return (
    <StudioPanel
      title="Layers"
      hideTitle={hideTitle}
      bare
      bodyClassName="py-1.5 px-1.5 flex flex-col gap-1"
      actions={
        <>
          <IconButton size="sm" aria-label="Group layers" title="Group selected layers" onClick={onGroup} className="!bg-transparent">
            <FolderPlus size={13} />
          </IconButton>
          <IconButton size="sm" aria-label="Add adjustment layer" title="Add adjustment layer" onClick={onAddAdjustment} className="!bg-transparent">
            <SlidersHorizontal size={13} />
          </IconButton>
          <IconButton
            size="sm"
            aria-label="Add layer"
            title="Add raster layer (Alt-click for a blank layer, no background copy)"
            onClick={(e) => { if (e.altKey) onAddBlank(); else onAdd(); }}
            className="!bg-transparent"
          >
            <Plus size={14} />
          </IconButton>
        </>
      }
    >
        {ordered.map(({ layer, depth }) => {
          const Icon = LAYER_TYPE_ICON[layer.type];
          const active = layer.id === activeLayerId;
          const inSelection = selected.includes(layer.id);
          const expanded = expandedLayerId === layer.id;
          const isGroup = layer.type === 'group';
          const isRenaming = renamingId === layer.id;
          const drop = dropTarget?.id === layer.id ? dropTarget.zone : null;

          return (
            <div
              key={layer.id}
              draggable={!layer.isBackground && !!onReparent}
              onDragStart={() => setDragId(layer.id)}
              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
              onDragOver={(e) => {
                if (!dragId || !onReparent) return;
                const zone = zoneFor(e, layer);
                if (!canDrop(dragId, layer, zone)) return;
                e.preventDefault();
                setDropTarget({ id: layer.id, zone });
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => { e.preventDefault(); handleDrop(layer, zoneFor(e, layer)); }}
              onContextMenu={(e) => openContextMenu(e, layer)}
              style={{ marginLeft: depth * 12 }}
              className={cn(
                'group rounded-control border transition-colors',
                dragId === layer.id && 'opacity-40',
                // The drop affordance has to say *which* of the three things will happen.
                drop === 'into' && 'ring-1 ring-accent',
                drop === 'above' && 'border-t-2 !border-t-accent',
                drop === 'below' && 'border-b-2 !border-b-accent',
                active ? 'bg-accent-soft border-accent/30'
                  // Also selected, but not the primary — dimmer, so it's clear which layer the
                  // single-layer panels are actually following.
                  : inSelection ? 'bg-accent-soft/40 border-accent/20'
                  : 'bg-ink/5 border-transparent hover:bg-ink/5'
              )}
            >
              {(() => {
                const rowInner = (
                  <>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                      onClick={(e) => { e.stopPropagation(); onToggleVisible(layer.id); }}
                      className="shrink-0 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink"
                    >
                      {layer.visible ? <Eye size={14} /> : <EyeOff size={14} className="opacity-40" />}
                    </span>

                    {/* Collapse chevron — a group's *subtree* visibility in the panel, which is a
                        different thing from `expandedId` (this row's own properties disclosure). */}
                    {isGroup ? (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={layer.collapsed ? `Expand ${layer.name}` : `Collapse ${layer.name}`}
                        onClick={(e) => { e.stopPropagation(); onToggleCollapsed?.(layer.id); }}
                        className="shrink-0 w-4 h-6 flex items-center justify-center text-ink-faint hover:text-ink"
                      >
                        {layer.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </span>
                    ) : (
                      <span className="shrink-0 w-4" />
                    )}

                    <span className={cn('shrink-0 w-6 h-6 rounded-control flex items-center justify-center', active ? 'text-accent' : 'text-ink-faint')}>
                      {isGroup && !layer.collapsed ? <FolderOpen size={14} /> : <Icon size={14} />}
                    </span>

                    {/* Mask chip — always visible (not gated behind the row's own disclosure) so it's
                        reachable with one click, matching Photoshop's layer-thumbnail/mask-thumbnail
                        pair. Not a live pixel preview (that would need a new thumbnail-rendering
                        pipeline); just an indicator of presence/enabled/active-paint-target state. */}
                    {layer.mask && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={activeMaskLayerId === layer.id ? `Stop editing ${layer.name}'s mask` : `Edit ${layer.name}'s mask`}
                        title={layer.mask.enabled ? 'Layer mask (click to edit)' : 'Layer mask (disabled)'}
                        onClick={(e) => { e.stopPropagation(); onSelectMask?.(layer.id); }}
                        className={cn(
                          'shrink-0 w-5 h-5 rounded border flex items-center justify-center',
                          activeMaskLayerId === layer.id ? 'border-accent bg-accent-soft text-accent'
                            : layer.mask.enabled ? 'border-hairline text-ink-faint hover:text-ink'
                            : 'border-hairline text-ink-faint/40'
                        )}
                      >
                        <Contrast size={11} />
                      </span>
                    )}

                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={commitRename}
                        className="flex-1 min-w-0 bg-ink/10 border border-accent/40 rounded-control px-1.5 py-0.5 text-ui text-ink outline-none"
                      />
                    ) : (
                      <span
                        className={cn('flex-1 min-w-0 text-left text-ui font-medium truncate', active ? 'text-ink' : 'text-ink/80')}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setRenameValue(layer.name);
                          setRenamingId(layer.id);
                        }}
                      >
                        {layer.name}
                      </span>
                    )}

                    {!layer.isBackground && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                        onClick={(e) => { e.stopPropagation(); onToggleLocked(layer.id); }}
                        className="shrink-0 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink"
                      >
                        {layer.locked ? <Lock size={13} /> : <Unlock size={13} className="opacity-30" />}
                      </span>
                    )}

                    {/* Settings — always the same inline-expansion this row already supports, just
                        reachable without needing a double-click. Visible on hover, always on touch
                        (no hover state to reveal it there). */}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={expanded ? `Close ${layer.name} settings` : `Open ${layer.name} settings`}
                      onClick={(e) => { e.stopPropagation(); onToggleExpanded(layer.id); }}
                      className={cn(
                        'shrink-0 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-ink transition-opacity',
                        'opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100',
                        expanded && 'opacity-100 text-accent'
                      )}
                    >
                      <Settings2 size={13} />
                    </span>

                    {/* Trash — a quick one-click delete without expanding the row first. Hover-only on a
                        fine pointer, always visible on touch (there's no hover state to reveal it).
                        Named "Remove", not "Delete" — an `opacity-0` element still matches
                        role/name locators (Playwright's visibility check doesn't look at opacity),
                        so sharing the word "Delete" with the expanded row's own "Delete layer"
                        button made every `getByRole('button', { name: 'Delete layer' })` in the
                        existing e2e suite ambiguous, and `.first()` could silently pick this one. */}
                    {!layer.isBackground && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Remove ${layer.name}`}
                        onClick={(e) => { e.stopPropagation(); deleteLayerOrSelection(layer.id); }}
                        className="shrink-0 w-6 h-6 flex items-center justify-center text-ink-faint hover:text-red-400 transition-opacity opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                      >
                        <Trash2 size={13} />
                      </span>
                    )}
                  </>
                );
                // A real <button> whenever possible (matches every other row-as-button convention
                // in this panel and keeps plain `locator('button')` queries working) — an <input>
                // can't validly nest inside one, so renaming swaps to a plain <div> for that one row.
                // A click both selects and toggles this row's own inline opacity/blend/actions
                // strip — that's a local expansion within this same list, not a navigation, so it
                // never violates "the list stays visible". Only jumping to the *separate*
                // Text/Adjustment panel (`onOpenSettings`, in the expanded strip below) was the
                // actual navigate-away bug; plain selection never touched that.
                return isRenaming ? (
                  <div className="w-full flex items-center gap-2 px-2 h-11">{rowInner}</div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      onSelect(layer.id, e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
                      onToggleExpanded(layer.id);
                    }}
                    className="w-full flex items-center gap-2 px-2 h-11"
                  >
                    {rowInner}
                  </button>
                );
              })()}

              {expanded && (
                <div className="px-3 pb-2.5 pt-0.5 flex flex-col gap-2 border-t border-hairline/60 mx-2">
                  {!layer.isBackground && (
                    <>
                      <label className="flex items-center gap-2 text-micro text-ink-faint">
                        <span className="w-14 shrink-0">Opacity</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(layer.opacity * 100)}
                          onChange={(e) => onOpacityChange(layer.id, Number(e.target.value) / 100)}
                          className="flex-1 accent-[var(--color-accent)]"
                        />
                        <span className="w-8 text-right tabular-nums">{Math.round(layer.opacity * 100)}</span>
                      </label>

                      {/* No blend control for adjustment layers. Photoshop blends an adjustment's
                          result against its unadjusted backdrop, and our adjustment wraps the very
                          stack it would need as that backdrop — so there's nothing to blend with.
                          Opacity works (it's folded into the filter as a strength); blend can't be,
                          and an inert dropdown would be worse than none. */}
                      {layer.type !== 'adjustment' && (
                        <label className="flex items-center gap-2 text-micro text-ink-faint">
                          <span className="w-14 shrink-0">Blend</span>
                          <select
                            value={layer.blendMode}
                            onChange={(e) => onBlendChange(layer.id, e.target.value as StudioLayer['blendMode'])}
                            className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
                          >
                            {BLEND_MODES.map(bm => <option key={bm.id} value={bm.id}>{bm.label}</option>)}
                          </select>
                        </label>
                      )}
                    </>
                  )}

                  <div className="flex items-center gap-1 pt-0.5">
                    {/* Bounds come from layerTree — a root-array index comparison is meaningless
                        once a layer can sit inside a group. */}
                    <IconButton size="sm" aria-label="Move up" disabled={!canMove(layers, layer.id, 'up')} onClick={() => onMove(layer.id, 'up')} className="!bg-transparent !w-7 !h-7">
                      <ChevronUp size={13} />
                    </IconButton>
                    <IconButton size="sm" aria-label="Move down" disabled={!canMove(layers, layer.id, 'down')} onClick={() => onMove(layer.id, 'down')} className="!bg-transparent !w-7 !h-7">
                      <ChevronDown size={13} />
                    </IconButton>
                    {onToggleMask && !layer.isBackground && layer.type !== 'adjustment' && (
                      <IconButton
                        size="sm"
                        aria-label={layer.mask ? 'Delete mask' : 'Add mask'}
                        title={layer.mask ? 'Delete layer mask' : 'Add layer mask (from selection, or reveal-all)'}
                        onClick={() => onToggleMask(layer.id)}
                        className="!bg-transparent !w-7 !h-7"
                      >
                        <Contrast size={12} className={layer.mask ? 'text-accent' : undefined} />
                      </IconButton>
                    )}
                    {layer.mask && onToggleMaskEnabled && (
                      <IconButton
                        size="sm"
                        aria-label={layer.mask.enabled ? 'Disable layer mask' : 'Enable layer mask'}
                        title={layer.mask.enabled ? 'Disable layer mask' : 'Enable layer mask'}
                        onClick={() => onToggleMaskEnabled(layer.id)}
                        className="!bg-transparent !w-7 !h-7"
                      >
                        {layer.mask.enabled ? <Eye size={12} /> : <EyeOff size={12} className="opacity-40" />}
                      </IconButton>
                    )}
                    {onToggleClipped && !layer.isBackground && (
                      <IconButton
                        size="sm"
                        aria-label={layer.clipped ? 'Release clipping mask' : 'Create clipping mask'}
                        title={
                          layer.clipped ? 'Release clipping mask'
                            : canBeClipBase(layerBelow(layers, layer.id)) ? 'Clip to the layer below'
                            : 'Clipping needs a raster layer directly below'
                        }
                        disabled={!layer.clipped && !canBeClipBase(layerBelow(layers, layer.id))}
                        onClick={() => onToggleClipped(layer.id)}
                        className="!bg-transparent !w-7 !h-7"
                      >
                        <CornerDownRight size={12} className={layer.clipped ? 'text-accent' : undefined} />
                      </IconButton>
                    )}
                    <div className="flex-1" />
                    {onOpenSettings && (layer.type === 'text' || layer.type === 'adjustment') && (
                      <IconButton size="sm" aria-label="Open layer settings" title="Open full settings (Text/Adjustment panel)" onClick={() => onOpenSettings(layer.id)} className="!bg-transparent !w-7 !h-7">
                        <Settings2 size={12} />
                      </IconButton>
                    )}
                    {isGroup && onUngroup && (
                      <IconButton size="sm" aria-label="Ungroup layers" title="Ungroup" onClick={() => onUngroup(layer.id)} className="!bg-transparent !w-7 !h-7">
                        <FolderOpen size={12} />
                      </IconButton>
                    )}
                    <IconButton size="sm" aria-label="Duplicate layer" onClick={() => onDuplicate(layer.id)} className="!bg-transparent !w-7 !h-7">
                      <Copy size={12} />
                    </IconButton>
                    {!layer.isBackground && (
                      <IconButton size="sm" aria-label="Delete layer" onClick={() => onDelete(layer.id)} className="!bg-transparent !w-7 !h-7 hover:!text-red-400">
                        <Trash2 size={12} />
                      </IconButton>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </StudioPanel>
  );
}
