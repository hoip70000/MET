import { useCallback, useEffect, useRef, useState } from 'react';
import { Scissors, Copy, ClipboardPaste, TextSelect, Check, X } from 'lucide-react';

type EditableEl = HTMLInputElement | HTMLTextAreaElement;

function isFormField(el: EventTarget | null): el is EditableEl {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function closestContentEditable(el: EventTarget | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  return el.closest('[contenteditable="true"], [contenteditable=""]');
}

interface PendingMenu {
  x: number;
  y: number;
  target: HTMLElement;
  editableHost: HTMLElement | null;
  selectedText: string;
  savedRange: Range | null;
  /** Set when the right-clicked target is a spell-check flag (the Text Editor's `.spell-miss`
   *  spans) — renders a "Change to / Ignore" body instead of Cut/Copy/Paste for that one case. */
  spellFix?: string | null;
}

/**
 * Replaces the OS's native right-click menu with a themed one, but only where
 * the native menu would itself just be offering Cut/Copy/Paste (a text
 * selection, or focus inside an editable field) — everywhere else (canvas,
 * images, devtools-worthy areas) the native menu is left alone. Studio's own
 * onContextMenu handlers (BrushesPanel, ColorPanel, ToolGroupButton) already
 * call preventDefault() themselves, so `defaultPrevented` lets this skip
 * those without needing to know about them.
 */
export function AppContextMenu() {
  const [menu, setMenu] = useState<PendingMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target.classList.contains('spell-miss')) {
        e.preventDefault();
        setMenu({
          x: e.clientX, y: e.clientY, target, editableHost: closestContentEditable(target),
          selectedText: '', savedRange: null, spellFix: target.dataset.fix ?? null,
        });
        return;
      }

      const editableHost = isFormField(target) ? target : closestContentEditable(target);
      let selectedText = '';
      let savedRange: Range | null = null;

      if (isFormField(target)) {
        const { selectionStart, selectionEnd, value } = target;
        selectedText = selectionStart != null && selectionEnd != null ? value.slice(selectionStart, selectionEnd) : '';
      } else {
        const sel = window.getSelection();
        selectedText = sel?.toString() ?? '';
        if (sel && sel.rangeCount > 0 && selectedText) savedRange = sel.getRangeAt(0).cloneRange();
      }

      const canCopy = selectedText.length > 0;
      const canPaste = !!editableHost;
      if (!canCopy && !canPaste) return; // nothing we'd add over the native menu

      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, target, editableHost, selectedText, savedRange });
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const handleDismiss = () => close();
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [menu, close]);

  if (!menu) return null;

  const { target, editableHost, selectedText, savedRange, spellFix } = menu;
  const isField = isFormField(target);

  // Dispatched rather than called directly: this component is a global singleton with no
  // knowledge of which feature's text it's editing, so it notifies whoever owns `target` (the
  // Text Editor's own autosave) via a bubbling custom event instead of importing that feature's
  // internals here.
  const notifyTextChanged = () => target.dispatchEvent(new CustomEvent('te-spell-fix', { bubbles: true }));

  if (spellFix !== undefined) {
    const itemClass = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-accent/15 hover:text-accent transition-colors';
    const menuWidth = 200;
    const menuHeight = 8 + (spellFix ? 2 : 1) * 34;
    const left = Math.min(menu.x, window.innerWidth - menuWidth - 8);
    const top = Math.min(menu.y, window.innerHeight - menuHeight - 8);
    return (
      <div ref={menuRef} className="liquid-glass-heavy fixed z-[999] min-w-[200px] rounded-2xl p-1" style={{ left, top }}>
        {spellFix && (
          <button
            type="button"
            className={itemClass}
            onClick={() => { target.replaceWith(document.createTextNode(spellFix)); notifyTextChanged(); close(); }}
          >
            <Check size={14} /> Change to “{spellFix}”
          </button>
        )}
        <button
          type="button"
          className={itemClass}
          onClick={() => { target.replaceWith(document.createTextNode(target.textContent ?? '')); notifyTextChanged(); close(); }}
        >
          <X size={14} /> Ignore
        </button>
      </div>
    );
  }

  const refocusAndRestoreSelection = () => {
    if (isField) {
      target.focus();
      return;
    }
    if (editableHost) {
      editableHost.focus();
      if (savedRange) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(savedRange);
      }
    }
  };

  const runCopy = async () => {
    try { await navigator.clipboard.writeText(selectedText); } catch { /* clipboard permission denied */ }
    close();
  };

  const runCut = async () => {
    try { await navigator.clipboard.writeText(selectedText); } catch { /* clipboard permission denied */ }
    refocusAndRestoreSelection();
    document.execCommand('insertText', false, '');
    close();
  };

  const runPaste = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* clipboard permission denied */ }
    if (text) {
      refocusAndRestoreSelection();
      document.execCommand('insertText', false, text);
    }
    close();
  };

  const runSelectAll = () => {
    if (isField) { target.select(); close(); return; }
    if (editableHost) {
      editableHost.focus();
      document.execCommand('selectAll');
    }
    close();
  };

  const canCut = !!editableHost && selectedText.length > 0;
  const canPaste = !!editableHost;
  const canSelectAll = !!editableHost;

  const menuWidth = 168;
  const menuHeight = 8 + [canCut, true, canPaste, canSelectAll].filter(Boolean).length * 34;
  const left = Math.min(menu.x, window.innerWidth - menuWidth - 8);
  const top = Math.min(menu.y, window.innerHeight - menuHeight - 8);

  const itemClass = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-accent/15 hover:text-accent transition-colors';

  return (
    <div
      ref={menuRef}
      className="liquid-glass-heavy fixed z-[999] min-w-[168px] rounded-2xl p-1"
      style={{ left, top }}
    >
      {canCut && (
        <button type="button" className={itemClass} onClick={runCut}>
          <Scissors size={14} /> Cut
        </button>
      )}
      <button type="button" className={itemClass} onClick={runCopy} disabled={!selectedText} style={selectedText ? undefined : { opacity: 0.4, pointerEvents: 'none' }}>
        <Copy size={14} /> Copy
      </button>
      {canPaste && (
        <button type="button" className={itemClass} onClick={runPaste}>
          <ClipboardPaste size={14} /> Paste
        </button>
      )}
      {canSelectAll && (
        <button type="button" className={itemClass} onClick={runSelectAll}>
          <TextSelect size={14} /> Select All
        </button>
      )}
    </div>
  );
}
