-- Join requests only ever carried a free-text message; the applicant can now also pick
-- which job(s) they're applying for, and acceptance auto-grants those job(s) with a
-- collision-free priority via the same mechanism claim_job_priority/admin_set_member_job
-- already use (team_job_collision_free_priority, from 0048_multi_job_pipeline.sql).

alter table public.join_requests add column if not exists job_types text[] not null default '{}';

create or replace function public.request_to_join_team(_team_id uuid, _message text, _job_types text[] default '{}')
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.join_requests;
begin
  if not exists (select 1 from public.teams where id = _team_id) then
    raise exception 'Team not found';
  end if;
  if exists (select 1 from public.team_members where team_id = _team_id and user_id = auth.uid() and status = 'active') then
    raise exception 'Already a member of this team';
  end if;

  insert into public.join_requests (team_id, user_id, message, job_types)
  values (_team_id, auth.uid(), _message, _job_types)
  returning * into r;
  return r;
end;
$$;

create or replace function public.decide_join_request(_id uuid, _approve boolean, _response_body text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.join_requests;
  v_team_name text;
  job text;
  next_prio int;
begin
  select * into r from public.join_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if not public.team_member_has_perm(r.team_id, 'can_manage_join_requests') then raise exception 'Not authorized'; end if;

  select name into v_team_name from public.teams where id = r.team_id;

  if _approve then
    update public.join_requests set status = 'approved' where id = _id;
    if not exists (select 1 from public.team_members where team_id = r.team_id and user_id = r.user_id) then
      insert into public.team_members (team_id, user_id, invited_email, role, status)
      values (r.team_id, r.user_id, (select email from public.profiles where id = r.user_id), 'member', 'active');
    end if;

    foreach job in array coalesce(r.job_types, '{}') loop
      select coalesce(max(priority), 0) + 1 into next_prio from public.team_member_jobs where team_id = r.team_id and job_type = job;
      insert into public.team_member_jobs (team_id, user_id, job_type, priority)
      values (r.team_id, r.user_id, job, public.team_job_collision_free_priority(r.team_id, job, next_prio))
      on conflict (team_id, user_id, job_type) do nothing;
    end loop;

    insert into public.notifications (user_id, title, body)
    values (r.user_id, 'Join request accepted', coalesce(_response_body, format('You''re now a member of %s.', coalesce(v_team_name, 'the team'))));
  else
    update public.join_requests set status = 'rejected' where id = _id;
    insert into public.notifications (user_id, title, body)
    values (r.user_id, 'Join request declined', coalesce(_response_body, format('Your request to join %s was declined.', coalesce(v_team_name, 'the team'))));
  end if;
end;
$$;
