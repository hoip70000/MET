import { useEffect } from 'react';

interface UseTextEditorShortcutsArgs {
  onBold: () => void;
  onItalic: () => void;
  onUnderline: () => void;
  onStrikethrough: () => void;
  onSave: () => void;
  onNewDoc: () => void;
  onFind: () => void;
  onFindReplace: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAlignLeft: () => void;
  onAlignCenter: () => void;
  onAlignRight: () => void;
  onAlignJustify: () => void;
  onHeading1: () => void;
  onHeading2: () => void;
  onHeading3: () => void;
  onHeading4: () => void;
  onNormal: () => void;
  onSendToTyper: () => void;
  onCloseFind: () => void;
}

/** A page div (`.te-page`) *is* the text field this editor is built around, so — unlike Studio's
 *  `useStudioShortcuts`, which suppresses itself while any text input has focus — these shortcuts
 *  must fire *while* a page has focus. Only the Find/Replace bar's own `<input>`s suppress them
 *  (Escape excepted, which always closes that panel). */
function isPageFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.classList.contains('te-page');
}

function isFindInputFocused(): boolean {
  return document.activeElement instanceof HTMLInputElement;
}

export function useTextEditorShortcuts({
  onBold, onItalic, onUnderline, onStrikethrough, onSave, onNewDoc, onFind, onFindReplace,
  onUndo, onRedo, onAlignLeft, onAlignCenter, onAlignRight, onAlignJustify,
  onHeading1, onHeading2, onHeading3, onHeading4, onNormal, onSendToTyper, onCloseFind,
}: UseTextEditorShortcutsArgs) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onCloseFind(); return; }

      if (isFindInputFocused()) return;
      if (!isPageFocused()) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && e.altKey) {
        if (key === '1') { e.preventDefault(); onHeading1(); return; }
        if (key === '2') { e.preventDefault(); onHeading2(); return; }
        if (key === '3') { e.preventDefault(); onHeading3(); return; }
        if (key === '4') { e.preventDefault(); onHeading4(); return; }
        return;
      }

      if (mod && e.shiftKey) {
        if (key === 'x') { e.preventDefault(); onStrikethrough(); return; }
        if (key === 'l') { e.preventDefault(); onAlignLeft(); return; }
        if (key === 'e') { e.preventDefault(); onAlignCenter(); return; }
        if (key === 'r') { e.preventDefault(); onAlignRight(); return; }
        if (key === 'j') { e.preventDefault(); onAlignJustify(); return; }
        if (key === 'z') { e.preventDefault(); onRedo(); return; }
        return;
      }

      if (mod) {
        if (key === 'b') { e.preventDefault(); onBold(); return; }
        if (key === 'i') { e.preventDefault(); onItalic(); return; }
        if (key === 'u') { e.preventDefault(); onUnderline(); return; }
        if (key === 's') { e.preventDefault(); onSave(); return; }
        if (key === 'n') { e.preventDefault(); onNewDoc(); return; }
        // Ctrl+Enter (hard page break) is deliberately not handled here — each page's own
        // onKeyDown (TextEditorPage.tsx's handlePageKeyDown) already owns it directly, since it
        // needs the specific page index; handling it again at this window level too would fire
        // insertHardBreak() twice per keypress (this listener runs after the page's own, since the
        // event still bubbles up to window even though the page handler already preventDefault()s).
        if (key === 'f') { e.preventDefault(); onFind(); return; }
        if (key === 'h') { e.preventDefault(); onFindReplace(); return; }
        if (key === 'z') { e.preventDefault(); onUndo(); return; }
        if (key === 'y') { e.preventDefault(); onRedo(); return; }
        if (key === '0') { e.preventDefault(); onNormal(); return; }
        return;
      }

      if (e.altKey && e.shiftKey && key === 's') { e.preventDefault(); onSendToTyper(); return; }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    onBold, onItalic, onUnderline, onStrikethrough, onSave, onNewDoc, onFind, onFindReplace,
    onUndo, onRedo, onAlignLeft, onAlignCenter, onAlignRight, onAlignJustify,
    onHeading1, onHeading2, onHeading3, onHeading4, onNormal, onSendToTyper, onCloseFind,
  ]);
}
