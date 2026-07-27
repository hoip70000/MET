import { memo, useEffect, useRef, useState } from 'react';
import { useChatScroll } from '../hooks/useChatScroll';
import {
  Users, ImagePlus, Plus, Mail, Check, X, Crown, ShieldCheck, ArrowUpCircle, ArrowDownCircle, UserMinus,
  Send, ListTodo, Paperclip, CalendarClock, Trash2, Wallet, Flame, Trophy, BarChart3, Link as LinkIcon,
  ThumbsUp, ThumbsDown, Pencil, LogOut, Clock3, PiggyBank, Home, MessageCircle, Globe, Lock, ArrowLeft, UserPlus,
  Megaphone, AlertTriangle, ChevronDown, Boxes, Mic,
} from 'lucide-react';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { GlassCard, Button, Input, Textarea, Modal, Switch, SkeletonCard, SkeletonRow } from './ui';
import { TeamUploadModal, type TeamUploadMeta } from './TeamUploadModal';
import { swal, swalToast, confirmAction } from '../lib/swalTheme';
import { readAvatarFile, readImageFile, uploadImageToStorage } from '../lib/image';
import {
  CloudFileVisibility, TeamCloudFileMeta, TeamCloudFolderMeta,
  listCloudFileMeta, listCloudFolderMeta, upsertCloudFileMeta, setCloudFileVisibility, setCloudFolderSecret, uploadCloudFileCover,
} from '../lib/teamCloudFiles';
import { useTeamAuth } from '../lib/teamAuth';
import {
  Team, TeamMember, JOB_TITLES, JobTitle,
  createTeam, getMyOwnedTeam, getMyMembership, getPendingInvitesForMe,
  inviteMember, acceptInvite, declineInvite, listTeamMembers, updateMemberFields,
  promoteToLeader, demoteToMember, removeMember, getLeaderboard,
  updateTeamSettings, deleteTeam, broadcastToTeam, updateMyNotificationPrefs, updateMyNotificationCategory, updateMyPrivacyPrefs,
  setMemberVerified, listMyMemberships, getActiveTeamId, setActiveTeamId,
  TeamCustomPermissionDef, TeamCustomPermissionGrant,
  listCustomPermissionDefs, createCustomPermissionDef, deleteCustomPermissionDef,
  listCustomPermissionGrants, grantCustomPermission, revokeCustomPermission,
} from '../lib/teams';
import {
  Task, TaskPriority, TaskStatus, TaskAttachment, createTaskWithWorkflow, listTeamTasks, listMyTasks, deleteTask, attachFileToTask, listTaskAttachments,
  setTeamTelegramChannel, acceptTask, declineTask, submitTask, approveTask, rejectSubmission, markTaskUnsuccessful,
  checkIn, setMemberActive, expireStaleOffers, reassignMemberTasks, notifyUpcomingTaskDeadlines, spawnRecurringTasks,
  TaskChecklistItem, listChecklistItems, addChecklistItem, toggleChecklistItem, deleteChecklistItem,
  TaskHistoryEntry, listTaskHistory,
  TaskTimeEntry, listTimeEntries, getMyOpenTimeEntry, startTimer, stopTimer, totalTrackedMs,
  listDependencies, addDependency, removeDependency,
  listTeamStageHistory,
} from '../lib/tasks';
import { TaskComment, listTaskComments, postTaskComment, subscribeToTaskComments } from '../lib/taskComments';
import { TaskTemplate, listTemplates, saveAsTemplate } from '../lib/taskTemplates';
import { deposit, penalize, transfer, requestWithdrawal, decideWithdrawal, listPendingWithdrawals, listTransactions, Transaction, Withdrawal } from '../lib/wallet';
import {
  requestLeave, decideLeave, requestResignation, decideResignation,
  listPendingLeaveRequests, listPendingResignations, LeaveRequest, ResignationRequest,
} from '../lib/memberRequests';
import {
  requestToJoinTeam, decideJoinRequest, listPublicTeams, listPendingJoinRequests, expireStaleJoinRequests,
  createInviteToken, redeemInviteToken, getPublicTeamLeaderboard, PublicTeamLeaderboardRow,
  listResponseTemplates, upsertResponseTemplate, deleteResponseTemplate, ResponseTemplate,
  JoinRequest, PublicTeamCard,
} from '../lib/joinRequests';
import {
  sendTeamMessage, listTeamMessages, subscribeToTeamMessages, TeamMessage,
  sendDirectMessage, listDirectMessages, subscribeToDirectMessages, listConversations, markDirectMessagesRead, DirectMessage, Conversation,
  editTeamMessage, deleteTeamMessage, pinTeamMessage, editDirectMessage, deleteDirectMessage,
  listReactions, subscribeToReactions, toggleReaction, MessageReaction,
  parseMentions, subscribeToTyping, markTeamChatRead, getTeamChatUnreadCount,
  reportMessage,
} from '../lib/chat';
import { notify } from '../lib/notifications';
import { dominantColorFromImage } from '../lib/color';
import { renderMarkdownMessage } from '../lib/miniMarkdown';
import { useChatBubbleMenu, ChatBubbleIcons } from './ChatBubbleMenu';
import { subscribeToTeamPresence, subscribeToGlobalPresence } from '../lib/presence';
import { requestOwnerTransfer, decideOwnerTransfer, getMyPendingOwnerTransfers, OwnerTransferRequest } from '../lib/ownerTransfer';
import { listTeamBadges, TeamBadge, listMemberBadges, MemberBadge } from '../lib/teamBadges';
import { getCurrentSeasonLeaderboard, closeCurrentSeason, SeasonLeaderboardRow } from '../lib/seasons';
import { exportTeamReportDocx } from '../lib/teamReport';
import {
  TeamMemberJob, listMyJobs, listTeamMemberJobs, claimJobPriority, removeMemberJob, setMemberJobActive, adminSetMemberJob, adminRemoveMemberJob,
} from '../lib/teamJobs';
import type { CloudClient, CloudFile, CloudFolder, CloudFileComment } from '../lib/cloudClient';
import { CloudFolders } from './cloud/CloudFolders';
import { Folder as FolderIcon, Upload, Download } from 'lucide-react';

type SectionId = 'dashboard' | 'tasks' | 'bank' | 'chat' | 'files' | 'requests' | 'roster' | 'analytics' | 'admin';

export function TeamsPanel({ cc, pendingJoinToken, onConsumedJoinToken }: { cc: CloudClient; pendingJoinToken?: string | null; onConsumedJoinToken?: () => void }) {
  const { session, isAdmin } = useTeamAuth();

  return (
    <div className="space-y-5">
      <div className="border-b border-hairline pb-4">
        <h2 className="text-lg font-display font-semibold text-ink flex items-center gap-2">
          <Users className="text-accent" size={20} /> Teams
        </h2>
        <p className="text-xs text-ink-muted mt-0.5">Signed in as {session?.user.email}</p>
      </div>

      {pendingJoinToken && onConsumedJoinToken && (
        <RedeemInviteTokenModal token={pendingJoinToken} onClose={onConsumedJoinToken} />
      )}

      <PendingOwnerTransfers />

      {isAdmin ? <AdminTeamSection cc={cc} /> : <MemberTeamSection cc={cc} />}
    </div>
  );
}

function RedeemInviteTokenModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    const error = await redeemInviteToken(token, message.trim());
    setSending(false);
    if (error) { swal({ icon: 'error', title: 'Could not join', text: error }); onClose(); return; }
    swalToast({ icon: 'success', title: 'Join request sent' });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Join via invite link" size="sm" footer={
      <Button className="w-full" onClick={handleSend} disabled={sending}>{sending ? 'Sending...' : 'Send Join Request'}</Button>
    }>
      <div className="space-y-1">
        <label className="text-xs text-accent font-semibold">Message (optional letter to the admin)</label>
        <Textarea placeholder="Tell them a bit about yourself..." value={message} onChange={e => setMessage(e.target.value)} rows={4} />
      </div>
    </Modal>
  );
}

