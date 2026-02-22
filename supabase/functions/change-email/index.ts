import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Validate JWT ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return json({ error: 'Missing authorization' }, 401);

  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return json({ error: 'Invalid token' }, 401);

  const userId = user.id;

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { newEmail?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const newEmail = body.newEmail?.trim().toLowerCase();
  if (!newEmail) return json({ error: 'newEmail is required' }, 400);

  // ── Verify guardians row exists ──────────────────────────────────────────
  const { data: guardian, error: guardianError } = await admin
    .from('guardians')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (guardianError) {
    console.error('[change-email] guardians lookup error', guardianError);
    return json({ error: 'Internal error' }, 500);
  }
  if (!guardian) {
    return json({ error: 'Guardian record not found' }, 400);
  }

  // ── Update email in auth.users ────────────────────────────────────────────
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    email: newEmail,
    email_confirm: true,
  });

  if (updateError) {
    console.error('[change-email] auth update error', updateError);
    // Supabase surfaces unique constraint violations as "already registered"
    if (updateError.message?.toLowerCase().includes('already') ||
        updateError.message?.toLowerCase().includes('unique')) {
      return json({ error: 'email_in_use' }, 409);
    }
    return json({ error: updateError.message }, 500);
  }

  // ── Sync guardians.email ─────────────────────────────────────────────────
  const { error: syncError } = await admin
    .from('guardians')
    .update({ email: newEmail })
    .eq('id', userId);

  if (syncError) {
    console.error('[change-email] guardians.email sync error', syncError);
    // Non-fatal: auth.users was already updated; log and continue
  }

  // ── Revoke other sessions ────────────────────────────────────────────────
  try {
    await (admin.auth.admin as any).signOut(userId, 'others');
  } catch (e) {
    console.warn('[change-email] session revocation failed, attempting global signout', e);
    try {
      await (admin.auth.admin as any).signOut(userId);
    } catch (e2) {
      console.error('[change-email] global signout also failed', e2);
    }
  }

  return json({ ok: true });
});
