-- Expands the system bot (item 26) beyond welcome/task-offer notices: it now also posts when a
-- task reaches its final review stage (admins need to know without polling the task board), when
-- a task is approved (visible team-wide credit, not just a private notification to the earner),
-- and when a member is kicked (the team should see why a name disappeared from the roster, same
-- as it already learns about it via the join-request-accepted welcome message). Still automated
-- messages only — no command parsing, per the earlier confirmed scope for this feature.

-- Reproduced from 0057_task_offer_timeout_24h.sql's task_submit (the latest prior definition),
-- only adding a bot post on the final-stage (under_review) branch.
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
    perform public.system_post_message(t.team_id, format('📥 "%s" was submitted and is now awaiting review.', t.title));
  end if;
end;
$$;

-- Reproduced from 0061_task_outcome_and_verified.sql's task_approve (the latest prior
-- definition), only adding a bot post at the end.
create or replace function public.task_approve(_task_id uuid, _rating int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  done_count int;
  personal_done_count int;
  contributor uuid;
  contributors uuid[];
  share numeric;
begin
  select * into t from public.tasks where id = _task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.team_member_has_perm(t.team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'done', last_outcome = 'success', rating = _rating, completed_at = now() where id = _task_id;
  insert into public.team_activity_log (team_id) values (t.team_id);
  insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'approved', 'rating ' || _rating);

  select array_agg(distinct assignee_id) into contributors
    from public.task_stage_history where task_id = _task_id and assignee_id is not null;
  if contributors is null or array_length(contributors, 1) is null then
    contributors := array[t.assignee_id];
  end if;

  if t.reward is not null and t.reward > 0 and array_length(contributors, 1) > 0 then
    share := round(t.reward / array_length(contributors, 1), 2);
    foreach contributor in array contributors loop
      update public.team_members set balance = balance + share where team_id = t.team_id and user_id = contributor;
      insert into public.transactions (team_id, sender_id, receiver_id, amount, details)
        values (t.team_id, null, contributor, share, 'Task reward: ' || t.title);
      insert into public.notifications (user_id, title, body)
        values (contributor, 'Task approved: ' || t.title, 'You earned $' || share || '.');
    end loop;
  end if;

  select count(*) into done_count from public.tasks where team_id = t.team_id and status = 'done';
  if done_count >= 100 then
    perform public.award_badge_if_missing(t.team_id, 'tasks-100', '100 Tasks Completed');
  end if;

  select count(*) into personal_done_count from public.tasks where team_id = t.team_id and assignee_id = t.assignee_id and status = 'done';
  if personal_done_count >= 10 then
    perform public.award_member_badge_if_missing(t.team_id, t.assignee_id, 'tasks-done-10', '10 Tasks Completed');
  end if;
  if personal_done_count >= 50 then
    perform public.award_member_badge_if_missing(t.team_id, t.assignee_id, 'tasks-done-50', '50 Tasks Completed');
  end if;
  if personal_done_count >= 100 then
    perform public.award_member_badge_if_missing(t.team_id, t.assignee_id, 'tasks-done-100', '100 Tasks Completed');
  end if;

  perform public.system_post_message(t.team_id, format('✅ "%s" was approved%s.', t.title, case when t.reward is not null and t.reward > 0 then format(' — $%s paid out', t.reward) else '' end));
end;
$$;

-- Reproduced from 0056_kick_and_leave_notify.sql's kick_team_member (the only/latest
-- definition), only adding a bot post at the end.
create or replace function public.kick_team_member(_team_id uuid, _user_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_name text;
  v_user_name text;
begin
  if not (public.is_team_owner(_team_id) or public.team_member_has_perm(_team_id, 'can_manage_members')) then
    raise exception 'Not authorized';
  end if;
  if _user_id = (select owner_id from public.teams where id = _team_id) then
    raise exception 'Cannot kick the team owner';
  end if;

  select name into v_team_name from public.teams where id = _team_id;
  select name into v_user_name from public.profiles where id = _user_id;

  update public.team_members
    set status = 'pending', is_active = false, member_status = 'resigned'
    where team_id = _team_id and user_id = _user_id;

  insert into public.notifications (user_id, title, body)
    values (_user_id, 'Removed from team', format('You were removed from %s.%s', coalesce(v_team_name, 'the team'), case when _reason is not null then ' Reason: ' || _reason else '' end));
  perform public.system_post_message(_team_id, format('👋 %s has left the team.', coalesce(v_user_name, 'A member')));
end;
$$;
