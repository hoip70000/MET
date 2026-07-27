import { useState, type ReactNode } from 'react';
import { cn } from '../../ui/cn';
import { CollapsiblePanel } from './CollapsiblePanel';
import { usePanelLayout } from './PanelLayoutContext';

export interface PanelStackEntry {
  id: string;
  label: string;
  content: ReactNode;
  /** Opens this panel's own small swal menu — omitted entirely (not just disabled) when a panel
   *  has no real action to put there. */
  onMenu?: () => void;
}

interface PanelStackProps {
  panels: PanelStackEntry[];
  className?: string;
}

/**
 * The stacked, collapsible, reorderable, maximizable right-column panel column — replaces the old
 * single-active-tab `RightDock`. Every entry in `panels` that's currently visible (per
 * `PanelLayoutContext`) renders as a `CollapsiblePanel`, in the user's own saved order.
 */
export function PanelStack({ panels, className }: PanelStackProps) {
  const layout = usePanelLayout();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; before: boolean } | null>(null);

  const byId = new Map(panels.map(p => [p.id, p]));
  const visibleOrder = layout.order.filter(id => byId.has(id) && layout.isVisible(id));

  const maximized = layout.maximizedId && byId.has(layout.maximizedId) && layout.isVisible(layout.maximizedId)
    ? byId.get(layout.maximizedId)!
    : null;

  if (maximized) {
    return (
      <div className={cn('h-full flex flex-col min-h-0', className)}>
        <CollapsiblePanel
          id={maximized.id}
          title={maximized.label}
          collapsed={false}
          onToggleCollapsed={() => layout.toggleCollapsed(maximized.id)}
          maximized
          onToggleMaximized={() => layout.toggleMaximized(maximized.id)}
          onMenu={maximized.onMenu}
          draggedOver={null}
          onDragStart={() => {}}
          onDragEnd={() => {}}
          onDragOverHeader={() => {}}
          onDropOnHeader={() => {}}
        >
          {maximized.content}
        </CollapsiblePanel>
      </div>
    );
  }

  return (
    <div className={cn('h-full flex flex-col min-h-0 overflow-y-auto', className)}>
      {visibleOrder.map(id => {
        const entry = byId.get(id)!;
        return (
          <CollapsiblePanel
            key={id}
            id={id}
            title={entry.label}
            collapsed={layout.isCollapsed(id)}
            onToggleCollapsed={() => layout.toggleCollapsed(id)}
            maximized={false}
            onToggleMaximized={() => layout.toggleMaximized(id)}
            grow={id === 'layers'}
            onMenu={entry.onMenu}
            draggedOver={dragOver?.id === id ? (dragOver.before ? 'above' : 'below') : null}
            onDragStart={() => setDragId(id)}
            onDragEnd={() => { setDragId(null); setDragOver(null); }}
            onDragOverHeader={(before) => { if (dragId && dragId !== id) setDragOver({ id, before }); }}
            onDropOnHeader={() => {
              if (dragId && dragId !== id && dragOver) layout.reorder(dragId, id, dragOver.before);
              setDragId(null);
              setDragOver(null);
            }}
          >
            {entry.content}
          </CollapsiblePanel>
        );
      })}
    </div>
  );
}
