-- Fixes a real bug: creating a team (public.teams insert, src/lib/teams.ts's createTeam) has
-- never inserted a matching public.team_members row for the owner. Every member-list UI
-- (TeamsPanel.tsx's roster, chat sender resolution, the Go Live "leader" picker, etc.) reads
-- purely from team_members, so the owner/admin who created the team was invisible in their own
-- team's member list — their messages/actions fell back to generic "Member" labeling instead of
-- their real name, and they didn't count as a 'leader' for any role-gated feature.
--
-- Mirrors 0001_teams.sql's own handle_new_user() trigger pattern (auto-create a profiles row on
-- auth.users insert) — this does the equivalent for teams -> team_members.

create or replace function public.ensure_team_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  -- Fires once per team insert (teams.id is generated fresh each time), and team_members has no
  -- unique constraint on (team_id, user_id) to conflict against — nothing to guard here.
  select email into v_email from public.profiles where id = new.owner_id;
  insert into public.team_members (team_id, user_id, invited_email, role, status)
  values (new.id, new.owner_id, coalesce(v_email, ''), 'leader', 'active');
  return new;
end;
$$;

drop trigger if exists on_team_created on public.teams;
create trigger on_team_created
  after insert on public.teams
  for each row execute function public.ensure_team_owner_membership();

-- Backfill: any existing team whose owner never got a team_members row (every team created
-- before this migration) gets one now, so owners stop being invisible in their own roster.
insert into public.team_members (team_id, user_id, invited_email, role, status)
select t.id, t.owner_id, coalesce(p.email, ''), 'leader', 'active'
from public.teams t
join public.profiles p on p.id = t.owner_id
where not exists (
  select 1 from public.team_members tm where tm.team_id = t.id and tm.user_id = t.owner_id
);
