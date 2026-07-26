import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn, IconButton, Modal } from '../ui';
import type { Page, ProcessedImage } from '../../types';
import { StudioToolbar } from './StudioToolbar';
import { StudioCanvas, loadImageFromSrc, type StudioCanvasHandle, type TextSelection, type TextLineSelection } from './StudioCanvas';
import { StudioPagesPanel } from './StudioPagesPanel';
import { PagesManagePanel } from './PagesManagePanel';
import { computeWhitedDiffMask } from './whitedDiff';
import { ToolRail } from './ToolRail';
import { PanelStack, type PanelStackEntry } from './dock/PanelStack';
import { LayersPanel } from './LayersPanel';
import { TextPanel } from './TextPanel';
import { TyperPanel } from './TyperPanel';
import { TyperFloatingWindow } from './TyperFloatingWindow';
import { ColorProvider, useColor } from './color/ColorContext';
import { ColorPanel } from './color/ColorPanel';
import { HistoryProvider, useHistory } from './history/HistoryContext';
import { HistoryPanel } from './history/HistoryPanel';
import { useKeyboardUndo } from './history/useKeyboardUndo';
import { PanelLayoutProvider, usePanelLayout } from './dock/PanelLayoutContext';
import {
  flattenTree, findLayer, updateLayer, mapTree, removeLayers, insertAfter, moveWithinParent, cloneSubtree,
  collectSubtree, getParent, getSiblings, groupLayers, ungroup, reparent, canBeClipBase,
} from './layerTree';
import { NO_SELECTION, hasSelection, featherSelection, growSelection, pathToSelection, alphaMaskToSelection, selectionBounds, type Selection } from './paint/selection';
import { strokePathOntoCanvas, fillPathOntoCanvas, type PaintSettings, type LiquifyMode, type SymmetryMode } from './paint/paintEngine';
import type { BrushShape } from './paint/brushTip';
import { PAINT_TOOLS } from './paint/usePaintLayer';
import { ToolOptionsBar } from './toolOptions/ToolOptionsBar';
import { useStudioShortcuts } from './shortcuts/useStudioShortcuts';
import { FIXED_SHORTCUTS_HELP } from './shortcuts/shortcutsMap';
import { MenuBar } from './menu/MenuBar';
import { buildMenus } from './menu/menuDefinitions';
import { swal, swalToast } from '../../lib/swalTheme';
import { ExportDialog } from './ExportDialog';
import { TranslationPreviewPanel } from './TranslationPreviewPanel';
import { exportPsd } from '../../lib/exportPsd';
import { renderFlattenedPage, compositeFlattenedSlice, downloadBlob } from '../../lib/exportImage';
import JSZip from 'jszip';
import {
  createBackgroundLayer, createLayer, createTextLayer, createAdjustmentLayer, createGroupLayer, createPathLayer, parseTyperScript,
  createLayerMask, DEFAULT_TYPER_STYLES, DEFAULT_TYPER_FOLDERS, FONT_FAMILIES, BLEND_TO_COMPOSITE, type StudioLayer, type TextLayerData, type PathLayerData, type PathAnchor,
  type TyperStyle, type TyperFolder, type AdjustmentLayerData, type AdjustmentKind, type LayerSelectMode, type TextAlign,
} from './studioTypes';
import { applyCharPatch, resolveCharValue } from './textRuns';
import { getClipboardLayer, setClipboardLayer } from '../../lib/layerClipboard';
import { layoutText, isArabicMajority } from './textLayout';
import { FontsPanel } from './FontsPanel';
import { BrushesPanel } from './BrushesPanel';
import type { BrushPreset } from '../../lib/brushStore';
import { AdjustmentPanel } from './AdjustmentPanel';
import {
  loadChapterStudioData, saveChapterStudioData, pushVersionSnapshot, STUDIO_SCHEMA_VERSION,
  type ChapterStudioData, type SerializedStudioLayer,
} from '../../lib/studioProjectStore';

const AUTOSAVE_DEBOUNCE_MS = 1200;

interface StudioProps {
  chapterId: string;
  chapterName: string;
  pages: Page[];
  onBack: () => void;
  /** Text sent from the standalone Text Editor page's "Send to TypeR" button, waiting to be picked up. */
  pendingTyperScript?: string | null;
  onConsumePendingTyperScript?: () => void;
  /** Persists page image changes (currently just Crop and Rotate Canvas) back up to the workspace tree. */
  onPagesChange?: (pages: Page[]) => void;
  /** Project > Export as .msp — the existing workspace-level .msp export (App.tsx), threaded down so
   *  it's reachable from inside a chapter without Studio needing the whole `Workspace` object itself. */
  onExportMsp?: () => void;
}

export function Studio(props: StudioProps) {
  return (
    <ColorProvider>
      <HistoryProvider>
        <PanelLayoutProvider storageKey={props.chapterId}>
          <StudioInner {...props} />
        </PanelLayoutProvider>
      </HistoryProvider>
    </ColorProvider>
  );
}

