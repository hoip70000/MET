-- Tracks which team is "active" for a user who belongs to more than one — the app layer
-- (getMyMembership) used to assume exactly one active membership via .maybeSingle(), which
-- errors once a user is active on 2+ teams. This table is additive and doesn't change the
-- team_members schema (balance/roles were already correctly scoped per (team_id, user_id)).
create table if not exists public.user_active_team (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.user_active_team enable row level security;

drop policy if exists "user_active_team_select_own" on public.user_active_team;
create policy "user_active_team_select_own" on public.user_active_team
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "user_active_team_upsert_own" on public.user_active_team;
create policy "user_active_team_upsert_own" on public.user_active_team
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "user_active_team_update_own" on public.user_active_team;
create policy "user_active_team_update_own" on public.user_active_team
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
