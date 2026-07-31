import { useEffect, useMemo, useRef, useState } from 'react';
import { Target, RotateCcw, Plus, Trash2, Copy, Download, Upload, Layers as LayersIcon, Pencil, Check, FolderPlus, Wand2, Play, Maximize2, Eye, EyeOff, FolderDown, Minus } from 'lucide-react';
import { Textarea, IconButton } from '../ui';
import { cn } from '../ui/cn';
import { swal, swalToast } from '../../lib/swalTheme';
import { StudioPanel } from './StudioPanel';
import {
  parseTyperScript, createTyperStyle, createTyperFolder, renameFolder, deleteTyperFolder,
  buildFolderTree, flattenFolderTree, FONT_FAMILIES, type TyperStyle, type TyperFolder,
} from './studioTypes';

export interface TyperPanelProps {
  script: string;
  onScriptChange: (script: string) => void;
  styles: TyperStyle[];
  onStylesChange: (styles: TyperStyle[]) => void;
  folders: TyperFolder[];
  onFoldersChange: (folders: TyperFolder[]) => void;
  ignoreLinePrefixes: string[];
  onIgnoreLinePrefixesChange: (prefixes: string[]) => void;
  ignoreTags: string[];
  onIgnoreTagsChange: (tags: string[]) => void;
  defaultStyleId: string | null;
  onDefaultStyleIdChange: (id: string | null) => void;
  /** Flood-fills from an armed placement click to find & size/center the new layer in its bubble. */
  autoCenterBubble: boolean;
  onAutoCenterBubbleChange: (enabled: boolean) => void;
  /** Font-size step shared by the per-style quick +/- buttons and the global text-size shortcut. */
  sizeStep: number;
  onSizeStepChange: (step: number) => void;
  index: number;
  onIndexChange: (index: number) => void;
  armed: boolean;
  onArmedChange: (armed: boolean) => void;
  /** Built-in fonts plus any custom fonts installed via the Fonts panel. */
  fontFamilies?: string[];
  /** Multi-Bubble mode: draw a rect per bubble (Rectangular Marquee), queue it, then place every
   *  queued rect's line in one go instead of one click-to-place bubble at a time. */
  multiBubbleMode: boolean;
  onMultiBubbleModeChange: (enabled: boolean) => void;
  queuedBubbleCount: number;
  onAddBubbleRect: () => void;
  onPlaceAllBubbles: () => void;
  /** Removes the most recently queued bubble capture (LIFO, one at a time). */
  onRemoveLastBubble: () => void;
  /** Removes every queued bubble capture at once — wired to a 2s-hold gesture on the same button
   *  that does the one-at-a-time removal, not a separate control. */
  onClearAllBubbles: () => void;
  /** Script-line indices already placed onto the canvas — drives the ✓ badge in the line list.
   *  Cleared by the caller on script change / Reset progress, not owned by this panel. */
  placedIndices: ReadonlySet<number>;
  /** Pops this panel out into its own floating window (Studio.tsx's TyperFloatingWindow). Omitted
   *  when this instance is already the floating one, or in any standalone/test usage — the button
   *  simply doesn't render without it. */
  onPopOut?: () => void;
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name. */
  hideTitle?: boolean;
}

/** newline-or-semicolon-separated textarea value, same convention as a style's Prefixes field. */
function parseListField(value: string): string[] {
  return value.split(/(?:\r?\n|;)/).map(s => s.trim()).filter(Boolean);
}

