-- Web Push subscriptions (one row per browser/device the user has enabled push on).
create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Fires the `send-push` Edge Function whenever a notification is inserted, so push delivery
-- is server-driven (doesn't depend on the inserting client staying online) — mirrors the
-- existing pattern of DB-triggered side effects elsewhere in this schema (badge awards, etc.),
-- just via an HTTP call instead of another SQL function. Requires `app.settings.edge_base_url`
-- and `app.settings.edge_service_key` to be set (see supabase/functions/send-push/README).
create or replace function public.trigger_send_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := current_setting('app.settings.edge_base_url', true) || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.edge_service_key', true)
    ),
    body := jsonb_build_object('notification_id', new.id, 'user_id', new.user_id)
  );
  return new;
exception when others then
  -- Push delivery is best-effort — a misconfigured/unreachable Edge Function must never
  -- block the notification row itself from being written.
  return new;
end;
$$;

drop trigger if exists notifications_send_push on public.notifications;
create trigger notifications_send_push
  after insert on public.notifications
  for each row execute function public.trigger_send_push();