function StudioInner({ chapterId, chapterName, pages, onBack, pendingTyperScript, onConsumePendingTyperScript, onPagesChange, onExportMsp }: StudioProps) {
  const canvasRef = useRef<StudioCanvasHandle>(null);
  const { foreground, background, setForeground, swap: swapColors, reset: resetColors } = useColor();
  const history = useHistory();
  useKeyboardUndo();
  const panelLayout = usePanelLayout();
  const [brushSize, setBrushSize] = useState(24);
  const [brushHardness, setBrushHardness] = useState(0.8);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushFlow, setBrushFlow] = useState(1);
  const [tolerance, setTolerance] = useState(32);
  const [liquifyMode, setLiquifyMode] = useState<LiquifyMode>('push');
  const [symmetry, setSymmetry] = useState<SymmetryMode>('none');
  const [spacing, setSpacing] = useState(0.15);
  const [brushShape, setBrushShape] = useState<BrushShape | 'image'>('round');
  const [brushAngle, setBrushAngle] = useState(0);
  const [brushRoundness, setBrushRoundness] = useState(1);
  const [scatter, setScatter] = useState(0);
  const [smoothing, setSmoothing] = useState(0);
  const [pressureSize, setPressureSize] = useState(true);
  const [pressureOpacity, setPressureOpacity] = useState(false);
  const [activeBrushId, setActiveBrushId] = useState<string | null>(null);
  /** Decoded tip mask for the active image brush; undefined for procedural shapes. */
  const [tipMask, setTipMask] = useState<HTMLCanvasElement | undefined>(undefined);
  const paintSettings: PaintSettings = {
    size: brushSize, hardness: brushHardness, opacity: brushOpacity, flow: brushFlow,
    color: foreground, bgColor: background, tolerance, liquifyMode, symmetry,
    spacing, brushShape, angle: brushAngle, roundness: brushRoundness,
    scatter, smoothing, pressureSize, pressureOpacity,
    tipMask, tipMaskId: brushShape === 'image' ? activeBrushId ?? undefined : undefined,
  };

  /** Applying a preset just writes the engine state — there's no separate "brush mode",
   *  so the options bar and the panel always describe the same live brush. */
  function handleSelectBrush(preset: BrushPreset, mask?: HTMLCanvasElement) {
    setActiveBrushId(preset.id);
    setBrushSize(preset.size);
    setBrushHardness(preset.hardness);
    setBrushOpacity(preset.opacity);
    setBrushFlow(preset.flow);
    setSpacing(preset.spacing);
    setBrushAngle(preset.angle);
    setBrushRoundness(preset.roundness);
    setScatter(preset.scatter);
    setSmoothing(preset.smoothing);
    setPressureSize(preset.pressureSize);
    setPressureOpacity(preset.pressureOpacity);
    setBrushShape(preset.shape);
    setTipMask(preset.shape === 'image' ? mask : undefined);
    if (!(PAINT_TOOLS as readonly string[]).includes(activeTool)) setActiveTool('brush');
  }
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);

  async function promptSelectionAmount(title: string, label: string): Promise<number | null> {
    const result = await swal({
      title,
      input: 'number',
      inputLabel: label,
      inputValue: 10,
      showCancelButton: true,
      confirmButtonText: 'Apply',
    });
    if (!result.isConfirmed || result.value === undefined || result.value === '') return null;
    return Number(result.value);
  }

  async function handleFeatherSelection() {
    if (!activePage) return;
    const amount = await promptSelectionAmount('Feather Selection', 'Radius (px)');
    if (amount === null || amount <= 0) return;
    setSelection(sel => featherSelection(sel, amount, activePage.original.width, activePage.original.height));
  }

  async function handleExpandSelection() {
    if (!activePage) return;
    const amount = await promptSelectionAmount('Expand Selection', 'Amount (px)');
    if (amount === null || amount <= 0) return;
    setSelection(sel => growSelection(sel, amount, activePage.original.width, activePage.original.height));
  }

  async function handleContractSelection() {
    if (!activePage) return;
    const amount = await promptSelectionAmount('Contract Selection', 'Amount (px)');
    if (amount === null || amount <= 0) return;
    setSelection(sel => growSelection(sel, -amount, activePage.original.width, activePage.original.height));
  }

  // Select > Transform Selection: StudioCanvas owns the interactive box and calls back here only
  // to flip the mode off again once the user commits (Enter) or cancels (Escape).
  const [transformingSelection, setTransformingSelection] = useState(false);
  function handleTransformSelection() {
    if (!hasSelection(selection)) return;
    setTransformingSelection(true);
  }

  // Quick Mask: painting with any tool edits a scratch alpha buffer instead of the active layer,
  // shown as a red rubylith tint; toggling off reads that buffer back into a real selection.
  const [quickMaskActive, setQuickMaskActive] = useState(false);
  function handleToggleQuickMask() {
    if (quickMaskActive) {
      const result = canvasRef.current?.commitQuickMask();
      if (result) setSelection(result);
      setQuickMaskActive(false);
    } else {
      setQuickMaskActive(true);
    }
  }

  /** Commits the Crop tool's rect selection: trims the background + every raster layer's canvas,
   *  shifts text layers to match, and persists the new page dimensions back up to App.tsx. */
  async function handleCommitCrop() {
    if (!activePage) return;
    if (selection.kind !== 'rect') {
      swalToast({ icon: 'info', title: 'Draw a rectangular crop area first' });
      return;
    }
    const rect = selection;
    const result = await canvasRef.current?.commitCrop(rect);
    if (!result) return;
    onPagesChange?.(pages.map(p => p.id === activePage.id ? { ...p, original: result.original, cleaned: result.cleaned } : p));
    updateLayers(current => mapTree(current, l =>
      l.type === 'text' && l.text ? { ...l, text: { ...l.text, x: l.text.x - rect.x, y: l.text.y - rect.y } } : l
    ), 'Crop');
    setSelection(NO_SELECTION);
    setActiveTool('select');
    setFitSignal(s => s + 1);
    scheduleAutosave();
    swalToast({ icon: 'success', title: 'Cropped' });
  }

  const studioRootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [toolRailVisible, setToolRailVisible] = useState(true);
  const [optionsBarVisible, setOptionsBarVisible] = useState(true);

  useEffect(() => {
    function onFullscreenChange() { setIsFullscreen(document.fullscreenElement === studioRootRef.current); }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      studioRootRef.current?.requestFullscreen().catch(() => {
        swalToast({ icon: 'error', title: "Couldn't enter fullscreen" });
      });
    }
  }

  function toggleToolRail() { setToolRailVisible(v => !v); }
  function toggleOptionsBar() { setOptionsBarVisible(v => !v); }
  /** AI > Content-Aware Fill / Image > Apply Filter > Distort > Liquify — both switch to an existing
   *  real brush-driven tool rather than opening a dialog; see toolGroups.ts for `contentAware`/`liquify`. */
  function switchToContentAwareFill() { setActiveTool('contentAware'); }
  function switchToLiquify() { setActiveTool('liquify'); }

  useStudioShortcuts({
    onToolChange: (id) => setActiveTool(id),
    onBrushSizeStep: (delta) => setBrushSize(v => Math.max(1, Math.min(200, v + delta))),
    onSwapColors: swapColors,
    onResetColors: resetColors,
    onZoomIn: () => canvasRef.current?.zoomIn(),
    onZoomOut: () => canvasRef.current?.zoomOut(),
    onFit: () => setFitSignal(s => s + 1),
    onToggleCleaned: () => setShowCleaned(v => !v),
    onToggleFullscreen: toggleFullscreen,
    onTogglePanelsHidden: () => setPanelsHidden(v => !v),
    onExport: () => setExportOpen(true),
    onGroupLayers: () => handleGroupLayers(),
    onUngroupLayers: () => { if (activeLayerId) handleUngroupLayer(activeLayerId); },
    onToggleQuickMask: handleToggleQuickMask,
    onTextSizeStep: handleTextSizeStep,
    onDeselect: () => setSelection(NO_SELECTION),
    onActualSize: () => canvasRef.current?.zoomTo(1),
    onCutLayer: () => handleCutLayer(),
    onCopyLayer: () => handleCopyLayer(),
    onPasteLayer: () => handlePasteLayer(),
    onFindReplace: handleOpenFindReplace,
    onToggleTextBold: handleToggleTextBold,
    onToggleTextItalic: handleToggleTextItalic,
    onToggleRulers: () => setShowRulers(v => !v),
    onToggleGrid: () => setShowGrid(v => !v),
    onNewLayer: () => handleAddLayer(),
    onMergeVisible: () => handleMergeVisible(),
  });
  const [activePageId, setActivePageId] = useState<string | null>(pages[0]?.id ?? null);
  const [pagesManagerOpen, setPagesManagerOpen] = useState(pages.length === 0);
  const [activeTool, setActiveTool] = useState('select');
  const [showCleaned, setShowCleaned] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(false);
  const [customFontFamilies, setCustomFontFamilies] = useState<string[]>([]);
  const allFontFamilies = [...FONT_FAMILIES, ...customFontFamilies];
  const [fitSignal, setFitSignal] = useState(0);
  // Left (Pages) / right (Tools) sidebar visibility. Desktop keeps both open as fixed columns by
  // default; tablet/phone treat these as slide-out sheets, so opening one there closes the other
  // to avoid covering the whole canvas.
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const leftSidebarRef = useRef<HTMLDivElement>(null);
  const rightSidebarRef = useRef<HTMLDivElement>(null);

  function toggleLeftSidebar() {
    setLeftOpen(v => {
      const next = !v;
      if (next && layoutMode !== 'desktop') setRightOpen(false);
      return next;
    });
  }

  function toggleRightSidebar() {
    setRightOpen(v => {
      const next = !v;
      if (next && layoutMode !== 'desktop') setLeftOpen(false);
      return next;
    });
  }

  // Per-page layer stacks. Each page always has a locked "Background" layer at index 0.
  const [layersByPage, setLayersByPage] = useState<Record<string, StudioLayer[]>>({});
  /**
   * Canvas selection. `activeLayerId` stays the *primary* member (the last one picked) and is what
   * the single-layer panels, shortcuts and the Transformer's edit target key off — keeping it
   * derived rather than a second piece of state means the two can't disagree.
   */
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>(['background']);
  const activeLayerId = selectedLayerIds.length > 0 ? selectedLayerIds[selectedLayerIds.length - 1] : null;
  const setActiveLayerId = useCallback((id: string | null) => setSelectedLayerIds(id ? [id] : []), []);
  /**
   * Which Layers-panel row has its properties disclosed. Lives here, not in `LayersPanel`, because
   * selecting a text or adjustment layer switches the dock to that layer's panel — which shares the
   * `top` region with Layers, so LayersPanel unmounts and local state would vanish. That made the
   * opacity slider on a text or adjustment layer unreachable: the click that opened the row was the
   * same click that navigated away from it, and the row was collapsed again on return.
   */
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  /** The layer whose *mask* is the current paint target (clicked its mask thumbnail in the Layers
   *  panel), or null while painting normally. Cleared on layer (re)selection. */
  const [activeMaskLayerId, setActiveMaskLayerId] = useState<string | null>(null);
  // The character range selected inside the text layer currently being edited on canvas. Lives here
  // rather than in StudioCanvas because TextPanel — a sibling in the dock — is what applies
  // character styling to it.
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  // A wrapped line clicked on a selected (not editing) text layer — independent of textSelection
  // above, which only exists while the editing textarea is open.
  const [textLineSelection, setTextLineSelection] = useState<TextLineSelection | null>(null);

  // TypeR: scripted lettering — paste a script, arm it, click bubbles to stamp lines in order.
  const [typerScript, setTyperScript] = useState('');
  const [typerStyles, setTyperStyles] = useState<TyperStyle[]>(DEFAULT_TYPER_STYLES);
  const [typerFolders, setTyperFolders] = useState<TyperFolder[]>(DEFAULT_TYPER_FOLDERS);
  const [typerIndex, setTyperIndex] = useState(0);
  const [typerArmed, setTyperArmed] = useState(false);
  // TypeR as a detached floating window — no floating-panel infrastructure exists anywhere else in
  // this app, so this is scoped to TypeR specifically rather than a generic system nobody else
  // needs yet. State lives here (not a new Context): only Studio.tsx and TyperFloatingWindow need
  // it, and typerIndex/typerArmed/etc. above stay exactly where they are regardless of floating vs
  // docked — StudioCanvas reads them for canvas-click placement either way. Persisted the same
  // debounced-localStorage way PanelLayoutContext persists panel order/collapse; Studio.tsx fully unmounts
  // on chapter switch (a fresh mount is a fresh chapter), so a lazy useState initializer is enough —
  // no re-seed-on-chapterId-change effect needed.
  const [typerFloating, setTyperFloating] = useState(() => {
    try { return localStorage.getItem(`studio_typer_floating_${chapterId}`) === '1'; } catch { return false; }
  });
  const [typerFloatPos, setTyperFloatPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(`studio_typer_floating_pos_${chapterId}`);
      return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(`studio_typer_floating_${chapterId}`, typerFloating ? '1' : '0'); } catch { /* not fatal */ }
  }, [chapterId, typerFloating]);
  useEffect(() => {
    if (!typerFloatPos) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(`studio_typer_floating_pos_${chapterId}`, JSON.stringify(typerFloatPos)); } catch { /* not fatal */ }
    }, 400);
    return () => clearTimeout(t);
  }, [chapterId, typerFloatPos]);
  // Configurable versions of what used to be a hardcoded "##" ignore-prefix and an implicit
  // empty-prefix-style default, plus arbitrary mid-line tag stripping — mirrors the real TypeR
  // extension's ignoreLinePrefixes/ignoreTags/defaultStyleId settings.
  const [ignoreLinePrefixes, setIgnoreLinePrefixes] = useState<string[]>(['##']);
  const [ignoreTags, setIgnoreTags] = useState<string[]>([]);
  const [defaultStyleId, setDefaultStyleId] = useState<string | null>(null);
  // Auto-detect bubble: flood-fills from an armed placement click to find & size/center the new
  // text layer in its speech bubble, instead of dropping it at the raw click point.
  const [typerAutoCenterBubble, setTyperAutoCenterBubble] = useState(false);
  // Shared by the TyperPanel per-style quick +/- buttons and the global text-size-step shortcut.
  const [typerSizeStep, setTyperSizeStep] = useState(2);
  // "Current folder" for prefix-matching priority: the folder of the style that placed the current
  // line, mirroring the real extension's implicit `state.currentStyle.folder`. Kept as state (not
  // derived inline) since it feeds back into parsing the very lines it's read from.
  const [typerCurrentFolderId, setTyperCurrentFolderId] = useState<string | null>(null);
  const typerLines = useMemo(
    () => parseTyperScript(typerScript, typerStyles, {
      folders: typerFolders, ignoreLinePrefixes, ignoreTags, defaultStyleId, currentFolderId: typerCurrentFolderId,
    }),
    [typerScript, typerStyles, typerFolders, ignoreLinePrefixes, ignoreTags, defaultStyleId, typerCurrentFolderId]
  );
  useEffect(() => {
    setTyperCurrentFolderId(typerLines[typerIndex]?.style.folderId ?? null);
  }, [typerIndex, typerLines]);
  // Multi-Bubble mode: draw a rect per bubble (Rectangular Marquee) and queue it instead of
  // placing immediately, then place every queued rect's line in one go, in script order.
  const [multiBubbleMode, setMultiBubbleModeState] = useState(false);
  const [multiBubbleRects, setMultiBubbleRects] = useState<{ x: number; y: number; width: number; height: number }[]>([]);

  function setMultiBubbleMode(enabled: boolean) {
    setMultiBubbleModeState(enabled);
    setMultiBubbleRects([]);
    if (typerArmed) setActiveTool(enabled ? 'marquee-rect' : 'text');
  }

  function handleAddBubbleRect() {
    if (selection.kind !== 'rect') {
      swalToast({ icon: 'info', title: 'Draw a rectangle around a bubble first' });
      return;
    }
    setMultiBubbleRects(prev => [...prev, selection]);
    setSelection(NO_SELECTION);
  }

  function handlePlaceAllBubbles() {
    if (multiBubbleRects.length === 0) return;
    const newLayers: StudioLayer[] = [];
    let idx = typerIndex;
    for (const rect of multiBubbleRects) {
      const line = typerLines[idx];
      if (!line) break;
      const { content, style, boldOverride, italicOverride } = line;
      const lineCount = content.split('\n').length || 1;
      const textWidth = Math.max(40, Math.min(rect.width, 400));
      const textHeight = lineCount * style.fontSize * 1.15;
      const layer = createTextLayer(rect.x + rect.width / 2 - textWidth / 2, rect.y + rect.height / 2 - textHeight / 2);
      layer.name = `Text: ${content.slice(0, 20)}`;
      layer.text = {
        ...layer.text!,
        content,
        width: textWidth,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: style.color,
        bold: boldOverride ?? style.bold,
        italic: italicOverride ?? style.italic,
        strokeColor: style.strokeColor,
        strokeWidth: style.strokeWidth,
      };
      newLayers.push(layer);
      idx += 1;
    }
    updateLayers(current => [...current, ...newLayers], 'Place TypeR Multi-Bubble');
    setTyperIndex(idx);
    if (idx >= typerLines.length) setTyperArmed(false);
    setMultiBubbleRects([]);
    setActiveTool('select');
    swalToast({ icon: 'success', title: `Placed ${newLayers.length} line${newLayers.length === 1 ? '' : 's'}` });
  }

  // Type Region: a freeform, freehand extension of TypeR — not a replacement for the panel above,
  // which keeps its own separate arm state and untouched placeInSel/mqAuto/mbFill flow. While armed,
  // StudioCanvas either clicks inside an existing selection or completes a brand-new marquee/lasso
  // one, then hands the shape here to become a text container immediately.
  const [typeRegionArmed, setTypeRegionArmed] = useState(false);

  function handleCreateTypeRegion(shape: Selection) {
    const bounds = selectionBounds(shape);
    if (!bounds || bounds.width < 8 || bounds.height < 8) return;
    const layer = createTextLayer(bounds.x, bounds.y, bounds.width);
    if (shape.kind === 'ellipse') {
      layer.text!.clipShape = { kind: 'ellipse', x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    } else if (shape.kind === 'polygon') {
      layer.text!.clipShape = { kind: 'polygon', points: shape.points };
    }
    // rect needs no clip (the frame itself already is the rect); mask-kind selections have no clean
    // vector form to persist, so they fall back to a plain rectangular container at their bounds.
    updateLayers(current => [...current, layer], 'Type Region');
    setActiveLayerId(layer.id);
    setActiveTool('select');
    setSelection(NO_SELECTION);
  }

  // Slice tool: draw a rect per slice (reuses the Rectangular-Marquee-style drag via MARQUEE_TOOLS),
  // queue it, then export every queued rect as one cropped PNG each, bundled into a zip — mirrors
  // the Multi-Bubble queue above.
  const [sliceRects, setSliceRects] = useState<{ x: number; y: number; width: number; height: number }[]>([]);

  function handleAddSliceRect() {
    if (selection.kind !== 'rect') {
      swalToast({ icon: 'info', title: 'Draw a rectangle first' });
      return;
    }
    setSliceRects(prev => [...prev, selection]);
    setSelection(NO_SELECTION);
  }

  async function handleExportSlices() {
    if (sliceRects.length === 0) return;
    const snapshot = canvasRef.current?.getExportSnapshot();
    if (!snapshot) {
      swalToast({ icon: 'warning', title: 'Nothing to export' });
      return;
    }
    try {
      const fullCanvas = await renderFlattenedPage(snapshot);
      const zip = new JSZip();
      for (let i = 0; i < sliceRects.length; i++) {
        const blob = await compositeFlattenedSlice(fullCanvas, sliceRects[i]);
        zip.file(`slice-${String(i + 1).padStart(2, '0')}.png`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const baseName = `${chapterName}${activePage ? `_${activePage.original.filename.replace(/\.[^.]+$/, '')}` : ''}`.replace(/\s+/g, '_');
      downloadBlob(zipBlob, `${baseName}-slices.zip`);
      setSliceRects([]);
      swalToast({ icon: 'success', title: `Exported ${sliceRects.length} slice${sliceRects.length === 1 ? '' : 's'}` });
    } catch (err) {
      console.error(err);
      swalToast({ icon: 'error', title: 'Slice export failed' });
    }
  }

  // Pick up text sent from the Text Editor's "Send to TypeR" button, if any is waiting.
  useEffect(() => {
    if (pendingTyperScript == null) return;
    setTyperScript(pendingTyperScript);
    onConsumePendingTyperScript?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTyperScript]);

  // TypeR "Page N" auto page-switching: when the armed script advances onto a line tagged with
  // a page hint, jump there automatically (matching by number in the filename, falling back to
  // 1-based position) so placement lands on the right page without a manual page click first.
  useEffect(() => {
    if (!typerArmed) return;
    const hint = typerLines[typerIndex]?.pageHint;
    if (!hint) return;
    const wantNumber = Number(hint);
    const target = pages.find(p => {
      const match = p.original.filename.match(/(\d+)(?!.*\d)/);
      return match && Number(match[1]) === wantNumber;
    }) ?? pages[wantNumber - 1];
    if (target && target.id !== activePageId) {
      setActivePageId(target.id);
      swalToast({ icon: 'info', title: `TypeR: switched to page ${hint}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typerArmed, typerIndex, typerLines, pages]);

  // --- Persistence: load this chapter's studio data (layers, TypeR script/styles, raster
  // pixels) on mount, then autosave on change. Kept in a separate idb-keyval store from the
  // main page/chapter library so painting doesn't trigger a full-library rewrite per stroke.
  const loadedRef = useRef(false);
  const rasterByPageRef = useRef<Record<string, Record<string, string>>>({});
  /** Mirrors `rasterByPageRef`, but for mask pixels — keyed by the *mask's own* id, alongside the
   *  owning layer's id (needed to redraw its Konva node once the mask's pixels are hydrated). */
  const maskByPageRef = useRef<Record<string, { layerId: string; maskId: string; dataUrl: string }[]>>({});
  const hydratedPagesRef = useRef<Set<string>>(new Set());
  const dirtyRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layersByPageRef = useRef(layersByPage);
  layersByPageRef.current = layersByPage;
  const typerScriptRef = useRef(typerScript);
  typerScriptRef.current = typerScript;
  const typerStylesRef = useRef(typerStyles);
  typerStylesRef.current = typerStyles;
  const typerFoldersRef = useRef(typerFolders);
  typerFoldersRef.current = typerFolders;
  const ignoreLinePrefixesRef = useRef(ignoreLinePrefixes);
  ignoreLinePrefixesRef.current = ignoreLinePrefixes;
  const ignoreTagsRef = useRef(ignoreTags);
  ignoreTagsRef.current = ignoreTags;
  const defaultStyleIdRef = useRef(defaultStyleId);
  defaultStyleIdRef.current = defaultStyleId;

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    hydratedPagesRef.current = new Set();
    rasterByPageRef.current = {};
    maskByPageRef.current = {};
    (async () => {
      const saved = await loadChapterStudioData(chapterId);
      if (cancelled) return;
      if (saved) {
        const nextLayersByPage: Record<string, StudioLayer[]> = {};
        const nextRasterByPage: Record<string, Record<string, string>> = {};
        const nextMaskByPage: Record<string, { layerId: string; maskId: string; dataUrl: string }[]> = {};
        for (const [pageId, serialized] of Object.entries(saved.layersByPage)) {
          // Strip pixels out of the layer objects and into the raster/mask side-maps. Both walk the
          // whole tree: a group's descendants carry pixels too, and the registries are keyed by
          // layer/mask id, flat, so nesting never reaches them.
          nextLayersByPage[pageId] = mapTree(serialized, ({ raster: _raster, maskRaster: _maskRaster, ...layer }) => layer) as StudioLayer[];
          const rasterMap: Record<string, string> = {};
          const maskList: { layerId: string; maskId: string; dataUrl: string }[] = [];
          for (const l of flattenTree(serialized)) {
            if (l.raster) rasterMap[l.id] = l.raster;
            if (l.mask && l.maskRaster) maskList.push({ layerId: l.id, maskId: l.mask.id, dataUrl: l.maskRaster });
          }
          if (Object.keys(rasterMap).length > 0) nextRasterByPage[pageId] = rasterMap;
          if (maskList.length > 0) nextMaskByPage[pageId] = maskList;
        }
        setLayersByPage(nextLayersByPage);
        setTyperScript(saved.typerScript);
        if (saved.typerStyles.length > 0) setTyperStyles(saved.typerStyles);
        if (saved.typerFolders?.length > 0) setTyperFolders(saved.typerFolders);
        if (saved.ignoreLinePrefixes?.length > 0) setIgnoreLinePrefixes(saved.ignoreLinePrefixes);
        setIgnoreTags(saved.ignoreTags ?? []);
        setDefaultStyleId(saved.defaultStyleId ?? null);
        rasterByPageRef.current = nextRasterByPage;
        maskByPageRef.current = nextMaskByPage;
      }
      loadedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [chapterId]);

  // Selections are per-page. A pixel selection is expressed in the *previous* page's image-space
  // coordinates, so it can't just carry over — but it also shouldn't be discarded outright: it's
  // stashed here (mirroring how rasterByPageRef/maskByPageRef already keep other per-page data)
  // and restored if the user comes back to that page. Quick Mask's scratch alpha canvas lives in a
  // flat (non-page-keyed) ref inside StudioCanvas, so switching pages while it's active would leave
  // it painting into/reading the previous page's buffer; commit it (same as toggling it off, and
  // reading purely from the canvas ref itself so it's unaffected by the new page's image already
  // loading) into that outgoing page's stashed selection — never silently drop in-progress mask
  // work. Multi-Bubble/Slice's queued rects are likewise a flat array with no page id on each
  // entry; carrying them over would draw/fill the wrong page's regions, so they're cleared same as
  // `selection` used to be unconditionally.
  const selectionByPageRef = useRef<Record<string, Selection>>({});
  const prevPageIdRef = useRef(activePageId);
  useEffect(() => {
    const prevId = prevPageIdRef.current;
    if (prevId === activePageId) return;
    if (prevId) selectionByPageRef.current[prevId] = selection;
    prevPageIdRef.current = activePageId;
    if (quickMaskActive) {
      const result = canvasRef.current?.commitQuickMask();
      if (result && prevId) selectionByPageRef.current[prevId] = result;
      setQuickMaskActive(false);
    }
    setSelection(activePageId ? (selectionByPageRef.current[activePageId] ?? NO_SELECTION) : NO_SELECTION);
    setMultiBubbleRects([]);
    setSliceRects([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageId]);

  // Hydrate the active page's raster (painted pixel) layers and masks once its canvas is ready.
  useEffect(() => {
    if (!loadedRef.current || !activePageId) return;
    if (hydratedPagesRef.current.has(activePageId)) return;
    hydratedPagesRef.current.add(activePageId);
    const raster = rasterByPageRef.current[activePageId];
    const masks = maskByPageRef.current[activePageId];
    if (!raster && !masks) return;
    (async () => {
      for (const [layerId, dataUrl] of Object.entries(raster ?? {})) {
        await canvasRef.current?.loadRasterLayer(layerId, dataUrl);
      }
      for (const { layerId, maskId, dataUrl } of masks ?? []) {
        await canvasRef.current?.loadMaskLayer(layerId, maskId, dataUrl);
      }
    })();
  }, [activePageId, layersByPage]);

  function scheduleAutosave() {
    dirtyRef.current = true;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
  }

  function flushAutosave() {
    if (!dirtyRef.current || !loadedRef.current) return;
    dirtyRef.current = false;
    // Covers every raster layer (and mask) touched so far this session (any page, not just the
    // active one — both registries keep every visited page's canvases alive until deleted).
    const liveRaster = canvasRef.current?.exportRasterLayers() ?? {};
    const liveMasks = canvasRef.current?.exportMaskLayers() ?? {};
    const mergedLayersByPage: Record<string, SerializedStudioLayer[]> = {};
    for (const [pageId, pageLayers] of Object.entries(layersByPageRef.current)) {
      mergedLayersByPage[pageId] = mapTree<SerializedStudioLayer>(pageLayers, (l) => {
        const raster = liveRaster[l.id] ?? rasterByPageRef.current[pageId]?.[l.id];
        const maskRaster = l.mask
          ? liveMasks[l.mask.id] ?? maskByPageRef.current[pageId]?.find(m => m.maskId === l.mask!.id)?.dataUrl
          : undefined;
        if (!raster && !maskRaster) return l;
        return { ...l, ...(raster ? { raster } : {}), ...(maskRaster ? { maskRaster } : {}) };
      });
    }
    const data: ChapterStudioData = {
      schemaVersion: STUDIO_SCHEMA_VERSION,
      layersByPage: mergedLayersByPage,
      typerScript: typerScriptRef.current,
      typerStyles: typerStylesRef.current,
      typerFolders: typerFoldersRef.current,
      ignoreLinePrefixes: ignoreLinePrefixesRef.current,
      ignoreTags: ignoreTagsRef.current,
      defaultStyleId: defaultStyleIdRef.current,
      updatedAt: new Date().toISOString(),
    };
    saveChapterStudioData(chapterId, data).catch(console.error);
    pushVersionSnapshot(chapterId, data).catch(console.error);
  }

  useEffect(() => {
    if (loadedRef.current) scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersByPage, typerScript, typerStyles, typerFolders, ignoreLinePrefixes, ignoreTags, defaultStyleId]);

  // Flush a pending save immediately when leaving this chapter's Studio (e.g. "Back to Pages").
  useEffect(() => () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    flushAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pages.find(p => p.id === activePageId)) {
      setActivePageId(pages[0]?.id ?? null);
    }
  }, [pages, activePageId]);

  const activePage = pages.find(p => p.id === activePageId) ?? null;

  const layers = useMemo(() => {
    if (!activePageId) return [];
    return layersByPage[activePageId] ?? [createBackgroundLayer()];
  }, [layersByPage, activePageId]);

  /** General primitive: edit any page's layer stack, not just the active one — the Translation
   *  Preview panel needs to edit dialogue text across every page in the chapter at once. */
  function updateLayersOnPage(pageId: string, updater: (current: StudioLayer[]) => StudioLayer[], historyLabel?: string) {
    // `before`/`after` are computed *inside* the functional updater, against React's own pending
    // state, not the `layersByPage` closure above — two updates fired in quick succession (e.g. a
    // toggle clicked twice before a re-render lands) would otherwise both read the same stale
    // `before` and the second would silently overwrite the first's effect instead of building on it.
    let before: StudioLayer[] = [];
    let after: StudioLayer[] = [];
    setLayersByPage(prev => {
      before = prev[pageId] ?? [createBackgroundLayer()];
      after = updater(before);
      return { ...prev, [pageId]: after };
    });
    if (historyLabel) {
      history.push({
        label: historyLabel,
        undo: () => setLayersByPage(prev => ({ ...prev, [pageId]: before })),
        redo: () => setLayersByPage(prev => ({ ...prev, [pageId]: after })),
      });
    }
  }

  function updateLayers(updater: (current: StudioLayer[]) => StudioLayer[], historyLabel?: string) {
    if (!activePageId) return;
    updateLayersOnPage(activePageId, updater, historyLabel);
  }

  function handleAddLayer() {
    const layer = createLayer('clean-patch', `Layer ${flattenTree(layers).length}`);
    updateLayers(current => [...current, layer], 'Add Layer');
    setActiveLayerId(layer.id);
    // New raster layers start as a working copy of the background — matches the standard
    // "duplicate scan, clean the duplicate" manga workflow and gives clone/heal/filter-brush/
    // liquify tools real pixels to act on immediately instead of an empty transparent canvas.
    canvasRef.current?.seedLayerWithBackground(layer.id);
  }

  /** The explicit "I want a truly empty layer" action, alongside handleAddLayer's default
   *  background-copy behavior above — reached via Alt-click on the Layers panel's Add button, or
   *  Layer > New Blank Layer. Deliberately not seeded: getOrCreateCanvasFor hands back a bare
   *  transparent canvas when nothing writes to it, so simply skipping the seed call is enough. */
  function handleAddBlankLayer() {
    const layer = createLayer('clean-patch', `Layer ${flattenTree(layers).length}`);
    updateLayers(current => [...current, layer], 'Add Blank Layer');
    setActiveLayerId(layer.id);
  }

  async function handleCreateWhitedPatchLayer(page: Page, whited: ProcessedImage) {
    try {
      const [originalImg, whitedImg] = await Promise.all([
        loadImageFromSrc(page.original.dataUrl),
        loadImageFromSrc(whited.dataUrl),
      ]);
      const { maskCanvas, changedRatio } = computeWhitedDiffMask(originalImg, whitedImg);
      if (changedRatio < 0.001) {
        swalToast({ icon: 'warning', title: 'No differences detected', text: 'The whited image looks identical to the original.' });
        return;
      }
      if (page.id !== activePageId) setActivePageId(page.id);
      const layer = createLayer('clean-patch', 'Whited Patch');
      updateLayersOnPage(page.id, current => [...current, layer], 'Add Whited Patch Layer');
      setActiveLayerId(layer.id);
      setSelection(alphaMaskToSelection(maskCanvas));
      canvasRef.current?.seedLayerWithMaskedImage(layer.id, maskCanvas);
      swalToast({ icon: 'success', title: 'Patch layer created', text: `${Math.round(changedRatio * 100)}% of the page differed from the original.` });
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error && err.message ? err.message : 'Could not diff the whited image against the original.';
      swal({ icon: 'error', title: 'Diff Failed', text: detail });
    }
  }

  /**
   * `LayersPanel`'s own "Add adjustment layer" button passes this straight to `onClick`
   * (`onClick={onAddAdjustment}`), so React hands it the click event as a real runtime argument —
   * a default parameter here would never apply (defaults only kick in for `undefined`, not "some
   * other value was passed"). Keeping this a true zero-arg function and giving the
   * Image-menu-with-a-kind path its own separate wrapper avoids that exact footgun.
   */
  function handleAddAdjustmentLayer() {
    handleAddAdjustmentLayerOfKind('brightness-contrast');
  }

  function handleAddAdjustmentLayerOfKind(kind: AdjustmentKind) {
    const layer = createAdjustmentLayer(kind);
    updateLayers(current => [...current, layer], 'Add Adjustment Layer');
    setActiveLayerId(layer.id);
    panelLayout.reveal('adjustment');
  }

  /** Edit > Copy: clones the active layer (and its subtree, if it's a group) under fresh ids with
   *  real, independent canvas backing — see lib/layerClipboard.ts's doc comment for why this makes
   *  the clipboard entry safe to keep around after the original is edited or deleted. */
  function handleCopyLayer() {
    if (!activeLayerId) return;
    const source = findLayer(layers, activeLayerId);
    if (!source || source.isBackground) return;
    const { copy, idMap } = cloneSubtree(source);
    canvasRef.current?.clonePaintCanvases(idMap);
    canvasRef.current?.cloneMaskCanvases(idMap);
    const previous = setClipboardLayer(copy);
    if (previous) {
      canvasRef.current?.deletePaintCanvas(previous.id);
      if (previous.mask) canvasRef.current?.deleteMaskCanvas(previous.mask.id);
    }
  }

  function handleCutLayer() {
    if (!activeLayerId) return;
    const source = findLayer(layers, activeLayerId);
    if (!source || source.isBackground) return;
    handleCopyLayer();
    handleDeleteLayers([activeLayerId]);
  }

  /** Always clones the stashed entry again under yet another fresh id, so pasting twice can't
   *  collide, and the clipboard itself stays intact for further pastes. */
  function handlePasteLayer() {
    const clip = getClipboardLayer();
    if (!clip) return;
    const { copy, idMap } = cloneSubtree(clip);
    canvasRef.current?.clonePaintCanvases(idMap);
    canvasRef.current?.cloneMaskCanvases(idMap);
    updateLayers(current => [...current, copy], 'Paste Layer');
    setSelectedLayerIds([copy.id]);
  }

  function handleOpenFindReplace() {
    setRightOpen(true);
    panelLayout.reveal('translation');
  }

  function handleSaveProjectNow() {
    flushAutosave();
    swalToast({ icon: 'success', title: 'Saved' });
  }

  /** Layer > Merge Down: only for two adjacent raster layers — the common case, and the one
   *  Photoshop's own Merge Down is used for most often. Groups/adjustments/text below the active
   *  layer disable the menu item rather than attempting a merge this app's layer model can't
   *  express simply (an adjustment or group has no single raster canvas to draw the active layer
   *  onto). */
  function handleMergeDown() {
    if (!activeLayerId) return;
    const active = findLayer(layers, activeLayerId);
    if (!active || active.type !== 'clean-patch') return;
    const below = layerBelowActive;
    if (!below || below.type !== 'clean-patch') return;
    const topCanvas = canvasRef.current?.getPaintCanvas(active.id);
    const bottomCanvas = canvasRef.current?.getPaintCanvas(below.id);
    if (!topCanvas || !bottomCanvas) return;
    const ctx = bottomCanvas.getContext('2d');
    if (!ctx) return;
    const before = ctx.getImageData(0, 0, bottomCanvas.width, bottomCanvas.height);
    ctx.save();
    ctx.globalAlpha = active.opacity;
    ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[active.blendMode] ?? 'source-over';
    ctx.drawImage(topCanvas, 0, 0);
    ctx.restore();
    const after = ctx.getImageData(0, 0, bottomCanvas.width, bottomCanvas.height);
    const belowId = below.id;
    history.push({
      label: 'Merge Down',
      undo: () => { ctx.putImageData(before, 0, 0); canvasRef.current?.redrawLayer(belowId); },
      redo: () => { ctx.putImageData(after, 0, 0); canvasRef.current?.redrawLayer(belowId); },
    });
    canvasRef.current?.redrawLayer(belowId);
    canvasRef.current?.deletePaintCanvas(active.id);
    updateLayers(current => removeLayers(current, [active.id]));
    setActiveLayerId(belowId);
    scheduleAutosave();
  }

  /** Layer > Merge Visible: flattens the export snapshot (which already respects `.visible`) into
   *  one new layer, then discards every root-level visible layer it replaces. Deliberately scoped to
   *  root-level layers only — reaching into a visible group's own children would pull them out from
   *  under the group instead of merging the group's composited appearance, which flattening the
   *  snapshot already captured correctly. */
  async function handleMergeVisible() {
    const snapshot = canvasRef.current?.getExportSnapshot();
    if (!snapshot) return;
    const flatCanvas = await renderFlattenedPage(snapshot);
    const layer = createLayer('clean-patch', 'Merged Visible');
    const target = canvasRef.current?.getPaintCanvas(layer.id);
    const ctx = target?.getContext('2d');
    if (!target || !ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(flatCanvas, 0, 0);
    const idsToRemove = layers.filter(l => !l.isBackground && l.visible).map(l => l.id);
    updateLayers(current => [...removeLayers(current, idsToRemove), layer], 'Merge Visible');
    idsToRemove.forEach(id => canvasRef.current?.deletePaintCanvas(id));
    canvasRef.current?.redrawLayer(layer.id);
    setActiveLayerId(layer.id);
    scheduleAutosave();
  }

  /** Layer > Flatten Image: same flatten-the-snapshot mechanism as Merge Visible, but replaces
   *  *every* layer above the locked Background root (visible or not — a hidden layer is discarded,
   *  not merged in, matching Photoshop's own Flatten). The Background root itself is never replaced;
   *  `layerTree.ts` enforces it stays at index 0 always, so "flatten" here means "collapse everything
   *  above it into one layer," which looks identical on screen to a true single-layer flatten. */
  async function handleFlattenImage() {
    const snapshot = canvasRef.current?.getExportSnapshot();
    if (!snapshot) return;
    const flatCanvas = await renderFlattenedPage(snapshot);
    const layer = createLayer('clean-patch', 'Flattened');
    const target = canvasRef.current?.getPaintCanvas(layer.id);
    const ctx = target?.getContext('2d');
    if (!target || !ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(flatCanvas, 0, 0);
    const idsToRemove = flattenTree(layers).filter(l => !l.isBackground).map(l => l.id);
    updateLayers(current => [...removeLayers(current, idsToRemove), layer], 'Flatten Image');
    idsToRemove.forEach(id => canvasRef.current?.deletePaintCanvas(id));
    canvasRef.current?.redrawLayer(layer.id);
    setActiveLayerId(layer.id);
    scheduleAutosave();
  }

  /** Layer Properties.../Blending Options... both point at the one real place opacity/blend/mask/
   *  clip controls live — the Layers panel's per-row expand strip — since neither is a separate
   *  dialog in this app. */
  function handleOpenLayerProperties() {
    if (activeLayerId) setExpandedLayerId(activeLayerId);
  }

  /** Image > Rotate Canvas: transforms the background/raster canvases via StudioCanvasHandle's
   *  rotateCanvas, then repositions text layers to match (mirroring how handleCommitCrop shifts them
   *  for Crop) — path layers are left untouched, the same pre-existing scope limit Crop already has. */
  async function handleRotateCanvas(dir: 'cw' | 'ccw' | '180' | 'flip-h' | 'flip-v') {
    if (!activePage) return;
    const result = await canvasRef.current?.rotateCanvas(dir);
    if (!result) return;
    const cw = activePage.original.width, ch = activePage.original.height;
    const swapped = dir === 'cw' || dir === 'ccw';
    function mapPoint(x: number, y: number): { x: number; y: number } {
      switch (dir) {
        case 'cw': return { x: ch - y, y: x };
        case 'ccw': return { x: y, y: cw - x };
        case '180': return { x: cw - x, y: ch - y };
        case 'flip-h': return { x: cw - x, y };
        case 'flip-v': return { x, y: ch - y };
      }
    }
    onPagesChange?.(pages.map(p => p.id === activePage.id ? { ...p, original: result.original, cleaned: result.cleaned } : p));
    updateLayers(current => mapTree(current, l => {
      if (l.type !== 'text' || !l.text) return l;
      const measured = layoutText(l.text);
      const width = l.text.autoWidth ? measured.width : l.text.width;
      const height = l.text.autoWidth ? measured.height : (l.text.fixedHeight ?? measured.height);
      const corner = mapPoint(l.text.x, l.text.y);
      const opposite = mapPoint(l.text.x + width, l.text.y + height);
      const nx = Math.min(corner.x, opposite.x);
      const ny = Math.min(corner.y, opposite.y);
      let rotation = l.text.rotation;
      if (dir === 'cw') rotation += 90;
      else if (dir === 'ccw') rotation -= 90;
      else if (dir === '180') rotation += 180;
      else rotation = -rotation; // flip-h / flip-v mirror the angle
      rotation = ((rotation % 360) + 360) % 360;
      const nextText: TextLayerData = { ...l.text, x: nx, y: ny, rotation };
      if (swapped && !l.text.autoWidth) {
        nextText.width = height;
        if (l.text.fixedHeight != null) nextText.fixedHeight = width;
      }
      return { ...l, text: nextText };
    }), 'Rotate Canvas');
    setSelection(NO_SELECTION);
    setFitSignal(s => s + 1);
    scheduleAutosave();
  }

  function handleRenameLayer(id: string, name: string) {
    updateLayers(current => updateLayer(current, id, l => ({ ...l, name })), 'Rename Layer');
  }

  function handleUpdateAdjustmentLayer(id: string, patch: Partial<AdjustmentLayerData>) {
    updateLayers(current => updateLayer(current, id, l =>
      l.type === 'adjustment' && l.adjustment ? { ...l, adjustment: { ...l.adjustment, ...patch } } : l
    ));
  }

  /**
   * @param mode 'replace' (plain click) or 'toggle' (Shift/Ctrl-click — adds, or removes if already
   *             selected). A toggle keeps the clicked layer primary so the panels follow it.
   */
  // Selecting a layer — from the canvas or the Layers panel — only ever selects it. It used to also
  // jump the shared dock over to that layer's Text/Adjustment tab, which made the Layers list
  // itself vanish on the very click that was supposed to just highlight a row in it. Opening those
  // deeper panels is now a separate, explicit action: the Layers panel's own settings button
  // (`openLayerSettings` below), handleAddTextLayer/handleAddAdjustmentLayer on creation, or
  // jumpToBubble from Translation Preview.
  function selectLayer(id: string, mode: LayerSelectMode = 'replace') {
    if (mode === 'toggle') {
      setSelectedLayerIds(current => current.includes(id)
        ? current.filter(l => l !== id)
        : [...current, id]);
    } else {
      setSelectedLayerIds([id]);
    }
    setActiveMaskLayerId(null);
  }

  /** Replaces the whole selection at once — used by the canvas's drag-a-box object marquee. */
  function selectLayers(ids: string[]) {
    setSelectedLayerIds(ids);
    setActiveMaskLayerId(null);
  }

  /** Explicit intent to edit a layer's full settings (Text/Adjustment panel) — the Layers panel's
   *  settings button, not plain selection. No-ops for layer types with no dedicated panel. */
  function openLayerSettings(id: string) {
    const type = findLayer(layers, id)?.type;
    if (type === 'text') panelLayout.reveal('text');
    if (type === 'adjustment') panelLayout.reveal('adjustment');
    setActiveMaskLayerId(null);
  }

  /** Clicking a mask's thumbnail makes it the paint target; clicking it again (or the layer's own
   *  thumbnail) returns to painting the layer itself. */
  function selectMask(id: string) {
    setSelectedLayerIds([id]);
    setActiveMaskLayerId(current => (current === id ? null : id));
  }

  function handleDuplicateLayer(id: string) {
    const source = findLayer(layers, id);
    if (!source || source.isBackground) return;
    // cloneSubtree regenerates ids for the layer *and* every descendant (masks included), and hands
    // back the map both registries need — the pixels live under the old ids, so a copy without this
    // is silently blank.
    const { copy, idMap } = cloneSubtree(source);
    canvasRef.current?.clonePaintCanvases(idMap);
    canvasRef.current?.cloneMaskCanvases(idMap);
    updateLayers(current => insertAfter(current, id, copy), 'Duplicate Layer');
    setActiveLayerId(copy.id);
  }

  function handleDeleteLayer(id: string) {
    handleDeleteLayers([id]);
  }

  /**
   * Wraps the current selection in a new group. `groupLayers` refuses a selection that spans
   * parents (it would silently reorder layers the user never selected), so tell them why rather
   * than no-op'ing in silence.
   */
  function handleGroupLayers() {
    const ids = selectedLayerIds.filter(id => !findLayer(layers, id)?.isBackground);
    if (ids.length === 0) {
      swalToast({ icon: 'info', title: 'Select one or more layers to group' });
      return;
    }
    const parents = new Set(ids.map(id => getParent(layers, id)?.id ?? null));
    if (parents.size > 1) {
      swalToast({ icon: 'info', title: 'Selected layers must be in the same group' });
      return;
    }
    const group = createGroupLayer();
    updateLayers(current => groupLayers(current, ids, group), 'Group Layers');
    setSelectedLayerIds([group.id]);
  }

  function handleUngroupLayer(id: string) {
    const target = findLayer(layers, id);
    if (!target || target.type !== 'group') return;
    const childIds = (target.children ?? []).map(c => c.id);
    updateLayers(current => ungroup(current, id), 'Ungroup Layers');
    // Select what came out; selecting the now-deleted group would leave every panel pointing at
    // a layer that no longer exists.
    setSelectedLayerIds(childIds.length > 0 ? childIds : ['background']);
  }

  /**
   * Clips the active layer to the raster layer directly beneath it, or releases it.
   *
   * Only raster layers can be a base (`canBeClipBase`) — both renderers trim a run by re-drawing
   * the base with `destination-in`, which needs the base to be a single drawable.
   */
  function handleToggleClipped(id: string) {
    const layer = findLayer(layers, id);
    if (!layer || layer.isBackground) return;

    if (layer.clipped) {
      updateLayers(current => updateLayer(current, id, l => ({ ...l, clipped: false })), 'Release Clipping Mask');
      return;
    }

    const siblings = getSiblings(layers, id);
    const index = siblings.findIndex(l => l.id === id);
    const below = index > 0 ? siblings[index - 1] : null;
    if (!canBeClipBase(below)) {
      swalToast({ icon: 'info', title: 'Clipping needs a raster layer directly below' });
      return;
    }
    updateLayers(current => updateLayer(current, id, l => ({ ...l, clipped: true })), 'Create Clipping Mask');
  }

  /**
   * Adds a raster mask to any layer type (groups included — see `StudioLayer.mask`'s doc comment),
   * except adjustments: they have no paintable content to trim, and their own `filters()` slot is
   * already owned by the adjustment effect in `StudioCanvas.tsx`.
   * Seeded from the active selection if one exists, otherwise fully opaque (reveal everything),
   * matching Photoshop's "Add Layer Mask" default.
   */
  function handleAddMask(id: string) {
    const layer = findLayer(layers, id);
    if (!layer || layer.mask || layer.type === 'adjustment') return;
    const mask = createLayerMask();
    updateLayers(current => updateLayer(current, id, l => ({ ...l, mask })), 'Add Layer Mask');
    canvasRef.current?.createMask(mask.id);
  }

  function handleDeleteMask(id: string) {
    const layer = findLayer(layers, id);
    if (!layer?.mask) return;
    canvasRef.current?.deleteMaskCanvas(layer.mask.id);
    updateLayers(current => updateLayer(current, id, l => ({ ...l, mask: undefined })), 'Delete Layer Mask');
    if (activeMaskLayerId === id) setActiveMaskLayerId(null);
  }

  function handleToggleMaskEnabled(id: string) {
    updateLayers(current => updateLayer(current, id, l =>
      l.mask ? { ...l, mask: { ...l.mask, enabled: !l.mask.enabled } } : l
    ), 'Toggle Layer Mask');
  }

  /** Add/Delete Mask toggle for the Layers panel button — mirrors `handleToggleClipped`'s shape. */
  function handleToggleMaskExistence(id: string) {
    const layer = findLayer(layers, id);
    if (layer?.mask) handleDeleteMask(id);
    else handleAddMask(id);
  }

  function handleToggleGroupCollapsed(id: string) {
    updateLayers(current => updateLayer(current, id, l => ({ ...l, collapsed: !l.collapsed })));
  }

  /** Drag-and-drop reparent from the Layers panel. `layerTree.reparent` enforces legality — cycles,
   *  the background, non-group parents — so an impossible drop lands as a no-op, not corruption. */
  function handleReparentLayer(id: string, newParentId: string | null, index: number) {
    updateLayers(current => reparent(current, id, newParentId, index), 'Move Layer');
  }

  /** Deletes every given layer. The background is never deletable, so it's filtered out rather
   *  than special-cased at each call site. */
  function handleDeleteLayers(ids: string[]) {
    const doomed = ids
      .map(id => findLayer(layers, id))
      .filter((l): l is StudioLayer => !!l && !l.isBackground && !l.locked);
    if (doomed.length === 0) return;
    const doomedIds = doomed.map(l => l.id);
    updateLayers(current => removeLayers(current, doomedIds), doomed.length > 1 ? `Delete ${doomed.length} Layers` : 'Delete Layer');
    // Deleting a group takes its whole subtree with it, so every descendant's canvas — and its mask,
    // if it has one — has to go too or the registry leaks them for the rest of the session (and into
    // the next autosave).
    const subtree = doomed.flatMap(collectSubtree);
    subtree.forEach(l => canvasRef.current?.deletePaintCanvas(l.id));
    subtree.forEach(l => { if (l.mask) canvasRef.current?.deleteMaskCanvas(l.mask.id); });
    if (subtree.some(l => l.id === activeMaskLayerId)) setActiveMaskLayerId(null);
    setActiveLayerId('background');
  }

  /**
   * Paint strokes are committed by the time this fires; `before` is the pixels just prior. `maskId`
   * is set when the stroke landed on a layer's mask rather than its own raster canvas — `layerId`
   * is still the owning layer either way, since masks have no Konva node of their own to redraw.
   */
  function handlePaintStrokeEnd(layerId: string, before: ImageData, maskId?: string) {
    const canvas = maskId ? canvasRef.current?.getMaskCanvas(maskId) : canvasRef.current?.getPaintCanvas(layerId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push({
      label: maskId ? 'Paint Mask' : 'Paint Stroke',
      undo: () => { ctx.putImageData(before, 0, 0); canvasRef.current?.redrawLayer(layerId); },
      redo: () => { ctx.putImageData(after, 0, 0); canvasRef.current?.redrawLayer(layerId); },
    });
    // Raster pixel edits don't touch layersByPage state, so they need an explicit autosave nudge.
    scheduleAutosave();
  }

  function handleMoveLayer(id: string, direction: 'up' | 'down') {
    updateLayers(current => moveWithinParent(current, id, direction), 'Reorder Layer');
  }

  function handleToggleVisible(id: string) {
    updateLayers(current => updateLayer(current, id, l => ({ ...l, visible: !l.visible })), 'Toggle Visibility');
  }

  function handleToggleLocked(id: string) {
    updateLayers(current => updateLayer(current, id, l => ({ ...l, locked: !l.locked })), 'Toggle Lock');
  }

  function handleOpacityChange(id: string, opacity: number) {
    // Continuous slider drag — intentionally not tracked in history (would spam an entry per pixel).
    updateLayers(current => updateLayer(current, id, l => ({ ...l, opacity })));
  }

  function handleBlendChange(id: string, blendMode: StudioLayer['blendMode']) {
    updateLayers(current => updateLayer(current, id, l => ({ ...l, blendMode })), 'Change Blend Mode');
  }

  function handleAddTextLayer(x: number, y: number, boxWidth?: number, boxHeight?: number) {
    // TypeR auto-detect-bubble: a plain click (not a drag-to-size box) while armed flood-fills
    // from the click point to find the speech bubble there, and sizes/centers the new layer to it
    // instead of dropping it at the raw click point — same centering math as handlePlaceAllBubbles.
    if (typerArmed && typerAutoCenterBubble && boxWidth === undefined && typerLines[typerIndex]) {
      const bubble = canvasRef.current?.detectBubbleBounds(x, y);
      if (bubble) {
        const lineCount = typerLines[typerIndex].content.split('\n').length || 1;
        const textWidth = Math.max(40, Math.min(bubble.width, 400));
        const textHeight = lineCount * typerLines[typerIndex].style.fontSize * 1.15;
        x = bubble.centerX - textWidth / 2;
        y = bubble.centerY - textHeight / 2;
        boxWidth = textWidth;
      }
    }

    const layer = createTextLayer(x, y, boxWidth, boxHeight);

    if (typerArmed && typerLines[typerIndex]) {
      const { content, style, boldOverride, italicOverride } = typerLines[typerIndex];
      layer.name = `Text: ${content.slice(0, 20)}`;
      layer.text = {
        ...layer.text!,
        content,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        color: style.color,
        bold: boldOverride ?? style.bold,
        italic: italicOverride ?? style.italic,
        strokeColor: style.strokeColor,
        strokeWidth: style.strokeWidth,
      };
      updateLayers(current => [...current, layer], 'Place TypeR Line');
      setActiveLayerId(layer.id);
      const nextIndex = typerIndex + 1;
      setTyperIndex(nextIndex);
      if (nextIndex >= typerLines.length) setTyperArmed(false);
      return;
    }

    updateLayers(current => [...current, layer], 'Add Text Layer');
    setActiveLayerId(layer.id);
    setActiveTool('select');
    panelLayout.reveal('text');
  }

  function handleUpdateTextLayer(id: string, patch: Partial<TextLayerData>) {
    updateLayers(current => updateLayer(current, id, l => {
      if (l.type !== 'text' || !l.text) return l;
      // Default a freshly-typed layer to RTL/right alignment the moment its content first reads as
      // Arabic — only on the empty-to-non-empty transition, and only if the caller (or a prior edit)
      // hasn't already set an alignment, so it never fights a deliberate later change.
      let next = patch;
      if (patch.content && !l.text.content && patch.align === undefined && isArabicMajority(patch.content)) {
        next = { ...patch, align: 'right' };
      }
      return { ...l, text: { ...l.text, ...next } };
    }));
  }

  /** Double-clicking a text layer's own ⊞ overflow indicator: fits fixedHeight tightly to the
   *  content it's currently holding, undoably — the height counterpart to the existing width
   *  auto-fit on a Transformer-handle dblclick (StudioCanvas.tsx), but a separate mechanism (fires
   *  on the indicator's own Konva node, not the Transformer). No-op for point text (autoWidth has
   *  no fixedHeight concept). */
  function handleAutoFitTextHeight(id: string) {
    const layer = findLayer(layers, id);
    if (!layer || layer.type !== 'text' || !layer.text || layer.text.autoWidth) return;
    const fitted = Math.max(20, layoutText(layer.text).height);
    updateLayers(current => updateLayer(current, id, l =>
      l.type === 'text' && l.text ? { ...l, text: { ...l.text, fixedHeight: fitted } } : l
    ), 'Auto-Fit Text Box Height');
  }

  function handleUpdatePathLayer(id: string, patch: Partial<PathLayerData>) {
    updateLayers(current => updateLayer(current, id, l =>
      l.type === 'path' && l.path ? { ...l, path: { ...l.path, ...patch } } : l
    ));
  }

  function handleAddPathLayer(anchors: PathAnchor[], closed: boolean) {
    const layer = createPathLayer(anchors, closed, { strokeColor: paintSettings.color, strokeWidth: Math.max(2, paintSettings.size / 6) });
    updateLayers(current => [...current, layer], 'Add Path Layer');
    setActiveLayerId(layer.id);
    setActiveTool('path-select');
  }

  /** Cross-page text edit, for the Translation Preview panel (search/replace, status, comments). */
  function handleUpdateTextLayerOnPage(pageId: string, id: string, patch: Partial<TextLayerData>) {
    updateLayersOnPage(pageId, current => updateLayer(current, id, l =>
      l.type === 'text' && l.text ? { ...l, text: { ...l.text, ...patch } } : l
    ));
  }

  function jumpToBubble(pageId: string, layerId: string) {
    setActivePageId(pageId);
    setActiveLayerId(layerId);
    panelLayout.reveal('text');
  }

  function handleCenterTextLayer(id: string) {
    canvasRef.current?.centerTextLayerInBubble(id);
  }

  /**
   * Bumps the active text layer's font size by `typerSizeStep * delta` and re-centers it around
   * its old midpoint (mirrors the real TypeR extension's size-increment shortcut). Line spacing
   * scaling falls out for free here since `lineHeight` is already a multiplier of `fontSize`, not
   * an absolute value — unlike Photoshop's `leading`, nothing needs adjusting alongside it.
   */
  function handleTextSizeStep(delta: number) {
    if (!activeLayerId || activeLayer?.type !== 'text' || !activeLayer.text) return;
    const before = layoutText(activeLayer.text);
    const fontSize = Math.max(1, activeLayer.text.fontSize + delta * typerSizeStep);
    const after = layoutText({ ...activeLayer.text, fontSize });
    handleUpdateTextLayer(activeLayerId, {
      fontSize,
      x: activeLayer.text.x - (after.width - before.width) / 2,
      y: activeLayer.text.y - (after.height - before.height) / 2,
    });
  }

  /** The Text menu's own character-range concept — the layer's whole content when nothing is
   *  selected in the editing textarea, exactly mirroring TextPanel's `range` (see textRuns.ts's
   *  applyCharPatch/resolveCharValue doc comments for why the two share one implementation). */
  function activeTextRange(): { start: number; end: number } | null {
    if (!activeLayer?.text) return null;
    return textSelection && textSelection.layerId === activeLayer.id && textSelection.end > textSelection.start
      ? textSelection
      : null;
  }

  function handleToggleTextBold() {
    if (!activeLayer?.text) return;
    const range = activeTextRange();
    const isBold = resolveCharValue(activeLayer.text, range, 'fontWeight') >= 600;
    handleUpdateTextLayer(activeLayer.id, applyCharPatch(activeLayer.text, range, { bold: !isBold, fontWeight: undefined }));
  }

  function handleToggleTextItalic() {
    if (!activeLayer?.text) return;
    const range = activeTextRange();
    const isItalic = resolveCharValue(activeLayer.text, range, 'italic');
    handleUpdateTextLayer(activeLayer.id, applyCharPatch(activeLayer.text, range, { italic: !isItalic }));
  }

  function handleSetTextFontSize(size: number) {
    if (!activeLayer?.text) return;
    handleUpdateTextLayer(activeLayer.id, applyCharPatch(activeLayer.text, activeTextRange(), { fontSize: size }));
  }

  /** Align is a paragraph property (layer-wide), never a per-run override — matches TextPanel's own
   *  align buttons, which always call `set({ align })` rather than `setChar`. */
  function handleSetTextAlign(align: TextAlign) {
    if (!activeLayer?.text) return;
    handleUpdateTextLayer(activeLayer.id, { align });
  }

  // RTL/LTR: this app has no separate `dir` field — right alignment is the existing proxy for "this
  // layer is RTL" that the editing textarea's own `dir` attribute already keys off (StudioCanvas.tsx),
  // so setting align is the whole, real implementation rather than a stub with nothing to back it.
  function handleSetTextRtl() { handleSetTextAlign('right'); }
  function handleSetTextLtr() { handleSetTextAlign('left'); }

  function handleOpenFontPanel() {
    setRightOpen(true);
    panelLayout.reveal('text');
  }

  function handleTriggerImportFonts() {
    setRightOpen(true);
    panelLayout.reveal('fonts');
  }

  function handleTriggerImportBrushes() {
    setRightOpen(true);
    panelLayout.reveal('brushes');
  }

  const activeLayer = findLayer(layers, activeLayerId) ?? null;

  /** Stroke/Fill Path's bake target — same "topmost existing raster layer" convention the
   *  paint-tool raster-auto-create effect below already uses, so both features pick the same
   *  layer a user would expect a paint-family action to land on. */
  function topmostRasterLayer(): StudioLayer | null {
    return [...layers].reverse().find(l => l.type === 'clean-patch') ?? null;
  }

  function bakeActivePath(bake: (ctx: CanvasRenderingContext2D, path: NonNullable<StudioLayer['path']>, selection: Selection) => void) {
    const pathLayer = activeLayer?.type === 'path' ? activeLayer : null;
    const target = topmostRasterLayer();
    if (!pathLayer?.path || !target) return;
    const canvas = canvasRef.current?.getPaintCanvas(target.id);
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    bake(ctx, pathLayer.path, selection);
    canvasRef.current?.redrawLayer(target.id);
    handlePaintStrokeEnd(target.id, before);
  }

  const handleStrokeActivePath = () => bakeActivePath(strokePathOntoCanvas);
  const handleFillActivePath = () => bakeActivePath(fillPathOntoCanvas);
  const canBakePath = activeLayer?.type === 'path' && !!topmostRasterLayer();

  function handleMakeSelectionFromPath() {
    if (activeLayer?.type !== 'path' || !activeLayer.path) return;
    setSelection(pathToSelection(activeLayer.path));
  }

  /** The layer directly beneath the active one among its siblings — its clip base, if it can be one. */
  const layerBelowActive = (() => {
    if (!activeLayerId) return null;
    const siblings = getSiblings(layers, activeLayerId);
    const index = siblings.findIndex(l => l.id === activeLayerId);
    return index > 0 ? siblings[index - 1] : null;
  })();

  // Paint-family tools need a clean-patch (raster) layer to draw onto — the Background layer has
  // no backing canvas, so without this every brush/fill/shape tool would silently no-op the moment
  // a fresh chapter is opened (Background is the default active layer). Reuse the topmost existing
  // raster layer if there is one; only create a fresh one if the stack has none at all.
  useEffect(() => {
    // Quick Mask paints onto its own scratch buffer regardless of the active layer — forcing a
    // layer switch here would be pointless churn (and could create an unwanted layer) mid-edit.
    // A layer mask being edited is the same story: it has its own canvas regardless of the active
    // layer's type, so force-switching to a raster layer would just kick the user out of the mask.
    if (quickMaskActive || activeMaskLayerId) return;
    if (!(PAINT_TOOLS as readonly string[]).includes(activeTool) || !activeLayer) return;
    if (activeLayer.type === 'clean-patch') return;
    // flattenTree, not the raw root array — a clean-patch layer nested inside a group is otherwise
    // invisible to this scan, so painting while a group holding one is active/collapsed would
    // create a redundant new layer instead of reusing the one that already exists.
    const existing = [...flattenTree(layers)].reverse().find(l => l.type === 'clean-patch');
    if (existing) {
      setActiveLayerId(existing.id);
    } else {
      handleAddLayer();
      swalToast({ icon: 'info', title: 'New layer created for painting' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  const cropHintShownRef = useRef(false);
  useEffect(() => {
    if (activeTool === 'crop' && !cropHintShownRef.current) {
      cropHintShownRef.current = true;
      swalToast({ icon: 'info', title: 'Draw a rectangle, then press Enter or double-click to crop' });
    }
  }, [activeTool]);

  const layersPanel = (
    <LayersPanel
      layers={layers}
      activeLayerId={activeLayerId}
      selectedLayerIds={selectedLayerIds}
      onSelect={selectLayer}
      onToggleVisible={handleToggleVisible}
      onToggleLocked={handleToggleLocked}
      onOpacityChange={handleOpacityChange}
      onBlendChange={handleBlendChange}
      onAdd={handleAddLayer}
      onAddBlank={handleAddBlankLayer}
      onAddAdjustment={handleAddAdjustmentLayer}
      onDuplicate={handleDuplicateLayer}
      onDelete={handleDeleteLayer}
      onDeleteMany={handleDeleteLayers}
      onRename={handleRenameLayer}
      onMove={handleMoveLayer}
      onGroup={handleGroupLayers}
      onUngroup={handleUngroupLayer}
      onToggleCollapsed={handleToggleGroupCollapsed}
      onReparent={handleReparentLayer}
      onToggleClipped={handleToggleClipped}
      onOpenSettings={openLayerSettings}
      onToggleMask={handleToggleMaskExistence}
      onToggleMaskEnabled={handleToggleMaskEnabled}
      onSelectMask={selectMask}
      activeMaskLayerId={activeMaskLayerId}
      expandedLayerId={expandedLayerId}
      onToggleExpanded={(id) => setExpandedLayerId(current => (current === id ? null : id))}
      hideTitle
    />
  );

  const textPanel = activeLayer?.type === 'text' ? (
    <TextPanel
      layer={activeLayer}
      onUpdate={handleUpdateTextLayer}
      onCenter={handleCenterTextLayer}
      fontFamilies={allFontFamilies}
      selection={textSelection?.layerId === activeLayer.id ? textSelection : null}
      selectedLineIndex={textLineSelection?.layerId === activeLayer.id ? textLineSelection.lineIndex : null}
      hideTitle
    />
  ) : null;

  const adjustmentPanel = activeLayer?.type === 'adjustment' ? (
    <AdjustmentPanel layer={activeLayer} onUpdate={handleUpdateAdjustmentLayer} hideTitle />
  ) : null;

  const brushesPanel = (
    <BrushesPanel
      color={foreground}
      activeBrushId={activeBrushId}
      onSelectBrush={handleSelectBrush}
      hideTitle
      live={{ size: brushSize, hardness: brushHardness, opacity: brushOpacity, flow: brushFlow,
        spacing, angle: brushAngle, roundness: brushRoundness, scatter, smoothing, pressureSize, pressureOpacity }}
      onLiveChange={(patch) => {
        if (patch.size !== undefined) setBrushSize(patch.size);
        if (patch.hardness !== undefined) setBrushHardness(patch.hardness);
        if (patch.opacity !== undefined) setBrushOpacity(patch.opacity);
        if (patch.flow !== undefined) setBrushFlow(patch.flow);
        if (patch.spacing !== undefined) setSpacing(patch.spacing);
        if (patch.angle !== undefined) setBrushAngle(patch.angle);
        if (patch.roundness !== undefined) setBrushRoundness(patch.roundness);
        if (patch.scatter !== undefined) setScatter(patch.scatter);
        if (patch.smoothing !== undefined) setSmoothing(patch.smoothing);
        if (patch.pressureSize !== undefined) setPressureSize(patch.pressureSize);
        if (patch.pressureOpacity !== undefined) setPressureOpacity(patch.pressureOpacity);
      }}
    />
  );

  const colorPanel = <ColorPanel hideTitle />;
  const historyPanel = <HistoryPanel hideTitle />;
  const fontsPanel = <FontsPanel onFamiliesChange={setCustomFontFamilies} hideTitle />;

  // Built once and reused for both the docked-tab render and the floating window — the one place a
  // copy-pasted prop list could quietly drift between the two.
  const typerPanelProps = {
    script: typerScript,
    onScriptChange: setTyperScript,
    styles: typerStyles,
    onStylesChange: setTyperStyles,
    folders: typerFolders,
    onFoldersChange: setTyperFolders,
    ignoreLinePrefixes,
    onIgnoreLinePrefixesChange: setIgnoreLinePrefixes,
    ignoreTags,
    onIgnoreTagsChange: setIgnoreTags,
    defaultStyleId,
    onDefaultStyleIdChange: setDefaultStyleId,
    autoCenterBubble: typerAutoCenterBubble,
    onAutoCenterBubbleChange: setTyperAutoCenterBubble,
    sizeStep: typerSizeStep,
    onSizeStepChange: setTyperSizeStep,
    index: typerIndex,
    onIndexChange: setTyperIndex,
    armed: typerArmed,
    onArmedChange: (armed: boolean) => { setTyperArmed(armed); if (armed) setActiveTool(multiBubbleMode ? 'marquee-rect' : 'text'); },
    fontFamilies: allFontFamilies,
    multiBubbleMode,
    onMultiBubbleModeChange: setMultiBubbleMode,
    queuedBubbleCount: multiBubbleRects.length,
    onAddBubbleRect: handleAddBubbleRect,
    onPlaceAllBubbles: handlePlaceAllBubbles,
  };

  const typerPanel = typerFloating ? (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-micro text-ink-faint">TypeR is floating.</p>
      <button
        type="button"
        onClick={() => setTyperFloating(false)}
        className="h-8 px-3 rounded-control text-ui font-medium border border-hairline bg-ink/5 text-ink hover:bg-ink/10 transition-colors"
      >
        Dock it back
      </button>
    </div>
  ) : (
    <TyperPanel {...typerPanelProps} onPopOut={() => setTyperFloating(true)} hideTitle />
  );

  const translationPanel = (
    <TranslationPreviewPanel
      pages={pages}
      layersByPage={layersByPage}
      activePageId={activePageId}
      onJumpToBubble={jumpToBubble}
      onUpdateText={(pageId, layerId, patch) => handleUpdateTextLayerOnPage(pageId, layerId, patch)}
      hideTitle
    />
  );

  const allTabs = [
    ...(textPanel ? [{ id: 'text', label: 'Text', content: textPanel }] : []),
    ...(adjustmentPanel ? [{ id: 'adjustment', label: 'Adjustment', content: adjustmentPanel }] : []),
    { id: 'typer', label: 'TypeR', content: typerPanel },
    { id: 'translation', label: 'Translation', content: translationPanel },
    { id: 'brushes', label: 'Brushes', content: brushesPanel },
    { id: 'color', label: 'Color', content: colorPanel },
    { id: 'fonts', label: 'Fonts', content: fontsPanel },
    { id: 'history', label: 'History', content: historyPanel },
    { id: 'layers', label: 'Layers', content: layersPanel },
    { id: 'pages', label: 'Pages', content: null },
  ];
  // Every real stackable panel except Pages, which is the separate left-side sidebar the Window
  // menu also lists — its visibility is `leftOpen`, not part of PanelLayoutContext's stack at all.
  const panelStackEntries: PanelStackEntry[] = allTabs
    .filter(t => t.id !== 'pages')
    .map(t => ({
      id: t.id,
      label: t.label,
      content: t.content,
      ...(t.id === 'layers' ? {
        onMenu: () => swal({
          title: 'Layers',
          input: 'select',
          inputOptions: { add: 'New Layer', addBlank: 'New Blank Layer', flatten: 'Flatten Image', mergeVisible: 'Merge Visible' },
          inputPlaceholder: 'Choose an action',
          showCancelButton: true,
          confirmButtonText: 'Go',
        }).then((r) => {
          if (!r.isConfirmed) return;
          if (r.value === 'add') handleAddLayer();
          else if (r.value === 'addBlank') handleAddBlankLayer();
          else if (r.value === 'flatten') void handleFlattenImage();
          else if (r.value === 'mergeVisible') void handleMergeVisible();
        }),
      } : {}),
    }));
  const pagesTabHorizontal = <StudioPagesPanel pages={pages} activePageId={activePageId} onSelect={setActivePageId} orientation="horizontal" onManagePages={() => setPagesManagerOpen(true)} />;

  const menus = buildMenus({
    onBack: onBack,
    onExport: () => setExportOpen(true),
    onExportSlices: handleExportSlices,
    hasSliceRects: sliceRects.length > 0,
    exportMsp: () => onExportMsp?.(),
    saveProjectNow: handleSaveProjectNow,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    cutLayer: handleCutLayer,
    copyLayer: handleCopyLayer,
    pasteLayer: handlePasteLayer,
    canCopy: !!activeLayer && !activeLayer.isBackground,
    canPaste: getClipboardLayer() !== null,
    openFindReplace: handleOpenFindReplace,
    toggleCleaned: () => setShowCleaned(v => !v),
    zoomIn: () => canvasRef.current?.zoomIn(),
    zoomOut: () => canvasRef.current?.zoomOut(),
    fit: () => setFitSignal(s => s + 1),
    actualSize: () => canvasRef.current?.zoomTo(1),
    toggleDock: () => setRightOpen(v => !v),
    addLayer: handleAddLayer,
    addBlankLayer: handleAddBlankLayer,
    duplicateLayer: () => activeLayerId && handleDuplicateLayer(activeLayerId),
    // Delete removes the whole selection, not just the primary layer.
    deleteLayer: () => handleDeleteLayers(selectedLayerIds),
    moveLayerUp: () => activeLayerId && handleMoveLayer(activeLayerId, 'up'),
    moveLayerDown: () => activeLayerId && handleMoveLayer(activeLayerId, 'down'),
    hasActiveLayer: !!activeLayer && !activeLayer.isBackground,
    groupLayers: handleGroupLayers,
    ungroupLayers: () => activeLayerId && handleUngroupLayer(activeLayerId),
    isGroupActive: activeLayer?.type === 'group',
    toggleClipped: () => { if (activeLayerId) handleToggleClipped(activeLayerId); },
    canClip: !!activeLayer && !activeLayer.isBackground && canBeClipBase(layerBelowActive),
    strokeActivePath: handleStrokeActivePath,
    fillActivePath: handleFillActivePath,
    canBakePath,
    makeSelectionFromPath: handleMakeSelectionFromPath,
    hasActivePathLayer: activeLayer?.type === 'path',
    isClipped: activeLayer?.clipped === true,
    toggleMask: () => {
      if (!activeLayerId) return;
      if (activeLayer?.mask) handleDeleteMask(activeLayerId);
      else handleAddMask(activeLayerId);
    },
    canMask: !!activeLayer && !activeLayer.isBackground && activeLayer.type !== 'adjustment',
    hasMask: activeLayer?.mask != null,
    mergeDown: handleMergeDown,
    canMergeDown: activeLayer?.type === 'clean-patch' && layerBelowActive?.type === 'clean-patch',
    mergeVisible: () => { void handleMergeVisible(); },
    flattenImage: () => { void handleFlattenImage(); },
    layerProperties: handleOpenLayerProperties,
    addTextLayer: () => setActiveTool('text'),
    centerTextInBubble: () => activeLayerId && handleCenterTextLayer(activeLayerId),
    increaseTextSize: () => handleTextSizeStep(1),
    decreaseTextSize: () => handleTextSizeStep(-1),
    hasActiveTextLayer: activeLayer?.type === 'text',
    textSetBold: handleToggleTextBold,
    textSetItalic: handleToggleTextItalic,
    textSetFontSize: handleSetTextFontSize,
    textSetAlign: handleSetTextAlign,
    textSetRtl: handleSetTextRtl,
    textSetLtr: handleSetTextLtr,
    openFontPanel: handleOpenFontPanel,
    addAdjustmentLayerKind: handleAddAdjustmentLayerOfKind,
    filtersEnabled: false,
    applyFilter: () => {},
    liquifyTool: switchToLiquify,
    contentAwareFillTool: switchToContentAwareFill,
    rotateCanvas: (dir) => { void handleRotateCanvas(dir); },
    toolRailVisible,
    toggleToolRail,
    optionsBarVisible,
    toggleOptionsBar,
    resetLayoutEnabled: true,
    resetPanelLayout: panelLayout.resetLayout,
    aboutOpen: () => setAboutOpen(true),
    triggerImportFonts: handleTriggerImportFonts,
    triggerImportBrushes: handleTriggerImportBrushes,
    typerFloating,
    toggleTyperFloating: () => setTyperFloating(v => !v),
    panelTabs: allTabs.map(t => ({ id: t.id, label: t.label })),
    // A real on/off toggle (not "always turn on") — Window > Brushes Panel needs to make the panel
    // disappear on a second click, not just re-select an already-visible one.
    showPanel: (id) => {
      if (id === 'pages') { setLeftOpen(v => !v); return; }
      const next = !panelLayout.isVisible(id);
      if (next) setRightOpen(true);
      panelLayout.setVisible(id, next);
    },
    isPanelVisible: (id) => {
      if (id === 'pages') return leftOpen;
      return rightOpen && panelLayout.isVisible(id);
    },
    showShortcutsHelp: () => swal({
      title: 'Keyboard Shortcuts',
      html: `<div style="text-align:left;font-size:13px;line-height:1.8">${FIXED_SHORTCUTS_HELP.map(s => `<div><b>${s.keys}</b> — ${s.description}</div>`).join('')}</div>`,
    }),
    isFullscreen,
    toggleFullscreen,
    panelsHidden,
    togglePanelsHidden: () => setPanelsHidden(v => !v),
    showGrid,
    toggleGrid: () => setShowGrid(v => !v),
    showRulers,
    toggleRulers: () => setShowRulers(v => !v),
    hasSelection: hasSelection(selection),
    deselect: () => setSelection(NO_SELECTION),
    featherSelection: handleFeatherSelection,
    expandSelection: handleExpandSelection,
    contractSelection: handleContractSelection,
    transformSelection: handleTransformSelection,
    quickMaskActive,
    toggleQuickMask: handleToggleQuickMask,
  });

  const [layoutMode, setLayoutMode] = useState<'desktop' | 'tablet' | 'phone'>(() => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
    if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
    return 'phone';
  });
  useEffect(() => {
    const mqDesktop = window.matchMedia('(min-width: 1024px)');
    const mqTablet = window.matchMedia('(min-width: 768px)');
    const onChange = () => setLayoutMode(mqDesktop.matches ? 'desktop' : mqTablet.matches ? 'tablet' : 'phone');
    mqDesktop.addEventListener('change', onChange);
    mqTablet.addEventListener('change', onChange);
    return () => {
      mqDesktop.removeEventListener('change', onChange);
      mqTablet.removeEventListener('change', onChange);
    };
  }, []);
  const isDesktop = layoutMode === 'desktop';

  // Flattened, so grouping layers doesn't dim a stage that's still genuinely satisfied.
  const allLayers = flattenTree(layers);
  useEffect(() => {
    if (isDesktop) return;
    function onPointerDown(e: PointerEvent) {
      if (leftOpen && leftSidebarRef.current && !leftSidebarRef.current.contains(e.target as Node)) setLeftOpen(false);
      if (rightOpen && rightSidebarRef.current && !rightSidebarRef.current.contains(e.target as Node)) setRightOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isDesktop, leftOpen, rightOpen]);

  const workflowStages = [
    { id: 'chapter', label: 'Chapter', active: true, tracked: true },
    { id: 'page', label: 'Page', active: !!activePage, tracked: true },
    { id: 'detection', label: 'Detection', active: false, tracked: false },
    { id: 'cleaning', label: 'Cleaning', active: !!activePage?.cleaned, tracked: true },
    { id: 'drawing', label: 'Drawing', active: allLayers.some(l => l.type === 'clean-patch'), tracked: true },
    { id: 'typesetting', label: 'Typesetting', active: allLayers.some(l => l.type === 'text' && !!l.text?.content), tracked: true },
    { id: 'review', label: 'Review', active: false, tracked: false },
    { id: 'export', label: 'Export', active: false, tracked: false },
  ];

  const canvasNode = (
    <StudioCanvas
      ref={canvasRef}
      page={activePage}
      showCleaned={showCleaned}
      overlayOpacity={overlayOpacity}
      showGrid={showGrid}
      showRulers={showRulers}
      activeTool={activeTool}
      fitSignal={fitSignal}
      layers={layers}
      activeLayerId={activeLayerId}
      selectedLayerIds={selectedLayerIds}
      onSelectLayer={selectLayer}
      onSelectLayers={selectLayers}
      onAddTextLayer={handleAddTextLayer}
      fontFamilies={allFontFamilies}
      onUpdateTextLayer={handleUpdateTextLayer}
      onAutoFitTextHeight={handleAutoFitTextHeight}
      onUpdatePathLayer={handleUpdatePathLayer}
      onAddPathLayer={handleAddPathLayer}
      onTextSelectionChange={setTextSelection}
      onTextLineSelectionChange={setTextLineSelection}
      paintSettings={paintSettings}
      selection={selection}
      onSelectionChange={setSelection}
      typeRegionArmed={typeRegionArmed}
      onCreateTypeRegion={handleCreateTypeRegion}
      onPaintStrokeEnd={handlePaintStrokeEnd}
      onEyedropperPick={setForeground}
      onCommitCrop={handleCommitCrop}
      queuedBubbleRects={multiBubbleRects}
      queuedSliceRects={sliceRects}
      transformingSelection={transformingSelection}
      onExitTransformSelection={() => setTransformingSelection(false)}
      quickMaskActive={quickMaskActive}
      activeMaskLayerId={activeMaskLayerId}
    />
  );

  // Every real panel now stacks vertically in one column (PanelStack), each independently visible/
  // collapsed/reordered/maximized via PanelLayoutContext — replacing the old fixed 3-block layout
  // (Color pinned top, one swappable tab strip, Layers pinned bottom).
  const toolsSidebar = (
    <div className="h-full flex">
      {toolRailVisible && <ToolRail activeTool={activeTool} onToolChange={setActiveTool} orientation="vertical" />}
      <div className="w-64 sm:w-72 h-full min-h-0 border-l border-hairline">
        <PanelStack panels={panelStackEntries} />
      </div>
    </div>
  );

  return (
    <div ref={studioRootRef} className="studio-shell fixed inset-0 lg:relative lg:inset-auto studio-canvas-bg flex flex-col lg:rounded-panel lg:overflow-hidden lg:border lg:border-hairline lg:h-[calc(100vh-8.5rem)] z-30">
      {/* No overflow-x here (there used to be one): per the CSS Overflow spec, 'overflow-x: auto'
          with 'overflow-y' unset forces the *computed* overflow-y to 'auto' too — and that
          coercion applies even if overflow-y is set to 'visible' explicitly, since 'visible' paired
          with a non-'visible' sibling axis isn't a valid combination at all. Either way, this bar's
          content clips to its own ~32px height, silently hiding every dropdown/submenu below it — a
          plain DOM/visibility check can't catch it, since Playwright auto-scrolls a clipping
          ancestor before interacting, which is exactly what made this look fine under automation.
          Ten short menu labels fit comfortably down to a 768px-wide viewport without scrolling. */}
      {!panelsHidden && (
        <div className="relative z-40">
          <MenuBar menus={menus} />
        </div>
      )}
      <StudioToolbar
        chapterName={chapterName}
        showCleaned={showCleaned}
        onToggleCleaned={() => setShowCleaned(v => !v)}
        overlayOpacity={overlayOpacity}
        onOverlayOpacityChange={setOverlayOpacity}
        onFit={() => setFitSignal(s => s + 1)}
        onBack={onBack}
        onToggleLeftSidebar={toggleLeftSidebar}
        onToggleRightSidebar={toggleRightSidebar}
        hasCleaned={!!activePage?.cleaned}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        workflowStages={workflowStages}
        typeRegionArmed={typeRegionArmed}
        onToggleTypeRegion={() => setTypeRegionArmed(v => !v)}
      />

      {!panelsHidden && optionsBarVisible && (
        <ToolOptionsBar
          activeTool={activeTool}
          size={brushSize}
          onSizeChange={setBrushSize}
          hardness={brushHardness}
          onHardnessChange={setBrushHardness}
          opacity={brushOpacity}
          onOpacityChange={setBrushOpacity}
          flow={brushFlow}
          onFlowChange={setBrushFlow}
          tolerance={tolerance}
          onToleranceChange={setTolerance}
          liquifyMode={liquifyMode}
          onLiquifyModeChange={setLiquifyMode}
          symmetry={symmetry}
          onSymmetryChange={setSymmetry}
          spacing={spacing}
          onSpacingChange={setSpacing}
          brushShape={brushShape}
          onBrushShapeChange={setBrushShape}
          angle={brushAngle}
          onAngleChange={setBrushAngle}
          roundness={brushRoundness}
          onRoundnessChange={setBrushRoundness}
          scatter={scatter}
          onScatterChange={setScatter}
          smoothing={smoothing}
          onSmoothingChange={setSmoothing}
          sliceRectCount={sliceRects.length}
          onAddSliceRect={handleAddSliceRect}
          onExportSlices={handleExportSlices}
          hasSelection={hasSelection(selection)}
          onDeselect={() => setSelection(NO_SELECTION)}
        />
      )}

      {/* Fixed 3-column body: Pages (left) | Canvas (center) | Tools (right). Desktop keeps all
          three as permanent columns; tablet/phone collapse the sidebars into slide-out sheets
          triggered from the top bar's Pages/Tools buttons. */}
      <div className="flex-1 flex min-h-0 relative">
        {!panelsHidden && isDesktop && leftOpen && (
          <div className="h-full shrink-0 relative z-30">
            <StudioPagesPanel pages={pages} activePageId={activePageId} onSelect={setActivePageId} orientation="vertical" onManagePages={() => setPagesManagerOpen(true)} />
          </div>
        )}

        <div className="flex-1 min-h-0 min-w-0 relative">
          {canvasNode}
        </div>

        {!panelsHidden && isDesktop && rightOpen && (
          <div className="h-full shrink-0 relative z-30">
            {toolsSidebar}
          </div>
        )}

        {!panelsHidden && layoutMode === 'tablet' && leftOpen && (
          <div ref={leftSidebarRef} className="absolute inset-y-0 left-0 z-20 w-72 max-w-[75vw] h-full liquid-glass-heavy border-r border-hairline shadow-2xl">
            <StudioPagesPanel pages={pages} activePageId={activePageId} onSelect={setActivePageId} orientation="vertical" onManagePages={() => setPagesManagerOpen(true)} />
          </div>
        )}
        {!panelsHidden && layoutMode === 'tablet' && rightOpen && (
          <div ref={rightSidebarRef} className="absolute inset-y-0 right-0 z-20 h-full liquid-glass-heavy border-l border-hairline shadow-2xl">
            {toolsSidebar}
          </div>
        )}

        {!panelsHidden && layoutMode === 'phone' && leftOpen && (
          <div ref={leftSidebarRef} className="studio-sheet absolute inset-x-0 bottom-0 top-[8vh] z-20 flex flex-col animate-slide-up-sheet rounded-t-2xl overflow-hidden">
            <button
              aria-label="Close panel"
              onClick={() => setLeftOpen(false)}
              className="h-6 shrink-0 flex items-center justify-center liquid-glass-bar !bg-transparent border-x border-t border-hairline rounded-t-2xl"
            >
              <span className="w-10 h-1 rounded-full bg-ink/20" />
            </button>
            <div className="flex-1 min-h-0">{pagesTabHorizontal}</div>
          </div>
        )}
        {!panelsHidden && layoutMode === 'phone' && rightOpen && (
          <div ref={rightSidebarRef} className="studio-sheet absolute inset-x-0 bottom-0 top-[8vh] z-20 flex flex-col animate-slide-up-sheet rounded-t-2xl overflow-hidden">
            <button
              aria-label="Close panel"
              onClick={() => setRightOpen(false)}
              className="h-6 shrink-0 flex items-center justify-center liquid-glass-bar !bg-transparent border-x border-t border-hairline rounded-t-2xl"
            >
              <span className="w-10 h-1 rounded-full bg-ink/20" />
            </button>
            <div className="flex-1 min-h-0 flex flex-col-reverse">
              {toolRailVisible && <ToolRail activeTool={activeTool} onToolChange={setActiveTool} orientation="horizontal" />}
              <div className="flex-1 min-h-0 flex flex-col border-x border-hairline">
                <PanelStack panels={panelStackEntries} />
              </div>
            </div>
          </div>
        )}
      </div>

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        fileBaseName={`${chapterName}${activePage ? `_${activePage.original.filename.replace(/\.[^.]+$/, '')}` : ''}`.replace(/\s+/g, '_')}
        getSnapshot={() => canvasRef.current?.getExportSnapshot() ?? null}
        exportPsd={exportPsd}
      />
      <PagesManagePanel
        open={pagesManagerOpen}
        onClose={() => setPagesManagerOpen(false)}
        chapterName={chapterName}
        pages={pages}
        onChange={(newPages) => onPagesChange?.(newPages)}
        onCreateWhitedPatchLayer={handleCreateWhitedPatchLayer}
      />
      {typerFloating && (
        <TyperFloatingWindow
          pos={typerFloatPos ?? { x: window.innerWidth - 340, y: 96 }}
          onPosChange={setTyperFloatPos}
          onDock={() => setTyperFloating(false)}
          typerProps={typerPanelProps}
        />
      )}
      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title="About MangaStudio" size="sm">
        <div className="flex flex-col gap-2 text-ui text-ink">
          <p>MangaStudio — manga/manhwa cleaning, translation, and typesetting.</p>
          <p className="text-micro text-ink-faint">A browser-based Studio for cleaning scans, laying out dialogue, and exporting finished pages.</p>
        </div>
      </Modal>
    </div>
  );
}
