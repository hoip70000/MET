-- Task offers were on a 48h timeout before reassigning to the next-priority
-- candidate; spec calls for 24h. These are `create or replace function` redefinitions
-- of the exact bodies from 0048_multi_job_pipeline.sql (the latest prior definition of
-- each), with every `interval '48 hours'` changed to `interval '24 hours'` — no other
-- behavior changes.

create or replace function public.task_create(
  _team_id uuid, _title text, _description text, _difficulty text,
  _job_types text[], _due_date timestamptz, _reward numeric default null,
  _attachment_msg_id int default null, _attachment_name text default null, _attachment_size int default null,
  _priority text default 'normal', _tags text[] default '{}', _recurrence text default 'none',
  _assignee_id uuid default null, _offer_expires_at timestamptz default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  primary_job text;
  candidate uuid;
  t public.tasks;
begin
  if not (public.is_team_manager(_team_id) or public.team_member_has_perm(_team_id, 'can_manage_tasks')) then
    raise exception 'Not authorized';
  end if;

  primary_job := _job_types[1];

  if _assignee_id is not null then
    if not exists (
      select 1 from public.team_members
      where team_id = _team_id and user_id = _assignee_id and status = 'active'
    ) then
      raise exception 'Chosen assignee is not an active member of this team';
    end if;
    candidate := _assignee_id;
  else
    candidate := public.team_job_first_candidate(_team_id, primary_job);
  end if;

  insert into public.tasks (
    team_id, creator_id, assignee_id, title, description, status, due_date,
    difficulty, reward, job_types, priority_index, stage_index, offer_expires_at,
    attachment_msg_id, attachment_name, attachment_size, priority, tags, recurrence
  ) values (
    _team_id, auth.uid(), coalesce(candidate, auth.uid()), _title, _description,
    'todo', _due_date, _difficulty, _reward, _job_types, 1, 0, coalesce(_offer_expires_at, now() + interval '24 hours'),
    _attachment_msg_id, _attachment_name, _attachment_size, _priority, _tags, _recurrence
  ) returning * into t;

  insert into public.task_history (task_id, actor_id, event, detail) values (t.id, auth.uid(), 'created', null);

  if candidate is not null then
    insert into public.notifications (user_id, title, body)
    values (candidate, 'New task offer: ' || _title, 'You''re priority for ' || primary_job || ' on this task.');
  end if;

  return t;
end;
$$;

create or replace function public.task_decline(_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  stage_job text;
  next_user uuid;
begin
  select * into t from public.tasks where id = _task_id and assignee_id = auth.uid() and status = 'todo' for update;
  if not found then raise exception 'Task not found or not declinable'; end if;

  stage_job := t.job_types[t.stage_index + 1];
  next_user := public.team_job_next_candidate(t.team_id, stage_job, t.priority_index, auth.uid());

  if next_user is not null then
    update public.tasks set assignee_id = next_user, priority_index = priority_index + 1, offer_expires_at = now() + interval '24 hours'
      where id = _task_id;
    insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'declined', 'reassigned to next candidate');
    insert into public.notifications (user_id, title, body)
    values (next_user, 'New task offer: ' || t.title, 'You''re next in line for ' || stage_job || '.');
  else
    update public.tasks set assignee_id = t.creator_id, status = 'cancelled' where id = _task_id;
    insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'declined', 'no candidate left, cancelled');
    insert into public.notifications (user_id, title, body)
    values (t.creator_id, 'Task cancelled: ' || t.title, 'No available ' || stage_job || ' left to offer it to.');
  end if;
end;
$$;

create or replace function public.expire_stale_task_offers(_team_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  stage_job text;
  next_user uuid;
  moved int := 0;
begin
  for t in
    select * from public.tasks
    where team_id = _team_id and status = 'todo' and offer_expires_at is not null and offer_expires_at < now()
  loop
    stage_job := t.job_types[t.stage_index + 1];
    next_user := public.team_job_next_candidate(_team_id, stage_job, t.priority_index, t.assignee_id);

    if next_user is not null then
      update public.tasks set assignee_id = next_user, priority_index = t.priority_index + 1, offer_expires_at = now() + interval '24 hours'
        where id = t.id;
      insert into public.task_history (task_id, actor_id, event, detail) values (t.id, null, 'offer_expired', 'reassigned to next candidate');
      insert into public.notifications (user_id, title, body)
      values (next_user, 'New task offer: ' || t.title, 'You''re next in line for ' || stage_job || ' (previous offer expired).');
    else
      update public.tasks set assignee_id = t.creator_id, status = 'cancelled' where id = t.id;
      insert into public.task_history (task_id, actor_id, event, detail) values (t.id, null, 'offer_expired', 'no candidate left, cancelled');
      insert into public.notifications (user_id, title, body)
      values (t.creator_id, 'Task cancelled: ' || t.title, 'Offer expired with no available ' || stage_job || ' left.');
    end if;
    moved := moved + 1;
  end loop;

  return moved;
end;
$$;

-- Only the offer-window literal changes here; the rest of task_submit (stage
-- advance vs under_review, task_stage_history logging) is reproduced verbatim
-- from 0048 since `create or replace function` replaces the whole body.
create or replace function public.task_submit(_task_id uuid, _type text, _content text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  completed_job text;
  next_job text;
  next_user uuid;
begin
  select * into t from public.tasks where id = _task_id and assignee_id = auth.uid() and status = 'in_progress' for update;
  if not found then raise exception 'Task not found or not submittable'; end if;

  completed_job := t.job_types[t.stage_index + 1];
  insert into public.task_stage_history (task_id, job_type, assignee_id) values (_task_id, completed_job, auth.uid());

  if t.stage_index + 2 <= array_length(t.job_types, 1) then
    next_job := t.job_types[t.stage_index + 2];
    next_user := public.team_job_first_candidate(t.team_id, next_job);

    update public.tasks set
      stage_index = stage_index + 1,
      priority_index = 1,
      assignee_id = coalesce(next_user, t.creator_id),
      status = 'todo',
      offer_expires_at = now() + interval '24 hours',
      submission_type = null, submission_content = null
    where id = _task_id;

    insert into public.task_history (task_id, actor_id, event, detail)
      values (_task_id, auth.uid(), 'stage_submitted', completed_job || ' done, next: ' || next_job);

    if next_user is not null then
      insert into public.notifications (user_id, title, body)
      values (next_user, 'New task offer: ' || t.title, completed_job || ' is done — you''re priority for ' || next_job || '.');
    else
      insert into public.notifications (user_id, title, body)
      values (t.creator_id, 'No one available for ' || next_job, '"' || t.title || '" needs a ' || next_job || ' holder to continue.');
    end if;
  else
    update public.tasks set status = 'under_review', submission_type = _type, submission_content = _content
      where id = _task_id;
    insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'submitted', _type);
  end if;
end;
$$;
