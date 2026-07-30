-- decide_leave/decide_resignation never notified the member either way (same gap
-- decide_join_request already had, fixed in 0012) — add notification rows on every
-- outcome, and add a real kick_team_member RPC (there wasn't one; the only way to
-- remove an active member was the member resigning themselves via request_resignation).

create or replace function public.decide_leave(_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.leave_requests;
  v_team_name text;
begin
  select * into r from public.leave_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if not public.is_team_manager(r.team_id) then raise exception 'Not authorized'; end if;

  select name into v_team_name from public.teams where id = r.team_id;

  if _approve then
    update public.leave_requests set status = 'approved' where id = _id;
    update public.team_members set member_status = 'on_leave' where team_id = r.team_id and user_id = r.user_id;
    insert into public.notifications (user_id, title, body)
      values (r.user_id, 'Leave request approved', format('Your leave request for %s was approved.', coalesce(v_team_name, 'the team')));
  else
    update public.leave_requests set status = 'rejected' where id = _id;
    insert into public.notifications (user_id, title, body)
      values (r.user_id, 'Leave request declined', format('Your leave request for %s was declined.', coalesce(v_team_name, 'the team')));
  end if;
end;
$$;

create or replace function public.decide_resignation(_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.resignation_requests;
  v_team_name text;
begin
  select * into r from public.resignation_requests where id = _id and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  if not public.is_team_manager(r.team_id) then raise exception 'Not authorized'; end if;

  select name into v_team_name from public.teams where id = r.team_id;

  if _approve then
    update public.resignation_requests set status = 'approved' where id = _id;
    update public.team_members set member_status = 'resigned', is_active = false where team_id = r.team_id and user_id = r.user_id;
    insert into public.notifications (user_id, title, body)
      values (r.user_id, 'You have left the team', format('Your resignation from %s was approved.', coalesce(v_team_name, 'the team')));
  else
    update public.resignation_requests set status = 'rejected' where id = _id;
    insert into public.notifications (user_id, title, body)
      values (r.user_id, 'Resignation request declined', format('Your request to leave %s was declined.', coalesce(v_team_name, 'the team')));
  end if;
end;
$$;

-- A member cannot leave a team on their own — only request_resignation +
-- decide_resignation gets them out that way — but an owner/leader can remove
-- someone outright. Distinct from decide_resignation: no pending request needed.
create or replace function public.kick_team_member(_team_id uuid, _user_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_name text;
begin
  if not (public.is_team_owner(_team_id) or public.team_member_has_perm(_team_id, 'can_manage_members')) then
    raise exception 'Not authorized';
  end if;
  if _user_id = (select owner_id from public.teams where id = _team_id) then
    raise exception 'Cannot kick the team owner';
  end if;

  select name into v_team_name from public.teams where id = _team_id;

  update public.team_members
    set status = 'pending', is_active = false, member_status = 'resigned'
    where team_id = _team_id and user_id = _user_id;

  insert into public.notifications (user_id, title, body)
    values (_user_id, 'Removed from team', format('You were removed from %s.%s', coalesce(v_team_name, 'the team'), case when _reason is not null then ' Reason: ' || _reason else '' end));
end;
$$;
