import { useEffect, useMemo } from 'react';
import { buildToolShortcutMap } from './shortcutsMap';

interface UseStudioShortcutsArgs {
  onToolChange: (id: string) => void;
  onBrushSizeStep: (delta: number) => void;
  onSwapColors: () => void;
  onResetColors: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleCleaned: () => void;
  onToggleFullscreen: () => void;
  onTogglePanelsHidden: () => void;
  onExport: () => void;
  onGroupLayers: () => void;
  onUngroupLayers: () => void;
  onToggleQuickMask: () => void;
  /** TypeR-style size-increment-with-recenter for the active text layer. delta is +1/-1. */
  onTextSizeStep: (delta: number) => void;
  onDeselect: () => void;
  onActualSize: () => void;
  onCutLayer: () => void;
  onCopyLayer: () => void;
  onPasteLayer: () => void;
  onFindReplace: () => void;
  /** Toggles the active text layer/selection's bold weight — fires even while the dialogue textarea
   *  itself has focus (see isStudioTextEditor below), unlike every other shortcut in this hook. */
  onToggleTextBold: () => void;
  onToggleTextItalic: () => void;
  onToggleRulers: () => void;
  onToggleGrid: () => void;
  onNewLayer: () => void;
  onMergeVisible: () => void;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

/** The one textarea Ctrl/Cmd+B / +I should reach through `isTextInputFocused`'s blanket guard for —
 *  see the `data-studio-text-editor` attribute on StudioCanvas.tsx's text-editing overlay. */
function isStudioTextEditor(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && el.tagName === 'TEXTAREA' && el.dataset.studioTextEditor === 'true';
}

export function useStudioShortcuts({
  onToolChange, onBrushSizeStep, onSwapColors, onResetColors, onZoomIn, onZoomOut, onFit,
  onToggleCleaned, onToggleFullscreen, onTogglePanelsHidden, onExport, onGroupLayers, onUngroupLayers,
  onToggleQuickMask, onTextSizeStep, onDeselect, onActualSize, onCutLayer, onCopyLayer, onPasteLayer,
  onFindReplace, onToggleTextBold, onToggleTextItalic, onToggleRulers, onToggleGrid, onNewLayer,
  onMergeVisible,
}: UseStudioShortcutsArgs) {
  const toolMap = useMemo(() => buildToolShortcutMap(), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Checked ahead of the blanket text-input guard below: Bold/Italic need to fire while the
      // dialogue textarea itself has focus, since that's exactly when they're used. Scoped to that
      // one textarea (not inputs/contentEditable in general) and to the plain mod combo, so it can't
      // collide with a Ctrl+Shift+ combo meant for something else.
      if (mod && !e.shiftKey && !e.altKey && isStudioTextEditor()) {
        if (key === 'b') { e.preventDefault(); onToggleTextBold(); return; }
        if (key === 'i') { e.preventDefault(); onToggleTextItalic(); return; }
      }

      if (isTextInputFocused()) return;

      // Not a literal "F11" binding — browsers intercept F11 at the chrome level before
      // JS reliably sees it, so Ctrl/Cmd+Shift+F is the in-app fullscreen shortcut instead.
      if (mod && e.shiftKey && key === 'f') { e.preventDefault(); onToggleFullscreen(); return; }
      // Checked ahead of plain Ctrl+G below, or the ungroup combo would be swallowed by grouping.
      if (mod && e.shiftKey && key === 'g') { e.preventDefault(); onUngroupLayers(); return; }
      // Both checked ahead of the plain mod block below for the same reason — otherwise Ctrl+Shift+N
      // and Ctrl+Shift+E would fall through into that block's unshifted 'e' (Export) case.
      if (mod && e.shiftKey && key === 'n') { e.preventDefault(); onNewLayer(); return; }
      if (mod && e.shiftKey && key === 'e') { e.preventDefault(); onMergeVisible(); return; }

      if (mod) {
        if (key === 'g') { e.preventDefault(); onGroupLayers(); return; }
        if (key === '=' || key === '+') { e.preventDefault(); onZoomIn(); return; }
        if (key === '-') { e.preventDefault(); onZoomOut(); return; }
        if (key === '0') { e.preventDefault(); onFit(); return; }
        if (key === '1') { e.preventDefault(); onActualSize(); return; }
        if (key === 'e') { e.preventDefault(); onExport(); return; }
        if (key === 'f') { e.preventDefault(); onFindReplace(); return; }
        if (key === 'x') { e.preventDefault(); onCutLayer(); return; }
        if (key === 'c') { e.preventDefault(); onCopyLayer(); return; }
        if (key === 'v') { e.preventDefault(); onPasteLayer(); return; }
        if (key === 'r') { e.preventDefault(); onToggleRulers(); return; }
        if (key === "'") { e.preventDefault(); onToggleGrid(); return; }
        // "." / "," rather than "]" / "[" — those are already the brush-size-step keys.
        if (key === '.') { e.preventDefault(); onTextSizeStep(1); return; }
        if (key === ',') { e.preventDefault(); onTextSizeStep(-1); return; }
        if (key === 'd') { e.preventDefault(); onDeselect(); return; }
        return; // other mod combos (undo/redo) are handled by useKeyboardUndo
      }

      if (e.key === 'Tab') { e.preventDefault(); onTogglePanelsHidden(); return; }

      if (key === '[') { onBrushSizeStep(-2); return; }
      if (key === ']') { onBrushSizeStep(2); return; }
      if (key === 'x') { onSwapColors(); return; }
      if (key === 'd') { onResetColors(); return; }
      if (key === 'o') { onToggleCleaned(); return; }
      if (key === 'q') { onToggleQuickMask(); return; }

      const toolId = toolMap[key];
      if (toolId) { e.preventDefault(); onToolChange(toolId); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    toolMap, onToolChange, onBrushSizeStep, onSwapColors, onResetColors, onZoomIn, onZoomOut, onFit,
    onToggleCleaned, onToggleFullscreen, onTogglePanelsHidden, onExport, onGroupLayers, onUngroupLayers,
    onToggleQuickMask, onTextSizeStep, onDeselect, onActualSize, onCutLayer, onCopyLayer, onPasteLayer,
    onFindReplace, onToggleTextBold, onToggleTextItalic, onToggleRulers, onToggleGrid, onNewLayer,
    onMergeVisible,
  ]);
}
