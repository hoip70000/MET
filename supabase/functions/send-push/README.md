# Web Push setup (one-time)

This Edge Function sends real browser push notifications (arrive even when the app tab is
closed) for rows inserted into `public.notifications`. It's wired up automatically by the
`notifications_send_push` trigger in `supabase/migrations/0055_push_subscriptions.sql` — you
only need to do the one-time key setup below, then deploy.

## 1. Generate a VAPID key pair

VAPID (Voluntary Application Server Identification) keys prove to the browser's push service
that pushes are coming from you, not somebody else. Generate them once, locally:

```sh
npx web-push generate-vapid-keys
```

This prints a `Public Key` and a `Private Key`. Treat the private key like any other secret —
never put it in client code or a `VITE_*` env var.

## 2. Store the public key for the client

Add it to `.env.local` (and your production env) as:

```
VITE_VAPID_PUBLIC_KEY=<the public key from step 1>
```

`src/lib/webPush.ts` reads this to create the browser's push subscription.

## 3. Store the private key + subject as Edge Function secrets

```sh
supabase secrets set VAPID_PRIVATE_KEY=<the private key from step 1>
supabase secrets set VAPID_PUBLIC_KEY=<the same public key from step 1>
supabase secrets set VAPID_SUBJECT=mailto:you@yourdomain.com
```

(`VAPID_SUBJECT` is a contact the push service can use if it needs to reach you about abuse —
a `mailto:` address or your app's URL both work.)

## 4. Let the DB trigger call this function

The trigger in migration `0055` calls out to:

```
current_setting('app.settings.edge_base_url')  -- e.g. https://<project-ref>.functions.supabase.co
current_setting('app.settings.edge_service_key') -- a service-role key or a dedicated bearer secret
```

Set these once via the SQL editor or `ALTER DATABASE ... SET`, matching whatever pattern this
project already uses for Postgres-level config (check for existing `app.settings.*` usage
before introducing a new convention). If this project doesn't already have a `pg_net`-based
trigger pattern, an equally valid alternative is to skip the DB trigger and instead call this
function directly from `src/lib/notifications.ts`'s `notify()` after a successful insert.

## 5. Deploy

```sh
supabase functions deploy send-push
```

## 6. Test

Enable push from Settings → Notifications on a device, then trigger any real notification
(e.g. approve a task, send a broadcast) and confirm the browser shows it — including with the
tab closed.
