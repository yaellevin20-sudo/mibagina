/**
 * still-there-scheduler
 *
 * Scheduled Edge Function (every 5 minutes). Two passes:
 *   1. Find sessions needing "Still There?" prompt → send Expo push → mark prompted.
 *   2. Mark all check-ins with expires_at <= now() as expired.
 *
 * Triggered via Supabase Cron or external scheduler.
 * Secured by CRON_SECRET env var (set in Supabase function secrets).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET   = Deno.env.get('CRON_SECRET') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type PendingSession = {
  session_id: string;         // INTERNAL — never forward to clients
  session_token: string;      // Derived HMAC token — safe to send to client
  guardian_id: string;
  expo_push_token: string | null;
  check_ins: Array<{ check_in_id: string; first_name: string; age_years: number }>;
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

  // ── Pass 1: "Still There?" prompts ──────────────────────────────────────────
  const { data: pending, error: pendingErr } = await admin.rpc('get_pending_prompts');
  if (pendingErr) {
    console.error('[scheduler] get_pending_prompts:', pendingErr.message);
    return new Response(JSON.stringify({ error: pendingErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessions: PendingSession[] = pending ?? [];
  let prompted = 0;

  for (const session of sessions) {
    // Send push notification if guardian has a token registered.
    if (session.expo_push_token) {
      const childNames = session.check_ins.map((c) => c.first_name).join(', ');

      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            to: session.expo_push_token,
            title: 'עדיין שם? / Still there?',
            body: childNames,
            data: {
              type: 'still_there_prompt',
              session_token: session.session_token, // session_id is NOT included
              check_ins: session.check_ins,
            },
            sound: 'default',
            priority: 'high',
          }),
        });
        if (!res.ok) {
          console.error('[scheduler] Expo push HTTP error:', res.status, await res.text());
        }
      } catch (e) {
        // Push failure is non-fatal — still mark as prompted to avoid repeated attempts.
        console.error('[scheduler] push error for guardian', session.guardian_id, e);
      }
    }

    // Mark all rows in this session as prompted (one prompt per row maximum).
    const { error: markErr } = await admin.rpc('mark_prompted', {
      p_session_id: session.session_id,
    });
    if (markErr) {
      console.error('[scheduler] mark_prompted error:', markErr.message);
    } else {
      prompted++;
    }
  }

  // ── Pass 2: Mark overdue check-ins as expired ────────────────────────────────
  const { error: expireErr } = await admin.rpc('mark_expired_checkins');
  if (expireErr) {
    console.error('[scheduler] mark_expired_checkins:', expireErr.message);
  }

  const body = { prompted, expired_pass_ok: !expireErr };
  console.log('[scheduler] done', body);
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
});
