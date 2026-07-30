-- Terminal task outcome (item 20/28 from the request): reject keeps its existing "revision
-- requested" retry behavior (confirmed with the user, not changed here) — this adds a real,
-- distinct terminal "unsuccessful" outcome as a *separate* admin action, plus a plain
-- last_outcome marker so the UI can distinguish "approved" / "sent back for revision" /
-- "marked unsuccessful" without overloading `status`.

alter table public.tasks add column if not exists last_outcome text
  check (last_outcome in ('pending', 'success', 'revision', 'unsuccessful'));

-- Reproduced verbatim from 0035_task_history.sql's task_reject_submission (the latest prior
-- definition), only adding the last_outcome='revision' marker.
create or replace function public.task_reject_submission(_task_id uuid, _notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = _task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.team_member_has_perm(t.team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'in_progress', last_outcome = 'revision', description = description || E'\n\nRevision requested: ' || _notes
    where id = _task_id;
  insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'rejected', _notes);
end;
$$;

-- A genuinely terminal failure — distinct from task_reject_submission's retry loop. Notifies
-- the assignee same as every other outcome-changing RPC in this schema.
create or replace function public.task_mark_unsuccessful(_task_id uuid, _notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = _task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.team_member_has_perm(t.team_id, 'can_review_tasks') then raise exception 'Not authorized'; end if;

  update public.tasks set status = 'cancelled', last_outcome = 'unsuccessful' where id = _task_id;
  insert into public.task_history (task_id, actor_id, event, detail) values (_task_id, auth.uid(), 'marked_unsuccessful', _notes);
  if t.assignee_id is not null then
    insert into public.notifications (user_id, title, body)
      values (t.assignee_id, 'Task unsuccessful: ' || t.title, coalesce(_notes, 'This task was marked unsuccessful by an admin.'));
  end if;
end;
$$;

-- Reproduced verbatim from 0048_multi_job_pipeline.sql's task_approve (the latest prior
-- definition), only adding the last_outcome='success' marker to the initial update.
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
end;
$$;

-- Verified badge (item 28): a per-team flag distinct from teamBadges.ts's milestone
-- achievements (tasks-100, streak-30, etc.) — this marks a person's identity/role as
-- confirmed, shown as an icon next to their name, not something earned by activity volume.
alter table public.team_members add column if not exists is_verified boolean not null default false;

create or replace function public.set_member_verified(_team_id uuid, _user_id uuid, _verified boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_team_owner(_team_id) or public.is_team_leader(_team_id)) then
    raise exception 'Not authorized';
  end if;
  update public.team_members set is_verified = _verified where team_id = _team_id and user_id = _user_id;
end;
$$;
