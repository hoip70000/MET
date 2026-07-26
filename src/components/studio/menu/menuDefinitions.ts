import type { AdjustmentKind, TextAlign } from '../studioTypes';
import { ADJUSTMENT_KIND_LABEL } from '../studioTypes';

export interface MenuItemDef {
  id: string;
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  /** When set (true or false), renders a checkmark reflecting this item's on/off state. */
  checked?: boolean;
  /** Nested items, shown with a ► and opened on hover/tap — see menu/Menu.tsx's recursive render. */
  submenu?: MenuItemDef[];
}

export interface MenuDef {
  id: string;
  label: string;
  items: MenuItemDef[];
}

const FONT_SIZES = [8, 10, 12, 14, 18, 24, 36, 48, 72];

export interface MenuActions {
  onBack: () => void;
  onExport: () => void;
  onExportSlices: () => void;
  hasSliceRects: boolean;
  /** Real: threaded from App.tsx down to the existing workspace-level .msp export. */
  exportMsp: () => void;
  /** Real: flushes the debounced studio-project autosave immediately. */
  saveProjectNow: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  cutLayer: () => void;
  copyLayer: () => void;
  pasteLayer: () => void;
  canCopy: boolean;
  canPaste: boolean;
  /** Opens the Translation panel, which already has its own cross-page search/replace. */
  openFindReplace: () => void;
  toggleCleaned: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actualSize: () => void;
  toggleDock: () => void;
  addLayer: () => void;
  addBlankLayer: () => void;
  duplicateLayer: () => void;
  deleteLayer: () => void;
  moveLayerUp: () => void;
  moveLayerDown: () => void;
  hasActiveLayer: boolean;
  groupLayers: () => void;
  ungroupLayers: () => void;
  /** Gates Ungroup — it's only meaningful when the primary selection is a group. */
  isGroupActive: boolean;
  toggleClipped: () => void;
  /** False when the layer below can't be a clip base — only raster layers can, see `canBeClipBase`. */
  canClip: boolean;
  strokeActivePath: () => void;
  fillActivePath: () => void;
  /** Stroke/Fill Path need both an active path layer (the geometry) and an active raster layer
   *  (the bake target) — disabled, not silently no-op, when either is missing. */
  canBakePath: boolean;
  isClipped: boolean;
  toggleMask: () => void;
  /** False for adjustment layers — they have no paintable content to trim to a mask. Any other
   *  non-background type (groups included) is fair game. */
  canMask: boolean;
  hasMask: boolean;
  /** Layer > Merge Down/Merge Visible/Flatten Image — all real, reusing the export flatten pipeline
   *  against a temporarily-adjusted visibility mask (see Studio.tsx's handleFlattenImage etc.). */
  mergeDown: () => void;
  canMergeDown: boolean;
  mergeVisible: () => void;
  flattenImage: () => void;
  /** Layer Properties.../Blending Options... both open the same per-layer settings-expand row
   *  (opacity/blend/mask/clip) the Layers panel already has — there's no separate dialog for either
   *  concept in this app, so both menu items point at the one real place those controls live. */
  layerProperties: () => void;
  addTextLayer: () => void;
  centerTextInBubble: () => void;
  increaseTextSize: () => void;
  decreaseTextSize: () => void;
  hasActiveTextLayer: boolean;
  /** Text menu's Font/Size/Bold/Italic/Align/RTL/LTR — real, via textRuns.ts's applyCharPatch
   *  (Bold/Italic/Size) or a direct layer-level align patch (Align/RTL/LTR — paragraph properties,
   *  never per-run). No-ops (and the items disable) without an active text layer. */
  textSetBold: () => void;
  textSetItalic: () => void;
  textSetFontSize: (size: number) => void;
  textSetAlign: (align: TextAlign) => void;
  textSetRtl: () => void;
  textSetLtr: () => void;
  openFontPanel: () => void;
  /** Image > Adjustments ► — creates an adjustment layer of the given kind, reusing the same
   *  `createAdjustmentLayer` factory the Layers panel's own "Add Adjustment Layer" button uses. */
  addAdjustmentLayerKind: (kind: AdjustmentKind) => void;
  /** Image > Apply Filter ► — disabled in this pass (no filter engine exists yet); Task 3 flips
   *  `filtersEnabled` and wires `applyFilter` to real dialogs. Never silently broken in between. */
  filtersEnabled: boolean;
  applyFilter: (kind: string) => void;
  liquifyTool: () => void;
  /** AI > Content-Aware Fill — switches to the existing real `contentAware` paint tool; no dialog. */
  contentAwareFillTool: () => void;
  rotateCanvas: (dir: 'cw' | 'ccw' | '180' | 'flip-h' | 'flip-v') => void;
  toolRailVisible: boolean;
  toggleToolRail: () => void;
  optionsBarVisible: boolean;
  toggleOptionsBar: () => void;
  /** Window > Arrange > Reset Layout — disabled until Task 2 builds the panel order/collapse state
   *  there is to reset. */
  resetLayoutEnabled: boolean;
  resetPanelLayout: () => void;
  aboutOpen: () => void;
  triggerImportFonts: () => void;
  triggerImportBrushes: () => void;
  panelTabs: { id: string; label: string }[];
  showPanel: (id: string) => void;
  isPanelVisible: (id: string) => boolean;
  showShortcutsHelp: () => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  panelsHidden: boolean;
  togglePanelsHidden: () => void;
  showGrid: boolean;
  toggleGrid: () => void;
  showRulers: boolean;
  toggleRulers: () => void;
  hasSelection: boolean;
  deselect: () => void;
  featherSelection: () => void;
  expandSelection: () => void;
  contractSelection: () => void;
  transformSelection: () => void;
  makeSelectionFromPath: () => void;
  hasActivePathLayer: boolean;
  quickMaskActive: boolean;
  toggleQuickMask: () => void;
  /** Separate from panelTabs/showPanel/isPanelVisible above — those are the swappable dock strip's
   *  own tab-visibility concept; this is "is TypeR windowed at all," an orthogonal concept. */
  typerFloating: boolean;
  toggleTyperFloating: () => void;
}

