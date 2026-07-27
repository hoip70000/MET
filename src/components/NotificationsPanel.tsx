import { useEffect, useState } from 'react';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { Modal, Button, Skeleton } from './ui';
import { swal } from '../lib/swalTheme';
import { AppNotification, listNotifications, markRead, markAllRead, deleteNotification, deleteAllNotifications } from '../lib/notifications';

export function NotificationsPanel({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listNotifications().then(list => {
      setItems(list);
      setLoading(false);
    });
  }, [open]);

  const handleMarkRead = async (id: string) => {
    await markRead(id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    onChanged();
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    onChanged();
  };

  const handleDelete = async (id: string) => {
    await deleteNotification(id);
    setItems(prev => prev.filter(n => n.id !== id));
    onChanged();
  };

  const handleDeleteAll = async () => {
    const result = await swal({
      icon: 'warning',
      title: 'Delete all notifications?',
      showCancelButton: true,
      confirmButtonText: 'Delete All',
    });
    if (!result.isConfirmed) return;
    await deleteAllNotifications();
    setItems([]);
    onChanged();
  };

  const hasUnread = items.some(n => !n.read);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Notifications"
      footer={items.length > 0 ? (
        <div className="flex gap-2">
          {hasUnread && (
            <Button variant="secondary" onClick={handleMarkAllRead} className="flex-1">
              <CheckCheck size={14} /> Mark all read
            </Button>
          )}
          <Button variant="danger" onClick={handleDeleteAll} className="flex-1">
            <Trash2 size={14} /> Delete all
          </Button>
        </div>
      ) : undefined}
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5">
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3" style={{ width: '70%' }} />
                <Skeleton className="h-2.5" style={{ width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-6">
          <Bell size={22} className="text-ink-faint mx-auto mb-2" />
          <p className="text-sm text-ink-muted">No notifications yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(n => (
            <div
              key={n.id}
              onClick={() => !n.read && handleMarkRead(n.id)}
              className={`group relative w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${n.read ? 'border-hairline bg-transparent' : 'border-accent/30 bg-accent-soft'}`}
            >
              <div className="flex items-center justify-between gap-2 pr-6">
                <p className="text-sm font-semibold text-ink">{n.title}</p>
                {!n.read && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
              </div>
              {n.body && <p className="text-xs text-ink-muted mt-0.5 pr-6">{n.body}</p>}
              <p className="text-[10px] text-ink-faint mt-1">{new Date(n.created_at).toLocaleString()}</p>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                aria-label="Delete notification"
                className="absolute top-2.5 right-2.5 p-1 rounded-lg text-ink-faint opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition-all"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
