-- Live collaborative Studio: a team leader (or a site admin) can host a spectator session for a
-- chapter. Team members join to watch the host's canvas + cursors and chat, via Supabase Realtime
-- presence/broadcast on a channel keyed by this row's id (not chapter_id, so a restarted session
-- never collides with a stale channel's retained presence/broadcast state). No layer/pixel data is
-- stored here — this table is only session discovery/roster bookkeeping; the live canvas/cursor/
-- chat traffic itself never touches Postgres (see src/lib/studioCollab.ts).

create table if not exists public.studio_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  chapter_id text not null,
  host_user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- One live session per (team, chapter) at a time — a second "Go Live" while one is already
-- running should end the old one first rather than silently forking into two channels.
create unique index if not exists studio_sessions_one_live_per_chapter
  on public.studio_sessions (team_id, chapter_id)
  where ended_at is null;

alter table public.studio_sessions enable row level security;

drop policy if exists "studio_sessions_select_team_member" on public.studio_sessions;
create policy "studio_sessions_select_team_member" on public.studio_sessions
  for select to authenticated using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = studio_sessions.team_id and tm.user_id = auth.uid() and tm.status = 'active'
    )
    or exists (select 1 from public.teams t where t.id = studio_sessions.team_id and t.owner_id = auth.uid())
  );

drop policy if exists "studio_sessions_insert_leader_or_admin" on public.studio_sessions;
create policy "studio_sessions_insert_leader_or_admin" on public.studio_sessions
  for insert to authenticated with check (
    host_user_id = auth.uid()
    and (
      exists (
        select 1 from public.team_members tm
        where tm.team_id = studio_sessions.team_id and tm.user_id = auth.uid()
          and tm.status = 'active' and tm.role = 'leader'
      )
      or exists (select 1 from public.teams t where t.id = studio_sessions.team_id and t.owner_id = auth.uid())
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
    )
  );

drop policy if exists "studio_sessions_update_host_only" on public.studio_sessions;
create policy "studio_sessions_update_host_only" on public.studio_sessions
  for update to authenticated using (host_user_id = auth.uid()) with check (host_user_id = auth.uid());
