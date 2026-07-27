-- Richer notification preferences: per-category channel (in-app vs in-app+push) and, for
-- chat specifically, all-messages vs mentions-&-DMs-only. `team_members.notification_prefs`
-- stays a jsonb blob (existing consumers already treat it as opaque) — this is additive, no
-- migration of existing rows needed since old boolean shapes and the new nested shape can
-- coexist; `src/lib/teams.ts` reads/writes the new nested shape going forward.
--
-- New shape (per team membership):
--   {
--     "chat":     { "mode": "all" | "mentions_dms", "channel": "in_app" | "in_app_push" },
--     "tasks":    { "enabled": bool, "channel": "in_app" | "in_app_push" },
--     "bank":     { "enabled": bool, "channel": "in_app" | "in_app_push" },
--     "requests": { "enabled": bool, "channel": "in_app" | "in_app_push" }
--   }

-- Not all notification categories are team-scoped (e.g. admin broadcasts, join-request
-- outcomes reach a user before/outside any specific team context), so those live in a
-- separate user-level table rather than being force-fit onto team_members.
create table if not exists public.user_notification_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  prefs jsonb not null default '{"broadcasts": {"enabled": true, "channel": "in_app"}, "requests": {"enabled": true, "channel": "in_app"}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_notification_prefs enable row level security;

drop policy if exists "user_notification_prefs_select_own" on public.user_notification_prefs;
create policy "user_notification_prefs_select_own" on public.user_notification_prefs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "user_notification_prefs_upsert_own" on public.user_notification_prefs;
create policy "user_notification_prefs_upsert_own" on public.user_notification_prefs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "user_notification_prefs_update_own" on public.user_notification_prefs;
create policy "user_notification_prefs_update_own" on public.user_notification_prefs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