export function TyperPanel({
  script, onScriptChange, styles, onStylesChange, folders, onFoldersChange,
  ignoreLinePrefixes, onIgnoreLinePrefixesChange, ignoreTags, onIgnoreTagsChange,
  defaultStyleId, onDefaultStyleIdChange, autoCenterBubble, onAutoCenterBubbleChange,
  sizeStep, onSizeStepChange,
  index, onIndexChange, armed, onArmedChange,
  fontFamilies = FONT_FAMILIES,
  multiBubbleMode, onMultiBubbleModeChange, queuedBubbleCount, onAddBubbleRect, onPlaceAllBubbles,
  onRemoveLastBubble, onClearAllBubbles, placedIndices,
  onPopOut, hideTitle,
}: TyperPanelProps) {
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Hold-to-clear-all on the "-" bubble-remove button: a quick press/release removes one (LIFO); a
  // continuous hold past 2s clears the whole queue instead, with a red warning after 1s so the user
  // sees it coming before it fires. Cancelled (no removal at all) if the pointer leaves the button.
  const removeHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeWarnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeClearedByHoldRef = useRef(false);
  const [removeHoldWarning, setRemoveHoldWarning] = useState(false);

  function clearRemoveHoldTimers() {
    if (removeHoldTimerRef.current !== null) { clearTimeout(removeHoldTimerRef.current); removeHoldTimerRef.current = null; }
    if (removeWarnTimerRef.current !== null) { clearTimeout(removeWarnTimerRef.current); removeWarnTimerRef.current = null; }
    setRemoveHoldWarning(false);
  }
  function onRemovePointerDown() {
    removeClearedByHoldRef.current = false;
    removeWarnTimerRef.current = setTimeout(() => setRemoveHoldWarning(true), 1000);
    removeHoldTimerRef.current = setTimeout(() => {
      removeClearedByHoldRef.current = true;
      clearRemoveHoldTimers();
      onClearAllBubbles();
    }, 2000);
  }
  function onRemovePointerUp() {
    const heldToClear = removeClearedByHoldRef.current;
    clearRemoveHoldTimers();
    if (!heldToClear) onRemoveLastBubble();
  }
  function onRemovePointerLeave() {
    clearRemoveHoldTimers();
  }
  const lines = useMemo(() => parseTyperScript(script, styles, { folders, ignoreLinePrefixes, ignoreTags, defaultStyleId }), [script, styles, folders, ignoreLinePrefixes, ignoreTags, defaultStyleId]);
  const current = lines[index] ?? null;
  const done = lines.length > 0 && index >= lines.length;
  const currentRowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const folderOptions = useMemo(() => flattenFolderTree(folderTree), [folderTree]);
  const unsortedStyles = styles.filter(s => !s.folderId);

  function updateStyle(id: string, patch: Partial<TyperStyle>) {
    onStylesChange(styles.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  function addStyle(folderId: string | null = null) {
    const style = createTyperStyle(`Style ${styles.length + 1}`, folderId);
    onStylesChange([...styles, style]);
    setEditingStyleId(style.id);
  }

  function duplicateStyle(id: string) {
    const source = styles.find(s => s.id === id);
    if (!source) return;
    const copy = { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} copy` };
    onStylesChange([...styles, copy]);
  }

  function deleteStyle(id: string) {
    if (styles.length <= 1) return;
    onStylesChange(styles.filter(s => s.id !== id));
    if (defaultStyleId === id) onDefaultStyleIdChange(null);
  }

  function addFolder(parentId: string | null) {
    const folder = createTyperFolder(folders, 'New Folder', parentId);
    onFoldersChange([...folders, folder]);
    setEditingFolderId(folder.id);
  }

  function commitFolderName(id: string, name: string) {
    onFoldersChange(renameFolder(folders, id, name));
    setEditingFolderId(null);
  }

  function removeFolder(id: string) {
    const result = deleteTyperFolder(folders, styles, id);
    onFoldersChange(result.folders);
    onStylesChange(result.styles);
  }

  function exportTyperJson() {
    const payload = { script, styles, folders, ignoreLinePrefixes, ignoreTags, defaultStyleId };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TypeR_Export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Exports only one folder's own styles (not its sub-folders' — a flat export matching how
   *  `styles.filter(s => s.folderId === folderId)` scopes everywhere else in this panel), reusing
   *  the same swal `input:'select'` picker pattern already used throughout the Studio for a single
   *  choice (`LayersPanel`/`BrushesPanel`'s context menus). */
  async function exportFolderJson() {
    if (folders.length === 0) {
      swalToast({ icon: 'info', title: 'No folders to export' });
      return;
    }
    const inputOptions = Object.fromEntries(folderOptions.map(opt => [opt.id, opt.label]));
    const result = await swal({
      title: 'Export Folder',
      input: 'select',
      inputOptions,
      inputPlaceholder: 'Choose a folder',
      showCancelButton: true,
      confirmButtonText: 'Export',
    });
    const folderId = result.value as string | undefined;
    if (!result.isConfirmed || !folderId) return;
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;
    const folderStylesOnly = styles.filter(s => s.folderId === folderId);
    const payload = { folders: [folder], styles: folderStylesOnly };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TypeR_${folder.name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importTyperJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.styles)) throw new Error('Missing styles array');
      onStylesChange(parsed.styles);
      if (Array.isArray(parsed.folders)) onFoldersChange(parsed.folders);
      if (typeof parsed.script === 'string') onScriptChange(parsed.script);
      swalToast({ icon: 'success', title: 'TypeR styles imported' });
    } catch (err) {
      swal({ icon: 'error', title: 'Import Failed', text: err instanceof Error ? err.message : 'Invalid TypeR JSON file.' });
    }
  }

  function renderStyleCard(style: TyperStyle) {
    const expanded = editingStyleId === style.id;
    const enabled = style.enabled !== false;
    return (
      <div key={style.id} className={cn('rounded-control border border-hairline bg-ink/5', !enabled && 'opacity-50')}>
        <div className="w-full flex items-center gap-1 px-2.5 h-9">
          <IconButton
            size="sm"
            active={!enabled}
            aria-label={enabled ? `Disable ${style.name}` : `Enable ${style.name}`}
            title={enabled ? 'Disable style (won’t match a prefix while off)' : 'Enable style'}
            onClick={() => updateStyle(style.id, { enabled: !enabled })}
            className="!bg-transparent !w-6 !h-6 shrink-0"
          >
            {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
          </IconButton>
          <button
            type="button"
            onClick={() => setEditingStyleId(expanded ? null : style.id)}
            className="flex-1 flex items-center gap-2 text-left min-w-0"
          >
            <span className="text-ui font-medium text-ink flex-1 truncate">{style.name}</span>
            {style.prefix && <span className="text-micro font-mono text-ink-faint shrink-0">{style.prefix}</span>}
          </button>
          {/* Quick text-size editor — no need to expand the full style card just to bump a size. */}
          <div className="flex items-center gap-0.5 shrink-0">
            <IconButton size="sm" aria-label="Decrease size" onClick={() => updateStyle(style.id, { fontSize: Math.max(6, style.fontSize - sizeStep) })} className="!bg-transparent !w-6 !h-6">
              <span className="text-ui">−</span>
            </IconButton>
            <span className="text-micro font-mono text-ink-faint w-6 text-center">{style.fontSize}</span>
            <IconButton size="sm" aria-label="Increase size" onClick={() => updateStyle(style.id, { fontSize: Math.min(200, style.fontSize + sizeStep) })} className="!bg-transparent !w-6 !h-6">
              <span className="text-ui">+</span>
            </IconButton>
          </div>
          <IconButton size="sm" aria-label="Duplicate style" title="Duplicate style" onClick={() => duplicateStyle(style.id)} className="!bg-transparent !w-6 !h-6">
            <Copy size={11} />
          </IconButton>
          <IconButton size="sm" aria-label="Delete style" title="Delete style" disabled={styles.length <= 1} onClick={() => deleteStyle(style.id)} className="!bg-transparent !w-6 !h-6 hover:!text-danger">
            <Trash2 size={11} />
          </IconButton>
        </div>
        {expanded && (
          <div className="px-2.5 pb-2.5 flex flex-col gap-2 border-t border-hairline/60">
            <div className="flex items-center gap-2 pt-2">
              <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                <span className="w-10 shrink-0">Name</span>
                <input
                  value={style.name}
                  onChange={(e) => updateStyle(style.id, { name: e.target.value })}
                  className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                <span className="w-14 shrink-0">Folder</span>
                <select
                  value={style.folderId ?? ''}
                  onChange={(e) => updateStyle(style.id, { folderId: e.target.value || null })}
                  className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
                >
                  <option value="">No folder</option>
                  {folderOptions.map(opt => (
                    <option key={opt.id} value={opt.id}>{''.padStart(opt.depth * 2, ' ')}{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-micro text-ink-faint">
              <span className="w-14 shrink-0">Font</span>
              <select
                value={style.fontFamily}
                onChange={(e) => updateStyle(style.id, { fontFamily: e.target.value })}
                className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
              >
                {fontFamilies.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-micro text-ink-faint">
              <span className="w-14 shrink-0">Prefix</span>
              <input
                value={style.prefix}
                onChange={(e) => updateStyle(style.id, { prefix: e.target.value })}
                className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro font-mono"
              />
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                <span className="shrink-0">Size</span>
                <input
                  type="number"
                  min={6}
                  max={200}
                  value={style.fontSize}
                  onChange={(e) => updateStyle(style.id, { fontSize: Number(e.target.value) || style.fontSize })}
                  className="w-full bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
                />
              </label>
              <input
                type="color"
                value={style.color}
                onChange={(e) => updateStyle(style.id, { color: e.target.value })}
                className="w-8 h-7 rounded-control border border-hairline bg-transparent"
              />
            </div>
            <div className="flex items-center gap-1">
              <IconButton size="sm" active={style.bold} aria-label="Bold" onClick={() => updateStyle(style.id, { bold: !style.bold })} className="!bg-transparent !w-7 !h-7">
                <span className="text-ui font-bold">B</span>
              </IconButton>
              <IconButton size="sm" active={style.italic} aria-label="Italic" onClick={() => updateStyle(style.id, { italic: !style.italic })} className="!bg-transparent !w-7 !h-7">
                <span className="text-ui italic">I</span>
              </IconButton>
              <div className="w-px h-5 bg-hairline mx-1" />
              <input
                type="color"
                title="Stroke color"
                value={style.strokeColor}
                onChange={(e) => updateStyle(style.id, { strokeColor: e.target.value })}
                className="w-7 h-7 rounded-control border border-hairline bg-transparent"
              />
              <input
                type="range"
                min={0}
                max={8}
                step={0.5}
                value={style.strokeWidth}
                onChange={(e) => updateStyle(style.id, { strokeWidth: Number(e.target.value) })}
                className="flex-1 accent-[var(--color-accent)]"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderFolderNode(node: ReturnType<typeof buildFolderTree>[number]): React.ReactNode {
    const folderStyles = styles.filter(s => s.folderId === node.id);
    const isEditingName = editingFolderId === node.id;
    return (
      <details key={node.id} open className="group">
        <summary className="flex items-center gap-1.5 text-micro text-ink-faint uppercase tracking-wide cursor-pointer select-none py-1">
          {isEditingName ? (
            <input
              autoFocus
              defaultValue={node.name}
              onClick={(e) => e.preventDefault()}
              onBlur={(e) => commitFolderName(node.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="flex-1 bg-ink/5 border border-hairline rounded px-1 py-0.5 text-ink normal-case tracking-normal"
            />
          ) : (
            <span className="flex-1">{node.name}</span>
          )}
          <IconButton size="sm" aria-label="Rename folder" title="Rename folder" onClick={(e) => { e.preventDefault(); setEditingFolderId(node.id); }} className="!bg-transparent !w-5 !h-5">
            {isEditingName ? <Check size={11} /> : <Pencil size={11} />}
          </IconButton>
          <IconButton size="sm" aria-label="Add sub-folder" title="Add sub-folder" onClick={(e) => { e.preventDefault(); addFolder(node.id); }} className="!bg-transparent !w-5 !h-5">
            <FolderPlus size={11} />
          </IconButton>
          <IconButton size="sm" aria-label="Add style here" title="Add style in this folder" onClick={(e) => { e.preventDefault(); addStyle(node.id); }} className="!bg-transparent !w-5 !h-5">
            <Plus size={11} />
          </IconButton>
          <IconButton size="sm" aria-label="Delete folder" title="Delete folder (styles become unsorted)" onClick={(e) => { e.preventDefault(); removeFolder(node.id); }} className="!bg-transparent !w-5 !h-5 hover:!text-danger">
            <Trash2 size={11} />
          </IconButton>
        </summary>
        <div className="flex flex-col gap-2 pl-2.5">
          {folderStyles.map(renderStyleCard)}
          {node.children.map(renderFolderNode)}
        </div>
      </details>
    );
  }

  return (
    <StudioPanel
      title="TypeR"
      hideTitle={hideTitle}
      actions={
        <>
          <IconButton size="sm" aria-label="Import TypeR JSON" title="Import TypeR JSON" onClick={() => importInputRef.current?.click()} className="!bg-transparent">
            <Upload size={13} />
          </IconButton>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={importTyperJson} />
          <IconButton size="sm" aria-label="Export TypeR JSON" title="Export all styles and folders as JSON" onClick={exportTyperJson} className="!bg-transparent">
            <Download size={13} />
          </IconButton>
          <IconButton size="sm" aria-label="Export folder" title="Export only one folder's styles as JSON" onClick={() => void exportFolderJson()} className="!bg-transparent">
            <FolderDown size={13} />
          </IconButton>
          <IconButton
            size="sm"
            aria-label="Reset progress"
            title="Reset progress"
            onClick={() => { onIndexChange(0); onArmedChange(false); }}
            className="!bg-transparent"
          >
            <RotateCcw size={13} />
          </IconButton>
          {onPopOut && (
            <IconButton size="sm" aria-label="Float TypeR" title="Pop out into a floating window" onClick={onPopOut} className="!bg-transparent">
              <Maximize2 size={13} />
            </IconButton>
          )}
        </>
      }
    >
        <Textarea
          value={script}
          onChange={(e) => { onScriptChange(e.target.value); onIndexChange(0); }}
          placeholder={'Paste a script, one line per bubble.\nPrefix lines to pick a style, e.g.\n!! for SFX, ~ for Thought.\n## note (ignored)\n// continuation of the previous line\nPage 3 (auto-switches when reached)'}
          rows={6}
          className="!text-ui !font-mono"
        />

        <div className="flex items-center justify-between text-micro text-ink-faint">
          <span>{lines.length > 0 ? `Line ${Math.min(index + 1, lines.length)} / ${lines.length}` : 'No lines yet'}</span>
          <div className="flex items-center gap-1.5">
            {current?.pageHint && <span className="px-1.5 py-0.5 rounded bg-ink/10 text-ink-faint">Page {current.pageHint}</span>}
            {current && <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent">{current.style.name}</span>}
          </div>
        </div>

        {/* Every parsed line, numbered and individually clickable — clicking one jumps straight to
            it (a direct trSetCur-style index set, not an advance) without visiting the lines in
            between. Ctrl+Enter-style sequential advance (placing a bubble on canvas) stays the
            existing +1 path in Studio.tsx's handleAddTextLayer/handlePlaceAllBubbles, untouched. */}
        <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto rounded-control border border-hairline bg-ink/5 p-1">
          {lines.length === 0 && (
            <div className="text-micro text-ink-faint italic px-2 py-3 text-center">No lines yet — paste a script above.</div>
          )}
          {lines.map((line, i) => {
            const placed = placedIndices.has(i);
            return (
              <button
                key={i}
                ref={i === index ? currentRowRef : undefined}
                type="button"
                onClick={() => onIndexChange(i)}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded text-left text-micro transition-colors',
                  i === index ? 'bg-accent-soft text-accent' : placed ? 'text-ink-faint hover:bg-ink/10' : 'text-ink hover:bg-ink/10'
                )}
              >
                <span className="w-5 shrink-0 text-right font-mono tabular-nums opacity-70">{i + 1}</span>
                {placed ? <Check size={10} className="shrink-0 opacity-70 text-success" /> : <Play size={10} className="shrink-0 opacity-60" />}
                <span className={cn('flex-1 truncate', placed && 'opacity-70')}>{line.content}</span>
                {line.pageHint && <span className="shrink-0 px-1 py-0.5 rounded bg-ink/10 text-[10px]">P{line.pageHint}</span>}
              </button>
            );
          })}
        </div>
        {done && <div className="text-micro text-ink-faint italic">All lines placed.</div>}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={lines.length === 0 || done}
            onClick={() => onArmedChange(!armed)}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 h-9 rounded-control text-ui font-medium border transition-colors',
              'disabled:opacity-40 disabled:pointer-events-none',
              armed ? 'bg-accent text-white border-accent' : 'bg-ink/5 border-hairline text-ink hover:bg-ink/10'
            )}
          >
            <Target size={14} />
            {armed
              ? multiBubbleMode ? 'Armed — draw a rect per bubble' : 'Armed — click the canvas to place'
              : 'Arm placement'}
          </button>
          <IconButton
            size="sm"
            active={multiBubbleMode}
            aria-label="Multi-Bubble mode"
            title="Multi-Bubble mode: queue several bubble rects, then place all their lines at once (Ctrl+Shift+M)"
            onClick={() => onMultiBubbleModeChange(!multiBubbleMode)}
            className="!bg-transparent !w-9 !h-9"
          >
            <LayersIcon size={14} />
          </IconButton>
          <IconButton
            size="sm"
            active={autoCenterBubble}
            aria-label="Auto-detect bubble"
            title="Auto-detect bubble: a single-click placement flood-fills to find & center in the speech bubble there"
            onClick={() => onAutoCenterBubbleChange(!autoCenterBubble)}
            className="!bg-transparent !w-9 !h-9"
          >
            <Wand2 size={14} />
          </IconButton>
        </div>

        {armed && multiBubbleMode && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onAddBubbleRect}
              className="flex-1 h-8 rounded-control text-micro font-medium border border-hairline bg-ink/5 text-ink hover:bg-ink/10 transition-colors"
            >
              Add Bubble ({queuedBubbleCount})
            </button>
            <button
              type="button"
              disabled={queuedBubbleCount === 0}
              title="Remove last bubble — hold 2s to clear all"
              onPointerDown={onRemovePointerDown}
              onPointerUp={onRemovePointerUp}
              onPointerLeave={onRemovePointerLeave}
              className={cn(
                'h-8 w-8 shrink-0 rounded-control text-ui font-medium border transition-colors flex items-center justify-center',
                'disabled:opacity-40 disabled:pointer-events-none',
                removeHoldWarning ? 'bg-danger text-white border-danger' : 'bg-ink/5 border-hairline text-ink hover:bg-ink/10'
              )}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              disabled={queuedBubbleCount === 0}
              onClick={onPlaceAllBubbles}
              className="flex-1 h-8 rounded-control text-micro font-medium border border-accent bg-accent text-white disabled:opacity-40 disabled:pointer-events-none hover:opacity-90 transition-colors"
            >
              Place All
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2 border-t border-hairline/60">
          <div className="flex items-center justify-between">
            <span className="text-micro text-ink-faint">Settings</span>
          </div>
          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <span className="w-24 shrink-0">Ignore prefixes</span>
            <input
              value={ignoreLinePrefixes.join('; ')}
              onChange={(e) => onIgnoreLinePrefixesChange(parseListField(e.target.value))}
              placeholder="##"
              className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro font-mono"
            />
          </label>
          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <span className="w-24 shrink-0">Ignore tags</span>
            <input
              value={ignoreTags.join('; ')}
              onChange={(e) => onIgnoreTagsChange(parseListField(e.target.value))}
              placeholder="e.g. [TL note]"
              className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro font-mono"
            />
          </label>
          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <span className="w-24 shrink-0">Default style</span>
            <select
              value={defaultStyleId ?? ''}
              onChange={(e) => onDefaultStyleIdChange(e.target.value || null)}
              className="flex-1 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
            >
              <option value="">None</option>
              {styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-hairline/60">
          <div className="flex items-center justify-between">
            <span className="text-micro text-ink-faint">Styles</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-micro text-ink-faint" title="Size step used by the +/- quick editor and the text-size shortcut">
                <span>Step</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={sizeStep}
                  onChange={(e) => onSizeStepChange(Math.max(1, Number(e.target.value) || 1))}
                  className="w-9 bg-ink/5 border border-hairline rounded px-1 py-0.5 text-ink text-micro"
                />
              </label>
              <IconButton size="sm" aria-label="Add folder" title="Add folder" onClick={() => addFolder(null)} className="!bg-transparent !w-6 !h-6">
                <FolderPlus size={13} />
              </IconButton>
              <IconButton size="sm" aria-label="Add style" title="Add style" onClick={() => addStyle(null)} className="!bg-transparent !w-6 !h-6">
                <Plus size={13} />
              </IconButton>
            </div>
          </div>

          {folderTree.map(renderFolderNode)}

          {unsortedStyles.length > 0 && (
            <details open className="group">
              <summary className="text-micro text-ink-faint uppercase tracking-wide cursor-pointer select-none py-1">Unsorted</summary>
              <div className="flex flex-col gap-2 pl-0.5">
                {unsortedStyles.map(renderStyleCard)}
              </div>
            </details>
          )}
        </div>
    </StudioPanel>
  );
}
