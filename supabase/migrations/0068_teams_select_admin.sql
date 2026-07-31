-- Fixes a real bug: a site admin trying to "Go Live" (studio_sessions insert policy already
-- allows any site admin to host under any team, see 0067) could still never get there, because
-- src/lib/studioCollab.ts's listHostableTeams() has to SELECT from `teams` first to build the
-- "which team?" picker, and no RLS policy let an admin see a team they aren't an owner/member of
-- — is_admin=true alone did nothing at the database level. The same gap silently affected the
-- existing Admin Dashboard's "list all teams" (src/lib/adminDashboard.ts's listAllTeams), which
-- has always been quietly limited to public/owned/member teams for whichever admin ran it.
--
-- Mirrors 0058_admin_dashboard_rpcs.sql's `profiles_select_admin` policy exactly, reusing the same
-- is_site_admin() SECURITY DEFINER helper it already left a comment noting was meant to be reused
-- by "the select policy" (only profiles ever got one, teams never did).
drop policy if exists "teams_select_admin" on public.teams;
create policy "teams_select_admin" on public.teams
  for select to authenticated using (public.is_site_admin());
