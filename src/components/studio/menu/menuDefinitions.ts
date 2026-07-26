export interface MenuItemDef {
  id: string;
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  /** When set (true or false), renders a checkmark reflecting this item's on/off state. */
  checked?: boolean;
}

export interface MenuDef {
  id: string;
  label: string;
  items: MenuItemDef[];
}

export interface MenuActions {
  onBack: () => void;
  onExport: () => void;
  onExportSlices: () => void;
  hasSliceRects: boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  toggleCleaned: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
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
  addTextLayer: () => void;
  centerTextInBubble: () => void;
  increaseTextSize: () => void;
  decreaseTextSize: () => void;
  hasActiveTextLayer: boolean;
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

export function buildMenus(a: MenuActions): MenuDef[] {
  return [
    {
      id: 'project',
      label: 'Project',
      items: [
        { id: 'export', label: 'Export…', shortcut: 'Ctrl+E', action: a.onExport },
        { id: 'export-slices', label: 'Export Slices…', action: a.onExportSlices, disabled: !a.hasSliceRects },
        { id: 'sep1', label: '', separator: true },
        { id: 'back', label: 'Back to Pages', action: a.onBack },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', action: a.undo, disabled: !a.canUndo },
        { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: a.redo, disabled: !a.canRedo },
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
        { id: 'toggle-cleaned', label: 'Toggle Original / Cleaned', action: a.toggleCleaned },
        { id: 'sep1', label: '', separator: true },
        { id: 'zoom-in', label: 'Zoom In', shortcut: 'Ctrl+=', action: a.zoomIn },
        { id: 'zoom-out', label: 'Zoom Out', shortcut: 'Ctrl+-', action: a.zoomOut },
        { id: 'fit', label: 'Fit to Screen', shortcut: 'Ctrl+0', action: a.fit },
        { id: 'sep2', label: '', separator: true },
        { id: 'grid', label: 'Grid', action: a.toggleGrid, checked: a.showGrid },
        { id: 'rulers', label: 'Rulers', action: a.toggleRulers, checked: a.showRulers },
        { id: 'sep3', label: '', separator: true },
        { id: 'toggle-dock', label: 'Toggle Panels', action: a.toggleDock },
        { id: 'fullscreen', label: 'Fullscreen', shortcut: 'Ctrl+Shift+F', action: a.toggleFullscreen, checked: a.isFullscreen },
      ],
    },
    {
      id: 'layer',
      label: 'Layer',
      items: [
        { id: 'add-layer', label: 'New Layer', action: a.addLayer },
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
        { id: 'stroke-path', label: 'Stroke Path', action: a.strokeActivePath, disabled: !a.canBakePath },
        { id: 'fill-path', label: 'Fill Path', action: a.fillActivePath, disabled: !a.canBakePath },
        { id: 'sep3', label: '', separator: true },
        { id: 'move-up', label: 'Bring Forward', action: a.moveLayerUp, disabled: !a.hasActiveLayer },
        { id: 'move-down', label: 'Send Backward', action: a.moveLayerDown, disabled: !a.hasActiveLayer },
      ],
    },
    {
      id: 'text',
      label: 'Text',
      items: [
        { id: 'add-text', label: 'New Text Layer', action: a.addTextLayer },
        { id: 'center-bubble', label: 'Center in Bubble', action: a.centerTextInBubble, disabled: !a.hasActiveTextLayer },
        { id: 'increase-text-size', label: 'Increase Size', shortcut: 'Ctrl+.', action: a.increaseTextSize, disabled: !a.hasActiveTextLayer },
        { id: 'decrease-text-size', label: 'Decrease Size', shortcut: 'Ctrl+,', action: a.decreaseTextSize, disabled: !a.hasActiveTextLayer },
      ],
    },
    {
      id: 'window',
      label: 'Window',
      items: [
        { id: 'toggle-dock', label: 'Toggle Panels', action: a.toggleDock },
        { id: 'hide-panels', label: 'Hide All Panels', shortcut: 'Tab', action: a.togglePanelsHidden, checked: a.panelsHidden },
        { id: 'fullscreen', label: 'Fullscreen', shortcut: 'Ctrl+Shift+F', action: a.toggleFullscreen, checked: a.isFullscreen },
        { id: 'sep1', label: '', separator: true },
        ...a.panelTabs.map(t => ({
          id: `show-${t.id}`, label: `Show ${t.label}`, action: () => a.showPanel(t.id), checked: a.isPanelVisible(t.id),
        })),
        { id: 'sep2', label: '', separator: true },
        { id: 'typer-floating', label: 'Float TypeR', action: a.toggleTyperFloating, checked: a.typerFloating },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { id: 'shortcuts', label: 'Keyboard Shortcuts', action: a.showShortcutsHelp },
      ],
    },
  ];
}
