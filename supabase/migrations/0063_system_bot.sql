-- Chat system bot (item 26): automated messages only (welcome new members, notify of task
-- assignment/reassignment) — confirmed with the user, no command parsing/interactivity.
-- Posts real team_messages rows (not a client-side pseudo-message) so every client sees it
-- through the existing Realtime subscription for free.
--
-- Originally attempted via a reserved sentinel `profiles` row, but `profiles.id` has a FK to
-- Supabase's own `auth.users` table — a synthetic profile with no matching auth user violates
-- that FK (and fabricating an auth.users row is the wrong tool: that schema is Supabase Auth's
-- internal table, not meant for hand-inserted rows, and its required columns vary by Supabase
-- version). Instead, `sender_id` becomes nullable and NULL is the bot's identity — no synthetic
-- user needed at all. The select policy on team_messages only checks team membership, not
-- sender_id, so a NULL-sender row is already visible to every active member without any policy
-- change; the insert policy's `sender_id = auth.uid()` check doesn't apply here since this
-- function is SECURITY DEFINER and writes the row directly, bypassing RLS like every other
-- RPC in this schema.
alter table public.team_messages alter column sender_id drop not null;

create or replace function public.system_post_message(_team_id uuid, _body text)
returns public.team_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.team_messages;
begin
  insert into public.team_messages (team_id, sender_id, body)
  values (_team_id, null, _body)
  returning * into m;
  return m;
end;
$$;

-- Welcome message on approved join (extends 0060's decide_join_request, reproduced in full
-- since create or replace replaces the whole body).
create or replace function public.decide_join_request(_id uuid, _approve boolean, _response_body text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.join_requests;
  v_team_name text;
  v_user_name text;
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

    select name into v_user_name from public.profiles where id = r.user_id;
    perform public.system_post_message(r.team_id, format('👋 Welcome %s to the team!', coalesce(v_user_name, 'a new member')));
  else
    update public.join_requests set status = 'rejected' where id = _id;
    insert into public.notifications (user_id, title, body)
    values (r.user_id, 'Join request declined', coalesce(_response_body, format('Your request to join %s was declined.', coalesce(v_team_name, 'the team'))));
  end if;
end;
$$;
