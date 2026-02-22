/**
 * orphan-monitor
 *
 * Scheduled Edge Function (daily). Detects children with no guardian_children
 * row and logs each with the ORPHAN_DETECTED prefix for ops alerting.
 *
 * This is an invariant that must NEVER be true in production.
 * Do NOT silently delete orphans — investigate first.
 *
 * Secured by CRON_SECRET env var (same secret as still-there-scheduler).
 * Schedule: once per day (e.g. 03:00 UTC) via Supabase Cron.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET   = Deno.env.get('CRON_SECRET') ?? '';

type OrphanedChild = {
  id: string;
  first_name: string;
  last_name: string;
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

  // Query children with no guardian via security-definer RPC.
  // Service role has implicit execute rights even though the function
  // is revoked from anon/authenticated.
  const { data, error } = await admin.rpc('get_orphaned_children');

  if (error) {
    console.error('[orphan-monitor] get_orphaned_children error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const orphans: OrphanedChild[] = data ?? [];

  if (orphans.length === 0) {
    console.log('[orphan-monitor] OK — no orphaned children found');
    return new Response(JSON.stringify({ orphan_count: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Log each orphan prominently for ops alerting.
  // Do NOT delete — investigate root cause first.
  for (const child of orphans) {
    console.error(
      `[ORPHAN_DETECTED] child_id=${child.id} ` +
      `name="${child.first_name} ${child.last_name}"`
    );
  }

  console.error(
    `[orphan-monitor] ALERT: ${orphans.length} orphaned child(ren) detected. ` +
    'Investigate before taking any action.'
  );

  return new Response(
    JSON.stringify({
      orphan_count: orphans.length,
      orphan_ids: orphans.map((c) => c.id),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