function PendingOwnerTransfers() {
  const [offers, setOffers] = useState<OwnerTransferRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => { getMyPendingOwnerTransfers().then(setOffers); };
  useEffect(refresh, []);

  const handleDecide = async (id: string, accept: boolean) => {
    setBusyId(id);
    const error = await decideOwnerTransfer(id, accept);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not respond', text: error }); return; }
    swalToast({ icon: 'success', title: accept ? 'Ownership accepted' : 'Offer declined' });
    refresh();
  };

  if (offers.length === 0) return null;

  return (
    <div className="space-y-2">
      {offers.map(o => (
        <GlassCard key={o.id} className="p-4 flex items-center justify-between gap-3 border-accent/30">
          <p className="text-sm text-ink">
            <span className="font-semibold">Ownership offer:</span> you've been nominated to own <span className="font-semibold">{o.team?.name || 'a team'}</span>.
          </p>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" onClick={() => handleDecide(o.id, true)} disabled={busyId === o.id}><Check size={13} /> Accept</Button>
            <Button size="sm" variant="secondary" onClick={() => handleDecide(o.id, false)} disabled={busyId === o.id}><X size={13} /> Decline</Button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard shell
// ---------------------------------------------------------------------------

const SECTIONS: { id: SectionId; label: string; icon: typeof Users; forOwnerOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'bank', label: 'Bank', icon: Wallet },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'files', label: 'Files', icon: FolderIcon },
  { id: 'requests', label: 'Requests', icon: CalendarClock },
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'admin', label: 'Admin', icon: ShieldCheck, forOwnerOnly: true },
];

interface Perms {
  isOwner: boolean;
  canManage: boolean; // owner or leader (blanket — invites, telegram channel)
  canReviewTasks: boolean;
  canManageBank: boolean;
  canManageJoinRequests: boolean;
  canManageVacations: boolean;
  canManageTasks: boolean; // delegable, in addition to blanket leader access
  canPreviewTasks: boolean; // view-only access to the full team task board
  canManageCloudFiles: boolean; // delegable — NOT bundled into blanket canManage, same as bank/tasks perms
  canManageMembers: boolean; // delegable roster editing (owner is otherwise the only one whose team_members writes pass RLS)
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Users; title: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/20 flex items-center justify-center text-accent shrink-0">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-display font-semibold text-ink">{title}</h2>
        {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

const SECTION_DESCRIPTIONS: Partial<Record<SectionId, string>> = {
  dashboard: 'Your status, balance, and streak at a glance',
  tasks: 'Offer, accept, submit, and review work',
  bank: 'Transfers, deposits, and withdrawals',
  chat: 'Team channel and direct messages',
  files: "Everything sitting in the team's shared Telegram channel",
  requests: 'Leave, resignation, and join requests',
  roster: 'Members, roles, and permissions',
  analytics: 'Leaderboard and team-wide report',
  admin: 'Team settings, broadcasts, and danger zone',
};

function TeamWorkspace({
  team, members, isOwner, myMember, canManage, onChanged, cc,
}: {
  team: Team;
  members: TeamMember[];
  isOwner: boolean;
  myMember: TeamMember | null;
  canManage: boolean;
  onChanged: () => void;
  cc: CloudClient;
}) {
  const perms: Perms = {
    isOwner,
    canManage,
    canReviewTasks: isOwner || !!myMember?.can_review_tasks,
    canManageBank: isOwner || !!myMember?.can_manage_bank,
    canManageJoinRequests: isOwner || !!myMember?.can_manage_join_requests,
    canManageVacations: isOwner || !!myMember?.can_manage_vacations,
    canManageTasks: canManage || !!myMember?.can_manage_tasks,
    canPreviewTasks: canManage || !!myMember?.can_manage_tasks || !!myMember?.can_preview_tasks,
    canManageCloudFiles: isOwner || !!myMember?.can_manage_cloud_files,
    canManageMembers: isOwner || !!myMember?.can_manage_members,
  };

  const visibleSections = SECTIONS.filter(s => !s.forOwnerOnly || isOwner);
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard');

  return (
    <div className="space-y-10">
      <nav className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 backdrop-blur-xl bg-surface/80 border-b border-hairline flex items-center gap-1.5 overflow-x-auto">
        {visibleSections.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeSection === s.id ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-accent-soft hover:text-accent'
              }`}
            >
              <Icon size={13} /> {s.label}
            </button>
          );
        })}
      </nav>

      {activeSection === 'dashboard' && (
        <div>
          <SectionHeader icon={Home} title="Dashboard" description={SECTION_DESCRIPTIONS.dashboard} />
          <DashboardSection team={team} myMember={myMember} canManage={canManage} members={members} onChanged={onChanged} />
        </div>
      )}

      {activeSection === 'tasks' && (
        <div>
          <SectionHeader icon={ListTodo} title="Tasks" description={SECTION_DESCRIPTIONS.tasks} />
          <TasksSection team={team} members={members} canManageTasks={perms.canManageTasks} canReviewTasks={perms.canReviewTasks} canPreviewTasks={perms.canPreviewTasks} myMember={myMember} cc={cc} />
        </div>
      )}

      {activeSection === 'bank' && (
        <div>
          <SectionHeader icon={Wallet} title="Bank" description={SECTION_DESCRIPTIONS.bank} />
          <BankTab team={team} members={members} myMember={myMember} canManageBank={perms.canManageBank} />
        </div>
      )}

      {activeSection === 'chat' && (
        <div>
          <SectionHeader icon={MessageCircle} title="Chat" description={SECTION_DESCRIPTIONS.chat} />
          <ChatSection team={team} members={members} myMember={myMember} isOwner={isOwner} canManage={canManage} onChanged={onChanged} cc={cc} />
        </div>
      )}

      {activeSection === 'files' && (
        <div>
          <SectionHeader icon={FolderIcon} title="Files" description={SECTION_DESCRIPTIONS.files} />
          <TeamFilesSection team={team} canManage={canManage} canManageCloudFiles={perms.canManageCloudFiles} cc={cc} members={members} />
        </div>
      )}

      {activeSection === 'requests' && (
        <div>
          <SectionHeader icon={CalendarClock} title="Requests" description={SECTION_DESCRIPTIONS.requests} />
          <RequestsTab team={team} myMember={myMember} canManageVacations={perms.canManageVacations} canManageJoinRequests={perms.canManageJoinRequests} onChanged={onChanged} />
        </div>
      )}

      {activeSection === 'roster' && (
        <div>
          <SectionHeader icon={Users} title="Roster" description={SECTION_DESCRIPTIONS.roster} />
          <TeamRoster team={team} members={members} isOwner={isOwner} canManageMembers={canManage} canEditMemberDetails={isOwner || perms.canManageMembers} onChanged={onChanged} />
        </div>
      )}

      {activeSection === 'analytics' && (
        <div>
          <SectionHeader icon={BarChart3} title="Analytics" description={SECTION_DESCRIPTIONS.analytics} />
          <AnalyticsSection team={team} members={members} />
        </div>
      )}

      {activeSection === 'admin' && isOwner && (
        <div>
          <SectionHeader icon={ShieldCheck} title="Admin" description={SECTION_DESCRIPTIONS.admin} />
          <AdminSection team={team} members={members} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function DashboardSection({ team, myMember, canManage, members, onChanged }: { team: Team; myMember: TeamMember | null; canManage: boolean; members: TeamMember[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const handleCheckIn = async () => {
    setBusy(true);
    const error = await checkIn(team.id);
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Check-in failed', text: error }); return; }
    swalToast({ icon: 'success', title: 'Checked in' });
    onChanged();
  };

  const handleToggleActive = async (value: boolean) => {
    const error = await setMemberActive(team.id, value);
    if (error) { swal({ icon: 'error', title: 'Could not update status', text: error }); return; }
    onChanged();
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {myMember && (
        <GlassCard className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-ink-faint">Your balance</p>
              <p className="text-2xl font-display font-bold text-ink">${myMember.balance.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-faint">Role</p>
              <p className="text-sm font-semibold text-accent flex items-center gap-1 justify-end">
                {myMember.role === 'leader' && <Crown size={12} />} {myMember.job_title || 'Unassigned'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl border border-hairline">
            <div className="flex items-center gap-2">
              <Flame size={16} className="text-accent" />
              <span className="text-sm font-semibold text-ink">{myMember.streak_count} day streak</span>
            </div>
            <Button size="sm" onClick={handleCheckIn} disabled={busy}>Check in</Button>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl border border-hairline">
            <span className="text-sm font-semibold text-ink">Available for new tasks</span>
            <Switch checked={myMember.is_active} onChange={handleToggleActive} />
          </div>

          <p className="text-xs text-ink-faint">
            Status: <span className="font-semibold text-ink">{myMember.member_status.replace('_', ' ')}</span>
            {myMember.priority != null && <> · Priority <span className="font-semibold text-ink">{myMember.priority}</span></>}
          </p>
        </GlassCard>
      )}

      {myMember && <MyNotificationPrefsCard team={team} myMember={myMember} onChanged={onChanged} />}
      {myMember && <MyPrivacyPrefsCard team={team} myMember={myMember} onChanged={onChanged} />}

      {myMember && <MyJobsCard team={team} />}

      {canManage && (
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-ink mb-3">Team at a glance</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-ink-faint text-xs">Members</p><p className="font-bold text-ink">{members.filter(m => m.status === 'active').length}</p></div>
            <div><p className="text-ink-faint text-xs">Active/Available</p><p className="font-bold text-ink">{members.filter(m => m.status === 'active' && m.is_active).length}</p></div>
            <div><p className="text-ink-faint text-xs">On leave</p><p className="font-bold text-ink">{members.filter(m => m.member_status === 'on_leave').length}</p></div>
            <div><p className="text-ink-faint text-xs">Pending invites</p><p className="font-bold text-ink">{members.filter(m => m.status === 'pending').length}</p></div>
          </div>
        </GlassCard>
      )}

      <TeamStatsCard team={team} members={members} />

      <TopPerformersCard team={team} members={members} />

      <TeamActivityFeed team={team} />

      {!myMember && !canManage && (
        <GlassCard className="p-8 text-center md:col-span-2">
          <p className="text-sm text-ink-muted">No personal dashboard for this account yet.</p>
        </GlassCard>
      )}
    </div>
  );
}

function TopPerformersCard({ team, members }: { team: Team; members: TeamMember[] }) {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => { listTeamTasks(team.id).then(setTasks); }, [team.id]);

  const jobs = Array.from(new Set(members.map(m => m.job_title).filter((j): j is JobTitle => !!j)));
  const doneTasks = tasks.filter(t => t.status === 'done' && t.assignee_id);

  const rankingByJob = jobs.map(job => {
    const counts = new Map<string, number>();
    for (const t of doneTasks) {
      if (!t.job_types.includes(job)) continue;
      counts.set(t.assignee_id, (counts.get(t.assignee_id) || 0) + 1);
    }
    const ranked = Array.from(counts.entries())
      .map(([userId, count]) => ({ userId, count, member: members.find(m => m.user_id === userId) }))
      .filter(r => r.member)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { job, ranked };
  }).filter(r => r.ranked.length > 0);

  if (rankingByJob.length === 0) return null;

  const medalColor = ['text-amber-500', 'text-slate-400', 'text-orange-700'];

  return (
    <GlassCard className="p-6 md:col-span-2">
      <h3 className="text-sm font-semibold text-ink mb-4 flex items-center gap-1.5"><Trophy size={14} className="text-accent" /> Top performers by job</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rankingByJob.map(({ job, ranked }) => (
          <div key={job} className="space-y-1.5">
            <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide">{job}</p>
            <div className="flex flex-col gap-1">
              {ranked.map((r, i) => (
                <div
                  key={r.userId}
                  className="flex items-center gap-2 p-1.5 rounded-lg bg-ink/[0.03] transition-all duration-500 ease-out"
                  style={{ order: i }}
                >
                  <span className={`text-xs font-bold w-4 shrink-0 ${medalColor[i] || 'text-ink-faint'}`}>#{i + 1}</span>
                  <ChatAvatar name={r.member?.profile?.name || r.member?.invited_email || 'Member'} avatar={r.member?.profile?.avatar} size={22} />
                  <span className="text-xs text-ink truncate flex-1">{r.member?.profile?.name || r.member?.invited_email}</span>
                  <span className="text-[10px] font-bold text-accent shrink-0">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function TeamStatsCard({ team, members }: { team: Team; members: TeamMember[] }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    listTeamTasks(team.id).then(setTasks);
    listTransactions(team.id).then(setTransactions);
  }, [team.id]);

  const doneTasks = tasks.filter(t => t.status === 'done');
  const completedThisWeek = doneTasks.filter(t => t.completed_at && Date.now() - new Date(t.completed_at).getTime() < 7 * 24 * 60 * 60 * 1000).length;
  const durations = doneTasks
    .filter(t => t.completed_at)
    .map(t => new Date(t.completed_at as string).getTime() - new Date(t.created_at).getTime())
    .filter(ms => ms > 0);
  const avgTurnaroundHrs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 3_600_000) : null;
  const totalPaidOut = transactions.filter(t => t.amount > 0 && t.sender_id !== t.receiver_id).reduce((sum, t) => sum + t.amount, 0);
  const streakLeader = [...members].filter(m => m.status === 'active').sort((a, b) => b.streak_count - a.streak_count)[0];

  return (
    <GlassCard className="p-6">
      <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5"><BarChart3 size={14} className="text-accent" /> Team stats</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-ink-faint text-xs">Tasks done (7d)</p><p className="font-bold text-ink">{completedThisWeek}</p></div>
        <div><p className="text-ink-faint text-xs">Avg turnaround</p><p className="font-bold text-ink">{avgTurnaroundHrs != null ? `${avgTurnaroundHrs}h` : '—'}</p></div>
        <div><p className="text-ink-faint text-xs">Paid out (all-time)</p><p className="font-bold text-ink">${totalPaidOut.toFixed(2)}</p></div>
        <div>
          <p className="text-ink-faint text-xs">Longest streak</p>
          <p className="font-bold text-ink truncate flex items-center gap-1">
            {streakLeader ? <><Flame size={12} className="text-accent shrink-0" /> {streakLeader.profile?.name || streakLeader.invited_email} ({streakLeader.streak_count}d)</> : '—'}
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

function TeamActivityFeed({ team }: { team: Team }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    listTeamTasks(team.id).then(setTasks);
    listTransactions(team.id).then(setTransactions);
  }, [team.id]);

  type Event = { id: string; at: string; icon: React.ReactNode; text: string };
  const events: Event[] = [
    ...tasks.filter(t => t.completed_at).map(t => ({
      id: `task-${t.id}`,
      at: t.completed_at as string,
      icon: <ListTodo size={13} className="text-success" />,
      text: `"${t.title}" was marked done${t.assignee?.name ? ` by ${t.assignee.name}` : ''}`,
    })),
    ...transactions.slice(0, 20).map(t => ({
      id: `tx-${t.id}`,
      at: t.created_at,
      icon: <Wallet size={13} className="text-accent" />,
      text: `${t.receiver?.name || 'A member'} ${t.amount >= 0 ? 'received' : 'was charged'} $${Math.abs(t.amount).toFixed(2)}${t.details ? ` — ${t.details}` : ''}`,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);

  if (events.length === 0) return null;

  return (
    <GlassCard className="p-6 md:col-span-2">
      <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5"><CalendarClock size={14} className="text-accent" /> Recent activity</h3>
      <div className="space-y-2.5">
        {events.map(e => (
          <div key={e.id} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 shrink-0">{e.icon}</span>
            <span className="text-ink-muted flex-1">{e.text}</span>
            <span className="text-ink-faint shrink-0 text-[10px]">{new Date(e.at).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function MyNotificationPrefsCard({ team, myMember, onChanged }: { team: Team; myMember: TeamMember; onChanged: () => void }) {
  const prefs = myMember.notification_prefs ?? {};
  const chat = { mode: 'all' as const, channel: 'in_app' as const, ...prefs.chat };
  const tasks = { enabled: true, channel: 'in_app' as const, ...prefs.tasks };

  const handleToggleBroadcasts = async (value: boolean) => {
    const error = await updateMyNotificationPrefs(team.id, { broadcasts: value });
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    onChanged();
  };

  const handleChatPatch = async (patch: Partial<typeof chat>) => {
    const error = await updateMyNotificationCategory(team.id, 'chat', patch);
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    onChanged();
  };

  const handleTasksPatch = async (patch: Partial<typeof tasks>) => {
    const error = await updateMyNotificationCategory(team.id, 'tasks', patch);
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    onChanged();
  };

  return (
    <GlassCard className="p-6 space-y-4">
      <h3 className="text-sm font-semibold text-ink">My Notifications</h3>

      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-muted">Team broadcasts</span>
        <Switch checked={prefs.broadcasts !== false} onChange={handleToggleBroadcasts} />
      </div>

      <div className="space-y-2 border-t border-hairline pt-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">Chat messages</span>
          <div className="flex items-center gap-1.5">
            <select
              className="text-xs rounded-lg border border-hairline bg-ink/5 px-2 py-1 text-ink"
              value={chat.mode}
              onChange={e => handleChatPatch({ mode: e.target.value as 'all' | 'mentions_dms' })}
            >
              <option value="all">Every message</option>
              <option value="mentions_dms">Mentions &amp; DMs only</option>
            </select>
            <select
              className="text-xs rounded-lg border border-hairline bg-ink/5 px-2 py-1 text-ink"
              value={chat.channel}
              onChange={e => handleChatPatch({ channel: e.target.value as 'in_app' | 'in_app_push' })}
            >
              <option value="in_app">In-app only</option>
              <option value="in_app_push">In-app + Web</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">Task assignments</span>
          <div className="flex items-center gap-1.5">
            <Switch checked={tasks.enabled !== false} onChange={v => handleTasksPatch({ enabled: v })} />
            <select
              className="text-xs rounded-lg border border-hairline bg-ink/5 px-2 py-1 text-ink disabled:opacity-40"
              value={tasks.channel}
              disabled={tasks.enabled === false}
              onChange={e => handleTasksPatch({ channel: e.target.value as 'in_app' | 'in_app_push' })}
            >
              <option value="in_app">In-app only</option>
              <option value="in_app_push">In-app + Web</option>
            </select>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function MyPrivacyPrefsCard({ team, myMember, onChanged }: { team: Team; myMember: TeamMember; onChanged: () => void }) {
  const prefs = { hide_status: false, hide_balance: false, hide_active: false, ...myMember.privacy_prefs };

  const handleToggle = async (key: 'hide_status' | 'hide_balance' | 'hide_active', value: boolean) => {
    const next = { ...prefs, [key]: value };
    const error = await updateMyPrivacyPrefs(team.id, next);
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    onChanged();
  };

  return (
    <GlassCard className="p-6 space-y-3">
      <h3 className="text-sm font-semibold text-ink">My Privacy</h3>
      {([
        ['hide_active', 'Hide my online/active status'],
        ['hide_status', 'Hide my member status (on leave, etc.)'],
        ['hide_balance', 'Hide my bank balance from others'],
      ] as const).map(([key, label]) => (
        <div key={key} className="flex items-center justify-between">
          <span className="text-sm text-ink-muted">{label}</span>
          <Switch checked={!!prefs[key]} onChange={v => handleToggle(key, v)} />
        </div>
      ))}
    </GlassCard>
  );
}

function MyJobsCard({ team }: { team: Team }) {
  const [jobs, setJobs] = useState<TeamMemberJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobPick, setJobPick] = useState<JobTitle | ''>('');
  const [priorityPick, setPriorityPick] = useState('1');
  const [saving, setSaving] = useState(false);

  const reload = () => { listMyJobs(team.id).then(j => { setJobs(j); setLoading(false); }); };
  useEffect(() => { reload(); }, [team.id]);

  const availableJobs = JOB_TITLES.filter(j => !jobs.some(job => job.job_type === j));

  const handleAdd = async () => {
    if (!jobPick) return;
    setSaving(true);
    const { error } = await claimJobPriority(team.id, jobPick, Number(priorityPick) || 1);
    setSaving(false);
    if (error) { swal({ icon: 'error', title: 'Could not set job', text: error }); return; }
    setJobPick(''); setPriorityPick('1');
    reload();
  };

  const handleRemove = async (jobType: string) => {
    const error = await removeMemberJob(team.id, jobType);
    if (error) { swal({ icon: 'error', title: 'Could not remove job', text: error }); return; }
    reload();
  };

  const handleToggleActive = async (jobType: string, active: boolean) => {
    const error = await setMemberJobActive(team.id, jobType, active);
    if (error) { swal({ icon: 'error', title: 'Could not update job', text: error }); return; }
    reload();
  };

  const handleChangePriority = async (jobType: string, priority: string) => {
    const { error } = await claimJobPriority(team.id, jobType, Number(priority) || 1);
    if (error) { swal({ icon: 'error', title: 'Could not update priority', text: error }); return; }
    reload();
  };

  if (loading) return <SkeletonCard className="h-40" />;

  return (
    <GlassCard className="p-6 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">My Jobs</h3>
        <p className="text-[11px] text-ink-faint mt-0.5">Priority 1 always gets first offer for that job; if you're busy or inactive, it cascades to the next priority.</p>
      </div>

      {jobs.length === 0 && <p className="text-xs text-ink-faint">No jobs set yet — pick at least one below.</p>}
      {jobs.map(j => (
        <div key={j.job_type} className="flex items-center gap-2 p-2 rounded-xl border border-hairline">
          <span className="text-xs font-semibold text-ink flex-1">{j.job_type}</span>
          <Input type="number" min={1} value={j.priority} onChange={e => handleChangePriority(j.job_type, e.target.value)} className="w-16 text-xs" />
          <Switch checked={j.active} onChange={v => handleToggleActive(j.job_type, v)} />
          <button onClick={() => handleRemove(j.job_type)} aria-label={`Remove ${j.job_type}`} className="p-1 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors">
            <X size={13} />
          </button>
        </div>
      ))}

      {availableJobs.length > 0 && (
        <div className="flex gap-1.5 pt-1">
          <select value={jobPick} onChange={e => setJobPick(e.target.value as JobTitle)} className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
            <option value="">Add a job...</option>
            {availableJobs.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
          <Input type="number" min={1} placeholder="Priority" value={priorityPick} onChange={e => setPriorityPick(e.target.value)} className="w-20 text-xs" />
          <Button size="sm" onClick={handleAdd} disabled={saving || !jobPick}>Add</Button>
        </div>
      )}
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

const PERM_TOGGLES: { key: 'can_review_tasks' | 'can_manage_bank' | 'can_manage_join_requests' | 'can_manage_vacations' | 'can_manage_tasks' | 'can_preview_tasks' | 'can_manage_cloud_files' | 'can_manage_members'; label: string }[] = [
  { key: 'can_review_tasks', label: 'Review tasks' },
  { key: 'can_manage_bank', label: 'Manage bank' },
  { key: 'can_manage_join_requests', label: 'Manage join requests' },
  { key: 'can_manage_vacations', label: 'Manage vacations' },
  { key: 'can_manage_tasks', label: 'Create/manage tasks' },
  { key: 'can_preview_tasks', label: 'Preview tasks (view-only)' },
  { key: 'can_manage_cloud_files', label: 'Manage Team Cloud folders/files' },
  { key: 'can_manage_members', label: 'Edit roster / member permissions' },
];

function EditMemberModal({ member, teamId, isOwner, onClose, onSaved }: { member: TeamMember; teamId: string; isOwner: boolean; onClose: () => void; onSaved: () => void }) {
  const [jobTitle, setJobTitle] = useState<JobTitle | ''>(member.job_title || '');
  const [priority, setPriority] = useState(String(member.priority ?? ''));
  const [balance, setBalance] = useState(String(member.balance ?? 0));
  const [customTitle, setCustomTitle] = useState(member.custom_title || '');
  const [customPerms, setCustomPerms] = useState<string[]>(member.custom_permissions || []);
  const [customPermInput, setCustomPermInput] = useState('');
  const [perms, setPerms] = useState({
    can_review_tasks: member.can_review_tasks,
    can_manage_bank: member.can_manage_bank,
    can_manage_join_requests: member.can_manage_join_requests,
    can_manage_vacations: member.can_manage_vacations,
    can_manage_tasks: member.can_manage_tasks,
    can_preview_tasks: member.can_preview_tasks,
    can_manage_cloud_files: member.can_manage_cloud_files,
    can_manage_members: member.can_manage_members,
  });
  const [memberJobs, setMemberJobs] = useState<TeamMemberJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobPick, setJobPick] = useState<JobTitle | ''>('');
  const [jobPriorityPick, setJobPriorityPick] = useState('1');
  const [customDefs, setCustomDefs] = useState<TeamCustomPermissionDef[]>([]);
  const [customGrants, setCustomGrants] = useState<TeamCustomPermissionGrant[]>([]);
  const [grantBusyId, setGrantBusyId] = useState<string | null>(null);

  const reloadCustomPerms = () => {
    Promise.all([listCustomPermissionDefs(teamId), listCustomPermissionGrants(teamId)]).then(([defs, grants]) => {
      setCustomDefs(defs);
      setCustomGrants(grants);
    });
  };
  useEffect(() => { reloadCustomPerms(); }, [teamId]);

  const handleToggleCustomGrant = async (def: TeamCustomPermissionDef, grant: TeamCustomPermissionGrant | undefined) => {
    if (!member.user_id) return;
    setGrantBusyId(def.id);
    const error = grant ? await revokeCustomPermission(grant.id) : await grantCustomPermission(teamId, def.id, member.user_id);
    setGrantBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not update permission', text: error }); return; }
    reloadCustomPerms();
  };

  const reloadJobs = () => {
    if (!member.user_id) { setJobsLoading(false); return; }
    listTeamMemberJobs(teamId).then(all => {
      setMemberJobs(all.filter(j => j.user_id === member.user_id));
      setJobsLoading(false);
    });
  };
  useEffect(() => { reloadJobs(); }, [teamId, member.user_id]);

  const availableJobPicks = JOB_TITLES.filter(j => !memberJobs.some(mj => mj.job_type === j));

  const handleAddJob = async () => {
    if (!jobPick || !member.user_id) return;
    const { error } = await adminSetMemberJob(teamId, member.user_id, jobPick, Number(jobPriorityPick) || 1);
    if (error) { swal({ icon: 'error', title: 'Could not set job', text: error }); return; }
    setJobPick(''); setJobPriorityPick('1');
    reloadJobs();
  };

  const handleRemoveJob = async (jobType: string) => {
    if (!member.user_id) return;
    const error = await adminRemoveMemberJob(teamId, member.user_id, jobType);
    if (error) { swal({ icon: 'error', title: 'Could not remove job', text: error }); return; }
    reloadJobs();
  };

  const handleChangeJobPriority = async (jobType: string, priorityValue: string) => {
    if (!member.user_id) return;
    const { error } = await adminSetMemberJob(teamId, member.user_id, jobType, Number(priorityValue) || 1);
    if (error) { swal({ icon: 'error', title: 'Could not update priority', text: error }); return; }
    reloadJobs();
  };
  const [saving, setSaving] = useState(false);

  const addCustomPerm = () => {
    const p = customPermInput.trim();
    if (p && !customPerms.includes(p)) setCustomPerms(prev => [...prev, p]);
    setCustomPermInput('');
  };

  const [verified, setVerified] = useState(member.is_verified);
  const [verifiedBusy, setVerifiedBusy] = useState(false);

  const handleToggleVerified = async (next: boolean) => {
    if (!member.user_id) return;
    setVerifiedBusy(true);
    const error = await setMemberVerified(teamId, member.user_id, next);
    setVerifiedBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not update', text: error }); return; }
    setVerified(next);
  };

  const handleSave = async () => {
    setSaving(true);
    const error = await updateMemberFields(member.id, {
      job_title: (jobTitle || null) as JobTitle | null,
      priority: priority ? Number(priority) : null,
      balance: Number(balance) || 0,
      custom_title: customTitle.trim() || null,
      custom_permissions: customPerms,
      ...perms,
    });
    setSaving(false);
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    swalToast({ icon: 'success', title: 'Member updated' });
    onSaved();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Edit Member" size="sm" footer={
      <Button className="w-full" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
    }>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Primary Job Title (display only)</label>
          <select value={jobTitle} onChange={e => setJobTitle(e.target.value as JobTitle)} className="w-full bg-ink/5 border border-hairline rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-accent">
            <option value="">Unassigned</option>
            {JOB_TITLES.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Balance ($)</label>
          <Input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Display title (e.g. "Bank Officer")</label>
          <Input value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="Optional" />
        </div>
        {isOwner && (
          <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-ink/5 border border-hairline">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-ink"><ShieldCheck size={13} className="text-accent" /> Verified</span>
            <Switch checked={verified} onChange={handleToggleVerified} disabled={verifiedBusy} />
          </div>
        )}

        <div className="space-y-1.5 pt-2 border-t border-hairline">
          <label className="text-xs text-accent font-semibold">Jobs &amp; Priorities</label>
          <p className="text-[10px] text-ink-faint -mt-0.5">Drives task auto-assignment. Priority 1 gets first offer for that job.</p>
          {!jobsLoading && memberJobs.map(j => (
            <div key={j.job_type} className="flex items-center gap-2 p-1.5 rounded-lg border border-hairline">
              <span className="text-xs font-semibold text-ink flex-1">{j.job_type}</span>
              <Input type="number" min={1} value={j.priority} onChange={e => handleChangeJobPriority(j.job_type, e.target.value)} className="w-16 text-xs" />
              <button onClick={() => handleRemoveJob(j.job_type)} aria-label={`Remove ${j.job_type}`} className="p-1 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors">
                <X size={12} />
              </button>
            </div>
          ))}
          {!jobsLoading && availableJobPicks.length > 0 && (
            <div className="flex gap-1.5">
              <select value={jobPick} onChange={e => setJobPick(e.target.value as JobTitle)} className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
                <option value="">Add a job...</option>
                {availableJobPicks.map(j => <option key={j} value={j}>{j}</option>)}
              </select>
              <Input type="number" min={1} placeholder="Priority" value={jobPriorityPick} onChange={e => setJobPriorityPick(e.target.value)} className="w-16 text-xs" />
              <Button type="button" variant="secondary" size="sm" onClick={handleAddJob}>Add</Button>
            </div>
          )}
        </div>

        {isOwner && member.role === 'leader' && (
          <div className="space-y-1.5 pt-2 border-t border-hairline">
            <label className="text-xs text-accent font-semibold">Sub-admin permissions</label>
            {PERM_TOGGLES.map(p => (
              <div key={p.key} className="flex items-center justify-between py-1">
                <span className="text-xs text-ink">{p.label}</span>
                <Switch checked={perms[p.key]} onChange={v => setPerms(prev => ({ ...prev, [p.key]: v }))} />
              </div>
            ))}
            <div className="pt-1.5 space-y-1.5">
              <label className="text-[11px] text-ink-muted">Custom permission tags</label>
              <div className="flex gap-2">
                <Input placeholder="e.g. can_edit_cloud" value={customPermInput} onChange={e => setCustomPermInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomPerm())} className="flex-1" />
                <Button type="button" variant="secondary" size="sm" onClick={addCustomPerm}>Add</Button>
              </div>
              {customPerms.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customPerms.map(p => (
                    <span key={p} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-ink/5 text-ink-muted flex items-center gap-1">
                      {p} <button type="button" onClick={() => setCustomPerms(prev => prev.filter(x => x !== p))} className="hover:text-danger">✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {customDefs.length > 0 && (
              <div className="pt-1.5 space-y-1.5">
                <label className="text-[11px] text-ink-muted">Team-defined permissions (enforced)</label>
                {customDefs.map(def => {
                  const grant = customGrants.find(g => g.def_id === def.id && g.user_id === member.user_id);
                  return (
                    <div key={def.id} className="flex items-center justify-between py-1">
                      <span className="text-xs text-ink">{def.label}</span>
                      <Switch checked={!!grant} onChange={() => handleToggleCustomGrant(def, grant)} disabled={grantBusyId === def.id} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function TeamRoster({
  team, members, isOwner, canManageMembers, canEditMemberDetails, onChanged,
}: {
  team: Team;
  members: TeamMember[];
  isOwner: boolean;
  canManageMembers: boolean;
  /** Owner, or a leader explicitly granted can_manage_members — separate from canManageMembers (invite/remove), gates the Edit Member dialog specifically. */
  canEditMemberDetails: boolean;
  onChanged: () => void;
}) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState(team.telegram_channel_id || '');
  const [savingChannel, setSavingChannel] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [reassignFrom, setReassignFrom] = useState<TeamMember | null>(null);
  const [badges, setBadges] = useState<TeamBadge[]>([]);
  useEffect(() => { listTeamBadges(team.id).then(setBadges); }, [team.id]);

  const handleSaveChannel = async () => {
    setSavingChannel(true);
    const error = await setTeamTelegramChannel(team.id, channelId.trim());
    setSavingChannel(false);
    if (error) { swal({ icon: 'error', title: 'Could not save channel', text: error }); return; }
    swalToast({ icon: 'success', title: 'Telegram channel saved' });
    onChanged();
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      swal({ icon: 'error', title: 'Email Required', text: 'Enter an email to invite.' });
      return;
    }
    setInviting(true);
    const error = await inviteMember(team.id, inviteEmail.trim());
    setInviting(false);
    if (error) {
      swal({ icon: 'error', title: 'Invite failed', text: error });
      return;
    }
    setInviteEmail('');
    swalToast({ icon: 'success', title: 'Invite sent' });
    onChanged();
  };

  const handlePromote = async (id: string) => {
    setBusyId(id);
    const error = await promoteToLeader(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not promote', text: error }); return; }
    swalToast({ icon: 'success', title: 'Promoted to leader' });
    onChanged();
  };

  const handleDemote = async (id: string) => {
    setBusyId(id);
    const error = await demoteToMember(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not demote', text: error }); return; }
    swalToast({ icon: 'success', title: 'Demoted to member' });
    onChanged();
  };

  const handleRemove = async (id: string) => {
    const result = await swal({
      icon: 'warning',
      title: 'Remove this member?',
      showCancelButton: true,
      confirmButtonText: 'Remove',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    setBusyId(id);
    const error = await removeMember(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not remove member', text: error }); return; }
    onChanged();
  };

  return (
    <GlassCard className="overflow-hidden">
      {editing && <EditMemberModal member={editing} teamId={team.id} isOwner={isOwner} onClose={() => setEditing(null)} onSaved={onChanged} />}
      {reassignFrom && (
        <ReassignTasksModal
          team={team}
          fromMember={reassignFrom}
          members={members.filter(m => m.id !== reassignFrom.id && m.status === 'active' && m.user_id)}
          onClose={() => setReassignFrom(null)}
          onDone={onChanged}
        />
      )}

      <div className="p-6 flex items-center gap-4 border-b border-hairline bg-ink/[0.02]">
        <div className="w-16 h-16 rounded-2xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
          {team.logo ? <img src={team.logo} alt={team.name} className="w-full h-full object-cover" /> : <Users size={22} className="text-accent" />}
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-ink font-display truncate">{team.name}</h3>
          <p className="text-xs font-semibold text-accent flex items-center gap-1 mt-0.5">
            {isOwner ? <ShieldCheck size={12} /> : <Crown size={12} />}
            {isOwner ? 'Admin' : 'Leader'}
          </p>
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {badges.map(b => (
                <span key={b.code} className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-accent-soft text-accent flex items-center gap-1"><Trophy size={9} /> {b.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-6 space-y-4">
        {canManageMembers && (
          <>
            <div className="flex gap-2">
              <Input placeholder="member@email.com" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="flex-1" />
              <Button onClick={handleInvite} disabled={inviting}>
                <Mail size={14} /> Invite
              </Button>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-accent font-semibold flex items-center gap-1"><Send size={12} /> Telegram Channel (for task attachments)</label>
              <div className="flex gap-2">
                <Input placeholder="@teamchannel or -100..." value={channelId} onChange={(e) => setChannelId(e.target.value)} className="flex-1" />
                <Button variant="secondary" onClick={handleSaveChannel} disabled={savingChannel}>Save</Button>
              </div>
            </div>
          </>
        )}

        <div className="space-y-2">
          {members.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No members yet.</p>}
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-hairline hover:border-accent/20 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-ink/5 border border-hairline shrink-0 flex items-center justify-center">
                  {m.profile?.avatar ? <img src={m.profile.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-ink-faint font-semibold">{(m.profile?.name || m.invited_email)[0]?.toUpperCase()}</span>}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink truncate flex items-center gap-1">
                    {m.profile?.name || m.invited_email}
                    {m.role === 'leader' && <Crown size={11} className="text-accent shrink-0" />}
                    {m.custom_title && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-accent-soft text-accent shrink-0">{m.custom_title}</span>}
                  </p>
                  <p className="text-[10px] text-ink-faint truncate">
                    {m.job_title || 'No job title'}{m.priority != null ? ` · P${m.priority}` : ''}
                    {m.member_status !== 'active' && ` · ${m.member_status.replace('_', ' ')}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.status === 'active' ? 'bg-accent-soft text-accent' : 'bg-ink/5 text-ink-faint'}`}>
                  {m.status === 'active' ? 'Active' : 'Pending'}
                </span>
                {canEditMemberDetails && m.status === 'active' && (
                  <button onClick={() => setEditing(m)} aria-label="Edit member" title="Edit member" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                    <Pencil size={13} />
                  </button>
                )}
                {isOwner && m.status === 'active' && (
                  m.role === 'leader' ? (
                    <button onClick={() => handleDemote(m.id)} disabled={busyId === m.id} aria-label="Demote to member" title="Demote to member" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                      <ArrowDownCircle size={14} />
                    </button>
                  ) : (
                    <button onClick={() => handlePromote(m.id)} disabled={busyId === m.id} aria-label="Promote to leader" title="Promote to leader" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                      <ArrowUpCircle size={14} />
                    </button>
                  )
                )}
                {canManageMembers && (m.member_status === 'on_leave' || m.member_status === 'resigned') && m.user_id && (
                  <button onClick={() => setReassignFrom(m)} aria-label="Reassign open tasks" title="Reassign open tasks" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
                    <ListTodo size={14} />
                  </button>
                )}
                {canManageMembers && (
                  <button onClick={() => handleRemove(m.id)} disabled={busyId === m.id} aria-label="Remove member" title="Remove member" className="p-1.5 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors">
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

function ReassignTasksModal({ team, fromMember, members, onClose, onDone }: {
  team: Team; fromMember: TeamMember; members: TeamMember[]; onClose: () => void; onDone: () => void;
}) {
  const [toUserId, setToUserId] = useState('');
  const [busy, setBusy] = useState(false);

  const handleReassign = async () => {
    if (!toUserId || !fromMember.user_id) return;
    setBusy(true);
    const { moved, error } = await reassignMemberTasks(team.id, fromMember.user_id, toUserId);
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not reassign', text: error }); return; }
    swalToast({ icon: 'success', title: `${moved} task${moved === 1 ? '' : 's'} reassigned` });
    onDone();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Reassign ${fromMember.profile?.name || fromMember.invited_email}'s open tasks`} size="sm" footer={
      <Button className="w-full" onClick={handleReassign} disabled={busy || !toUserId}>{busy ? 'Reassigning...' : 'Reassign'}</Button>
    }>
      <div className="space-y-2">
        <label className="text-xs text-accent font-semibold">Move to</label>
        <select
          value={toUserId}
          onChange={e => setToUserId(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-hairline bg-transparent text-sm text-ink"
        >
          <option value="">Select a member...</option>
          {members.map(m => (
            <option key={m.id} value={m.user_id!}>{m.profile?.name || m.invited_email}</option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Admin / Member section resolution (unchanged shape, now mounts TeamWorkspace)
// ---------------------------------------------------------------------------

function AdminTeamSection({ cc }: { cc: CloudClient }) {
  const { session } = useTeamAuth();
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamName, setTeamName] = useState('');
  const [logo, setLogo] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [payNote, setPayNote] = useState('');
  const [creating, setCreating] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    const owned = await getMyOwnedTeam();
    setTeam(owned);
    if (owned) setMembers(await listTeamMembers(owned.id));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = async () => {
    if (!teamName.trim()) {
      swal({ icon: 'error', title: 'Name Required', text: 'Give your team a name.' });
      return;
    }
    setCreating(true);
    let logoUrl = logo;
    if (logo.startsWith('data:') && session?.user.id) {
      const uploaded = await uploadImageToStorage(logo, `${session.user.id}/team-logo-${Date.now()}.jpg`);
      if (uploaded) logoUrl = uploaded;
    }
    const { team: created, error } = await createTeam({ name: teamName.trim(), logo: logoUrl, description: description.trim(), visibility, payNote: payNote.trim() });
    setCreating(false);
    if (error) {
      swal({ icon: 'error', title: 'Could not create team', text: error });
      return;
    }
    setTeam(created);
    swalToast({ icon: 'success', title: 'Team created' });
  };

  if (loading) {
    return (
      <SkeletonCard className="max-w-md h-72" />
    );
  }

  if (!team) {
    return (
      <GlassCard className="overflow-hidden max-w-md">
        <div className="p-6 border-b border-hairline bg-ink/[0.02] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/20 flex items-center justify-center shrink-0">
            <ShieldCheck size={18} className="text-accent" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-ink font-display">Create Your Team</h3>
            <p className="text-xs text-ink-muted mt-0.5">Set a name and logo to get started</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="w-16 h-16 rounded-2xl border border-dashed border-hairline bg-ink/5 flex items-center justify-center overflow-hidden shrink-0 hover:border-accent transition-colors"
            >
              {logo ? <img src={logo} alt="Logo" className="w-full h-full object-cover" /> : <ImagePlus size={18} className="text-ink-faint" />}
            </button>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readAvatarFile(f, setLogo); }} />
            <div className="flex-1 space-y-1">
              <label className="text-xs text-accent font-semibold">Team Name</label>
              <Input placeholder="e.g. Nightfall Scans" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-accent font-semibold">Description</label>
            <Textarea placeholder="What does this team work on?" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-accent font-semibold">Usual Pay</label>
            <Input placeholder="e.g. $10–20 per task" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl border border-hairline">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              {visibility === 'public' ? <Globe size={14} className="text-accent" /> : <Lock size={14} className="text-ink-faint" />}
              {visibility === 'public' ? 'Public — listed in the directory' : 'Private — join by ID only'}
            </div>
            <Switch checked={visibility === 'public'} onChange={v => setVisibility(v ? 'public' : 'private')} />
          </div>
          <Button onClick={handleCreate} disabled={creating} className="w-full">
            <Plus size={14} /> {creating ? 'Creating...' : 'Create Team'}
          </Button>
        </div>
      </GlassCard>
    );
  }

  return <TeamWorkspace team={team} members={members} isOwner myMember={null} canManage onChanged={refresh} cc={cc} />;
}

function MemberTeamSection({ cc }: { cc: CloudClient }) {
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<(TeamMember & { team: Team })[]>([]);
  const [membership, setMembership] = useState<(TeamMember & { team: Team }) | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<(TeamMember & { team: Team })[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const all = await listMyMemberships();
    setMemberships(all);
    const active = await getMyMembership();
    setMembership(active);
    if (active) {
      setMembers(await listTeamMembers(active.team_id));
    } else {
      setInvites(await getPendingInvitesForMe());
    }
    setLoading(false);
  };

  const handleSwitchTeam = async (teamId: string) => {
    await setActiveTeamId(teamId);
    await refresh();
  };

  useEffect(() => { refresh(); }, []);

  const handleAccept = async (id: string) => {
    setBusyId(id);
    const error = await acceptInvite(id);
    setBusyId(null);
    if (error) {
      swal({ icon: 'error', title: 'Could not accept invite', text: error });
      return;
    }
    swalToast({ icon: 'success', title: 'Joined team' });
    await refresh();
  };

  const handleDecline = async (id: string) => {
    setBusyId(id);
    const error = await declineInvite(id);
    setBusyId(null);
    if (error) {
      swal({ icon: 'error', title: 'Could not decline invite', text: error });
      return;
    }
    await refresh();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <SkeletonCard className="h-40" />
          <SkeletonCard className="h-40" />
        </div>
        <SkeletonCard className="h-52" />
      </div>
    );
  }

  if (membership) {
    const freshMe = members.find(m => m.id === membership.id) || membership;
    return (
      <div className="space-y-3">
        {memberships.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-muted">Team:</span>
            <select
              value={membership.team_id}
              onChange={e => handleSwitchTeam(e.target.value)}
              className="bg-ink/5 border border-hairline rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink outline-none focus:border-accent"
            >
              {memberships.map(m => <option key={m.team_id} value={m.team_id}>{m.team.name}</option>)}
            </select>
          </div>
        )}
        <TeamWorkspace
          team={membership.team}
          members={members}
          isOwner={false}
          myMember={freshMe}
          canManage={membership.role === 'leader'}
          onChanged={refresh}
          cc={cc}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {invites.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {invites.map(inv => (
            <GlassCard key={inv.id} className="overflow-hidden border-accent/30">
              <div className="p-5 flex items-center gap-3 bg-accent-soft">
                <div className="w-11 h-11 rounded-xl overflow-hidden bg-elevated border border-accent/30 shrink-0 flex items-center justify-center">
                  {inv.team?.logo ? <img src={inv.team.logo} alt={inv.team?.name || 'Team'} className="w-full h-full object-cover" /> : <Mail size={18} className="text-accent" />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-accent uppercase tracking-wide">Team Invitation</p>
                  <p className="text-sm font-semibold text-ink truncate">{inv.team?.name || 'Unknown team'}</p>
                </div>
              </div>
              <div className="p-4 flex gap-2">
                <Button onClick={() => handleAccept(inv.id)} disabled={busyId === inv.id} className="flex-1">
                  <Check size={14} /> Accept
                </Button>
                <Button variant="secondary" onClick={() => handleDecline(inv.id)} disabled={busyId === inv.id} className="flex-1">
                  <X size={14} /> Decline
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <TeamDirectory />
    </div>
  );
}

type TeamCategory = 'all' | 'active' | 'members' | 'popular' | 'pay';

const CATEGORY_TABS: { id: TeamCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Most Active' },
  { id: 'members', label: 'Most Members' },
  { id: 'popular', label: 'Most Popular' },
  { id: 'pay', label: 'Most Pay' },
];

function parsePayNote(note: string): number {
  const match = note.match(/[\d,.]+/);
  if (!match) return -1;
  const n = parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : -1;
}

function sortTeamsByCategory(teams: PublicTeamCard[], category: TeamCategory): PublicTeamCard[] {
  const copy = [...teams];
  switch (category) {
    case 'members':
      return copy.sort((a, b) => b.member_count - a.member_count);
    case 'active':
      // Backed by team_activity_log (chat/task/check-in events, last 7 days).
      return copy.sort((a, b) => b.activity_count - a.activity_count || b.member_count - a.member_count);
    case 'popular':
      // Approximation: popularity would ideally use join-request volume;
      // falls back to member count until a lightweight stats RPC exists.
      return copy.sort((a, b) => b.member_count - a.member_count);
    case 'pay':
      return copy.sort((a, b) => parsePayNote(b.pay_note || '') - parsePayNote(a.pay_note || ''));
    default:
      return copy;
  }
}

interface DirectoryPrefs { category: TeamCategory; search: string; tag: string }
const DIRECTORY_PREFS_KEY = 'teams_directory_prefs';

function loadDirectoryPrefs(): DirectoryPrefs {
  try {
    const raw = localStorage.getItem(DIRECTORY_PREFS_KEY);
    if (raw) return { category: 'all', search: '', tag: '', ...JSON.parse(raw) };
  } catch { /* ignore malformed prefs */ }
  return { category: 'all', search: '', tag: '' };
}

function PublicTeamLeaderboard() {
  const [rows, setRows] = useState<PublicTeamLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPublicTeamLeaderboard().then(r => { setRows(r); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <GlassCard className="overflow-hidden divide-y divide-hairline">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </GlassCard>
    );
  }
  if (rows.length === 0) return <GlassCard className="p-8 text-center"><p className="text-sm text-ink-muted">No leaderboard data yet.</p></GlassCard>;

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <GlassCard key={r.team_id} className="p-4 flex items-center gap-3">
          <span className="text-sm font-bold text-ink-faint w-6 text-center shrink-0">#{i + 1}</span>
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
            {r.team_logo ? <img src={r.team_logo} alt={r.team_name} className="w-full h-full object-cover" /> : <Users size={14} className="text-accent" />}
          </div>
          <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate">{r.team_name}</span>
          <span className="text-xs text-ink-faint shrink-0">{r.tasks_done} tasks done</span>
        </GlassCard>
      ))}
    </div>
  );
}

function CurrentSeasonLeaderboard() {
  const { isAdmin } = useTeamAuth();
  const [rows, setRows] = useState<SeasonLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);

  const refresh = () => { getCurrentSeasonLeaderboard().then(r => { setRows(r); setLoading(false); }); };
  useEffect(refresh, []);

  const handleCloseSeason = async () => {
    const result = await swal({
      icon: 'warning',
      title: 'Close the current season?',
      text: 'This locks in final standings, awards the champion badge, and starts a new season.',
      showCancelButton: true,
      confirmButtonText: 'Close Season',
    });
    if (!result.isConfirmed) return;
    setClosing(true);
    const error = await closeCurrentSeason();
    setClosing(false);
    if (error) { swal({ icon: 'error', title: 'Could not close season', text: error }); return; }
    swalToast({ icon: 'success', title: 'Season closed — a new one has started' });
    refresh();
  };

  if (loading) {
    return (
      <GlassCard className="overflow-hidden divide-y divide-hairline">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </GlassCard>
    );
  }

  return (
    <div className="space-y-2">
      {isAdmin && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={handleCloseSeason} disabled={closing}>{closing ? 'Closing...' : 'Close Season'}</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <GlassCard className="p-8 text-center"><p className="text-sm text-ink-muted">No season data yet.</p></GlassCard>
      ) : rows.map((r, i) => (
        <GlassCard key={r.team_id} className={`p-4 flex items-center gap-3 ${r.featured ? 'border-accent/40' : ''}`}>
          <span className="text-sm font-bold text-ink-faint w-6 text-center shrink-0">#{i + 1}</span>
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
            {r.team_logo ? <img src={r.team_logo} alt={r.team_name} className="w-full h-full object-cover" /> : <Users size={14} className="text-accent" />}
          </div>
          <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate flex items-center gap-1.5">
            {r.team_name}
            {r.featured && <Trophy size={12} className="text-accent" />}
          </span>
          <span className="text-xs text-ink-faint shrink-0">{r.tasks_done} tasks · {r.activity_score} activity</span>
        </GlassCard>
      ))}
    </div>
  );
}

function TeamDirectory() {
  const [teams, setTeams] = useState<PublicTeamCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinTarget, setJoinTarget] = useState<PublicTeamCard | { id: string; name: string } | null>(null);
  const [view, setView] = useState<'directory' | 'leaderboard' | 'season'>('directory');
  const initialPrefs = useRef(loadDirectoryPrefs()).current;
  const [category, setCategory] = useState<TeamCategory>(initialPrefs.category);
  const [search, setSearch] = useState(initialPrefs.search);
  const [tagFilter, setTagFilter] = useState(initialPrefs.tag);

  useEffect(() => {
    (async () => { setTeams(await listPublicTeams()); setLoading(false); })();
  }, []);

  useEffect(() => {
    localStorage.setItem(DIRECTORY_PREFS_KEY, JSON.stringify({ category, search, tag: tagFilter }));
  }, [category, search, tagFilter]);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard className="h-24" />
        <div className="grid sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  const allTags = Array.from(new Set(teams.flatMap(t => t.tags || []))).sort();
  let filteredTeams = teams;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filteredTeams = filteredTeams.filter(t => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
  }
  if (tagFilter) {
    filteredTeams = filteredTeams.filter(t => (t.tags || []).includes(tagFilter));
  }
  const sortedTeams = sortTeamsByCategory(filteredTeams, category);

  return (
    <div className="space-y-4">
      {joinTarget && <RequestJoinModal target={joinTarget} onClose={() => setJoinTarget(null)} />}

      <div className="flex justify-center gap-1.5">
        <button type="button" onClick={() => setView('directory')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${view === 'directory' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}>Directory</button>
        <button type="button" onClick={() => setView('leaderboard')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${view === 'leaderboard' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}><Trophy size={12} /> All-Time</button>
        <button type="button" onClick={() => setView('season')} className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 ${view === 'season' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}><Flame size={12} /> Season</button>
      </div>

      {view === 'leaderboard' ? <PublicTeamLeaderboard /> : view === 'season' ? <CurrentSeasonLeaderboard /> : (
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-sm font-semibold text-ink">Public Teams</h3>
          <Input placeholder="Search teams..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-[220px]" />
        </div>
        {allTags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-2">
            <button
              type="button"
              onClick={() => setTagFilter('')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                !tagFilter ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
              }`}
            >
              All Tags
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => setTagFilter(tag)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  tagFilter === tag ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end flex-wrap gap-2 mb-3">
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORY_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                  category === tab.id ? 'bg-accent text-white shadow-sm' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {sortedTeams.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <p className="text-sm text-ink-muted">No public teams yet.</p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sortedTeams.map(t => (
              <GlassCard key={t.id} className="stagger-item overflow-hidden flex flex-col w-full">
                {t.join_ad_url && (
                  <div className="w-full overflow-hidden border-b border-hairline bg-ink/[0.04] flex items-center justify-center">
                    <img src={t.join_ad_url} alt="" className="w-full max-h-56 object-contain" />
                  </div>
                )}
                <div className="p-4 flex items-center gap-3 border-b border-hairline bg-ink/[0.02]">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-accent-soft border border-hairline shrink-0 flex items-center justify-center">
                    {t.logo ? <img src={t.logo} alt={t.name} className="w-full h-full object-cover" /> : <Users size={20} className="text-accent" />}
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold text-ink truncate">{t.name}</p>
                    <p className="text-[10px] text-ink-faint">{t.member_count} member{t.member_count === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div className="p-4 space-y-2 text-left flex-1 flex flex-col">
                  {t.description && <p className="text-xs text-ink-muted line-clamp-2">{t.description}</p>}
                  {t.pay_note && <p className="text-xs font-semibold text-accent">{t.pay_note}</p>}
                  {t.tags && t.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {t.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-ink/5 text-ink-muted">{tag}</span>
                      ))}
                    </div>
                  )}
                  {t.badges && t.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {t.badges.map(b => (
                        <span key={b.code} className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-accent-soft text-accent flex items-center gap-1"><Trophy size={9} /> {b.label}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" className="w-full" onClick={() => setJoinTarget(t)}><UserPlus size={13} /> Request to Join</Button>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function RequestJoinModal({ target, onClose }: { target: { id: string; name: string }; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [jobTypes, setJobTypes] = useState<JobTitle[]>([]);
  const [sending, setSending] = useState(false);

  const toggleJob = (job: JobTitle) => {
    setJobTypes(prev => prev.includes(job) ? prev.filter(j => j !== job) : [...prev, job]);
  };

  const handleSend = async () => {
    setSending(true);
    const error = await requestToJoinTeam(target.id, message.trim(), jobTypes);
    setSending(false);
    if (error) { swal({ icon: 'error', title: 'Could not send request', text: error }); return; }
    swalToast({ icon: 'success', title: 'Join request sent' });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Request to join ${target.name}`} size="sm" footer={
      <Button className="w-full" onClick={handleSend} disabled={sending}>{sending ? 'Sending...' : 'Send Request'}</Button>
    }>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs text-accent font-semibold">Which job(s) are you applying for?</label>
          <div className="flex flex-wrap gap-1.5">
            {JOB_TITLES.map(job => (
              <button
                key={job}
                type="button"
                onClick={() => toggleJob(job)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  jobTypes.includes(job) ? 'bg-accent text-white border-accent' : 'bg-ink/5 border-hairline text-ink-muted hover:bg-ink/10'
                }`}
              >
                {job}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-ink-faint">If accepted, you'll be given priority for whichever job(s) you pick here.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Message (optional letter to the admin)</label>
          <Textarea placeholder="Tell them a bit about yourself..." value={message} onChange={e => setMessage(e.target.value)} rows={4} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function formatDue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_LABEL: Record<Task['status'], string> = {
  todo: 'Offered',
  in_progress: 'In Progress',
  under_review: 'Under Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: 'bg-danger text-white',
  high: 'bg-orange-500 text-white',
  normal: 'bg-ink/10 text-ink-muted',
  low: 'bg-ink/5 text-ink-faint',
};

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function TaskAttachmentControl({ task, team, cc, onChanged }: { task: Task; team: Team; cc: CloudClient; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const { session } = useTeamAuth();
  const myUserId = session?.user.id;

  const reload = () => { listTaskAttachments(task.id).then(setAttachments); };
  useEffect(reload, [task.id]);

  const submission = attachments.find(a => a.kind === 'submission');

  const handleAttach = async (file: File) => {
    if (!team.telegram_channel_id) {
      swal({ icon: 'error', title: 'No Channel Set', text: 'Ask your leader to set the team Telegram channel first.' });
      return;
    }
    setBusy(true);
    const result = await cc.uploadTaskAttachment(team.telegram_channel_id, file);
    if (result) {
      await attachFileToTask(task.id, result, 'submission');
      await submitTask(task.id, 'file', result.name);
      await upsertCloudFileMeta({ teamId: team.id, channelMsgId: result.msgId, folderMsgId: null, uploaderUserId: myUserId, isTaskSubmission: true });
      if (task.creator_id && task.creator_id !== myUserId) notify(task.creator_id, 'Task submitted', `"${task.title}" was submitted: ${result.name}`);
    }
    setBusy(false);
    if (result) { swalToast({ icon: 'success', title: 'File submitted' }); reload(); onChanged(); }
  };

  const handleDownload = (a: TaskAttachment) => {
    cc.downloadTaskAttachment(team.telegram_channel_id, a.msg_id, a.name);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {task.attachment_msg_id && (
        <button onClick={() => cc.downloadTaskAttachment(team.telegram_channel_id, task.attachment_msg_id!, task.attachment_name || 'attachment')} className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold">
          <Paperclip size={11} /> {task.attachment_name || 'Reference'}
        </button>
      )}
      {attachments.map(a => (
        <button key={a.id} onClick={() => handleDownload(a)} className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold">
          <Paperclip size={11} /> {a.kind === 'reference' ? 'Reference: ' : ''}{a.name}
        </button>
      ))}
      {!submission && (
        <>
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttach(f); }} />
          <button
            onClick={() => cc.isConnected ? fileInputRef.current?.click() : swal({ icon: 'info', title: 'Connect Telegram', text: 'Connect your Telegram account in Cloud Storage to attach files.' })}
            disabled={busy}
            className="text-[11px] text-ink-faint hover:text-accent flex items-center gap-1 font-semibold"
            title={cc.isConnected ? 'Submit a file' : 'Connect Telegram in Cloud Storage first'}
          >
            <Paperclip size={11} /> {busy ? 'Uploading...' : 'Submit file'}
          </button>
        </>
      )}
    </div>
  );
}

function SubmitLinkControl({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const { session } = useTeamAuth();
  const myUserId = session?.user.id;

  const handleSubmit = async () => {
    if (!link.trim().startsWith('http')) {
      swal({ icon: 'error', title: 'Invalid link', text: 'Link must start with http:// or https://' });
      return;
    }
    setBusy(true);
    const error = await submitTask(task.id, 'link', link.trim());
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not submit', text: error }); return; }
    if (task.creator_id && task.creator_id !== myUserId) notify(task.creator_id, 'Task submitted', `"${task.title}" was submitted: ${link.trim()}`);
    swalToast({ icon: 'success', title: 'Link submitted' });
    onChanged();
  };

  return (
    <div className="flex gap-1.5 mt-1">
      <Input placeholder="https://..." value={link} onChange={e => setLink(e.target.value)} className="!py-1.5 !text-[11px] flex-1" />
      <Button size="sm" onClick={handleSubmit} disabled={busy}><LinkIcon size={11} /></Button>
    </div>
  );
}

function RateSubmissionControl({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [rating, setRating] = useState(5);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState('');

  const handleApprove = async () => {
    setBusy(true);
    const error = await approveTask(task.id, rating);
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not approve', text: error }); return; }
    if (task.assignee_id) notify(task.assignee_id, 'Task approved', `"${task.title}" was approved — reward paid.`);
    swalToast({ icon: 'success', title: `Approved · reward paid` });
    onChanged();
  };

  const handleReject = async () => {
    if (!notes.trim()) { swal({ icon: 'error', title: 'Notes required', text: 'Explain what needs to change.' }); return; }
    setBusy(true);
    const error = await rejectSubmission(task.id, notes.trim());
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not reject', text: error }); return; }
    if (task.assignee_id) notify(task.assignee_id, 'Submission sent back', `"${task.title}" needs changes: ${notes.trim()}`);
    swalToast({ icon: 'success', title: 'Sent back for revision' });
    onChanged();
  };

  const handleMarkUnsuccessful = async () => {
    const result = await swal({
      icon: 'warning',
      title: 'Mark this task unsuccessful?',
      text: 'This is final — the task is closed out as unsuccessful rather than sent back for revision.',
      input: 'text',
      inputLabel: 'Reason (optional)',
      showCancelButton: true,
      confirmButtonText: 'Mark Unsuccessful',
    });
    if (!result.isConfirmed) return;
    setBusy(true);
    const error = await markTaskUnsuccessful(task.id, result.value || undefined);
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not update task', text: error }); return; }
    swalToast({ icon: 'success', title: 'Task marked unsuccessful' });
    onChanged();
  };

  if (rejecting) {
    return (
      <div className="flex gap-1.5 mt-1">
        <Input placeholder="Revision notes..." value={notes} onChange={e => setNotes(e.target.value)} className="!py-1.5 !text-[11px] flex-1" />
        <Button size="sm" variant="danger" onClick={handleReject} disabled={busy}>Send</Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <select value={rating} onChange={e => setRating(Number(e.target.value))} className="bg-ink/5 border border-hairline rounded-lg px-1.5 py-1 text-[11px] outline-none">
        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
      </select>
      <Button size="sm" onClick={handleApprove} disabled={busy}><ThumbsUp size={11} /></Button>
      <Button size="sm" variant="secondary" onClick={() => setRejecting(true)} disabled={busy} title="Send back for revision"><ThumbsDown size={11} /></Button>
      <Button size="sm" variant="danger" onClick={handleMarkUnsuccessful} disabled={busy} title="Mark unsuccessful (final)">✕</Button>
    </div>
  );
}

function TasksSection({ team, members, canManageTasks, canReviewTasks, canPreviewTasks, myMember, cc }: { team: Team; members: TeamMember[]; canManageTasks: boolean; canReviewTasks: boolean; canPreviewTasks: boolean; myMember: TeamMember | null; cc: CloudClient }) {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [reward, setReward] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{ msgId: number; name: string; size: number } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [sortBy, setSortBy] = useState<'created' | 'due' | 'priority'>('created');
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [assignMode, setAssignMode] = useState<'auto' | 'manual'>('auto');
  const [assigneeId, setAssigneeId] = useState('');
  const [offerExpiresAt, setOfferExpiresAt] = useState('');

  useEffect(() => { if (canManageTasks) listTemplates(team.id).then(setTemplates); }, [team.id, canManageTasks]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find(x => x.id === id);
    if (!t) return;
    setTitle(t.title); setDescription(t.description); setJobTypes(t.job_types);
    setReward(t.reward != null ? String(t.reward) : ''); setPriority(t.priority); setTags(t.tags);
  };

  const handleSaveTemplate = async () => {
    if (!title.trim()) { swal({ icon: 'error', title: 'Add a title first' }); return; }
    const { value: name } = await swal({ title: 'Template name', input: 'text', showCancelButton: true });
    if (!name) return;
    const error = await saveAsTemplate({ teamId: team.id, name, title: title.trim(), description: description.trim(), jobTypes, reward: reward ? Number(reward) : null, priority, tags });
    if (error) { swal({ icon: 'error', title: 'Could not save template', text: error }); return; }
    swalToast({ icon: 'success', title: 'Template saved' });
    listTemplates(team.id).then(setTemplates);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  };

  const handleAttachReference = async (file: File) => {
    if (!team.telegram_channel_id) {
      swal({ icon: 'error', title: 'No Channel Set', text: 'Set the team Telegram channel first.' });
      return;
    }
    if (!cc.isConnected) {
      swal({ icon: 'info', title: 'Connect Telegram', text: 'Connect your Telegram account in Cloud Storage to attach files.' });
      return;
    }
    setAttaching(true);
    const result = await cc.uploadTaskAttachment(team.telegram_channel_id, file);
    setAttaching(false);
    if (result) {
      setAttachment(result);
      await upsertCloudFileMeta({ teamId: team.id, channelMsgId: result.msgId, folderMsgId: null, uploaderUserId: myMember?.user_id ?? null, isTaskSubmission: true });
    }
  };

  const refresh = async () => {
    setLoading(true);
    await expireStaleOffers(team.id);
    await notifyUpcomingTaskDeadlines(team.id);
    if (canManageTasks) await spawnRecurringTasks(team.id);
    setTasks((canManageTasks || canPreviewTasks) ? await listTeamTasks(team.id) : await listMyTasks(team.id));
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.id, canManageTasks, canPreviewTasks]);

  const toggleJobType = (job: string) => {
    setJobTypes(prev => prev.includes(job) ? prev.filter(j => j !== job) : [...prev, job]);
  };

  const handleCreate = async () => {
    if (!title.trim() || jobTypes.length === 0) {
      swal({ icon: 'error', title: 'Missing details', text: 'Give the task a title and pick at least one job type.' });
      return;
    }
    if (assignMode === 'manual' && !assigneeId) {
      swal({ icon: 'error', title: 'Pick an assignee', text: 'Choose a member or switch back to auto-assign.' });
      return;
    }
    setCreating(true);
    const mentionedUserIds = parseMentions(description, members);
    const error = await createTaskWithWorkflow({
      teamId: team.id, title: title.trim(), description: description.trim(),
      jobTypes, dueDate: dueDate || null, reward: reward ? Number(reward) : undefined,
      attachment: attachment ?? undefined, priority, tags, recurrence,
      assigneeId: assignMode === 'manual' ? assigneeId : null,
      offerExpiresAt: offerExpiresAt ? new Date(offerExpiresAt).toISOString() : null,
      mentionedUserIds,
    });
    setCreating(false);
    if (error) { swal({ icon: 'error', title: 'Could not create task', text: error }); return; }
    setTitle(''); setDescription(''); setJobTypes([]); setDueDate(''); setReward(''); setAttachment(null); setPriority('normal'); setTags([]); setTagInput(''); setTemplateId(''); setRecurrence('none'); setAssignMode('auto'); setAssigneeId(''); setOfferExpiresAt('');
    swalToast({ icon: 'success', title: assignMode === 'manual' ? 'Task created and assigned' : 'Task created and auto-assigned' });
    refresh();
  };

  const withBusy = (id: string, fn: () => Promise<string | null>, successTitle: string) => async () => {
    setBusyId(id);
    const error = await fn();
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    swalToast({ icon: 'success', title: successTitle });
    refresh();
  };

  let filteredTasks = tasks;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filteredTasks = filteredTasks.filter(t => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.tags?.some(tag => tag.toLowerCase().includes(q)));
  }
  if (statusFilter !== 'all') filteredTasks = filteredTasks.filter(t => t.status === statusFilter);
  if (priorityFilter !== 'all') filteredTasks = filteredTasks.filter(t => t.priority === priorityFilter);
  filteredTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === 'due') return (a.due_date ? new Date(a.due_date).getTime() : Infinity) - (b.due_date ? new Date(b.due_date).getTime() : Infinity);
    if (sortBy === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const handleDelete = async (id: string) => {
    const result = await swal({ icon: 'warning', title: 'Delete this task?', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    setBusyId(id);
    const error = await deleteTask(id);
    setBusyId(null);
    if (error) { swal({ icon: 'error', title: 'Could not delete task', text: error }); return; }
    refresh();
  };

  if (loading) {
    return (
      <GlassCard className="overflow-hidden divide-y divide-hairline">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </GlassCard>
    );
  }

  return (
    <GlassCard className="overflow-hidden">
      <div className="p-6 border-b border-hairline bg-ink/[0.02] flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/20 flex items-center justify-center shrink-0">
          <ListTodo size={18} className="text-accent" />
        </div>
        <div>
          <h3 className="text-base font-display font-semibold text-ink">{canManageTasks ? 'Tasks' : canPreviewTasks ? 'Team Tasks (Preview)' : 'My Tasks'}</h3>
          <p className="text-xs text-ink-muted mt-0.5">{canManageTasks ? 'Create and route work across the team' : canPreviewTasks ? 'View-only — everyone\'s tasks across the team' : 'Offered, in progress, and awaiting review'}</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {canManageTasks && (
          <div className="space-y-2 pb-4 border-b border-hairline">
            {templates.length > 0 && (
              <select value={templateId} onChange={e => applyTemplate(e.target.value)} className="w-full text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
                <option value="">Start from a template...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            <div className="flex flex-wrap gap-1.5">
              {JOB_TITLES.map(job => (
                <button
                  key={job}
                  type="button"
                  onClick={() => toggleJobType(job)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${jobTypes.includes(job) ? 'bg-accent text-white border-accent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}
                >
                  {job}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-semibold text-ink-faint uppercase tracking-wide px-1">Deadline</label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <Input type="number" step="0.01" placeholder="Reward ($, optional)" value={reward} onChange={(e) => setReward(e.target.value)} className="mt-auto" />
            </div>
            <div>
              <label className="text-[9px] font-semibold text-ink-faint uppercase tracking-wide px-1">Offer expiry (auto-decline if unaccepted)</label>
              <Input type="datetime-local" value={offerExpiresAt} onChange={(e) => setOfferExpiresAt(e.target.value)} />
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setAssignMode('auto')} className={`flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg border transition-colors ${assignMode === 'auto' ? 'bg-accent text-white border-accent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}>Auto-assign</button>
              <button type="button" onClick={() => setAssignMode('manual')} className={`flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg border transition-colors ${assignMode === 'manual' ? 'bg-accent text-white border-accent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}>Choose member</button>
            </div>
            {assignMode === 'manual' && (
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className="w-full text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
                <option value="">Select a member...</option>
                {members.filter(m => m.status === 'active' && m.user_id).map(m => (
                  <option key={m.id} value={m.user_id!}>{m.profile?.name || m.invited_email}</option>
                ))}
              </select>
            )}
            <div className="flex flex-wrap gap-1.5">
              {(['low', 'normal', 'high', 'urgent'] as TaskPriority[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors capitalize ${priority === p ? PRIORITY_COLORS[p] + ' border-transparent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <select value={recurrence} onChange={e => setRecurrence(e.target.value as typeof recurrence)} className="w-full text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="none">Does not repeat</option>
              <option value="daily">Repeats daily</option>
              <option value="weekly">Repeats weekly</option>
              <option value="monthly">Repeats monthly</option>
            </select>
            <div className="flex gap-2">
              <Input placeholder="Add a tag..." value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} className="flex-1" />
              <Button type="button" variant="secondary" size="sm" onClick={addTag}>Add</Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => (
                  <span key={t} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-ink/5 text-ink-muted flex items-center gap-1">
                    {t} <button type="button" onClick={() => setTags(prev => prev.filter(x => x !== t))} className="hover:text-danger">✕</button>
                  </span>
                ))}
              </div>
            )}
            <input ref={attachmentInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAttachReference(f); }} />
            {attachment ? (
              <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted px-1">
                <span className="flex items-center gap-1 truncate"><Paperclip size={11} /> {attachment.name}</span>
                <button type="button" onClick={() => setAttachment(null)} className="text-ink-faint hover:text-danger shrink-0">Remove</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={attaching}
                className="text-[11px] text-ink-faint hover:text-accent flex items-center gap-1 font-semibold px-1"
              >
                <Paperclip size={11} /> {attaching ? 'Uploading...' : 'Attach reference file (optional)'}
              </button>
            )}
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={creating} className="flex-1">
                <Plus size={14} /> {creating ? 'Creating...' : 'Create Task'}
              </Button>
              <Button variant="secondary" onClick={handleSaveTemplate} disabled={creating}>Save as Template</Button>
            </div>
          </div>
        )}

        <div className="space-y-2 pb-3 border-b border-hairline">
          <Input placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="flex flex-wrap gap-1.5 items-center">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as TaskStatus | 'all')} className="text-[11px] px-2 py-1 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as TaskPriority | 'all')} className="text-[11px] px-2 py-1 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="all">All priorities</option>
              {(['urgent', 'high', 'normal', 'low'] as TaskPriority[]).map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as 'created' | 'due' | 'priority')} className="text-[11px] px-2 py-1 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="created">Sort: Newest</option>
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1.5 -mt-1">
          <button type="button" onClick={() => setViewMode('list')} className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-accent-soft hover:text-accent'}`}>List</button>
          <button type="button" onClick={() => setViewMode('board')} className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${viewMode === 'board' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-accent-soft hover:text-accent'}`}>Board</button>
        </div>

        {(() => {
          const renderTaskCard = (t: Task) => {
            const isMine = myMember && t.assignee_id === myMember.user_id;
            return (
              <div key={t.id} className={`p-3 rounded-xl border transition-colors ${t.status === 'done' || t.status === 'cancelled' ? 'border-hairline bg-ink/[0.02]' : 'border-hairline hover:border-accent/20'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className={`text-sm font-semibold truncate ${t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.title}</p>
                      {t.priority !== 'normal' && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>}
                    </div>
                    {t.description && <p className="text-xs text-ink-muted mt-0.5 whitespace-pre-line">{t.description}</p>}
                    <p className="text-[10px] text-ink-faint mt-1 flex flex-wrap items-center gap-x-2">
                      {(canManageTasks || canPreviewTasks) && <span>{t.assignee?.name || 'Unassigned'}</span>}
                      {t.reward != null && <span>${t.reward}</span>}
                      {t.job_types?.length === 1 && <span>{t.job_types[0]}</span>}
                    </p>
                    {t.job_types?.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1 mt-1.5">
                        {t.job_types.map((job, i) => (
                          <span key={job} className="flex items-center gap-1">
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              i < t.stage_index ? 'bg-success/15 text-success'
                              : i === t.stage_index ? 'bg-accent text-white'
                              : 'bg-ink/5 text-ink-faint'
                            }`}>{job}</span>
                            {i < t.job_types.length - 1 && <span className="text-ink-faint text-[9px]">→</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    {t.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.tags.map(tag => <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-ink/5 text-ink-faint">{tag}</span>)}
                      </div>
                    )}
                  </div>
                  {canManageTasks && (
                    <button onClick={() => handleDelete(t.id)} disabled={busyId === t.id} aria-label="Delete task" className="p-1.5 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition-colors shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-hairline">
                  <div className="flex items-center gap-3">
                    {t.due_date && (
                      <span className="text-[10px] text-ink-faint flex items-center gap-1"><CalendarClock size={11} /> {formatDue(t.due_date)}</span>
                    )}
                    <span className="text-[10px] font-semibold text-ink-faint">
                      {t.status === 'todo' ? 'Pending' : STATUS_LABEL[t.status]}
                      {t.status === 'todo' && t.offer_expires_at && <span className="text-ink-faint font-normal"> · offer expires {formatDue(t.offer_expires_at)}</span>}
                      {t.status === 'cancelled' && t.last_outcome === 'unsuccessful' && <span className="text-danger font-normal"> · unsuccessful</span>}
                    </span>
                    {t.status !== 'todo' && <TaskAttachmentControl task={t} team={team} cc={cc} onChanged={refresh} />}
                    {t.status === 'todo' && t.attachment_msg_id && (
                      <button onClick={() => cc.downloadTaskAttachment(team.telegram_channel_id, t.attachment_msg_id!, t.attachment_name || 'attachment')} className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold">
                        <Paperclip size={11} /> {t.attachment_name || 'Reference'}
                      </button>
                    )}
                  </div>
                  {t.status === 'done' && (
                    <span className="text-[10px] font-semibold text-success flex items-center gap-1"><Check size={11} /> {t.rating ? `${t.rating}★` : 'Done'}</span>
                  )}
                </div>

                {!canManageTasks && isMine && t.status === 'todo' && (
                  <div className="flex gap-1.5 mt-2">
                    <Button size="sm" onClick={withBusy(t.id, () => acceptTask(t.id), 'Task accepted')} disabled={busyId === t.id} className="flex-1">Accept</Button>
                    <Button size="sm" variant="secondary" onClick={withBusy(t.id, () => declineTask(t.id), 'Task passed on')} disabled={busyId === t.id} className="flex-1">Decline</Button>
                  </div>
                )}
                {!canManageTasks && isMine && t.status === 'in_progress' && (
                  <SubmitLinkControl task={t} onChanged={refresh} />
                )}
                {canReviewTasks && t.status === 'under_review' && (
                  <RateSubmissionControl task={t} onChanged={refresh} />
                )}

                <button
                  onClick={() => setExpandedId(id => id === t.id ? null : t.id)}
                  className="text-[10px] text-ink-faint hover:text-accent font-semibold mt-2"
                >
                  {expandedId === t.id ? 'Hide details' : 'Checklist, comments & history'}
                </button>
                {expandedId === t.id && <TaskDetailPanel task={t} canManage={canManageTasks || !!isMine} allTasks={tasks} />}
              </div>
            );
          };

          if (viewMode === 'list') {
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {filteredTasks.length === 0 && <p className="text-xs text-ink-faint text-center py-3 lg:col-span-2">{canManageTasks ? 'No tasks match.' : 'No tasks assigned to you.'}</p>}
                {filteredTasks.map(renderTaskCard)}
              </div>
            );
          }

          const columns: { status: TaskStatus; label: string }[] = [
            { status: 'todo', label: STATUS_LABEL.todo },
            { status: 'in_progress', label: STATUS_LABEL.in_progress },
            { status: 'under_review', label: STATUS_LABEL.under_review },
            { status: 'done', label: STATUS_LABEL.done },
          ];
          return (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {columns.map(col => {
                const colTasks = filteredTasks.filter(t => t.status === col.status);
                return (
                  <div key={col.status} className="w-72 shrink-0 space-y-2">
                    <p className="text-[11px] font-bold text-ink-faint uppercase tracking-wide px-1">{col.label} · {colTasks.length}</p>
                    <div className="space-y-2 min-h-[40px]">
                      {colTasks.map(renderTaskCard)}
                      {colTasks.length === 0 && <p className="text-[11px] text-ink-faint px-1">No tasks</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </GlassCard>
  );
}

function TaskDetailPanel({ task, canManage, allTasks }: { task: Task; canManage: boolean; allTasks: Task[] }) {
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [timeEntries, setTimeEntries] = useState<TaskTimeEntry[]>([]);
  const [openEntry, setOpenEntry] = useState<TaskTimeEntry | null>(null);
  const [, forceTick] = useState(0);
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [depPick, setDepPick] = useState('');

  const reload = () => {
    listChecklistItems(task.id).then(setChecklist);
    listTaskComments(task.id).then(setComments);
    listTaskHistory(task.id).then(setHistory);
    listTimeEntries(task.id).then(setTimeEntries);
    getMyOpenTimeEntry(task.id).then(setOpenEntry);
    listDependencies(task.id).then(rows => setDependsOn(rows.map(r => r.depends_on_task_id)));
  };

  const handleAddDependency = async () => {
    if (!depPick) return;
    await addDependency(task.id, depPick);
    setDepPick('');
    reload();
  };
  useEffect(() => {
    reload();
    const unsubscribe = subscribeToTaskComments(task.id, c => setComments(prev => upsertById(prev, c)));
    return unsubscribe;
  }, [task.id]);

  useEffect(() => {
    if (!openEntry) return;
    const interval = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [openEntry]);

  const handleToggleTimer = async () => {
    if (openEntry) {
      await stopTimer(openEntry.id);
    } else {
      await startTimer(task.id);
    }
    reload();
  };

  const formatDuration = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  };

  const handleAddItem = async () => {
    if (!newItem.trim()) return;
    await addChecklistItem(task.id, newItem.trim(), checklist.length);
    setNewItem('');
    reload();
  };

  const handlePostComment = async () => {
    if (!commentBody.trim()) return;
    await postTaskComment(task.id, commentBody.trim());
    setCommentBody('');
  };

  const done = checklist.filter(c => c.done).length;

  return (
    <div className="mt-2 pt-2 border-t border-hairline space-y-3">
      <div>
        <p className="text-[10px] font-semibold text-accent mb-1">Checklist {checklist.length > 0 && `(${done}/${checklist.length})`}</p>
        <div className="space-y-1">
          {checklist.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              <input type="checkbox" checked={item.done} onChange={e => { toggleChecklistItem(item.id, e.target.checked); reload(); }} className="accent-[var(--color-accent)]" />
              <span className={`text-xs flex-1 ${item.done ? 'line-through text-ink-faint' : 'text-ink'}`}>{item.label}</span>
              {canManage && <button onClick={() => { deleteChecklistItem(item.id); reload(); }} className="text-ink-faint hover:text-danger text-xs">✕</button>}
            </div>
          ))}
        </div>
        {canManage && (
          <div className="flex gap-1.5 mt-1.5">
            <Input placeholder="Add checklist item..." value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddItem()} className="flex-1 text-xs" />
            <Button size="sm" variant="secondary" onClick={handleAddItem}>Add</Button>
          </div>
        )}
      </div>

      <div>
        <p className="text-[10px] font-semibold text-accent mb-1">Comments</p>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {comments.map(c => (
            <div key={c.id} className="flex items-start gap-1.5">
              <ChatAvatar name={c.author?.name || 'Member'} avatar={c.author?.avatar} size={18} />
              <div className="min-w-0"><span className="text-[10px] font-semibold text-accent">{c.author?.name}</span> <span className="text-xs text-ink">{c.body}</span></div>
            </div>
          ))}
          {comments.length === 0 && <p className="text-[10px] text-ink-faint">No comments yet.</p>}
        </div>
        <div className="flex gap-1.5 mt-1.5">
          <Input placeholder="Add a comment..." value={commentBody} onChange={e => setCommentBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && handlePostComment()} className="flex-1 text-xs" />
          <Button size="sm" variant="secondary" onClick={handlePostComment}>Post</Button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-accent">Time Tracked: {formatDuration(totalTrackedMs(timeEntries))}</p>
          <Button size="sm" variant={openEntry ? 'danger' : 'secondary'} onClick={handleToggleTimer}>{openEntry ? 'Stop Timer' : 'Start Timer'}</Button>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-accent mb-1">Depends On</p>
        <div className="space-y-1">
          {dependsOn.map(id => {
            const dep = allTasks.find(t => t.id === id);
            return (
              <div key={id} className="flex items-center justify-between text-xs">
                <span className={dep?.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}>{dep?.title || 'Unknown task'}</span>
                {canManage && <button onClick={() => { removeDependency(task.id, id); reload(); }} className="text-ink-faint hover:text-danger">✕</button>}
              </div>
            );
          })}
          {dependsOn.length === 0 && <p className="text-[10px] text-ink-faint">No dependencies.</p>}
        </div>
        {canManage && (
          <div className="flex gap-1.5 mt-1.5">
            <select value={depPick} onChange={e => setDepPick(e.target.value)} className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
              <option value="">Select a task...</option>
              {allTasks.filter(t => t.id !== task.id && !dependsOn.includes(t.id)).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <Button size="sm" variant="secondary" onClick={handleAddDependency}>Add</Button>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-accent mb-1">History</p>
          <div className="space-y-0.5">
            {history.map(h => (
              <p key={h.id} className="text-[10px] text-ink-faint">{new Date(h.created_at).toLocaleString()} · {h.event}{h.detail ? ` — ${h.detail}` : ''}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

function BankTab({ team, members, myMember, canManageBank: canManage }: { team: Team; members: TeamMember[]; myMember: TeamMember | null; canManageBank: boolean }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const [tx, wd] = await Promise.all([
      listTransactions(team.id, myMember?.user_id || undefined),
      canManage ? listPendingWithdrawals(team.id) : Promise.resolve([]),
    ]);
    setTransactions(tx);
    setWithdrawals(wd);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.id, canManage]);

  const otherMembers = members.filter(m => m.status === 'active' && m.user_id && m.user_id !== myMember?.user_id);

  const run = async (fn: () => Promise<string | null>, successTitle: string) => {
    if (!amount || Number(amount) <= 0) { swal({ icon: 'error', title: 'Enter a valid amount' }); return; }
    const ok = await confirmAction(`Confirm: ${successTitle.replace(/ (sent|applied|requested)$/, '')} of $${amount}`);
    if (!ok) return;
    setBusy(true);
    const error = await fn();
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    swalToast({ icon: 'success', title: successTitle });
    setAmount(''); setDetails('');
    refresh();
  };

  const handleWithdrawalDecision = async (id: string, approve: boolean) => {
    const ok = await confirmAction(`Confirm: ${approve ? 'approve' : 'reject'} this withdrawal`);
    if (!ok) return;
    const error = await decideWithdrawal(id, approve);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    refresh();
  };

  if (loading) {
    return (
      <div className="grid lg:grid-cols-2 gap-4">
        <SkeletonCard className="h-64" />
        <SkeletonCard className="h-64" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(myMember || canManage) && (
        <GlassCard className="p-6 space-y-3">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><PiggyBank size={16} className="text-accent" /> {canManage ? 'Team Treasury' : 'Send / Withdraw'}</h3>

          {otherMembers.length > 0 && (
            <select value={targetId} onChange={e => setTargetId(e.target.value)} className="w-full bg-ink/5 border border-hairline rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-accent">
              <option value="">Select member...</option>
              {otherMembers.map(m => <option key={m.id} value={m.user_id!}>{m.profile?.name || m.invited_email}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="0.01" placeholder="Amount ($)" value={amount} onChange={e => setAmount(e.target.value)} />
            <Input placeholder="Note" value={details} onChange={e => setDetails(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2">
            {canManage && (
              <>
                <Button size="sm" disabled={busy || !targetId} onClick={() => run(() => deposit(team.id, targetId, Number(amount), details), 'Deposit sent')}>Deposit</Button>
                <Button size="sm" variant="danger" disabled={busy || !targetId} onClick={() => run(() => penalize(team.id, targetId, Number(amount), details), 'Penalty applied')}>Penalize</Button>
              </>
            )}
            {myMember && (
              <>
                <Button size="sm" variant="secondary" disabled={busy || !targetId} onClick={() => run(() => transfer(team.id, targetId, Number(amount), details), 'Transfer sent')}>Transfer</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => requestWithdrawal(team.id, Number(amount)), 'Withdrawal requested')}>Request withdrawal</Button>
              </>
            )}
          </div>
        </GlassCard>
      )}

      {canManage && withdrawals.length > 0 && (
        <GlassCard className="p-6 space-y-2">
          <h3 className="text-sm font-semibold text-ink">Pending Withdrawals</h3>
          {withdrawals.map(w => (
            <div key={w.id} className="flex items-center justify-between p-2.5 rounded-xl border border-hairline text-xs">
              <span className="font-semibold text-ink">{w.user?.name || w.user?.email} · ${w.amount.toFixed(2)}</span>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => handleWithdrawalDecision(w.id, true)}>Approve</Button>
                <Button size="sm" variant="secondary" onClick={() => handleWithdrawalDecision(w.id, false)}>Reject</Button>
              </div>
            </div>
          ))}
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink">Recent Transactions</h3>
        {transactions.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No transactions yet.</p>}
        {transactions.map(tx => (
          <div key={tx.id} className="flex items-center justify-between p-2 text-xs border-b border-hairline last:border-0">
            <div className="min-w-0">
              <p className="text-ink font-medium truncate">{tx.details || (tx.sender_id ? 'Transfer' : 'System')}</p>
              <p className="text-ink-faint text-[10px]">{tx.sender?.name || 'System'} → {tx.receiver?.name}</p>
            </div>
            <span className={`font-semibold shrink-0 ${tx.amount < 0 ? 'text-danger' : 'text-success'}`}>{tx.amount < 0 ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}</span>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requests (leave / resignation)
// ---------------------------------------------------------------------------

function JoinRequestRow({ request, teamId, onDecided }: { request: JoinRequest; teamId: string; onDecided: () => void }) {
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { listResponseTemplates(teamId).then(setTemplates); }, [teamId]);

  const handleDecide = async (approve: boolean) => {
    setBusy(true);
    const body = templates.find(t => t.id === templateId)?.body;
    await decideJoinRequest(request.id, approve, body);
    setBusy(false);
    onDecided();
  };

  return (
    <div className="p-2.5 rounded-xl border border-hairline text-xs space-y-1.5">
      <p className="font-semibold text-ink">{request.user?.name || request.user?.email}</p>
      {request.message && <p className="text-ink-muted whitespace-pre-line">{request.message}</p>}
      {templates.length > 0 && (
        <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-hairline bg-transparent text-ink">
          <option value="">Default response...</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      )}
      <div className="flex gap-1">
        <Button size="sm" onClick={() => handleDecide(true)} disabled={busy}>Approve</Button>
        <Button size="sm" variant="secondary" onClick={() => handleDecide(false)} disabled={busy}>Reject</Button>
      </div>
    </div>
  );
}

function ResponseTemplatesCard({ team }: { team: Team }) {
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = () => { listResponseTemplates(team.id).then(setTemplates); };
  useEffect(refresh, [team.id]);

  const handleSave = async () => {
    if (!label.trim() || !body.trim()) return;
    setSaving(true);
    const error = await upsertResponseTemplate(team.id, label.trim(), body.trim());
    setSaving(false);
    if (error) { swal({ icon: 'error', title: 'Could not save template', text: error }); return; }
    setLabel(''); setBody('');
    refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteResponseTemplate(id);
    refresh();
  };

  return (
    <GlassCard className="p-6 space-y-3">
      <h3 className="text-sm font-semibold text-ink">Response Templates</h3>
      {templates.map(t => (
        <div key={t.id} className="flex items-start justify-between gap-2 p-2.5 rounded-xl border border-hairline text-xs">
          <div className="min-w-0"><p className="font-semibold text-ink">{t.label}</p><p className="text-ink-muted line-clamp-2">{t.body}</p></div>
          <button onClick={() => handleDelete(t.id)} aria-label="Delete template" className="p-1 rounded-lg text-ink-faint hover:text-danger shrink-0"><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="space-y-1.5 pt-2 border-t border-hairline">
        <Input placeholder="Label (e.g. Welcome)" value={label} onChange={e => setLabel(e.target.value)} />
        <Textarea placeholder="Response message" value={body} onChange={e => setBody(e.target.value)} rows={2} />
        <Button size="sm" onClick={handleSave} disabled={saving}>Add Template</Button>
      </div>
    </GlassCard>
  );
}

function RequestsTab({ team, myMember, canManageVacations, canManageJoinRequests, onChanged }: { team: Team; myMember: TeamMember | null; canManageVacations: boolean; canManageJoinRequests: boolean; onChanged: () => void }) {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [resignations, setResignations] = useState<ResignationRequest[]>([]);
  const [joins, setJoins] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveDuration, setLeaveDuration] = useState('');
  const [resignReason, setResignReason] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    if (canManageJoinRequests) await expireStaleJoinRequests(team.id);
    const [l, r, j] = await Promise.all([
      canManageVacations ? listPendingLeaveRequests(team.id) : Promise.resolve([]),
      canManageVacations ? listPendingResignations(team.id) : Promise.resolve([]),
      canManageJoinRequests ? listPendingJoinRequests(team.id) : Promise.resolve([]),
    ]);
    setLeaves(l); setResignations(r); setJoins(j);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [team.id, canManageVacations, canManageJoinRequests]);

  const handleRequestLeave = async () => {
    if (!leaveReason.trim() || !leaveDuration.trim()) { swal({ icon: 'error', title: 'Fill in both fields' }); return; }
    setBusy(true);
    const error = await requestLeave(team.id, leaveReason.trim(), leaveDuration.trim());
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not submit', text: error }); return; }
    swalToast({ icon: 'success', title: 'Leave requested' });
    setLeaveReason(''); setLeaveDuration('');
  };

  const handleRequestResignation = async () => {
    if (!resignReason.trim()) { swal({ icon: 'error', title: 'Reason required' }); return; }
    const result = await swal({ icon: 'warning', title: 'Submit resignation?', showCancelButton: true, confirmButtonText: 'Submit', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    setBusy(true);
    const error = await requestResignation(team.id, resignReason.trim());
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Could not submit', text: error }); return; }
    swalToast({ icon: 'success', title: 'Resignation submitted' });
    setResignReason('');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {myMember && (
        <GlassCard className="p-6 space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Clock3 size={15} className="text-accent" /> Request Leave</h3>
            <Input placeholder="Reason" value={leaveReason} onChange={e => setLeaveReason(e.target.value)} />
            <Input placeholder="Duration (e.g. Aug 1 – Aug 7)" value={leaveDuration} onChange={e => setLeaveDuration(e.target.value)} />
            <Button size="sm" onClick={handleRequestLeave} disabled={busy}>Submit</Button>
          </div>
          <div className="space-y-2 pt-3 border-t border-hairline">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><LogOut size={15} className="text-danger" /> Resign</h3>
            <Input placeholder="Reason" value={resignReason} onChange={e => setResignReason(e.target.value)} />
            <Button size="sm" variant="danger" onClick={handleRequestResignation} disabled={busy}>Submit Resignation</Button>
          </div>
        </GlassCard>
      )}

      {loading && (canManageJoinRequests || canManageVacations) && (
        <>
          <SkeletonCard className="h-48" />
          <SkeletonCard className="h-48" />
        </>
      )}

      {!loading && canManageJoinRequests && (
        <>
          <GlassCard className="p-6 space-y-2">
            <h3 className="text-sm font-semibold text-ink">Pending Join Requests</h3>
            {joins.length === 0 && <p className="text-xs text-ink-faint text-center py-3">None pending.</p>}
            {joins.map(j => (
              <JoinRequestRow key={j.id} request={j} teamId={team.id} onDecided={() => { refresh(); onChanged(); }} />
            ))}
          </GlassCard>
          <ResponseTemplatesCard team={team} />
        </>
      )}

      {!loading && canManageVacations && (
        <>
          <GlassCard className="p-6 space-y-2">
            <h3 className="text-sm font-semibold text-ink">Pending Leave Requests</h3>
            {leaves.length === 0 && <p className="text-xs text-ink-faint text-center py-3">None pending.</p>}
            {leaves.map(l => (
              <div key={l.id} className="p-2.5 rounded-xl border border-hairline text-xs space-y-1.5">
                <p className="font-semibold text-ink">{l.user?.name || l.user?.email}</p>
                <p className="text-ink-muted">{l.duration} — {l.reason}</p>
                <div className="flex gap-1">
                  <Button size="sm" onClick={async () => { await decideLeave(l.id, true); refresh(); onChanged(); }}>Approve</Button>
                  <Button size="sm" variant="secondary" onClick={async () => { await decideLeave(l.id, false); refresh(); }}>Reject</Button>
                </div>
              </div>
            ))}
          </GlassCard>

          <GlassCard className="p-6 space-y-2">
            <h3 className="text-sm font-semibold text-ink">Pending Resignations</h3>
            {resignations.length === 0 && <p className="text-xs text-ink-faint text-center py-3">None pending.</p>}
            {resignations.map(r => (
              <div key={r.id} className="p-2.5 rounded-xl border border-hairline text-xs space-y-1.5">
                <p className="font-semibold text-ink">{r.user?.name || r.user?.email}</p>
                <p className="text-ink-muted">{r.reason}</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="danger" onClick={async () => { await decideResignation(r.id, true); refresh(); onChanged(); }}>Accept</Button>
                  <Button size="sm" variant="secondary" onClick={async () => { await decideResignation(r.id, false); refresh(); }}>Reject</Button>
                </div>
              </div>
            ))}
          </GlassCard>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics (leaderboard + team report, open to every member)
// ---------------------------------------------------------------------------

function AnalyticsSection({ team, members }: { team: Team; members: TeamMember[] }) {
  const [top, setTop] = useState<TeamMember[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stageHistory, setStageHistory] = useState<Awaited<ReturnType<typeof listTeamStageHistory>>>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      const [t, tk, sh] = await Promise.all([getLeaderboard(team.id), listTeamTasks(team.id), listTeamStageHistory(team.id)]);
      setTop(t); setTasks(tk); setStageHistory(sh); setLoading(false);
    })();
  }, [team.id]);

  const handleExportReport = async () => {
    setExporting(true);
    const transactions = await listTransactions(team.id);
    await exportTeamReportDocx({ team, members, tasks, transactions });
    setExporting(false);
  };

  if (loading) {
    return (
      <div className="grid lg:grid-cols-2 gap-4">
        <SkeletonCard className="h-40" />
        <SkeletonCard className="h-52" />
        <SkeletonCard className="h-52" />
        <SkeletonCard className="h-52" />
      </div>
    );
  }

  const done = tasks.filter(t => t.status === 'done').length;
  const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' && t.status !== 'cancelled');
  const completionRate = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
  const completedWithDates = tasks.filter(t => t.status === 'done' && t.completed_at);
  const avgTurnaroundDays = completedWithDates.length > 0
    ? (completedWithDates.reduce((sum, t) => sum + (new Date(t.completed_at!).getTime() - new Date(t.created_at).getTime()), 0) / completedWithDates.length) / 86400000
    : 0;
  const memberReliability = members
    .filter(m => m.status === 'active')
    .map(m => {
      const assigned = tasks.filter(t => t.assignee_id === m.user_id);
      const finished = assigned.filter(t => t.status === 'done');
      return { name: m.profile?.name || m.invited_email, rate: assigned.length > 0 ? Math.round((finished.length / assigned.length) * 100) : null, assigned: assigned.length };
    })
    .filter(m => m.assigned > 0)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  // Time-in-stage: each entry's duration is the gap since the previous stage
  // completed for that task (or since task creation, for the first stage).
  const byTask = new Map<string, typeof stageHistory>();
  for (const entry of stageHistory) {
    const list = byTask.get(entry.task_id) ?? [];
    list.push(entry);
    byTask.set(entry.task_id, list);
  }
  const stageDurations = new Map<string, number[]>();
  for (const entries of byTask.values()) {
    let prevAt = entries[0]?.task_created_at;
    for (const entry of entries) {
      const durationMs = new Date(entry.completed_at).getTime() - new Date(prevAt).getTime();
      if (durationMs >= 0) {
        const list = stageDurations.get(entry.job_type) ?? [];
        list.push(durationMs);
        stageDurations.set(entry.job_type, list);
      }
      prevAt = entry.completed_at;
    }
  }
  const avgTimeInStage = Array.from(stageDurations.entries())
    .map(([jobType, durations]) => ({ jobType, avgDays: durations.reduce((a, b) => a + b, 0) / durations.length / 86400000, count: durations.length }))
    .sort((a, b) => b.avgDays - a.avgDays);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassCard className="p-6 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Team Report</h3>
          <Button size="sm" variant="secondary" onClick={handleExportReport} disabled={exporting}>{exporting ? 'Exporting...' : 'Export Report'}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-ink-faint text-xs">Members</p><p className="font-bold text-ink">{members.length}</p></div>
          <div><p className="text-ink-faint text-xs">Tasks total</p><p className="font-bold text-ink">{tasks.length}</p></div>
          <div><p className="text-ink-faint text-xs">Completed</p><p className="font-bold text-ink">{done}</p></div>
          <div><p className="text-ink-faint text-xs">Overdue</p><p className="font-bold text-danger">{overdue.length}</p></div>
          <div><p className="text-ink-faint text-xs">Completion rate</p><p className="font-bold text-ink">{completionRate}%</p></div>
          <div><p className="text-ink-faint text-xs">Avg turnaround</p><p className="font-bold text-ink">{avgTurnaroundDays.toFixed(1)}d</p></div>
        </div>
      </GlassCard>

      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink">Member Reliability</h3>
        {memberReliability.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No assigned tasks yet.</p>}
        {memberReliability.map(m => (
          <div key={m.name} className="flex items-center justify-between p-2.5 rounded-xl border border-hairline">
            <span className="text-sm text-ink">{m.name}</span>
            <span className="text-sm font-bold text-accent">{m.rate}%</span>
          </div>
        ))}
      </GlassCard>

      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink">Avg Time in Stage</h3>
        {avgTimeInStage.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No completed pipeline stages yet.</p>}
        {avgTimeInStage.map(s => (
          <div key={s.jobType} className="flex items-center justify-between p-2.5 rounded-xl border border-hairline">
            <span className="text-sm text-ink">{s.jobType} <span className="text-ink-faint text-xs">({s.count})</span></span>
            <span className="text-sm font-bold text-accent">{s.avgDays.toFixed(1)}d</span>
          </div>
        ))}
      </GlassCard>

      <GlassCard className="p-6 space-y-2">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Trophy size={16} className="text-accent" /> Top Earners</h3>
        {top.length === 0 && <p className="text-xs text-ink-faint text-center py-3">No data yet.</p>}
        {top.map((m, i) => (
          <div key={m.id} className="flex items-center justify-between p-2.5 rounded-xl border border-hairline">
            <span className="text-sm font-semibold text-ink">#{i + 1} {m.profile?.name || m.invited_email}</span>
            <span className="text-sm font-bold text-accent">{m.privacy_prefs?.hide_balance ? '••••' : `$${m.balance.toFixed(2)}`}</span>
          </div>
        ))}
      </GlassCard>

      {overdue.length > 0 && (
        <GlassCard className="p-6 space-y-2 lg:col-span-2">
          <h3 className="text-sm font-semibold text-ink">Overdue Tasks</h3>
          {overdue.map(t => (
            <div key={t.id} className="p-2.5 rounded-xl border border-danger/30 text-xs">
              <p className="font-semibold text-ink">{t.title}</p>
              <p className="text-ink-faint">Due {formatDue(t.due_date)} · {STATUS_LABEL[t.status]}</p>
            </div>
          ))}
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-2 lg:col-span-2">
        <h3 className="text-sm font-semibold text-ink">Members</h3>
        {members.map(m => (
          <div key={m.id} className="flex items-center justify-between p-2 text-xs border-b border-hairline last:border-0">
            <span className="text-ink">{m.profile?.name || m.invited_email} <span className="text-ink-faint">({m.job_title || 'no job'})</span></span>
            <span className="font-semibold text-ink">{m.privacy_prefs?.hide_balance ? '••••' : `$${m.balance.toFixed(2)}`}</span>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team Files — shared browse of the team's Telegram channel. Everyone active
// can view/download everything in it (including task submissions); only
// managers can create folders or upload standalone files. Regular members
// still contribute files via task submission (Tasks section), not here.
// ---------------------------------------------------------------------------

// Shared so both the Team Files browser and Chat (routing attachments into
// the secret .chat-uploads folder) can reach the same folder without either
// duplicating folder-lookup/creation logic or depending on the other's
// component state.
async function ensureChatUploadsFolderId(cc: CloudClient, team: Team): Promise<number | null> {
  if (!team.telegram_channel_id) return null;
  const { folders } = await cc.fetchChannelFiles(team.telegram_channel_id);
  const existing = folders.find(f => f.parentId === null && f.name === '.chat-uploads');
  if (existing) return existing.id;
  await cc.createChannelFolder(team.telegram_channel_id, '.chat-uploads', null, []);
  const { folders: refreshed } = await cc.fetchChannelFiles(team.telegram_channel_id);
  const created = refreshed.find(f => f.parentId === null && f.name === '.chat-uploads');
  if (created) await setCloudFolderSecret(team.id, created.id, true);
  return created?.id ?? null;
}

async function ensurePrivateFolderId(cc: CloudClient, team: Team, userId: string): Promise<number | null> {
  if (!team.telegram_channel_id) return null;
  const { folders } = await cc.fetchChannelFiles(team.telegram_channel_id);
  const name = `Private: ${userId}`;
  const existing = folders.find(f => f.parentId === null && f.name === name);
  if (existing) return existing.id;
  await cc.createChannelFolder(team.telegram_channel_id, name, null, [userId]);
  const { folders: refreshed } = await cc.fetchChannelFiles(team.telegram_channel_id);
  return refreshed.find(f => f.parentId === null && f.name === name)?.id ?? null;
}

/** The Team Files browser only ever shows ZIP backups — checked against the underlying
 *  Telegram file's own name (not the possibly-custom display name/meta.name, which might
 *  omit the extension entirely), matching how downloadCloudFile derives a file's real
 *  extension elsewhere in this file. */
function isZipFile(f: CloudFile): boolean {
  const rawName = (f.msg as any)?.file?.name as string | undefined;
  return (rawName || f.name || '').toLowerCase().endsWith('.zip');
}

function TeamFilesSection({ team, canManage, canManageCloudFiles, cc, members }: { team: Team; canManage: boolean; canManageCloudFiles: boolean; cc: CloudClient; members: TeamMember[] }) {
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [fileMeta, setFileMeta] = useState<TeamCloudFileMeta[]>([]);
  const [folderMeta, setFolderMeta] = useState<TeamCloudFolderMeta[]>([]);
  const [comments, setComments] = useState<CloudFileComment[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [coverBusyId, setCoverBusyId] = useState<number | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverTargetRef = useRef<CloudFile | null>(null);
  const { session } = useTeamAuth();
  const myUserId = session?.user.id;

  const refresh = async () => {
    if (!team.telegram_channel_id) { setLoading(false); return; }
    setLoading(true);
    const [{ files: f, folders: fo }, fm, fom, allComments] = await Promise.all([
      cc.fetchChannelFiles(team.telegram_channel_id),
      listCloudFileMeta(team.id),
      listCloudFolderMeta(team.id),
      cc.listAllComments(team.telegram_channel_id),
    ]);
    setFiles(f); setFolders(fo); setFileMeta(fm); setFolderMeta(fom); setComments(allComments);
    setLoading(false);
    return fo;
  };

  useEffect(() => { refresh(); }, [team.telegram_channel_id, team.id]);

  const metaByMsgId = new Map(fileMeta.map(m => [m.channel_msg_id, m]));
  const folderMetaByMsgId = new Map(folderMeta.map(m => [m.folder_msg_id, m]));

  const uploaderName = (f: CloudFile): string => {
    const meta = metaByMsgId.get(f.id);
    if (meta?.uploader_user_id) {
      const member = members.find(m => m.user_id === meta.uploader_user_id);
      if (member?.profile?.name) return member.profile.name;
    }
    return f.sender;
  };

  const commenterName = (c: CloudFileComment): string => {
    if (c.authorUserId) {
      const member = members.find(m => m.user_id === c.authorUserId);
      if (member?.profile?.name) return member.profile.name;
    }
    return c.author;
  };

  const canSeeFile = (f: CloudFile): boolean => {
    const meta = metaByMsgId.get(f.id);
    if (!meta || meta.visibility !== 'private') return true;
    return canManage || meta.owner_user_id === myUserId;
  };

  // One-time seed of the fixed Tasks > Finished/Unfinished folder structure.
  useEffect(() => {
    if (!canManage || loading || seeding || !team.telegram_channel_id) return;
    const tasksRoot = folders.find(f => f.parentId === null && f.name === 'Tasks');
    if (!tasksRoot) {
      setSeeding(true);
      cc.createChannelFolder(team.telegram_channel_id, 'Tasks', null).then(() => refresh()).finally(() => setSeeding(false));
      return;
    }
    const hasFinished = folders.some(f => f.parentId === tasksRoot.id && f.name === 'Finished');
    const hasUnfinished = folders.some(f => f.parentId === tasksRoot.id && f.name === 'Unfinished');
    if (!hasFinished || !hasUnfinished) {
      setSeeding(true);
      (async () => {
        if (!hasFinished) await cc.createChannelFolder(team.telegram_channel_id, 'Finished', tasksRoot.id);
        if (!hasUnfinished) await cc.createChannelFolder(team.telegram_channel_id, 'Unfinished', tasksRoot.id);
        await refresh();
      })().finally(() => setSeeding(false));
    }
  }, [canManage, loading, folders, team.telegram_channel_id]);

  const currentFolder = folders.find(f => f.id === currentFolderId) || null;
  const isProtectedFolder = (name: string) => name === 'Tasks' || name === 'Finished' || name === 'Unfinished';
  const canUploadHere = canManage || !currentFolder || currentFolder.members.length === 0 || (!!myUserId && currentFolder.members.includes(myUserId));

  const handleCreateFolder = async (name: string, parentId: number | null) => {
    await cc.createChannelFolder(team.telegram_channel_id, name, parentId);
    refresh();
  };

  const handleDeleteFolder = async (folder: CloudFolder) => {
    if (isProtectedFolder(folder.name)) { swal({ icon: 'info', title: 'Protected folder', text: 'The Tasks/Finished/Unfinished structure cannot be deleted.' }); return; }
    const result = await swal({ icon: 'warning', title: `Delete folder "${folder.name}"?`, text: 'Files inside will remain, unfiled.', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    await cc.deleteChannelFolder(team.telegram_channel_id, folder);
    refresh();
  };

  const handleEditFolderMembers = async (folder: CloudFolder, memberIds: string[]) => {
    await cc.updateChannelFolderMembers(team.telegram_channel_id, folder, memberIds);
    refresh();
  };

  const handleUpload = async (file: File, meta: TeamUploadMeta) => {
    if (!canUploadHere) { swal({ icon: 'error', title: 'Not allowed', text: 'You are not a member of this folder.' }); return; }
    setUploading(true);
    const msgId = await cc.uploadChannelFile(team.telegram_channel_id, file, currentFolderId, undefined, { name: meta.displayName, description: meta.description });
    if (msgId && myUserId) {
      const isPrivate = currentFolder?.name?.startsWith('Private: ');
      await upsertCloudFileMeta({
        teamId: team.id, channelMsgId: msgId, folderMsgId: currentFolderId,
        uploaderUserId: myUserId,
        visibility: isPrivate ? 'private' : 'team',
        ownerUserId: isPrivate ? myUserId : null,
        displayName: meta.displayName,
      });
      if (meta.coverDataUrl) {
        await uploadCloudFileCover(team.id, msgId, meta.coverDataUrl);
      }
    }
    setUploading(false);
    setPendingUploadFile(null);
    swalToast({ icon: 'success', title: 'File uploaded' });
    refresh();
  };

  const handleOpenMyPrivateFolder = async () => {
    if (!myUserId) return;
    const id = await ensurePrivateFolderId(cc, team, myUserId);
    if (id != null) { await refresh(); setCurrentFolderId(id); }
  };

  const handleDownload = async (file: CloudFile) => {
    await cc.downloadChannelFile(file);
  };

  const handleSetVisibility = async (file: CloudFile, visibility: CloudFileVisibility) => {
    const ownerUserId = visibility === 'private' ? (metaByMsgId.get(file.id)?.owner_user_id ?? myUserId ?? null) : null;
    const error = await setCloudFileVisibility(team.id, file.id, visibility, ownerUserId);
    if (error) { swal({ icon: 'error', title: 'Could not update visibility', text: error }); return; }
    refresh();
  };

  const handleCoverPick = (file: CloudFile) => {
    coverTargetRef.current = file;
    coverInputRef.current?.click();
  };

  const handleCoverFile = (f: File) => {
    const target = coverTargetRef.current;
    if (!target) return;
    readImageFile(f, async (dataUrl) => {
      setCoverBusyId(target.id);
      const error = await uploadCloudFileCover(team.id, target.id, dataUrl);
      setCoverBusyId(null);
      if (error) { swal({ icon: 'error', title: 'Could not set cover', text: error }); return; }
      refresh();
    });
  };

  const handlePostComment = async (file: CloudFile) => {
    const body = (commentDrafts[file.id] || '').trim();
    if (!body) return;
    await cc.postFileComment(team.telegram_channel_id, file.id, body);
    setCommentDrafts(prev => ({ ...prev, [file.id]: '' }));
    setComments(await cc.listAllComments(team.telegram_channel_id));
  };

  if (!team.telegram_channel_id) {
    return (
      <GlassCard className="p-8 text-center">
        <p className="text-sm text-ink-muted">No Telegram channel set for this team yet.</p>
        {canManage && <p className="text-xs text-ink-faint mt-1">Set one in the Roster section to enable shared Team Files.</p>}
      </GlassCard>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} className="aspect-square" />)}
      </div>
    );
  }

  const visibleFolders = folders.filter(f => canManage || !folderMetaByMsgId.get(f.id)?.is_secret);
  // Only genuine "Upload File" uploads belong here — chat attachments and
  // task-submission/reference files land in the same Telegram channel but
  // aren't deliberate Team Cloud uploads, so they're excluded by the flags
  // set at their own upload call sites (see upsertCloudFileMeta callers).
  // This browser is specifically for ZIP backups (matching the personal TeleCloud's own
  // workspace-backup listing, which is ZIP-only by construction) — a reference photo or
  // other non-ZIP file uploaded into the same channel/folder isn't a deliverable and
  // shouldn't clutter this card grid.
  const filesInFolder = files.filter(f => {
    if (f.folderId !== currentFolderId) return false;
    if (!canSeeFile(f)) return false;
    const meta = metaByMsgId.get(f.id);
    if (meta?.is_chat_upload || meta?.is_task_submission) return false;
    return isZipFile(f);
  });
  const inFinished = currentFolder?.name === 'Finished';

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingUploadFile(f); e.target.value = ''; }} />
      <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCoverFile(f); e.target.value = ''; }} />
      {pendingUploadFile && (
        <TeamUploadModal
          file={pendingUploadFile}
          uploading={uploading}
          onClose={() => setPendingUploadFile(null)}
          onConfirm={(meta) => handleUpload(pendingUploadFile, meta)}
        />
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <CloudFolders
          folders={visibleFolders}
          currentFolderId={currentFolderId}
          onNavigate={setCurrentFolderId}
          onCreateFolder={(canManage || canManageCloudFiles) ? handleCreateFolder : () => {}}
          onDeleteFolder={(canManage || canManageCloudFiles) ? handleDeleteFolder : () => {}}
          fileCountFor={(folderId) => files.filter(f => f.folderId === folderId).length}
          onEditMembers={(canManage || canManageCloudFiles) ? handleEditFolderMembers : undefined}
        />
        <Button size="sm" variant="secondary" onClick={handleOpenMyPrivateFolder}>
          <Lock size={12} /> My Private Folder
        </Button>
      </div>

      {canUploadHere ? (
        <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload size={13} /> {uploading ? 'Uploading...' : 'Upload File'}
        </Button>
      ) : (
        <p className="text-[11px] text-ink-faint">You're not a member of this folder — ask an admin to add you before uploading here.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filesInFolder.length === 0 && (
          <p className="text-xs text-ink-faint text-center py-6 sm:col-span-2 lg:col-span-3">No ZIP backups in this folder yet.</p>
        )}
        {filesInFolder.map(f => {
          const meta = metaByMsgId.get(f.id);
          const visibility: CloudFileVisibility = meta?.visibility ?? 'team';
          const fileComments = comments.filter(c => c.fileId === f.id);
          const displayName = meta?.display_name || f.name;
          return (
            <GlassCard key={f.id} radius="xl" className="overflow-hidden flex flex-col hover:border-accent/50 transition-colors group">
              <div className="h-40 w-full bg-accent-soft flex flex-col items-center justify-center border-b border-hairline relative overflow-hidden">
                {meta?.cover_image_path ? (
                  <>
                    <img src={`${meta.cover_image_path}?v=${meta.cover_version}`} alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  </>
                ) : (
                  <Boxes size={32} className="text-accent/50" />
                )}
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-black/50 text-white backdrop-blur-sm">
                  <Boxes size={10} /> ZIP
                </span>
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {(canManage || canManageCloudFiles) && (
                    <button onClick={() => handleCoverPick(f)} disabled={coverBusyId === f.id} aria-label={`Set cover for ${displayName}`} className="p-1.5 rounded-lg bg-black/40 text-white">
                      <ImagePlus size={12} />
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 flex flex-col gap-2 flex-1">
                <h4 className="font-bold text-ink text-base truncate">{displayName}</h4>
                <p className="text-xs text-ink-muted bg-ink/5 px-2 py-1.5 rounded-lg border border-hairline truncate">
                  {cc.formatSize(f.sizeBytes)} · {inFinished ? <span className="font-semibold text-accent">{uploaderName(f)}</span> : uploaderName(f)}
                </p>

                {(canManage || canManageCloudFiles) && (
                  <div className="flex items-center gap-1.5">
                    {(['team', 'public', 'private'] as CloudFileVisibility[]).map(v => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => handleSetVisibility(f, v)}
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border capitalize flex items-center gap-1 transition-colors ${visibility === v ? 'bg-accent text-white border-accent' : 'border-hairline text-ink-muted hover:border-accent/40'}`}
                      >
                        {v === 'private' ? <Lock size={9} /> : <Globe size={9} />} {v}
                      </button>
                    ))}
                  </div>
                )}
                {!(canManage || canManageCloudFiles) && visibility === 'private' && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-ink/5 text-ink-faint inline-flex items-center gap-1"><Lock size={9} /> Private</span>
                )}

                <div className="flex justify-between items-center text-xs text-ink-muted font-mono border-t border-hairline pt-2">
                  <span>{new Date(f.date).toLocaleDateString()}</span>
                  <button onClick={() => handleDownload(f)} className="text-accent hover:text-ink flex items-center gap-1 font-sans font-bold bg-accent-soft hover:opacity-80 px-2 py-1 rounded transition-colors">
                    <Download size={14} /> Download
                  </button>
                </div>

                <div className="pt-2 border-t border-hairline space-y-1.5">
                  <p className="text-[9px] font-semibold text-accent uppercase tracking-wide">Comments</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {fileComments.length === 0 && <p className="text-[10px] text-ink-faint">No comments yet.</p>}
                    {fileComments.map(c => (
                      <div key={c.id} className="p-1.5 rounded-lg bg-ink/[0.03]">
                        <p className="text-[9px] font-semibold text-accent">{commenterName(c)}</p>
                        <p className="text-[11px] text-ink whitespace-pre-line">{c.body}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="Add a comment..."
                      value={commentDrafts[f.id] || ''}
                      onChange={e => setCommentDrafts(prev => ({ ...prev, [f.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handlePostComment(f)}
                      className="flex-1 text-xs"
                    />
                    <Button size="sm" variant="secondary" onClick={() => handlePostComment(f)}>Post</Button>
                  </div>
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>

      <Modal open={cc.isDownloading} onClose={() => {}} dismissible={false} title="Downloading" size="sm">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink truncate">{cc.downloadLabel}</p>
            <p className="text-xs text-ink-faint font-mono mt-0.5">{cc.formatSize(Math.round(cc.downloadTotalBytes * (cc.downloadProgress / 100)))} / {cc.formatSize(cc.downloadTotalBytes)}</p>
          </div>
          <div className="w-full bg-ink/10 border border-hairline h-3 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 bg-accent h-full transition-all duration-300" style={{ width: `${cc.downloadProgress}%` }} />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white mix-blend-difference">{cc.downloadProgress}%</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat (team channel + DMs)
// ---------------------------------------------------------------------------

function ChatSection({ team, members, myMember, isOwner, canManage, onChanged, cc }: { team: Team; members: TeamMember[]; myMember: TeamMember | null; isOwner: boolean; canManage: boolean; onChanged: () => void; cc: CloudClient }) {
  const [mode, setMode] = useState<'team' | 'dm'>('team');
  const [activePartner, setActivePartner] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  const partnerMember = members.find(m => m.user_id === activePartner);
  const profileMember = members.find(m => m.user_id === profileUserId);

  return (
    <GlassCard className="overflow-hidden h-[70vh] flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-hairline shrink-0">
        <button
          type="button"
          onClick={() => { setMode('team'); setActivePartner(null); }}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${mode === 'team' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}
        >
          Team Chat
        </button>
        <button
          type="button"
          onClick={() => setMode('dm')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${mode === 'dm' ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'}`}
        >
          Direct Messages
        </button>
      </div>

      {mode === 'team' && <TeamChatThread team={team} members={members} myMember={myMember} canManage={canManage} onOpenProfile={setProfileUserId} cc={cc} />}
      {mode === 'dm' && !activePartner && <ConversationList team={team} members={members} myMember={myMember} onSelect={setActivePartner} />}
      {mode === 'dm' && activePartner && (
        <DirectThread
          team={team}
          partnerId={activePartner}
          partnerName={partnerMember?.profile?.name || partnerMember?.invited_email || 'Member'}
          partnerAvatar={partnerMember?.profile?.avatar || ''}
          onBack={() => setActivePartner(null)}
          onOpenProfile={setProfileUserId}
          cc={cc}
        />
      )}

      {profileMember && (
        <MemberProfileModal
          team={team}
          member={profileMember}
          canManage={canManage}
          isOwner={isOwner}
          onClose={() => setProfileUserId(null)}
          onChanged={onChanged}
        />
      )}
    </GlassCard>
  );
}

function useSenderColor(avatar: string | undefined): string {
  const [color, setColor] = useState('inherit');
  useEffect(() => {
    let cancelled = false;
    if (!avatar) { setColor('inherit'); return; }
    dominantColorFromImage(avatar, 'inherit').then(c => { if (!cancelled) setColor(c); });
    return () => { cancelled = true; };
  }, [avatar]);
  return color;
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', opus: 'audio/opus', aac: 'audio/aac', webm: 'audio/webm',
};
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
const AUDIO_EXTENSIONS = ['webm', 'ogg', 'mp3', 'wav', 'm4a', 'opus', 'aac'];

function getAttachmentKind(name: string): 'image' | 'audio' | 'file' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  return 'file';
}

function guessMimeType(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext];
}

// Session-only cache (blob URLs can't survive a reload anyway) so a bubble that re-renders
// — or a second bubble instance somehow pointing at the same message — never re-downloads
// media it already fetched once.
const attachmentPreviewCache = new Map<number, string>();

/** A photo or voice-message attachment auto-downloads and renders inline the moment the
 *  bubble mounts — no manual "click to download" step, unlike a generic file attachment,
 *  which keeps the existing Paperclip download link/button. */
function AttachmentPreview({ channelId, msgId, name, onFetchPreview, onDownload }: {
  channelId: string;
  msgId: number;
  name: string;
  onFetchPreview: (channelId: string, msgId: number, mimeType?: string) => Promise<string | null>;
  onDownload: () => void;
}) {
  const kind = getAttachmentKind(name);
  const [url, setUrl] = useState<string | null>(attachmentPreviewCache.get(msgId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (kind === 'file' || url) return;
    let cancelled = false;
    onFetchPreview(channelId, msgId, guessMimeType(name)).then(fetched => {
      if (cancelled) return;
      if (fetched) {
        attachmentPreviewCache.set(msgId, fetched);
        setUrl(fetched);
      } else {
        setFailed(true);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, channelId, msgId]);

  if (kind === 'file') {
    return (
      <button onClick={onDownload} className="text-[11px] text-accent hover:text-ink flex items-center gap-1 font-semibold mt-1">
        <Paperclip size={11} /> {name || 'Attachment'}
      </button>
    );
  }

  if (failed) {
    return (
      <button onClick={onDownload} className="text-[11px] text-danger hover:text-ink flex items-center gap-1 font-semibold mt-1">
        <Paperclip size={11} /> Preview failed — {name || 'Attachment'}
      </button>
    );
  }

  if (!url) {
    return <div className="mt-1 w-40 h-28 rounded-lg animate-skeleton" />;
  }

  if (kind === 'image') {
    return <img src={url} alt={name} className="mt-1 max-w-[240px] max-h-[240px] rounded-lg object-cover cursor-pointer" onClick={() => window.open(url, '_blank')} />;
  }

  return <audio controls src={url} className="mt-1 h-9 max-w-[240px]" />;
}

function ChatAvatar({ name, avatar, size = 28 }: { name: string; avatar?: string; size?: number }) {
  return (
    <div
      className="rounded-full overflow-hidden bg-ink/5 border border-hairline shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-ink-faint font-semibold">{(name || '?')[0]?.toUpperCase()}</span>}
    </div>
  );
}

function hydrateSender(msg: TeamMessage, members: TeamMember[]): TeamMessage {
  if (msg.sender?.name) return msg;
  if (msg.sender_id === null) return { ...msg, sender: { name: 'Team Bot', avatar: '' } };
  const m = members.find(mm => mm.user_id === msg.sender_id);
  return { ...msg, sender: { name: m?.profile?.name || m?.invited_email || 'Member', avatar: m?.profile?.avatar || '' } };
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex(x => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = [...list];
  next[idx] = item;
  return next;
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
const EMPTY_REACTIONS: MessageReaction[] = [];

// Adding a *new* reaction now happens from the bubble's long-press/right-click menu (a quick-emoji
// row up top, see ChatBubbleMenu.tsx) rather than a "+" button here — this bar is just the
// already-placed reaction chips, still clickable to toggle your own.
function ReactionBar({ reactions, myUserId, onToggle }: { reactions: MessageReaction[]; myUserId: string | undefined; onToggle: (emoji: string) => void }) {
  const grouped = new Map<string, MessageReaction[]>();
  for (const r of reactions) {
    const list = grouped.get(r.emoji) ?? [];
    list.push(r);
    grouped.set(r.emoji, list);
  }
  if (grouped.size === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {Array.from(grouped.entries()).map(([emoji, list]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={`text-[11px] px-1.5 py-0.5 rounded-full border transition-colors ${
            list.some(r => r.user_id === myUserId) ? 'bg-accent-soft border-accent text-accent' : 'bg-ink/5 border-hairline text-ink-muted hover:border-accent/40'
          }`}
        >
          {emoji} {list.length}
        </button>
      ))}
    </div>
  );
}

/** Reactions are refetched wholesale on any team-wide reaction change, so the array reference always changes; compare by signature instead of identity so unrelated bubbles skip re-rendering. */
function reactionsSignatureEqual(a: MessageReaction[], b: MessageReaction[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

const TeamMessageBubble = memo(function TeamMessageBubble({ message, replied, isMine, canManage, isVerified, reactions, myUserId, teamId, telegramChannelId, onOpenProfile, onReply, onEdit, onDelete, onPin, onReport, onDownloadAttachment, onFetchAttachmentPreview, onToggleReaction }: {
  message: TeamMessage;
  replied: TeamMessage | null;
  isMine: boolean;
  canManage: boolean;
  isVerified?: boolean;
  reactions: MessageReaction[];
  myUserId: string | undefined;
  teamId: string;
  telegramChannelId: string;
  onOpenProfile: (userId: string) => void;
  onReply: (m: TeamMessage) => void;
  onEdit: (m: TeamMessage) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onReport: (m: TeamMessage) => void;
  onDownloadAttachment: (channelId: string, msgId: number, name: string) => void;
  onFetchAttachmentPreview: (channelId: string, msgId: number, mimeType?: string) => Promise<string | null>;
  onToggleReaction: (teamId: string, table: 'team_messages', messageId: string, emoji: string) => void;
}) {
  const m = message;
  const isBot = m.sender_id === null;
  const nameColor = useSenderColor(m.sender?.avatar);
  const { bind, menuElement } = useChatBubbleMenu();
  const bubbleActions = () => [
    { key: 'copy', label: 'Copy', icon: <ChatBubbleIcons.Copy size={13} />, onSelect: () => navigator.clipboard.writeText(m.body) },
    !m.deleted && { key: 'reply', label: 'Reply', icon: <ChatBubbleIcons.Reply size={13} />, onSelect: () => onReply(m) },
    !m.deleted && isMine && { key: 'edit', label: 'Edit', icon: <ChatBubbleIcons.Edit size={13} />, onSelect: () => onEdit(m) },
    !m.deleted && !isMine && { key: 'report', label: 'Report to Admin', icon: <ChatBubbleIcons.Report size={13} />, onSelect: () => onReport(m) },
    !m.deleted && canManage && { key: 'pin', label: m.pinned ? 'Unpin' : 'Pin', icon: m.pinned ? <ChatBubbleIcons.PinOff size={13} /> : <ChatBubbleIcons.Pin size={13} />, onSelect: () => onPin(m.id, !m.pinned) },
    !m.deleted && (isMine || canManage) && { key: 'delete', label: 'Delete', icon: <ChatBubbleIcons.Delete size={13} />, danger: true, onSelect: () => onDelete(m.id) },
  ].filter(Boolean) as { key: string; label: string; icon: React.ReactNode; danger?: boolean; onSelect: () => void }[];
  const bubbleReactions = () => m.deleted ? [] : QUICK_EMOJIS.map(emoji => ({
    emoji,
    active: reactions.some(r => r.emoji === emoji && r.user_id === myUserId),
    onSelect: () => onToggleReaction(teamId, 'team_messages', m.id, emoji),
  }));

  return (
    <div className={`flex items-start gap-2 max-w-md group animate-fade-in-up ${isMine ? 'ml-auto flex-row-reverse' : ''}`}>
      <button type="button" onClick={() => m.sender_id && onOpenProfile(m.sender_id)} className="shrink-0" disabled={isBot}>
        <ChatAvatar name={m.sender?.name || 'Member'} avatar={m.sender?.avatar} />
      </button>
      <div className="min-w-0 flex-1">
        <div
          {...bind(bubbleActions, bubbleReactions)}
          className={`p-2.5 rounded-2xl min-w-0 backdrop-blur-sm shadow-sm transition-all duration-200 select-none ${isMine ? 'bg-gradient-to-br from-accent-soft to-accent-soft/60 rounded-tr-sm' : 'bg-gradient-to-br from-ink/[0.04] to-ink/[0.02] rounded-tl-sm'}`}
        >
          <div className={`flex items-center gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
            <button type="button" onClick={() => m.sender_id && onOpenProfile(m.sender_id)} disabled={isBot} className="text-[10px] font-semibold hover:underline flex items-center gap-1 disabled:cursor-default" style={{ color: isBot ? undefined : nameColor }}>
              {m.sender?.name || 'Member'} {isVerified && <ShieldCheck size={10} className="text-accent" />}
            </button>
            {m.pinned && <span className="text-[9px] text-ink-faint">📌</span>}
            {m.edited_at && !m.deleted && <span className="text-[9px] text-ink-faint">(edited)</span>}
            <span className="text-[9px] text-ink-faint">{formatMessageTime(m.created_at)}</span>
          </div>
          {replied && (
            <div className="mt-1 mb-1 pl-2 border-l-2 border-accent/40 text-[10px] text-ink-faint truncate">
              {replied.sender?.name}: {replied.deleted ? 'Message deleted' : replied.body}
            </div>
          )}
          {m.deleted ? (
            <p className="text-sm text-ink-faint italic">This message was deleted</p>
          ) : (
            <>
              <p className="text-sm text-ink">{renderMarkdownMessage(m.body)}</p>
              {m.attachment_msg_id && (
                <AttachmentPreview
                  channelId={telegramChannelId}
                  msgId={m.attachment_msg_id}
                  name={m.attachment_name || 'attachment'}
                  onFetchPreview={onFetchAttachmentPreview}
                  onDownload={() => onDownloadAttachment(telegramChannelId, m.attachment_msg_id!, m.attachment_name || 'attachment')}
                />
              )}
            </>
          )}
        </div>
        {!m.deleted && <ReactionBar reactions={reactions} myUserId={myUserId} onToggle={emoji => onToggleReaction(teamId, 'team_messages', m.id, emoji)} />}
      </div>
      {menuElement}
    </div>
  );
}, (prev, next) => (
  prev.message === next.message &&
  prev.replied === next.replied &&
  prev.isVerified === next.isVerified &&
  prev.isMine === next.isMine &&
  prev.canManage === next.canManage &&
  prev.myUserId === next.myUserId &&
  reactionsSignatureEqual(prev.reactions, next.reactions)
));

const DirectMessageBubble = memo(function DirectMessageBubble({ message, replied, isMine, partnerId, isPartnerOnline, reactions, myUserId, teamId, telegramChannelId, partnerName, partnerAvatar, onDownloadAttachment, onFetchAttachmentPreview, onReply, onEdit, onDelete, onReport, onToggleReaction }: {
  message: DirectMessage;
  replied: DirectMessage | null;
  isMine: boolean;
  partnerId: string;
  isPartnerOnline?: boolean;
  reactions: MessageReaction[];
  myUserId: string | undefined;
  teamId: string;
  telegramChannelId: string;
  partnerName: string;
  partnerAvatar?: string;
  onDownloadAttachment: (channelId: string, msgId: number, name: string) => void;
  onFetchAttachmentPreview: (channelId: string, msgId: number, mimeType?: string) => Promise<string | null>;
  onReply: (m: DirectMessage) => void;
  onEdit: (m: DirectMessage) => void;
  onDelete: (id: string) => void;
  onReport: (m: DirectMessage) => void;
  onToggleReaction: (teamId: string, table: 'direct_messages', messageId: string, emoji: string) => void;
}) {
  const m = message;
  const { bind, menuElement } = useChatBubbleMenu();
  const bubbleActions = () => [
    { key: 'copy', label: 'Copy', icon: <ChatBubbleIcons.Copy size={13} />, onSelect: () => navigator.clipboard.writeText(m.body) },
    !m.deleted && { key: 'reply', label: 'Reply', icon: <ChatBubbleIcons.Reply size={13} />, onSelect: () => onReply(m) },
    !m.deleted && isMine && { key: 'edit', label: 'Edit', icon: <ChatBubbleIcons.Edit size={13} />, onSelect: () => onEdit(m) },
    !m.deleted && !isMine && { key: 'report', label: 'Report to Admin', icon: <ChatBubbleIcons.Report size={13} />, onSelect: () => onReport(m) },
    !m.deleted && isMine && { key: 'delete', label: 'Delete', icon: <ChatBubbleIcons.Delete size={13} />, danger: true, onSelect: () => onDelete(m.id) },
  ].filter(Boolean) as { key: string; label: string; icon: React.ReactNode; danger?: boolean; onSelect: () => void }[];
  const bubbleReactions = () => m.deleted ? [] : QUICK_EMOJIS.map(emoji => ({
    emoji,
    active: reactions.some(r => r.emoji === emoji && r.user_id === myUserId),
    onSelect: () => onToggleReaction(teamId, 'direct_messages', m.id, emoji),
  }));

  return (
    <div className={`flex items-end gap-2 max-w-md group ${isMine ? 'ml-auto flex-row-reverse' : ''}`}>
      <div className="relative shrink-0">
        <ChatAvatar name={partnerName} avatar={m.sender_id === partnerId ? partnerAvatar : undefined} size={22} />
        {m.sender_id === partnerId && isPartnerOnline && (
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-success border border-surface" />
        )}
      </div>
      <div className="min-w-0">
        <div {...bind(bubbleActions, bubbleReactions)} className={`p-2.5 rounded-2xl min-w-0 backdrop-blur-sm shadow-sm transition-all duration-200 select-none animate-fade-in-up ${!isMine ? 'bg-gradient-to-br from-ink/[0.04] to-ink/[0.02] rounded-bl-sm' : 'bg-gradient-to-br from-accent-soft to-accent-soft/60 rounded-br-sm'}`}>
          <div className="flex items-center gap-1.5 justify-end mb-0.5">
            {m.edited_at && !m.deleted && <span className="text-[9px] text-ink-faint">(edited)</span>}
            <span className="text-[9px] text-ink-faint">{formatMessageTime(m.created_at)}</span>
            {isMine && !m.deleted && <span className={`text-[9px] ${m.read ? 'text-accent' : 'text-ink-faint'}`}>{m.read ? '✓✓' : '✓'}</span>}
          </div>
          {replied && (
            <div className="mb-1 pl-2 border-l-2 border-accent/40 text-[10px] text-ink-faint truncate">
              {replied.deleted ? 'Message deleted' : replied.body}
            </div>
          )}
          {m.deleted ? (
            <p className="text-sm text-ink-faint italic">This message was deleted</p>
          ) : (
            <>
              <p className="text-sm text-ink">{renderMarkdownMessage(m.body)}</p>
              {m.attachment_msg_id && (
                <AttachmentPreview
                  channelId={telegramChannelId}
                  msgId={m.attachment_msg_id}
                  name={m.attachment_name || 'attachment'}
                  onFetchPreview={onFetchAttachmentPreview}
                  onDownload={() => onDownloadAttachment(telegramChannelId, m.attachment_msg_id!, m.attachment_name || 'attachment')}
                />
              )}
            </>
          )}
        </div>
        {!m.deleted && <ReactionBar reactions={reactions} myUserId={myUserId} onToggle={emoji => onToggleReaction(teamId, 'direct_messages', m.id, emoji)} />}
      </div>
      {menuElement}
    </div>
  );
}, (prev, next) => (
  prev.message === next.message &&
  prev.replied === next.replied &&
  prev.isMine === next.isMine &&
  prev.myUserId === next.myUserId &&
  prev.partnerAvatar === next.partnerAvatar &&
  prev.isPartnerOnline === next.isPartnerOnline &&
  reactionsSignatureEqual(prev.reactions, next.reactions)
));

function TeamChatThread({ team, members, myMember, canManage, onOpenProfile, cc }: {
  team: Team; members: TeamMember[]; myMember: TeamMember | null; canManage: boolean; onOpenProfile: (userId: string) => void; cc: CloudClient;
}) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [attaching, setAttaching] = useState(false);
  const { scrollRef, showJumpToEnd, handleScroll, jumpToEnd, pinToBottom } = useChatScroll(messages.length);
  const typingRef = useRef<ReturnType<typeof subscribeToTyping> | null>(null);
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { session } = useTeamAuth();
  const myUserId = session?.user.id;

  const reload = () => { listTeamMessages(team.id, search ? { search } : undefined).then(setMessages); };

  const membersRef = useRef(members);
  useEffect(() => { membersRef.current = members; }, [members]);

  useEffect(() => {
    let mounted = true;
    reload();
    listReactions(team.id, 'team_messages').then(r => { if (mounted) setReactions(r); });
    const unsubMsgs = subscribeToTeamMessages(team.id, msg => setMessages(prev => upsertById(prev, hydrateSender(msg, membersRef.current))));
    const unsubReactions = subscribeToReactions(team.id, () => listReactions(team.id, 'team_messages').then(setReactions));
    typingRef.current = subscribeToTyping(team.id, (userId, name) => {
      if (userId === myUserId) return;
      setTypingUsers(prev => ({ ...prev, [userId]: name }));
      if (typingTimeoutsRef.current[userId]) clearTimeout(typingTimeoutsRef.current[userId]);
      typingTimeoutsRef.current[userId] = setTimeout(() => {
        setTypingUsers(prev => { const next = { ...prev }; delete next[userId]; return next; });
      }, 3000);
    });
    return () => { mounted = false; unsubMsgs(); unsubReactions(); typingRef.current?.unsubscribe(); };
  }, [team.id, search]);

  useEffect(() => {
    if (messages.length > 0 && myUserId) markTeamChatRead(team.id, messages[messages.length - 1].id);
  }, [messages.length, team.id, myUserId]);

  const [activeUserIds, setActiveUserIds] = useState<string[]>([]);
  useEffect(() => {
    if (!myUserId) return;
    return subscribeToTeamPresence(team.id, myUserId, setActiveUserIds);
  }, [team.id, myUserId]);

  const handleReportMessage = async (m: TeamMessage) => {
    const { value: reason } = await swal({
      title: 'Report message to admin',
      input: 'textarea',
      inputLabel: 'Why are you reporting this message?',
      showCancelButton: true,
      confirmButtonText: 'Report',
    });
    if (!reason) return;
    const error = await reportMessage(team.id, 'team_messages', m.id, reason);
    if (error) { swal({ icon: 'error', title: 'Could not report message', text: error }); return; }
    swalToast({ icon: 'success', title: 'Reported to admins' });
  };

  const pinned = messages.filter(m => m.pinned && !m.deleted).slice(0, 3);
  const messageById = new Map(messages.map(m => [m.id, m]));
  const reactionsByMessageId = new Map<string, MessageReaction[]>();
  for (const r of reactions) {
    const list = reactionsByMessageId.get(r.message_id) ?? [];
    list.push(r);
    reactionsByMessageId.set(r.message_id, list);
  }

  const handleBodyChange = (v: string) => {
    setBody(v);
    const atMatch = v.match(/@([\w.-]*)$/);
    setMentionQuery(atMatch ? atMatch[1] : null);
    if (myMember?.profile?.name) typingRef.current?.notifyTyping(myUserId || '', myMember.profile.name);
  };

  const insertMention = (name: string) => {
    setBody(b => b.replace(/@([\w.-]*)$/, `@${name.replace(/\s+/g, '')} `));
    setMentionQuery(null);
  };

  const handleAttach = async (file: File, captionOverride?: string) => {
    if (!team.telegram_channel_id || !cc.isConnected) {
      swal({ icon: 'info', title: 'Connect Telegram', text: 'Connect Telegram and set the team channel to send files in chat.' });
      return;
    }
    setAttaching(true);
    const folderId = await ensureChatUploadsFolderId(cc, team);
    const result = await cc.uploadChatAttachment(team.telegram_channel_id, file, folderId);
    if (result && myUserId) {
      await upsertCloudFileMeta({ teamId: team.id, channelMsgId: result.msgId, folderMsgId: folderId, uploaderUserId: myUserId, isChatUpload: true });
    }
    setAttaching(false);
    if (result) {
      const id = crypto.randomUUID();
      const text = body.trim() || captionOverride || `📎 ${result.name}`;
      pinToBottom();
      setMessages(prev => upsertById(prev, {
        id, team_id: team.id, sender_id: myUserId || '', body: text,
        created_at: new Date().toISOString(), reply_to_id: replyTo?.id ?? null,
        edited_at: null, deleted: false, pinned: false,
        attachment_msg_id: result.msgId, attachment_name: result.name, attachment_size: result.size,
        sender: myMember?.profile ? { name: myMember.profile.name, avatar: myMember.profile.avatar } : null,
      }));
      await sendTeamMessage(team.id, text, { id, attachment: result, replyToId: replyTo?.id });
      setBody(''); setReplyTo(null);
    }
  };

  const voiceRecorder = useVoiceRecorder((file) => handleAttach(file, '🎤 Voice message'));

  const handleSend = async () => {
    if (!body.trim()) return;
    const text = body.trim();
    setBody(''); setMentionQuery(null);
    if (editingId) {
      await editTeamMessage(editingId, text);
      setEditingId(null);
      return;
    }
    const id = crypto.randomUUID();
    const replyToId = replyTo?.id;
    pinToBottom();
    setMessages(prev => upsertById(prev, {
      id, team_id: team.id, sender_id: myUserId || '', body: text,
      created_at: new Date().toISOString(), reply_to_id: replyToId ?? null,
      edited_at: null, deleted: false, pinned: false,
      attachment_msg_id: null, attachment_name: null, attachment_size: null,
      sender: myMember?.profile ? { name: myMember.profile.name, avatar: myMember.profile.avatar } : null,
    }));
    setReplyTo(null);
    const error = await sendTeamMessage(team.id, text, { id, replyToId });
    if (error) {
      swal({ icon: 'error', title: 'Message failed to send', text: error });
      setMessages(prev => prev.filter(m => m.id !== id));
      return;
    }

    const mentioned = parseMentions(text, members);
    for (const userId of mentioned) {
      notify(userId, 'Mentioned you', `${myMember?.profile?.name || 'Someone'} mentioned you: "${text.slice(0, 80)}"`);
    }
    const others = members.filter(m => m.status === 'active' && m.user_id && m.user_id !== myUserId && !mentioned.includes(m.user_id!));
    for (const m of others) {
      // Default mode is "all" (every message) — only "mentions_dms" opts out of this
      // team-wide fan-out, since mentions themselves are notified above regardless of mode.
      if (m.notification_prefs?.chat?.mode !== 'mentions_dms') notify(m.user_id!, `New message in ${team.name}`, text.slice(0, 80));
    }
  };

  const mentionCandidates = mentionQuery !== null
    ? members.filter(m => m.status === 'active' && (m.profile?.name || m.invited_email).toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
    : [];

  return (
    <>
      <div className="px-3 pt-2 shrink-0 flex items-center gap-1.5 text-[10px] text-ink-faint">
        <span className={`w-1.5 h-1.5 rounded-full ${activeUserIds.length > 0 ? 'bg-success' : 'bg-ink-faint'}`} />
        {activeUserIds.length === 0 ? 'No users active' : activeUserIds.length === 1 ? '1 user active' : `${activeUserIds.length} users active`}
      </div>
      {pinned.length > 0 && (
        <div className="px-3 py-2 border-b border-hairline bg-accent-soft/40 space-y-1 shrink-0">
          {pinned.map(p => (
            <p key={p.id} className="text-[11px] text-ink-muted truncate flex items-center gap-1">📌 <span className="font-semibold">{p.sender?.name}:</span> {p.body}</p>
          ))}
        </div>
      )}
      <div className="px-3 py-2 border-b border-hairline shrink-0">
        <Input placeholder="Search messages..." value={search} onChange={e => setSearch(e.target.value)} className="text-xs" />
      </div>
      <div ref={scrollRef} onScroll={handleScroll} data-testid="chat-scroll" className="flex-1 overflow-y-auto p-4 space-y-3 relative">
        {messages.length === 0 && <p className="text-xs text-ink-faint text-center py-6">No messages yet — say hello.</p>}
        {messages.map(m => (
          <TeamMessageBubble
            key={m.id}
            message={m}
            replied={m.reply_to_id ? messageById.get(m.reply_to_id) ?? null : null}
            isMine={m.sender_id === myUserId}
            canManage={canManage}
            isVerified={members.find(mm => mm.user_id === m.sender_id)?.is_verified}
            reactions={reactionsByMessageId.get(m.id) ?? EMPTY_REACTIONS}
            myUserId={myUserId}
            teamId={team.id}
            telegramChannelId={team.telegram_channel_id}
            onOpenProfile={onOpenProfile}
            onReply={setReplyTo}
            onEdit={(msg) => { setEditingId(msg.id); setBody(msg.body); }}
            onDelete={deleteTeamMessage}
            onPin={pinTeamMessage}
            onReport={handleReportMessage}
            onDownloadAttachment={(channelId, msgId, name) => cc.downloadTaskAttachment(channelId, msgId, name)}
            onFetchAttachmentPreview={(channelId, msgId, mimeType) => cc.fetchAttachmentBlobUrl(channelId, msgId, mimeType)}
            onToggleReaction={toggleReaction}
          />
        ))}
        {showJumpToEnd && (
          <button
            onClick={jumpToEnd}
            className="absolute right-4 bottom-2 z-10 px-3 py-1.5 rounded-full bg-accent text-white text-[11px] font-semibold shadow-lg flex items-center gap-1 hover:brightness-110 transition-all"
          >
            <ChevronDown size={12} /> New messages
          </button>
        )}
      </div>
      {Object.keys(typingUsers).length > 0 && (
        <div className="px-3 pb-1 shrink-0 flex items-center gap-2 animate-fade-in-up">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-ink/[0.05] border border-hairline">
            <span className="flex -space-x-1.5">
              {Object.keys(typingUsers).slice(0, 4).map(userId => {
                const m = members.find(mm => mm.user_id === userId);
                return <ChatAvatar key={userId} name={m?.profile?.name || 'Member'} avatar={m?.profile?.avatar} size={18} />;
              })}
            </span>
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-ink-faint animate-typing-dot [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-ink-faint animate-typing-dot [animation-delay:150ms]" />
              <span className="w-1 h-1 rounded-full bg-ink-faint animate-typing-dot [animation-delay:300ms]" />
            </span>
          </span>
        </div>
      )}
      {replyTo && (
        <div className="px-3 py-1.5 border-t border-hairline bg-ink/[0.02] flex items-center justify-between gap-2 shrink-0">
          <p className="text-[11px] text-ink-muted truncate">Replying to <span className="font-semibold">{replyTo.sender?.name}</span>: {replyTo.body}</p>
          <button onClick={() => setReplyTo(null)} className="text-ink-faint hover:text-danger text-xs shrink-0">✕</button>
        </div>
      )}
      <div className="p-3 border-t border-hairline shrink-0 relative">
        {mentionCandidates.length > 0 && (
          <div className="absolute bottom-full left-3 mb-1 flex flex-col rounded-xl bg-surface border border-hairline shadow-lg overflow-hidden">
            {mentionCandidates.map(m => (
              <button key={m.id} onClick={() => insertMention(m.profile?.name || m.invited_email)} className="px-3 py-1.5 text-xs text-left hover:bg-accent-soft">
                {m.profile?.name || m.invited_email}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAttach(f); }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={attaching} className="p-2 rounded-xl text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors shrink-0">
            <Paperclip size={16} />
          </button>
          <button
            type="button"
            onClick={voiceRecorder.toggle}
            disabled={attaching}
            className={`p-2 rounded-xl transition-colors shrink-0 ${voiceRecorder.isRecording ? 'text-white bg-danger animate-pulse' : 'text-ink-faint hover:text-accent hover:bg-accent-soft'}`}
            aria-label={voiceRecorder.isRecording ? 'Stop recording' : 'Record voice message'}
            title={voiceRecorder.isRecording ? 'Stop recording' : 'Record voice message'}
          >
            <Mic size={16} />
          </button>
          <Input placeholder={editingId ? 'Edit message...' : 'Message the team...'} value={body} onChange={e => handleBodyChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} className="flex-1" />
          <Button onClick={handleSend}><Send size={14} /></Button>
        </div>
      </div>
    </>
  );
}

function ConversationList({ team, members, myMember, onSelect }: { team: Team; members: TeamMember[]; myMember: TeamMember | null; onSelect: (userId: string) => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => { setConversations(await listConversations(team.id)); setLoading(false); })();
  }, [team.id]);

  const others = members.filter(m => m.status === 'active' && m.user_id && m.user_id !== myMember?.user_id);
  const contacted = new Set(conversations.map(c => c.otherUserId));

  if (loading) {
    return (
      <div className="divide-y divide-hairline">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
      {conversations.map(c => (
        <button key={c.otherUserId} onClick={() => onSelect(c.otherUserId)} className="w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-ink/5 transition-colors text-left">
          <ChatAvatar name={c.otherName} avatar={c.otherAvatar} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink truncate">{c.otherName}</p>
            <p className="text-xs text-ink-faint truncate">{c.lastMessage}</p>
          </div>
          {c.unread > 0 && <span className="text-[10px] font-bold text-white bg-accent rounded-full w-5 h-5 flex items-center justify-center shrink-0">{c.unread}</span>}
        </button>
      ))}
      {others.filter(m => !contacted.has(m.user_id!)).map(m => (
        <button key={m.id} onClick={() => onSelect(m.user_id!)} className="w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-ink/5 transition-colors text-left">
          <ChatAvatar name={m.profile?.name || m.invited_email} avatar={m.profile?.avatar} />
          <p className="text-sm text-ink">{m.profile?.name || m.invited_email}</p>
        </button>
      ))}
      {conversations.length === 0 && others.length === 0 && <p className="text-xs text-ink-faint text-center py-6">No teammates to message yet.</p>}
    </div>
  );
}

function DirectThread({ team, partnerId, partnerName, partnerAvatar, onBack, onOpenProfile, cc }: {
  team: Team; partnerId: string; partnerName: string; partnerAvatar?: string; onBack: () => void; onOpenProfile: (userId: string) => void; cc: CloudClient;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const { scrollRef, showJumpToEnd, handleScroll, jumpToEnd, pinToBottom } = useChatScroll(messages.length);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { session } = useTeamAuth();
  const myUserId = session?.user.id;

  useEffect(() => {
    let mounted = true;
    listDirectMessages(team.id, partnerId).then(msgs => { if (mounted) setMessages(msgs); });
    listReactions(team.id, 'direct_messages').then(r => { if (mounted) setReactions(r); });
    markDirectMessagesRead(team.id, partnerId);
    const unsubscribe = subscribeToDirectMessages(team.id, msg => {
      if (msg.sender_id === partnerId || msg.receiver_id === partnerId) setMessages(prev => upsertById(prev, msg));
    });
    const unsubReactions = subscribeToReactions(team.id, () => listReactions(team.id, 'direct_messages').then(setReactions));
    return () => { mounted = false; unsubscribe(); unsubReactions(); };
  }, [team.id, partnerId]);

  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  useEffect(() => {
    if (!myUserId) return;
    return subscribeToGlobalPresence(myUserId, setOnlineUserIds);
  }, [myUserId]);
  const isPartnerOnline = onlineUserIds.includes(partnerId);

  const handleReportMessage = async (m: DirectMessage) => {
    const { value: reason } = await swal({
      title: 'Report message to admin',
      input: 'textarea',
      inputLabel: 'Why are you reporting this message?',
      showCancelButton: true,
      confirmButtonText: 'Report',
    });
    if (!reason) return;
    const error = await reportMessage(team.id, 'direct_messages', m.id, reason);
    if (error) { swal({ icon: 'error', title: 'Could not report message', text: error }); return; }
    swalToast({ icon: 'success', title: 'Reported to admins' });
  };

  const messageById = new Map(messages.map(m => [m.id, m]));
  const reactionsByMessageId = new Map<string, MessageReaction[]>();
  for (const r of reactions) {
    const list = reactionsByMessageId.get(r.message_id) ?? [];
    list.push(r);
    reactionsByMessageId.set(r.message_id, list);
  }

  const handleAttach = async (file: File, captionOverride?: string) => {
    if (!team.telegram_channel_id || !cc.isConnected) {
      swal({ icon: 'info', title: 'Connect Telegram', text: 'Connect Telegram and set the team channel to send files in chat.' });
      return;
    }
    setAttaching(true);
    const folderId = await ensureChatUploadsFolderId(cc, team);
    const result = await cc.uploadChatAttachment(team.telegram_channel_id, file, folderId);
    if (result && myUserId) {
      await upsertCloudFileMeta({ teamId: team.id, channelMsgId: result.msgId, folderMsgId: folderId, uploaderUserId: myUserId, isChatUpload: true, visibility: 'private', ownerUserId: myUserId });
    }
    setAttaching(false);
    if (result) {
      const id = crypto.randomUUID();
      const text = body.trim() || captionOverride || `📎 ${result.name}`;
      pinToBottom();
      setMessages(prev => upsertById(prev, {
        id, team_id: team.id, sender_id: myUserId || '', receiver_id: partnerId, body: text, read: false,
        created_at: new Date().toISOString(), reply_to_id: replyTo?.id ?? null, edited_at: null, deleted: false,
        attachment_msg_id: result.msgId, attachment_name: result.name, attachment_size: result.size,
      }));
      await sendDirectMessage(team.id, partnerId, text, { id, attachment: result, replyToId: replyTo?.id });
      setBody(''); setReplyTo(null);
    }
  };

  const voiceRecorder = useVoiceRecorder((file) => handleAttach(file, '🎤 Voice message'));

  const handleSend = async () => {
    if (!body.trim()) return;
    const text = body.trim();
    setBody('');
    if (editingId) {
      await editDirectMessage(editingId, text);
      setEditingId(null);
      return;
    }
    const id = crypto.randomUUID();
    const replyToId = replyTo?.id;
    pinToBottom();
    setMessages(prev => upsertById(prev, {
      id, team_id: team.id, sender_id: myUserId || '', receiver_id: partnerId, body: text, read: false,
      created_at: new Date().toISOString(), reply_to_id: replyToId ?? null, edited_at: null, deleted: false,
      attachment_msg_id: null, attachment_name: null, attachment_size: null,
    }));
    setReplyTo(null);
    const error = await sendDirectMessage(team.id, partnerId, text, { id, replyToId });
    if (error) {
      swal({ icon: 'error', title: 'Message failed to send', text: error });
      setMessages(prev => prev.filter(m => m.id !== id));
      return;
    }
    notify(partnerId, `New message from ${session?.user.email || 'a teammate'}`, text.slice(0, 80));
  };

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
        <button onClick={onBack} aria-label="Back" className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors">
          <ArrowLeft size={14} />
        </button>
        <button type="button" onClick={() => onOpenProfile(partnerId)} className="flex items-center gap-2 hover:opacity-80">
          <span className="relative">
            <ChatAvatar name={partnerName} avatar={partnerAvatar} size={24} />
            {isPartnerOnline && <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-success border border-surface" />}
          </span>
          <p className="text-sm font-semibold text-ink">{partnerName}</p>
        </button>
      </div>
      <div ref={scrollRef} onScroll={handleScroll} data-testid="chat-scroll" className="flex-1 overflow-y-auto p-4 space-y-3 relative">
        {messages.map(m => (
          <DirectMessageBubble
            key={m.id}
            message={m}
            replied={m.reply_to_id ? messageById.get(m.reply_to_id) ?? null : null}
            isMine={m.sender_id !== partnerId}
            partnerId={partnerId}
            isPartnerOnline={isPartnerOnline}
            reactions={reactionsByMessageId.get(m.id) ?? EMPTY_REACTIONS}
            myUserId={myUserId}
            teamId={team.id}
            telegramChannelId={team.telegram_channel_id}
            partnerName={partnerName}
            partnerAvatar={partnerAvatar}
            onDownloadAttachment={(channelId, msgId, name) => cc.downloadTaskAttachment(channelId, msgId, name)}
            onFetchAttachmentPreview={(channelId, msgId, mimeType) => cc.fetchAttachmentBlobUrl(channelId, msgId, mimeType)}
            onReply={setReplyTo}
            onEdit={(msg) => { setEditingId(msg.id); setBody(msg.body); }}
            onDelete={deleteDirectMessage}
            onReport={handleReportMessage}
            onToggleReaction={toggleReaction}
          />
        ))}
        {showJumpToEnd && (
          <button
            onClick={jumpToEnd}
            className="absolute right-4 bottom-2 z-10 px-3 py-1.5 rounded-full bg-accent text-white text-[11px] font-semibold shadow-lg flex items-center gap-1 hover:brightness-110 transition-all"
          >
            <ChevronDown size={12} /> New messages
          </button>
        )}
      </div>
      {replyTo && (
        <div className="px-3 py-1.5 border-t border-hairline bg-ink/[0.02] flex items-center justify-between gap-2 shrink-0">
          <p className="text-[11px] text-ink-muted truncate">Replying to: {replyTo.body}</p>
          <button onClick={() => setReplyTo(null)} className="text-ink-faint hover:text-danger text-xs shrink-0">✕</button>
        </div>
      )}
      <div className="p-3 border-t border-hairline flex gap-2 shrink-0">
        <input ref={fileInputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAttach(f); }} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={attaching} className="p-2 rounded-xl text-ink-faint hover:text-accent hover:bg-accent-soft transition-colors shrink-0">
          <Paperclip size={16} />
        </button>
        <button
          type="button"
          onClick={voiceRecorder.toggle}
          disabled={attaching}
          className={`p-2 rounded-xl transition-colors shrink-0 ${voiceRecorder.isRecording ? 'text-white bg-danger animate-pulse' : 'text-ink-faint hover:text-accent hover:bg-accent-soft'}`}
          aria-label={voiceRecorder.isRecording ? 'Stop recording' : 'Record voice message'}
          title={voiceRecorder.isRecording ? 'Stop recording' : 'Record voice message'}
        >
          <Mic size={16} />
        </button>
        <Input placeholder={editingId ? 'Edit message...' : 'Type a message...'} value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} className="flex-1" />
        <Button onClick={handleSend}><Send size={14} /></Button>
      </div>
    </>
  );
}

function MemberProfileModal({ team, member, canManage, isOwner, onClose, onChanged }: {
  team: Team; member: TeamMember; canManage: boolean; isOwner: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [badges, setBadges] = useState<MemberBadge[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (member.user_id) listMemberBadges(team.id, member.user_id).then(setBadges); }, [team.id, member.user_id]);

  const withBusy = (fn: () => Promise<string | null>) => async () => {
    setBusy(true);
    const error = await fn();
    setBusy(false);
    if (error) { swal({ icon: 'error', title: 'Action failed', text: error }); return; }
    onChanged();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Member Profile" size="sm">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ChatAvatar name={member.profile?.name || member.invited_email} avatar={member.profile?.avatar} size={52} />
          <div className="min-w-0">
            <p className="text-base font-semibold text-ink truncate flex items-center gap-1.5">
              {member.profile?.name || member.invited_email}
              {member.role === 'leader' && <Crown size={13} className="text-accent shrink-0" />}
            </p>
            <p className="text-xs text-ink-faint">{member.job_title || 'No job title'}{member.priority != null ? ` · P${member.priority}` : ''}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-ink-faint text-xs">Streak</p><p className="font-bold text-ink flex items-center gap-1"><Flame size={13} className="text-accent" /> {member.streak_count} days</p></div>
          <div><p className="text-ink-faint text-xs">Balance</p><p className="font-bold text-ink">${member.balance.toFixed(2)}</p></div>
          <div><p className="text-ink-faint text-xs">Status</p><p className="font-semibold text-ink">{member.member_status.replace('_', ' ')}</p></div>
          <div><p className="text-ink-faint text-xs">Available</p><p className="font-semibold text-ink">{member.is_active ? 'Yes' : 'No'}</p></div>
        </div>

        {badges.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-accent font-semibold">Badges</p>
            <div className="flex flex-wrap gap-1.5">
              {badges.map(b => (
                <span key={b.code} className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-accent-soft text-accent flex items-center gap-1"><Trophy size={11} /> {b.label}</span>
              ))}
            </div>
          </div>
        )}

        {canManage && isOwner && (
          <div className="flex gap-2 pt-2 border-t border-hairline">
            {member.role === 'leader' ? (
              <Button size="sm" variant="secondary" onClick={withBusy(() => demoteToMember(member.id))} disabled={busy}><ArrowDownCircle size={13} /> Demote</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={withBusy(() => promoteToLeader(member.id))} disabled={busy}><ArrowUpCircle size={13} /> Promote</Button>
            )}
            <Button size="sm" variant="danger" onClick={withBusy(() => removeMember(member.id))} disabled={busy}><UserMinus size={13} /> Remove</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Admin — team settings, broadcast, danger zone (owner only)
// ---------------------------------------------------------------------------

function AdminSection({ team, members, onChanged }: { team: Team; members: TeamMember[]; onChanged: () => void }) {
  const [name, setName] = useState(team.name);
  const [transferTo, setTransferTo] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);

  const handleCreateInviteLink = async () => {
    setCreatingInvite(true);
    const { token, error } = await createInviteToken(team.id);
    setCreatingInvite(false);
    if (error || !token) { swal({ icon: 'error', title: 'Could not create invite link', text: error || 'Unknown error' }); return; }
    const link = `${window.location.origin}${window.location.pathname}?join=${token.token}`;
    await navigator.clipboard.writeText(link);
    swalToast({ icon: 'success', title: 'Invite link copied to clipboard' });
  };

  const handleTransfer = async () => {
    if (!transferTo) return;
    const result = await swal({
      icon: 'warning',
      title: 'Propose ownership transfer?',
      text: 'The nominee must accept before ownership actually changes.',
      showCancelButton: true,
      confirmButtonText: 'Send Offer',
    });
    if (!result.isConfirmed) return;
    setTransferring(true);
    const error = await requestOwnerTransfer(team.id, transferTo);
    setTransferring(false);
    if (error) { swal({ icon: 'error', title: 'Could not send offer', text: error }); return; }
    swalToast({ icon: 'success', title: 'Transfer offer sent' });
    setTransferTo('');
  };
  const [description, setDescription] = useState(team.description);
  const [payNote, setPayNote] = useState(team.pay_note);
  const [visibility, setVisibility] = useState<'public' | 'private'>(team.visibility);
  const [joinAdUrl, setJoinAdUrl] = useState(team.join_ad_url || '');
  const [tags, setTags] = useState<string[]>(team.tags || []);
  const [savingSettings, setSavingSettings] = useState(false);
  const joinAdInputRef = useRef<HTMLInputElement>(null);

  const toggleTag = (tag: string) => {
    setTags(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);
  };

  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  const [deleting, setDeleting] = useState(false);

  const [customDefs, setCustomDefs] = useState<TeamCustomPermissionDef[]>([]);
  const [newPermKey, setNewPermKey] = useState('');
  const [newPermLabel, setNewPermLabel] = useState('');
  const [creatingPerm, setCreatingPerm] = useState(false);

  const reloadCustomDefs = () => { listCustomPermissionDefs(team.id).then(setCustomDefs); };
  useEffect(() => { reloadCustomDefs(); }, [team.id]);

  const handleCreatePermDef = async () => {
    const key = newPermKey.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    if (!key || !newPermLabel.trim()) { swal({ icon: 'error', title: 'Key and label are both required' }); return; }
    setCreatingPerm(true);
    const error = await createCustomPermissionDef(team.id, key, newPermLabel.trim());
    setCreatingPerm(false);
    if (error) { swal({ icon: 'error', title: 'Could not create permission', text: error }); return; }
    setNewPermKey(''); setNewPermLabel('');
    reloadCustomDefs();
  };

  const handleDeletePermDef = async (def: TeamCustomPermissionDef) => {
    const result = await swal({ icon: 'warning', title: `Delete "${def.label}"?`, text: 'Revokes it from everyone it was granted to.', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#FF3B30' });
    if (!result.isConfirmed) return;
    const error = await deleteCustomPermissionDef(def.id);
    if (error) { swal({ icon: 'error', title: 'Could not delete permission', text: error }); return; }
    reloadCustomDefs();
  };

  const handleSaveSettings = async () => {
    if (!name.trim()) { swal({ icon: 'error', title: 'Team name is required' }); return; }
    setSavingSettings(true);
    let joinAdUploaded = joinAdUrl;
    if (joinAdUrl.startsWith('data:')) {
      const uploaded = await uploadImageToStorage(joinAdUrl, `teams/${team.id}/join-ad.jpg`);
      if (uploaded) joinAdUploaded = uploaded;
    }
    const error = await updateTeamSettings(team.id, { name: name.trim(), description: description.trim(), pay_note: payNote.trim(), visibility, join_ad_url: joinAdUploaded || null, tags });
    setSavingSettings(false);
    if (error) { swal({ icon: 'error', title: 'Could not save', text: error }); return; }
    swalToast({ icon: 'success', title: 'Team settings saved' });
    onChanged();
  };

  const handleBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) { swal({ icon: 'error', title: 'Title and message required' }); return; }
    setBroadcasting(true);
    const error = await broadcastToTeam(team.id, broadcastTitle.trim(), broadcastBody.trim());
    setBroadcasting(false);
    if (error) { swal({ icon: 'error', title: 'Could not broadcast', text: error }); return; }
    swalToast({ icon: 'success', title: 'Broadcast sent to every member' });
    setBroadcastTitle(''); setBroadcastBody('');
  };

  const handleDeleteTeam = async () => {
    const result = await swal({
      icon: 'warning',
      title: `Permanently delete "${team.name}"?`,
      text: 'This removes every member, task, transaction, and message for this team. This cannot be undone.',
      showCancelButton: true,
      confirmButtonText: 'Delete Team',
      confirmButtonColor: '#FF3B30',
    });
    if (!result.isConfirmed) return;
    setDeleting(true);
    const error = await deleteTeam(team.id);
    setDeleting(false);
    if (error) { swal({ icon: 'error', title: 'Could not delete team', text: error }); return; }
    swalToast({ icon: 'success', title: 'Team deleted' });
    onChanged();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Team Settings</h3>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Name</label>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Description</label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Usual Pay</label>
          <Input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="e.g. $10–20 per task" />
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl border border-hairline">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            {visibility === 'public' ? <Globe size={14} className="text-accent" /> : <Lock size={14} className="text-ink-faint" />}
            {visibility === 'public' ? 'Public — listed in directory' : 'Private — join by ID only'}
          </div>
          <Switch checked={visibility === 'public'} onChange={v => setVisibility(v ? 'public' : 'private')} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Specialty Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {JOB_TITLES.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  tags.includes(tag) ? 'bg-accent text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-accent font-semibold">Join Ad Image</label>
          <p className="text-[10px] text-ink-faint">Shown at the top of your team's card in the public directory</p>
          <button
            type="button"
            onClick={() => joinAdInputRef.current?.click()}
            className="w-full max-h-56 rounded-xl overflow-hidden border border-dashed border-hairline flex items-center justify-center bg-ink/[0.02] hover:bg-ink/[0.05] transition-colors"
          >
            {joinAdUrl ? <img src={joinAdUrl} alt="Join ad" className="w-full max-h-56 object-contain" /> : <ImagePlus size={20} className="text-ink-faint" />}
          </button>
          <input ref={joinAdInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readAvatarFile(f, setJoinAdUrl, 480); }} />
        </div>
        <Button className="w-full" onClick={handleSaveSettings} disabled={savingSettings}>{savingSettings ? 'Saving...' : 'Save Settings'}</Button>
      </GlassCard>

      <GlassCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Megaphone size={16} className="text-accent" /> Broadcast to Everyone</h3>
        <Input placeholder="Announcement title" value={broadcastTitle} onChange={e => setBroadcastTitle(e.target.value)} />
        <Textarea placeholder="Message..." value={broadcastBody} onChange={e => setBroadcastBody(e.target.value)} rows={4} />
        <Button className="w-full" onClick={handleBroadcast} disabled={broadcasting}>{broadcasting ? 'Sending...' : 'Send to All Members'}</Button>
      </GlassCard>

      <GlassCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><LinkIcon size={16} className="text-accent" /> Invite Link</h3>
        <p className="text-xs text-ink-muted">Anyone who opens the link can request to join — you still approve or reject each request.</p>
        <Button className="w-full" variant="secondary" onClick={handleCreateInviteLink} disabled={creatingInvite}>{creatingInvite ? 'Creating...' : 'Copy Invite Link'}</Button>
      </GlassCard>

      <GlassCard className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Crown size={16} className="text-accent" /> Transfer Ownership</h3>
        <p className="text-xs text-ink-muted">The nominee must accept before ownership changes — this doesn't happen instantly.</p>
        <select
          value={transferTo}
          onChange={e => setTransferTo(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-hairline bg-transparent text-sm text-ink"
        >
          <option value="">Select a member...</option>
          {members.filter(m => m.status === 'active' && m.user_id && m.user_id !== team.owner_id).map(m => (
            <option key={m.id} value={m.user_id!}>{m.profile?.name || m.invited_email}</option>
          ))}
        </select>
        <Button className="w-full" onClick={handleTransfer} disabled={transferring || !transferTo}>{transferring ? 'Sending...' : 'Propose Transfer'}</Button>
      </GlassCard>

      <GlassCard className="p-6 space-y-3 lg:col-span-2">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><ShieldCheck size={16} className="text-accent" /> Custom Permissions</h3>
        <p className="text-xs text-ink-muted">Define your own enforced permissions (beyond the built-in list) and grant them to specific leaders from the Roster's Edit Member dialog.</p>
        <div className="flex flex-wrap gap-1.5">
          {customDefs.map(def => (
            <span key={def.id} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-ink/5 text-ink-muted flex items-center gap-1.5">
              {def.label} <span className="text-ink-faint">({def.key})</span>
              <button type="button" onClick={() => handleDeletePermDef(def)} className="hover:text-danger">✕</button>
            </span>
          ))}
          {customDefs.length === 0 && <p className="text-[11px] text-ink-faint">No custom permissions defined yet.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="key (e.g. can_edit_covers)" value={newPermKey} onChange={e => setNewPermKey(e.target.value)} className="flex-1 min-w-[160px]" />
          <Input placeholder="Label (e.g. Edit Covers)" value={newPermLabel} onChange={e => setNewPermLabel(e.target.value)} className="flex-1 min-w-[160px]" />
          <Button type="button" variant="secondary" size="sm" onClick={handleCreatePermDef} disabled={creatingPerm}>{creatingPerm ? 'Adding...' : 'Add Permission'}</Button>
        </div>
      </GlassCard>

      <GlassCard className="p-6 space-y-3 border-danger/30 lg:col-span-2">
        <h3 className="text-sm font-semibold text-danger flex items-center gap-2"><AlertTriangle size={16} /> Danger Zone</h3>
        <p className="text-xs text-ink-muted">Deleting the team removes all members, tasks, transactions, and messages permanently.</p>
        <Button variant="danger" onClick={handleDeleteTeam} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete Team'}</Button>
      </GlassCard>
    </div>
  );
}
