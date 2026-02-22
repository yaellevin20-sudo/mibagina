import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_RETRIES = 3;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // ── Delete auth.users with retries ───────────────────────────────────────
  // DB-side data has already been cleaned up by delete_my_account() RPC
  // called by the client before invoking this function.
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);

      console.log(`[delete-account] auth.users deleted for ${userId}`);
      return json({ ok: true });
    } catch (e: any) {
      lastError = e;
      console.warn(`[delete-account] attempt ${attempt}/${MAX_RETRIES} failed:`, e.message);

      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        await sleep(500 * Math.pow(2, attempt - 1));
      }
    }
  }

  // All retries exhausted — flag for manual cleanup
  console.error(
    `[delete-account] MANUAL_CLEANUP_REQUIRED: auth.users row for ${userId} could not be deleted. ` +
    `DB data already removed. Last error: ${lastError?.message}`
  );

  // Return 500 so client can display an error; DB data is already gone.
  return json({ error: 'auth_delete_failed', userId }, 500);
});
