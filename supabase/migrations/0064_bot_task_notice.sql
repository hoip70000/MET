-- Bot posts a chat notice when a task offer goes out, alongside the existing notifications
-- row — reproduced from 0057_task_offer_timeout_24h.sql's task_create (the latest prior
-- definition), only adding the system_post_message call.
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
  candidate_name text;
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
    select name into candidate_name from public.profiles where id = candidate;
    perform public.system_post_message(_team_id, format('📋 New task "%s" offered to %s (%s).', _title, coalesce(candidate_name, 'someone'), primary_job));
  end if;

  return t;
end;
$$;
