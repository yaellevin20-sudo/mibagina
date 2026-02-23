/**
 * notify-group-checkin
 *
 * Called fire-and-forget by the client immediately after a successful check-in.
 * Finds all group members at the same playground who should be notified,
 * and sends them an Expo push notification.
 *
 * Auth: Bearer JWT from client — guardian_id extracted from verified JWT only.
 * Body: { playground_id: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL   = 'https://exp.host/--/api/v2/push/send';

type NotificationTarget = {
  guardian_id:     string;
  expo_push_token: string;
  group_name:      string;
  playground_name: string;
  children: Array<{ first_name: string; last_name: string }>;
};

Deno.serve(async (req: Request) => {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const jwt = authHeader.slice(7);

  // Use anon client to verify the JWT — guardian_id comes from the token only.
  const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
  const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const guardian_id = user.id;

  // ── Parse body ──────────────────────────────────────────────────────────────
  let playground_id: string;
  try {
    const body = await req.json();
    playground_id = body.playground_id;
    if (!playground_id) throw new Error('missing playground_id');
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // ── Get notification targets ─────────────────────────────────────────────────
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: targets, error: targetsError } = await admin.rpc(
    'get_group_notification_targets',
    { p_playground_id: playground_id, p_posted_by: guardian_id }
  );

  if (targetsError) {
    console.error('[notify-group-checkin] get_group_notification_targets error:', targetsError.message);
    return new Response(JSON.stringify({ error: targetsError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Each row is (guardian_id, group_id) — one notification per group per guardian.
  // Same push token appearing multiple times is intentional: different groups
  // have different children in scope, so each notification has different content.
  const notifyList: NotificationTarget[] = targets ?? [];
  let sent = 0;

  for (const target of notifyList) {
    const childNames = target.children.map((c) => c.first_name).join(', ') || '';
    const body = childNames
      ? `${childNames} at ${target.playground_name}`
      : target.playground_name;

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to:       target.expo_push_token,
          title:    'חברים בגינה! / Friends at the playground!',
          body,
          data: {
            type:            'group_checkin',
            playground_id,
            playground_name: target.playground_name,
            group_name:      target.group_name,
          },
          sound:    'default',
          priority: 'high',
        }),
      });
      if (!res.ok) {
        console.error('[notify-group-checkin] Expo push HTTP error:', res.status, await res.text());
      } else {
        sent++;
      }
    } catch (e) {
      console.error('[notify-group-checkin] push error for guardian', target.guardian_id, e);
    }
  }

  const responseBody = { sent };
  console.log('[notify-group-checkin] done', responseBody);
  return new Response(JSON.stringify(responseBody), {
    headers: { 'Content-Type': 'application/json' },
  });
});
