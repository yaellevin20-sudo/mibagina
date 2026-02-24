/**
 * dispatch-notifications
 *
 * Scheduled Edge Function (every minute). Atomically claims all due notification
 * queue batches, fetches recipients + bundled children for each, and sends Expo
 * push notifications. Cleans up sent rows older than 24 hours.
 *
 * Secured by CRON_SECRET. Deploy with --no-verify-jwt.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET   = Deno.env.get('CRON_SECRET') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type NotificationTarget = {
  guardian_id:     string;
  expo_push_token: string;
  group_name:      string;
  playground_name: string;
  children:        Array<{ first_name: string }>;
};

type QueueBatch = {
  id:            string;
  group_id:      string;
  playground_id: string;
  posted_by:     string;       // poster's guardian_id — used to exclude self-notification
  fire_at:       string;
  sent_at:       string | null;
};

Deno.serve(async (req: Request) => {
  // Validate cron secret to prevent unauthorized invocation.
  if (CRON_SECRET) {
    const auth = req.headers.get('Authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const now   = new Date().toISOString();

  // ── Step 1: Atomically claim all due batches ───────────────────────────────
  // UPDATE...RETURNING prevents concurrent cron runs from processing the same
  // batch. Setting sent_at also frees the unique index slot so new check-ins
  // arriving after this claim can insert a fresh pending row (not silently lost).
  const { data: batches, error: claimErr } = await admin
    .from('notification_queue')
    .update({ sent_at: now })
    .lte('fire_at', now)
    .is('sent_at', null)
    .select() as { data: QueueBatch[] | null; error: unknown };

  if (claimErr) {
    console.error('[dispatch] claim error:', (claimErr as Error).message ?? claimErr);
    return new Response(JSON.stringify({ error: String(claimErr) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const claimed = batches ?? [];
  let dispatched = 0;

  // ── Step 2: For each claimed batch, fetch targets + send pushes ────────────
  for (const batch of claimed) {
    const { data: targets, error: targetsErr } = await admin.rpc(
      'get_notification_batch_targets',
      { p_group_id: batch.group_id, p_playground_id: batch.playground_id, p_posted_by: batch.posted_by },
    ) as { data: NotificationTarget[] | null; error: unknown };

    if (targetsErr) {
      console.error(
        '[dispatch] get_notification_batch_targets error for batch', batch.id,
        (targetsErr as Error).message ?? targetsErr,
      );
      continue;
    }

    for (const target of targets ?? []) {
      // Skip if all check-ins have expired since the batch was queued.
      if (!target.children?.length) continue;

      // Hebrew body: "X בגינה Y 🛝" / "X וY בגינה Y 🛝" / "X, Y ועוד N בגינה Z 🛝"
      const names      = target.children.map((c) => c.first_name);
      const playground = target.playground_name;
      let body: string;
      if (names.length === 1) {
        body = `${names[0]} בגינה ${playground} 🛝`;
      } else if (names.length === 2) {
        body = `${names[0]} ו${names[1]} בגינה ${playground} 🛝`;
      } else {
        body = `${names[0]}, ${names[1]} ועוד ${names.length - 2} בגינה ${playground} 🛝`;
      }

      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            to:       target.expo_push_token,
            title:    target.group_name,
            body,
            data: {
              type:            'group_checkin',
              playground_id:   batch.playground_id,
              playground_name: target.playground_name,
              group_name:      target.group_name,
            },
            sound:    'default',
            priority: 'high',
          }),
        });
        if (!res.ok) {
          console.error('[dispatch] Expo push HTTP error:', res.status, await res.text());
        } else {
          dispatched++;
        }
      } catch (e) {
        // Push failure is non-fatal — batch already claimed, won't retry.
        console.error('[dispatch] push error for guardian', target.guardian_id, e);
      }
    }
  }

  // ── Step 3: Clean up sent rows older than 24 hours ────────────────────────
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  const { error: cleanupErr } = await admin
    .from('notification_queue')
    .delete()
    .not('sent_at', 'is', null)
    .lt('sent_at', cutoff);

  if (cleanupErr) {
    console.error('[dispatch] cleanup error:', (cleanupErr as Error).message ?? cleanupErr);
  }

  const result = {
    batches_claimed: claimed.length,
    pushes_dispatched: dispatched,
    cleanup_ok: !cleanupErr,
  };
  console.log('[dispatch] done', result);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});
