import { supabase } from './supabaseClient';
import { notify } from './notifications';

export type TaskStatus = 'todo' | 'in_progress' | 'under_review' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  team_id: string;
  creator_id: string;
  assignee_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  due_date: string | null;
  attachment_name: string;
  attachment_size: number;
  attachment_msg_id: number | null;
  created_at: string;
  completed_at: string | null;
  reward: number | null;
  job_types: string[];
  submission_type: 'file' | 'link' | null;
  submission_content: string | null;
  rating: number | null;
  priority_index: number;
  priority: TaskPriority;
  tags: string[];
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrence_parent_id: string | null;
  offer_expires_at: string | null;
  /** Index into job_types — which pipeline stage currently holds the task. job_types.length === 1 behaves exactly as a single-stage task always has. */
  stage_index: number;
  last_outcome: 'pending' | 'success' | 'revision' | 'unsuccessful' | null;
  assignee?: { name: string; avatar: string; email: string } | null;
}

export interface TaskStageHistoryEntry {
  id: string;
  task_id: string;
  job_type: string;
  assignee_id: string | null;
  completed_at: string;
}

export async function listTaskStageHistory(taskId: string): Promise<TaskStageHistoryEntry[]> {
  const { data } = await supabase.from('task_stage_history').select('*').eq('task_id', taskId).order('completed_at', { ascending: true });
  return (data as TaskStageHistoryEntry[]) ?? [];
}

/** Team-wide stage history for analytics (avg time-in-stage) — joins through tasks.team_id rather than N+1 per-task calls. */
export async function listTeamStageHistory(teamId: string): Promise<(TaskStageHistoryEntry & { task_created_at: string })[]> {
  const { data } = await supabase
    .from('task_stage_history')
    .select('*, tasks!inner(team_id, created_at)')
    .eq('tasks.team_id', teamId)
    .order('completed_at', { ascending: true });
  return ((data as any[]) ?? []).map(row => ({
    id: row.id, task_id: row.task_id, job_type: row.job_type, assignee_id: row.assignee_id, completed_at: row.completed_at,
    task_created_at: row.tasks?.created_at,
  }));
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.rpc(fn, args);
  return error ? error.message : null;
}

export async function createTaskWithWorkflow(input: {
  teamId: string; title: string; description: string;
  jobTypes: string[]; dueDate: string | null; reward?: number;
  attachment?: { msgId: number; name: string; size: number };
  priority?: TaskPriority; tags?: string[]; recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  assigneeId?: string | null; offerExpiresAt?: string | null;
  mentionedUserIds?: string[];
}): Promise<string | null> {
  const { data, error } = await supabase.rpc('task_create', {
    _team_id: input.teamId, _title: input.title, _description: input.description,
    _difficulty: 'Medium', _job_types: input.jobTypes, _due_date: input.dueDate,
    _reward: input.reward ?? null,
    _attachment_msg_id: input.attachment?.msgId ?? null,
    _attachment_name: input.attachment?.name ?? null,
    _attachment_size: input.attachment?.size ?? null,
    _priority: input.priority ?? 'normal',
    _tags: input.tags ?? [],
    _recurrence: input.recurrence ?? 'none',
    _assignee_id: input.assigneeId ?? null,
    _offer_expires_at: input.offerExpiresAt ?? null,
  });
  if (error) return error.message;
  const created = data as Task | null;
  if (created?.assignee_id) {
    const { data: member } = await supabase
      .from('team_members')
      .select('notification_prefs')
      .eq('team_id', input.teamId)
      .eq('user_id', created.assignee_id)
      .maybeSingle();
    if ((member?.notification_prefs as { tasks?: boolean } | null)?.tasks !== false) {
      await notify(created.assignee_id, 'New task assigned', input.title);
    }
  }
  for (const userId of input.mentionedUserIds ?? []) {
    if (userId !== created?.assignee_id) await notify(userId, 'Mentioned in a task', input.title);
  }
  return null;
}

export const acceptTask = (taskId: string) => rpc('task_accept', { _task_id: taskId });
export const declineTask = (taskId: string) => rpc('task_decline', { _task_id: taskId });
export const submitTask = (taskId: string, type: 'file' | 'link', content: string) =>
  rpc('task_submit', { _task_id: taskId, _type: type, _content: content });
export const approveTask = (taskId: string, rating: number) =>
  rpc('task_approve', { _task_id: taskId, _rating: rating });
export const rejectSubmission = (taskId: string, notes: string) =>
  rpc('task_reject_submission', { _task_id: taskId, _notes: notes });

/** Terminal failure, distinct from `rejectSubmission`'s retry/revision loop — see
 *  `last_outcome` on Task. */
export const markTaskUnsuccessful = (taskId: string, notes?: string) =>
  rpc('task_mark_unsuccessful', { _task_id: taskId, _notes: notes ?? null });
export const checkIn = (teamId: string) => rpc('team_check_in', { _team_id: teamId });
export const setMemberActive = (teamId: string, isActive: boolean) =>
  rpc('team_set_active', { _team_id: teamId, _is_active: isActive });
export const changePriority = (teamId: string, requested: number) =>
  rpc('team_change_priority', { _team_id: teamId, _requested: requested });

export async function reassignMemberTasks(teamId: string, fromUser: string, toUser: string): Promise<{ moved: number; error: string | null }> {
  const { data, error } = await supabase.rpc('reassign_member_tasks', { _team_id: teamId, _from_user: fromUser, _to_user: toUser });
  return { moved: (data as number) ?? 0, error: error ? error.message : null };
}

export async function expireStaleOffers(teamId: string): Promise<void> {
  await supabase.rpc('expire_stale_task_offers', { _team_id: teamId });
}