const APPLY_FILTER_SUBMENU = (a: MenuActions): MenuItemDef[] => {
  const item = (id: string, label: string, real: boolean): MenuItemDef => ({
    id,
    label,
    disabled: !a.filtersEnabled || !real,
    action: real ? () => a.applyFilter(id) : undefined,
  });
  return [
    {
      id: 'filter-blur', label: 'Blur', submenu: [
        item('gaussian-blur', 'Gaussian Blur…', true),
        item('motion-blur', 'Motion Blur…', true),
        item('box-blur', 'Box Blur…', true),
      ],
    },
    {
      id: 'filter-sharpen', label: 'Sharpen', submenu: [
        item('unsharp-mask', 'Unsharp Mask…', true),
        item('smart-sharpen', 'Smart Sharpen…', false),
      ],
    },
    {
      id: 'filter-noise', label: 'Noise', submenu: [
        item('add-noise', 'Add Noise…', true),
        item('reduce-noise', 'Reduce Noise…', false),
      ],
    },
    {
      id: 'filter-distort', label: 'Distort', submenu: [
        // Liquify opens the existing real brush-driven tool, not a dialog — see contentAwareFillTool's
        // sibling `liquifyTool` above.
        { id: 'liquify', label: 'Liquify…', action: a.liquifyTool },
      ],
    },
    {
      id: 'filter-pixelate', label: 'Pixelate', submenu: [
        item('mosaic', 'Mosaic…', true),
        item('color-halftone', 'Color Halftone…', false),
      ],
    },
    {
      id: 'filter-stylize', label: 'Stylize', submenu: [
        item('find-edges', 'Find Edges', true),
        item('emboss', 'Emboss…', true),
        item('glowing-edges', 'Glowing Edges…', false),
      ],
    },
  ];
};

