import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!;
const RATE_LIMIT        = 10;
const RATE_WINDOW_MS    = 3_600_000; // 1 hour

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize('NFKC');
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Rate limiting ────────────────────────────────────────────────────────────
  const rawIp  = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipHash = await sha256hex(rawIp);

  // Every request counts as an attempt (spec requirement).
  await admin.from('rate_limit_log').insert({ ip_hash: ipHash, endpoint: 'join-group' });

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await admin
    .from('rate_limit_log')
    .select('*', { count: 'exact', head: true })
    .eq('endpoint', 'join-group')
    .eq('ip_hash', ipHash)
    .gte('attempted_at', since);

  if ((count ?? 0) > RATE_LIMIT) {
    return json({ error: 'rate_limited' }, 429);
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);

  const guardianId = user.id;

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const { action, token, group_id, child_ids, confirmed_merges } = body as {
    action?: string;
    token?: string;
    group_id?: string;
    child_ids?: string[];
    confirmed_merges?: Record<string, string | null>;
  };

  if (!token) return json({ error: 'missing_token' }, 400);

  // ── Validate token ───────────────────────────────────────────────────────────
  const { data: group } = await admin
    .from('groups')
    .select('id, name, expires_at')
    .eq('invite_token', token)
    .maybeSingle();

  if (!group) return json({ error: 'invalid_token' }, 404);
  if (group.expires_at && new Date(group.expires_at) < new Date()) {
    return json({ error: 'expired_token' }, 410);
  }

  // ── action: validate ─────────────────────────────────────────────────────────
  if (action === 'validate') {
    return json({ group_id: group.id, group_name: group.name });
  }

  // ── action: join ─────────────────────────────────────────────────────────────
  if (action === 'join') {
    if (!group_id || group_id !== group.id) return json({ error: 'group_mismatch' }, 400);
    if (!Array.isArray(child_ids) || child_ids.length === 0) {
      return json({ error: 'no_children' }, 400);
    }

    // Verify guardian owns all requested children.
    const { data: owned } = await admin
      .from('guardian_children')
      .select('child_id')
      .eq('guardian_id', guardianId)
      .in('child_id', child_ids);

    if (!owned || owned.length !== child_ids.length) {
      return json({ error: 'forbidden' }, 403);
    }

    // Fetch children data for duplicate detection.
    const { data: myChildren } = await admin
      .from('children')
      .select('id, first_name, date_of_birth')
      .in('id', child_ids);

    // Fetch existing children in the group from other guardians.
    const { data: existingLinks } = await admin
      .from('guardian_child_groups')
      .select('child_id, guardian_id')
      .eq('group_id', group.id)
      .neq('guardian_id', guardianId);

    const existingChildIds = [...new Set((existingLinks ?? []).map((l: { child_id: string }) => l.child_id))];

    const { data: existingChildren } = existingChildIds.length > 0
      ? await admin.from('children').select('id, first_name, date_of_birth').in('id', existingChildIds)
      : { data: [] as Array<{ id: string; first_name: string; date_of_birth: string }> };

    // ── Duplicate detection (skip when confirmed_merges already provided) ──────
    if (!confirmed_merges) {
      const duplicates: Array<{
        my_child_id: string;
        match: { child_id: string; first_name: string; birth_year: number };
      }> = [];

      for (const mine of myChildren ?? []) {
        const myNorm = normalize(mine.first_name);
        const myYear = new Date(mine.date_of_birth).getFullYear();

        for (const existing of existingChildren ?? []) {
          if (
            normalize(existing.first_name) === myNorm &&
            new Date(existing.date_of_birth).getFullYear() === myYear
          ) {
            duplicates.push({
              my_child_id: mine.id,
              match: { child_id: existing.id, first_name: existing.first_name, birth_year: myYear },
            });
            break;
          }
        }
      }

      if (duplicates.length > 0) {
        return json({ status: 'needs_confirmation', duplicates });
      }
    }

    // ── Execute join ──────────────────────────────────────────────────────────
    const merges: Record<string, string | null> = confirmed_merges ?? {};

    for (const childId of child_ids) {
      const mergeTarget = merges[childId]; // existing child ID, or null/undefined = normal join

      if (mergeTarget) {
        // Atomic 7-step merge via stored procedure.
        const { error: mergeErr } = await admin.rpc('merge_child_into_group', {
          p_guardian_id:       guardianId,
          p_my_child_id:       childId,
          p_existing_child_id: mergeTarget,
          p_group_id:          group.id,
        });
        if (mergeErr) return json({ error: mergeErr.message }, 500);
        // TODO Phase 9: Notify existing guardians that co-guardian linked.
      } else {
        // Normal join: add child to group.
        const { error: insertErr } = await admin.from('guardian_child_groups').upsert(
          { guardian_id: guardianId, child_id: childId, group_id: group.id },
          { onConflict: 'guardian_id,child_id,group_id', ignoreDuplicates: true },
        );
        if (insertErr) return json({ error: insertErr.message }, 500);
        // TODO Phase 9: Notify group admin if user said No to duplicate.
      }
    }

    // Insert guardian settings (idempotent).
    await admin.from('guardian_group_settings').upsert(
      { guardian_id: guardianId, group_id: group.id },
      { onConflict: 'guardian_id,group_id', ignoreDuplicates: true },
    );

    return json({ status: 'done' });
  }

  return json({ error: 'unknown_action' }, 400);
});
