-- Admin dashboard: soft-delete a user, and let a site-wide admin (profiles.is_admin)
-- change someone's role on any team — distinct from the existing owner/leader-scoped
-- `team_members` role update in src/lib/teams.ts's `promoteToLeader`, which only works
-- if the caller already manages that specific team.

alter table public.profiles add column if not exists deleted_at timestamptz;

-- A policy on `profiles` cannot subquery `profiles` inline for the is_admin check —
-- that's the exact self-recursion trap `0004_fix_rls_recursion.sql` fixed for
-- team_members/teams — so this goes through a SECURITY DEFINER helper (bypasses RLS
-- on the underlying table) instead, reused by both the RPCs below and the select policy.
create or replace function public.is_site_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true);
$$;

create or replace function public.admin_soft_delete_user(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  update public.profiles set deleted_at = now() where id = _user_id;
  insert into public.notifications (user_id, title, body)
    values (_user_id, 'Account disabled', 'Your account has been disabled by an administrator.');
end;
$$;

create or replace function public.admin_restore_user(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  update public.profiles set deleted_at = null where id = _user_id;
end;
$$;

create or replace function public.admin_set_team_role(_team_id uuid, _user_id uuid, _role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_name text;
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  if _role not in ('leader', 'member') then
    raise exception 'Invalid role';
  end if;

  select name into v_team_name from public.teams where id = _team_id;

  update public.team_members set role = _role where team_id = _team_id and user_id = _user_id;
  insert into public.notifications (user_id, title, body)
    values (_user_id, 'Role updated', format('An administrator set your role in %s to %s.', coalesce(v_team_name, 'a team'), _role));
end;
$$;

create or replace function public.admin_notify_user(_user_id uuid, _title text, _body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Not authorized';
  end if;
  insert into public.notifications (user_id, title, body) values (_user_id, _title, _body);
end;
$$;

-- Admins need to see every profile to manage them.
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select to authenticated using (public.is_site_admin());