export function buildMenus(a: MenuActions): MenuDef[] {
  return [
    {
      id: 'project',
      label: 'Project',
      items: [
        { id: 'new-project', label: 'New Project', disabled: true },
        { id: 'open-project', label: 'Open Project…', disabled: true },
        { id: 'open-recent', label: 'Open Recent', disabled: true, submenu: [] },
        { id: 'sep1', label: '', separator: true },
        { id: 'save-project', label: 'Save Project', shortcut: 'Ctrl+S', action: a.saveProjectNow },
        { id: 'save-as', label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: true },
        { id: 'export-msp', label: 'Export as .msp', action: a.exportMsp },
        { id: 'sep2', label: '', separator: true },
        {
          id: 'import', label: 'Import', submenu: [
            { id: 'import-original', label: 'Original Pages…', disabled: true },
            { id: 'import-cleaned', label: 'Cleaned Pages…', disabled: true },
            { id: 'import-translation', label: 'Translation File…', disabled: true },
            { id: 'import-fonts', label: 'Fonts…', action: a.triggerImportFonts },
            { id: 'import-brushes', label: 'Brushes…', action: a.triggerImportBrushes },
          ],
        },
        { id: 'sep3', label: '', separator: true },
        { id: 'export', label: 'Export Page…', shortcut: 'Ctrl+E', action: a.onExport },
        { id: 'export-slices', label: 'Export Slices…', action: a.onExportSlices, disabled: !a.hasSliceRects },
        { id: 'sep4', label: '', separator: true },
        { id: 'close', label: 'Close Project', action: a.onBack },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', action: a.undo, disabled: !a.canUndo },
        { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: a.redo, disabled: !a.canRedo },
        { id: 'sep1', label: '', separator: true },
        { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', action: a.cutLayer, disabled: !a.canCopy },
        { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', action: a.copyLayer, disabled: !a.canCopy },
        { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', action: a.pasteLayer, disabled: !a.canPaste },
        { id: 'sep2', label: '', separator: true },
        { id: 'find-replace', label: 'Find & Replace…', shortcut: 'Ctrl+F', action: a.openFindReplace },
        { id: 'sep3', label: '', separator: true },
        { id: 'preferences', label: 'Preferences…', disabled: true },
      ],
    },
    {
      id: 'select',
      label: 'Select',
      items: [
        { id: 'deselect', label: 'Deselect', shortcut: 'Ctrl+D', action: a.deselect, disabled: !a.hasSelection },
        { id: 'sep1', label: '', separator: true },
        { id: 'feather', label: 'Feather…', action: a.featherSelection, disabled: !a.hasSelection },
        { id: 'expand', label: 'Expand…', action: a.expandSelection, disabled: !a.hasSelection },
        { id: 'contract', label: 'Contract…', action: a.contractSelection, disabled: !a.hasSelection },
        { id: 'transform', label: 'Transform Selection', action: a.transformSelection, disabled: !a.hasSelection },
        { id: 'make-selection', label: 'Make Selection from Path', action: a.makeSelectionFromPath, disabled: !a.hasActivePathLayer },
        { id: 'sep2', label: '', separator: true },
        { id: 'quick-mask', label: 'Quick Mask', shortcut: 'Q', action: a.toggleQuickMask, checked: a.quickMaskActive },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { id: 'toggle-cleaned', label: 'Toggle Original / Cleaned', shortcut: 'O', action: a.toggleCleaned },
        { id: 'sep1', label: '', separator: true },
        { id: 'zoom-in', label: 'Zoom In', shortcut: 'Ctrl+=', action: a.zoomIn },
        { id: 'zoom-out', label: 'Zoom Out', shortcut: 'Ctrl+-', action: a.zoomOut },
        { id: 'fit', label: 'Fit Page', shortcut: 'Ctrl+0', action: a.fit },
        { id: 'actual-size', label: 'Actual Size', shortcut: 'Ctrl+1', action: a.actualSize },
        { id: 'sep2', label: '', separator: true },
        { id: 'rulers', label: 'Rulers', shortcut: 'Ctrl+R', action: a.toggleRulers, checked: a.showRulers },
        { id: 'grid', label: 'Grid', shortcut: "Ctrl+'", action: a.toggleGrid, checked: a.showGrid },
        { id: 'guides', label: 'Guides', disabled: true, checked: false },
        { id: 'safe-area', label: 'Safe Area', disabled: true, checked: false },
        { id: 'sep3', label: '', separator: true },
        { id: 'snap-grid', label: 'Snap to Grid', disabled: true, checked: false },
        { id: 'snap-guides', label: 'Snap to Guides', disabled: true, checked: false },
        { id: 'sep4', label: '', separator: true },
        { id: 'toggle-dock', label: 'Toggle Panels', action: a.toggleDock },
        { id: 'fullscreen', label: 'Fullscreen', shortcut: 'Ctrl+Shift+F', action: a.toggleFullscreen, checked: a.isFullscreen },
      ],
    },
    {
      id: 'image',
      label: 'Image',
      items: [
        { id: 'image-size', label: 'Image Size…', disabled: true },
        { id: 'canvas-size', label: 'Canvas Size…', disabled: true },
        { id: 'sep1', label: '', separator: true },
        {
          id: 'rotate-canvas', label: 'Rotate Canvas', submenu: [
            { id: 'rotate-cw', label: '90° CW', action: () => a.rotateCanvas('cw') },
            { id: 'rotate-ccw', label: '90° CCW', action: () => a.rotateCanvas('ccw') },
            { id: 'rotate-180', label: '180°', action: () => a.rotateCanvas('180') },
            { id: 'flip-h', label: 'Flip Horizontal', action: () => a.rotateCanvas('flip-h') },
            { id: 'flip-v', label: 'Flip Vertical', action: () => a.rotateCanvas('flip-v') },
          ],
        },
        { id: 'sep2', label: '', separator: true },
        {
          id: 'adjustments', label: 'Adjustments', submenu: (Object.keys(ADJUSTMENT_KIND_LABEL) as AdjustmentKind[]).map(kind => ({
            id: `adj-${kind}`,
            label: `${ADJUSTMENT_KIND_LABEL[kind]}…`,
            action: () => a.addAdjustmentLayerKind(kind),
          })),
        },
        { id: 'sep3', label: '', separator: true },
        { id: 'apply-filter', label: 'Apply Filter', submenu: APPLY_FILTER_SUBMENU(a) },
      ],
    },
    {
      id: 'layer',
      label: 'Layer',
      items: [
        { id: 'add-layer', label: 'New Layer', shortcut: 'Ctrl+Shift+N', action: a.addLayer },
        { id: 'add-blank-layer', label: 'New Blank Layer', action: a.addBlankLayer },
        { id: 'duplicate-layer', label: 'Duplicate Layer', action: a.duplicateLayer, disabled: !a.hasActiveLayer },
        { id: 'delete-layer', label: 'Delete Layer', action: a.deleteLayer, disabled: !a.hasActiveLayer },
        { id: 'sep1', label: '', separator: true },
        { id: 'group-layers', label: 'Group Layers', shortcut: 'Ctrl+G', action: a.groupLayers, disabled: !a.hasActiveLayer },
        { id: 'ungroup-layers', label: 'Ungroup Layers', shortcut: 'Ctrl+Shift+G', action: a.ungroupLayers, disabled: !a.isGroupActive },
        {
          id: 'layer-mask',
          label: a.hasMask ? 'Delete Layer Mask' : 'Add Layer Mask',
          action: a.toggleMask,
          disabled: !a.canMask && !a.hasMask,
        },
        {
          id: 'clip-layer',
          label: a.isClipped ? 'Release Clipping Mask' : 'Create Clipping Mask',
          action: a.toggleClipped,
          disabled: !a.canClip && !a.isClipped,
        },
        { id: 'sep2', label: '', separator: true },
        { id: 'merge-down', label: 'Merge Down', action: a.mergeDown, disabled: !a.canMergeDown },
        { id: 'merge-visible', label: 'Merge Visible', shortcut: 'Ctrl+Shift+E', action: a.mergeVisible },
        { id: 'flatten-image', label: 'Flatten Image', action: a.flattenImage },
        { id: 'sep3', label: '', separator: true },
        { id: 'layer-properties', label: 'Layer Properties…', action: a.layerProperties, disabled: !a.hasActiveLayer },
        { id: 'blending-options', label: 'Blending Options…', action: a.layerProperties, disabled: !a.hasActiveLayer },
        { id: 'sep4', label: '', separator: true },
        { id: 'lock-transparent', label: 'Lock Transparent Pixels', disabled: true, checked: false },
        { id: 'lock-image', label: 'Lock Image Pixels', disabled: true, checked: false },
        { id: 'lock-position', label: 'Lock Position', disabled: true, checked: false },
        { id: 'sep5', label: '', separator: true },
        { id: 'stroke-path', label: 'Stroke Path', action: a.strokeActivePath, disabled: !a.canBakePath },
        { id: 'fill-path', label: 'Fill Path', action: a.fillActivePath, disabled: !a.canBakePath },
        { id: 'sep6', label: '', separator: true },
        { id: 'move-up', label: 'Bring Forward', action: a.moveLayerUp, disabled: !a.hasActiveLayer },
        { id: 'move-down', label: 'Send Backward', action: a.moveLayerDown, disabled: !a.hasActiveLayer },
      ],
    },
    {
      id: 'text',
      label: 'Text',
      items: [
        { id: 'add-text', label: 'Add Text Layer', shortcut: 'T', action: a.addTextLayer },
        { id: 'sep1', label: '', separator: true },
        { id: 'font', label: 'Font…', action: a.openFontPanel, disabled: !a.hasActiveTextLayer },
        {
          id: 'size', label: 'Size', disabled: !a.hasActiveTextLayer,
          submenu: FONT_SIZES.map(size => ({ id: `size-${size}`, label: `${size}`, action: () => a.textSetFontSize(size) })),
        },
        { id: 'sep2', label: '', separator: true },
        { id: 'bold', label: 'Bold', shortcut: 'Ctrl+B', action: a.textSetBold, disabled: !a.hasActiveTextLayer },
        { id: 'italic', label: 'Italic', shortcut: 'Ctrl+I', action: a.textSetItalic, disabled: !a.hasActiveTextLayer },
        { id: 'underline', label: 'Underline', shortcut: 'Ctrl+U', disabled: true },
        { id: 'sep3', label: '', separator: true },
        { id: 'align-left', label: 'Align Left', action: () => a.textSetAlign('left'), disabled: !a.hasActiveTextLayer },
        { id: 'align-center', label: 'Align Center', action: () => a.textSetAlign('center'), disabled: !a.hasActiveTextLayer },
        { id: 'align-right', label: 'Align Right', action: () => a.textSetAlign('right'), disabled: !a.hasActiveTextLayer },
        { id: 'align-justify', label: 'Justify', action: () => a.textSetAlign('justify'), disabled: !a.hasActiveTextLayer },
        { id: 'sep4', label: '', separator: true },
        { id: 'rtl', label: 'RTL', action: a.textSetRtl, disabled: !a.hasActiveTextLayer },
        { id: 'ltr', label: 'LTR', action: a.textSetLtr, disabled: !a.hasActiveTextLayer },
        { id: 'sep5', label: '', separator: true },
        { id: 'center-bubble', label: 'Center in Bubble', action: a.centerTextInBubble, disabled: !a.hasActiveTextLayer },
        { id: 'increase-text-size', label: 'Increase Size', shortcut: 'Ctrl+.', action: a.increaseTextSize, disabled: !a.hasActiveTextLayer },
        { id: 'decrease-text-size', label: 'Decrease Size', shortcut: 'Ctrl+,', action: a.decreaseTextSize, disabled: !a.hasActiveTextLayer },
      ],
    },
    {
      id: 'ai',
      label: 'AI',
      items: [
        { id: 'auto-detect-bubbles', label: 'Auto-Detect Bubbles', disabled: true },
        { id: 'auto-clean-page', label: 'Auto-Clean Page', disabled: true },
        { id: 'content-aware-fill', label: 'Content-Aware Fill', action: a.contentAwareFillTool },
        { id: 'sep1', label: '', separator: true },
        { id: 'ai-queue', label: 'AI Queue…', disabled: true },
      ],
    },
    {
      id: 'window',
      label: 'Window',
      items: [
        { id: 'tool-rail', label: 'Tool Rail', action: a.toggleToolRail, checked: a.toolRailVisible },
        { id: 'options-bar', label: 'Options Bar', action: a.toggleOptionsBar, checked: a.optionsBarVisible },
        ...a.panelTabs.map(t => ({
          id: `show-${t.id}`, label: `${t.label} Panel`, action: () => a.showPanel(t.id), checked: a.isPanelVisible(t.id),
        })),
        { id: 'minimap', label: 'Minimap', disabled: true, checked: false },
        { id: 'status-bar', label: 'Status Bar', disabled: true, checked: false },
        { id: 'sep1', label: '', separator: true },
        {
          id: 'arrange', label: 'Arrange', submenu: [
            { id: 'reset-layout', label: 'Reset Layout', action: a.resetPanelLayout, disabled: !a.resetLayoutEnabled },
            { id: 'save-layout', label: 'Save Layout…', disabled: true },
            { id: 'load-layout', label: 'Load Layout…', disabled: true },
          ],
        },
        { id: 'sep2', label: '', separator: true },
        { id: 'hide-panels', label: 'Hide All Panels', shortcut: 'Tab', action: a.togglePanelsHidden, checked: a.panelsHidden },
        { id: 'fullscreen', label: 'Full Screen', shortcut: 'Ctrl+Shift+F', action: a.toggleFullscreen, checked: a.isFullscreen },
        { id: 'sep3', label: '', separator: true },
        { id: 'typer-floating', label: 'Float TypeR', action: a.toggleTyperFloating, checked: a.typerFloating },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { id: 'documentation', label: 'Documentation', disabled: true },
        { id: 'shortcuts', label: 'Keyboard Shortcuts…', action: a.showShortcutsHelp },
        { id: 'sep1', label: '', separator: true },
        { id: 'about', label: 'About MangaStudio', action: a.aboutOpen },
      ],
    },
  ];
}
