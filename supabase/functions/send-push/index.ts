// Supabase Edge Function: sends a real Web Push notification for a just-inserted
// `notifications` row, to every device the recipient has subscribed on (see
// `push_subscriptions`), respecting their notification-category channel preference.
//
// Deployment (see supabase/functions/send-push/README.md for the full VAPID walkthrough):
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
//   supabase functions deploy send-push
//
// Triggered automatically by the `notifications_send_push` trigger (migration 0055).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@example.com';

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

Deno.serve(async (req) => {
  try {
    const { notification_id, user_id } = await req.json();
    if (!notification_id || !user_id) {
      return new Response(JSON.stringify({ error: 'notification_id and user_id are required' }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: notification } = await supabase
      .from('notifications')
      .select('title, body')
      .eq('id', notification_id)
      .single();
    if (!notification) return new Response(JSON.stringify({ error: 'Notification not found' }), { status: 404 });

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', user_id);
    if (!subscriptions?.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

    const payload = JSON.stringify({ title: notification.title, body: notification.body, url: '/' });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async (err) => {
          // 404/410 means the browser/OS has invalidated this subscription — clean it up
          // rather than retrying it forever.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
          }
          throw err;
        })
      )
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    return new Response(JSON.stringify({ sent, total: subscriptions.length }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});
