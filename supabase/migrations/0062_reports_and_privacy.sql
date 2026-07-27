-- Report-to-admin chat action (item 22) and per-member "hide my status/balance/activity"
-- privacy toggles (item 27), matching the existing notification_prefs jsonb pattern on
-- team_members rather than adding three more standalone boolean columns.

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  message_table text not null check (message_table in ('team_messages', 'direct_messages')),
  message_id bigint not null,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text default '',
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.message_reports enable row level security;

drop policy if exists "message_reports_insert_member" on public.message_reports;
create policy "message_reports_insert_member" on public.message_reports
  for insert to authenticated with check (public.is_team_active_member(team_id) and reporter_id = auth.uid());

drop policy if exists "message_reports_select_managers" on public.message_reports;
create policy "message_reports_select_managers" on public.message_reports
  for select to authenticated using (public.is_team_manager(team_id) or reporter_id = auth.uid());

drop policy if exists "message_reports_update_managers" on public.message_reports;
create policy "message_reports_update_managers" on public.message_reports
  for update to authenticated using (public.is_team_manager(team_id)) with check (public.is_team_manager(team_id));

alter table public.team_members add column if not exists privacy_prefs jsonb not null default '{"hide_status": false, "hide_balance": false, "hide_active": false}'::jsonb;
