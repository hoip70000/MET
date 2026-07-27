import { useEffect, useState } from 'react';
import { ShieldAlert, Trash2, RotateCcw, Send, Users, Boxes } from 'lucide-react';
import { GlassCard, Button, Modal, Textarea } from './ui';
import { swal, swalToast } from '../lib/swalTheme';
import {
  listAllUsers, listAllTeams, adminSoftDeleteUser, adminRestoreUser, adminNotifyUser, adminSetTeamRole,
  type AdminUserRow, type AdminTeamRow,
} from '../lib/adminDashboard';
import { SkeletonRow } from './ui';

export function AdminDashboard() {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [teams, setTeams] = useState<AdminTeamRow[] | null>(null);
  const [notifyTarget, setNotifyTarget] = useState<AdminUserRow | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUserRow | null>(null);

  const refresh = () => {
    listAllUsers().then(setUsers);
    listAllTeams().then(setTeams);
  };

  useEffect(() => { refresh(); }, []);

  const handleToggleDelete = async (u: AdminUserRow) => {
    if (u.deleted_at) {
      const error = await adminRestoreUser(u.id);
      if (error) { swal({ icon: 'error', title: 'Could not restore user', text: error }); return; }
      swalToast({ icon: 'success', title: `${u.name} restored` });
    } else {
      const result = await swal({
        icon: 'warning',
        title: `Disable ${u.name}?`,
        text: 'This soft-deletes their account (disabled, not erased) and notifies them.',
        showCancelButton: true,
        confirmButtonText: 'Disable',
      });
      if (!result.isConfirmed) return;
      const error = await adminSoftDeleteUser(u.id);
      if (error) { swal({ icon: 'error', title: 'Could not disable user', text: error }); return; }
      swalToast({ icon: 'success', title: `${u.name} disabled` });
    }
    refresh();
  };

  return (
    <GlassCard className="p-6 space-y-5">
      <h3 className="text-base font-semibold text-ink font-display flex items-center gap-2">
        <ShieldAlert size={16} className="text-accent" /> Admin Dashboard
      </h3>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-ink-muted flex items-center gap-1.5"><Users size={13} /> Users</p>
        {users === null ? (
          <div className="space-y-1">{Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {users.map(u => (
              <div key={u.id} className={`flex items-center gap-3 p-2 rounded-lg border border-hairline ${u.deleted_at ? 'opacity-50' : ''}`}>
                <div className="w-8 h-8 rounded-full overflow-hidden bg-accent-soft shrink-0 flex items-center justify-center">
                  {u.avatar ? <img src={u.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] font-semibold">{u.name?.[0]?.toUpperCase()}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink truncate">{u.name} {u.is_admin && <span className="text-accent">(admin)</span>}</p>
                  <p className="text-[10px] text-ink-faint truncate">{u.email}{u.deleted_at ? ' — disabled' : ''}</p>
                </div>
                <button title="Send notification" onClick={() => setNotifyTarget(u)} className="p-1.5 rounded-lg hover:bg-ink/8 text-ink-faint hover:text-ink">
                  <Send size={13} />
                </button>
                <button title="Make team admin" onClick={() => setRoleTarget(u)} className="p-1.5 rounded-lg hover:bg-ink/8 text-ink-faint hover:text-ink">
                  <ShieldAlert size={13} />
                </button>
                <button
                  title={u.deleted_at ? 'Restore' : 'Disable'}
                  onClick={() => handleToggleDelete(u)}
                  className="p-1.5 rounded-lg hover:bg-danger/10 text-ink-faint hover:text-danger"
                >
                  {u.deleted_at ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-hairline pt-4">
        <p className="text-xs font-semibold text-ink-muted flex items-center gap-1.5"><Boxes size={13} /> Teams</p>
        {teams === null ? (
          <div className="space-y-1">{Array.from({ length: 2 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {teams.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-2 rounded-lg border border-hairline text-xs">
                <span className="font-semibold text-ink truncate">{t.name}</span>
                <span className="text-ink-faint">{t.member_count} member{t.member_count === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {notifyTarget && (
        <NotifyUserModal user={notifyTarget} onClose={() => setNotifyTarget(null)} />
      )}
      {roleTarget && (
        <SetTeamRoleModal user={roleTarget} teams={teams ?? []} onClose={() => setRoleTarget(null)} />
      )}
    </GlassCard>
  );
}

function NotifyUserModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!title.trim()) return;
    setSending(true);
    const error = await adminNotifyUser(user.id, title.trim(), body.trim());
    setSending(false);
    if (error) { swal({ icon: 'error', title: 'Could not send', text: error }); return; }
    swalToast({ icon: 'success', title: 'Notification sent' });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Notify ${user.name}`} size="sm" footer={
      <Button className="w-full" onClick={handleSend} disabled={sending || !title.trim()}>{sending ? 'Sending...' : 'Send'}</Button>
    }>
      <div className="space-y-2">
        <input
          className="w-full rounded-lg border border-hairline bg-ink/5 px-3 py-2 text-sm text-ink"
          placeholder="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <Textarea placeholder="Message (optional)" value={body} onChange={e => setBody(e.target.value)} rows={3} />
      </div>
    </Modal>
  );
}

function SetTeamRoleModal({ user, teams, onClose }: { user: AdminUserRow; teams: AdminTeamRow[]; onClose: () => void }) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [saving, setSaving] = useState(false);

  const handleApply = async () => {
    if (!teamId) return;
    setSaving(true);
    const error = await adminSetTeamRole(teamId, user.id, 'leader');
    setSaving(false);
    if (error) { swal({ icon: 'error', title: 'Could not update role', text: error }); return; }
    swalToast({ icon: 'success', title: `${user.name} is now a leader on that team` });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Make ${user.name} a team admin`} size="sm" footer={
      <Button className="w-full" onClick={handleApply} disabled={saving || !teamId}>{saving ? 'Applying...' : 'Apply'}</Button>
    }>
      <select
        className="w-full rounded-lg border border-hairline bg-ink/5 px-3 py-2 text-sm text-ink"
        value={teamId}
        onChange={e => setTeamId(e.target.value)}
      >
        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </Modal>
  );
}