export async function notifyUpcomingTaskDeadlines(teamId: string): Promise<void> {
  await supabase.rpc('notify_upcoming_task_deadlines', { _team_id: teamId });
}

export async function spawnRecurringTasks(teamId: string): Promise<void> {
  await supabase.rpc('spawn_recurring_tasks', { _team_id: teamId });
}

export async function listTeamTasks(teamId: string): Promise<Task[]> {
  const { data } = await supabase
    .from('tasks')
    .select('*, assignee:profiles!tasks_assignee_id_fkey(name, avatar, email)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });
  return (data as unknown as Task[]) ?? [];
}

export async function listMyTasks(teamId: string): Promise<Task[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('team_id', teamId)
    .eq('assignee_id', userId)
    .order('created_at', { ascending: false });
  return (data as Task[]) ?? [];
}

export async function deleteTask(taskId: string): Promise<string | null> {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  return error ? error.message : null;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploader_id: string;
  msg_id: number;
  name: string;
  size: number;
  kind: 'reference' | 'submission';
  created_at: string;
}

/** Records a task attachment as its own row (task_attachments), tagged by kind, instead of
 *  overwriting the legacy single-slot tasks.attachment_* columns shared between creator/assignee. */
export async function attachFileToTask(taskId: string, attachment: { msgId: number; name: string; size: number }, kind: 'reference' | 'submission' = 'submission'): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uploaderId = userData.user?.id;
  if (!uploaderId) return 'Not signed in.';
  const { error } = await supabase.from('task_attachments').insert({
    task_id: taskId, uploader_id: uploaderId, msg_id: attachment.msgId, name: attachment.name, size: attachment.size, kind,
  });
  return error ? error.message : null;
}

export async function listTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
  const { data } = await supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at', { ascending: true });
  return (data as TaskAttachment[]) ?? [];
}

export interface TaskChecklistItem {
  id: string;
  task_id: string;
  label: string;
  done: boolean;
  position: number;
  created_by: string;
  created_at: string;
}

export async function listChecklistItems(taskId: string): Promise<TaskChecklistItem[]> {
  const { data } = await supabase.from('task_checklist_items').select('*').eq('task_id', taskId).order('position', { ascending: true });
  return (data as TaskChecklistItem[]) ?? [];
}

export async function addChecklistItem(taskId: string, label: string, position: number): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'Not signed in.';
  const { error } = await supabase.from('task_checklist_items').insert({ task_id: taskId, label, position, created_by: userId });
  return error ? error.message : null;
}

export async function toggleChecklistItem(id: string, done: boolean): Promise<string | null> {
  const { error } = await supabase.from('task_checklist_items').update({ done }).eq('id', id);
  return error ? error.message : null;
}

export async function deleteChecklistItem(id: string): Promise<string | null> {
  const { error } = await supabase.from('task_checklist_items').delete().eq('id', id);
  return error ? error.message : null;
}

export interface TaskHistoryEntry {
  id: string;
  task_id: string;
  actor_id: string | null;
  event: string;
  detail: string | null;
  created_at: string;
}

export async function listTaskHistory(taskId: string): Promise<TaskHistoryEntry[]> {
  const { data } = await supabase.from('task_history').select('*').eq('task_id', taskId).order('created_at', { ascending: true });
  return (data as TaskHistoryEntry[]) ?? [];
}

export interface TaskTimeEntry {
  id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
}

export async function listTimeEntries(taskId: string): Promise<TaskTimeEntry[]> {
  const { data } = await supabase.from('task_time_entries').select('*').eq('task_id', taskId).order('started_at', { ascending: true });
  return (data as TaskTimeEntry[]) ?? [];
}

export async function getMyOpenTimeEntry(taskId: string): Promise<TaskTimeEntry | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data } = await supabase.from('task_time_entries').select('*').eq('task_id', taskId).eq('user_id', userId).is('ended_at', null).maybeSingle();
  return (data as TaskTimeEntry) ?? null;
}

export async function startTimer(taskId: string): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return 'Not signed in.';
  const { error } = await supabase.from('task_time_entries').insert({ task_id: taskId, user_id: userId });
  return error ? error.message : null;
}

export async function stopTimer(entryId: string): Promise<string | null> {
  const { error } = await supabase.from('task_time_entries').update({ ended_at: new Date().toISOString() }).eq('id', entryId);
  return error ? error.message : null;
}

export function totalTrackedMs(entries: TaskTimeEntry[]): number {
  return entries.reduce((sum, e) => sum + ((e.ended_at ? new Date(e.ended_at).getTime() : Date.now()) - new Date(e.started_at).getTime()), 0);
}

export async function listDependencies(taskId: string): Promise<{ depends_on_task_id: string }[]> {
  const { data } = await supabase.from('task_dependencies').select('depends_on_task_id').eq('task_id', taskId);
  return data ?? [];
}

export async function addDependency(taskId: string, dependsOnTaskId: string): Promise<string | null> {
  const { error } = await supabase.from('task_dependencies').insert({ task_id: taskId, depends_on_task_id: dependsOnTaskId });
  return error ? error.message : null;
}

export async function removeDependency(taskId: string, dependsOnTaskId: string): Promise<string | null> {
  const { error } = await supabase.from('task_dependencies').delete().eq('task_id', taskId).eq('depends_on_task_id', dependsOnTaskId);
  return error ? error.message : null;
}

export async function setTeamTelegramChannel(teamId: string, channelId: string): Promise<string | null> {
  const { error } = await supabase.from('teams').update({ telegram_channel_id: channelId }).eq('id', teamId);
  return error ? error.message : null;
}
