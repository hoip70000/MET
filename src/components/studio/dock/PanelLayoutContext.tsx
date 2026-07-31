import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Every known right-column panel, in its default stack order. 'text'/'adjustment' additionally stay
 * gated on "is there an applicable active layer" wherever they're rendered (PanelStack's caller) —
 * this context only tracks whether the *user* has asked to see them, not whether there's currently
 * anything to show.
 */
const DEFAULT_ORDER = ['collab', 'color', 'typer', 'magicerase', 'translation', 'layers', 'brushes', 'fonts', 'adjustment', 'text', 'history'];

const DEFAULT_COLLAPSED: Record<string, boolean> = {
  collab: false, color: false, typer: false, magicerase: true, translation: true, layers: false,
  brushes: true, fonts: true, adjustment: true, text: false, history: false,
};

// Brushes/Fonts/Adjustments (and now Magic Erase) start absent (not just collapsed) so Window >
// "<Panel>" reads as a real on/off toggle — "appears… disappears" — rather than merely expanding
// something already present.
//
// Magic Erase was missing from DEFAULT_ORDER entirely until now (not just DEFAULT_VISIBLE) — since
// PanelStack's visibleOrder is `layout.order.filter(...)`, an id absent from `order` can never
// render no matter what `visible` says, and loadLayout's migration for existing saved layouts
// (`parsed.order.filter(id => DEFAULT_ORDER.includes(id))`) only ever backfills ids that are
// *already* in DEFAULT_ORDER — so this was unreachable for every session, new or existing, until
// this array itself listed it.
const DEFAULT_VISIBLE: Record<string, boolean> = {
  collab: false, color: true, typer: true, magicerase: false, translation: true, layers: true,
  brushes: false, fonts: false, adjustment: false, text: false, history: false,
};

interface PanelLayoutState {
  order: string[];
  collapsed: Record<string, boolean>;
  visible: Record<string, boolean>;
}

function defaultLayout(): PanelLayoutState {
  return { order: [...DEFAULT_ORDER], collapsed: { ...DEFAULT_COLLAPSED }, visible: { ...DEFAULT_VISIBLE } };
}

const SCHEMA_VERSION = 1;
interface StoredLayout { v: number; order: string[]; collapsed: Record<string, boolean>; visible: Record<string, boolean>; }

function loadLayout(storageKey: string | undefined): PanelLayoutState {
  const fallback = defaultLayout();
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(`studio_panel_layout_${storageKey}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredLayout;
    if (parsed.v !== SCHEMA_VERSION) return fallback;
    // A panel id this saved layout has never heard of (introduced since, or never touched by the
    // user) still needs a real default rather than silently vanishing from `order`.
    const order = [...parsed.order.filter(id => DEFAULT_ORDER.includes(id)), ...DEFAULT_ORDER.filter(id => !parsed.order.includes(id))];
    return {
      order,
      collapsed: { ...DEFAULT_COLLAPSED, ...parsed.collapsed },
      visible: { ...DEFAULT_VISIBLE, ...parsed.visible },
    };
  } catch {
    return fallback;
  }
}

interface PanelLayoutContextValue {
  order: string[];
  isVisible: (id: string) => boolean;
  isCollapsed: (id: string) => boolean;
  setVisible: (id: string, visible: boolean) => void;
  toggleCollapsed: (id: string) => void;
  /** Makes a panel visible and expanded — the panel-stack successor to the old dock's "select this
   *  tab": there's no single active tab anymore, so "reveal" is the closest real equivalent. */
  reveal: (id: string) => void;
  reorder: (draggedId: string, targetId: string, before: boolean) => void;
  maximizedId: string | null;
  toggleMaximized: (id: string) => void;
  resetLayout: () => void;
}

const PanelLayoutContext = createContext<PanelLayoutContextValue | null>(null);

interface PanelLayoutProviderProps {
  children: ReactNode;
  /** Scopes the remembered layout to a project — e.g. a chapter id. */
  storageKey?: string;
}

export function PanelLayoutProvider({ children, storageKey }: PanelLayoutProviderProps) {
  const [state, setState] = useState<PanelLayoutState>(() => loadLayout(storageKey));
  const [maximizedId, setMaximizedId] = useState<string | null>(null);

  const lastKeyRef = useRef(storageKey);
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    setState(loadLayout(storageKey));
    setMaximizedId(null);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    const timeout = setTimeout(() => {
      try {
        const stored: StoredLayout = { v: SCHEMA_VERSION, order: state.order, collapsed: state.collapsed, visible: state.visible };
        localStorage.setItem(`studio_panel_layout_${storageKey}`, JSON.stringify(stored));
      } catch {
        // Storage full/unavailable — layout just won't persist this time, not fatal.
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [storageKey, state]);

  const isVisible = useCallback((id: string) => state.visible[id] ?? false, [state.visible]);
  const isCollapsed = useCallback((id: string) => state.collapsed[id] ?? false, [state.collapsed]);

  const setVisible = useCallback((id: string, visible: boolean) => {
    setState(s => ({ ...s, visible: { ...s.visible, [id]: visible } }));
  }, []);

  const toggleCollapsed = useCallback((id: string) => {
    setState(s => ({ ...s, collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }));
  }, []);

  const reveal = useCallback((id: string) => {
    setState(s => ({ ...s, visible: { ...s.visible, [id]: true }, collapsed: { ...s.collapsed, [id]: false } }));
  }, []);

  const reorder = useCallback((draggedId: string, targetId: string, before: boolean) => {
    if (draggedId === targetId) return;
    setState(s => {
      const withoutDragged = s.order.filter(id => id !== draggedId);
      const targetIndex = withoutDragged.indexOf(targetId);
      if (targetIndex === -1) return s;
      const insertAt = before ? targetIndex : targetIndex + 1;
      const nextOrder = [...withoutDragged.slice(0, insertAt), draggedId, ...withoutDragged.slice(insertAt)];
      return { ...s, order: nextOrder };
    });
  }, []);

  const toggleMaximized = useCallback((id: string) => {
    setMaximizedId(current => (current === id ? null : id));
  }, []);

  const resetLayout = useCallback(() => {
    setState(defaultLayout());
    setMaximizedId(null);
  }, []);

  const value = useMemo<PanelLayoutContextValue>(() => ({
    order: state.order, isVisible, isCollapsed, setVisible, toggleCollapsed, reveal, reorder,
    maximizedId, toggleMaximized, resetLayout,
  }), [state.order, isVisible, isCollapsed, setVisible, toggleCollapsed, reveal, reorder, maximizedId, toggleMaximized, resetLayout]);

  return <PanelLayoutContext.Provider value={value}>{children}</PanelLayoutContext.Provider>;
}

export function usePanelLayout(): PanelLayoutContextValue {
  const ctx = useContext(PanelLayoutContext);
  if (!ctx) throw new Error('usePanelLayout must be used within a PanelLayoutProvider');
  return ctx;
}
