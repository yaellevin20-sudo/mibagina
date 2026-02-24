/**
 * delete-group
 *
 * Called by the group owner when deleting a group.
 * 1. Verifies caller is admin via JWT
 * 2. Checks no active check-ins exist for children in the group
 * 3. Sends push notifications to all other members
 * 4. Deletes the group (cascade handles all member/child rows)
 *
 * Auth: Bearer JWT from client — guardian_id extracted from verified JWT only.
 * Body: { group_id: string }
 * Errors: 409 if active check-ins exist (client shows specific message)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req: Request) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const jwt = authHeader.slice(7);

  const anonClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
  const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const caller_id = user.id;

  // ── Parse body ────────────────────────────────────────────────────────────
  let group_id: string;
  try {
    const body = await req.json();
    group_id = body.group_id;
    if (!group_id) throw new Error('missing group_id');
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Verify caller is admin ────────────────────────────────────────────────
  const { data: adminRow } = await admin
    .from('group_admins')
    .select('guardian_id')
    .eq('group_id', group_id)
    .eq('guardian_id', caller_id)
    .single();

  if (!adminRow) {
    return new Response('Forbidden', { status: 403 });
  }

  // ── Get group info ────────────────────────────────────────────────────────
  const { data: group, error: groupError } = await admin
    .from('groups')
    .select('id, name')
    .eq('id', group_id)
    .single();

  if (groupError || !group) {
    return new Response(JSON.stringify({ error: 'Group not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Check for active check-ins ────────────────────────────────────────────
  const { data: groupChildren } = await admin
    .from('guardian_child_groups')
    .select('child_id')
    .eq('group_id', group_id);

  const childIds = (groupChildren ?? []).map((r: { child_id: string }) => r.child_id);

  if (childIds.length > 0) {
    const { count } = await admin
      .from('check_ins')
      .select('*', { count: 'exact', head: true })
      .in('child_id', childIds)
      .in('status', ['active', 'extended'])
      .gt('expires_at', new Date().toISOString());

    if (count && count > 0) {
      return new Response(JSON.stringify({ error: 'Active check-ins exist' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Get member push tokens (excluding the deleter) ────────────────────────
  const { data: members, error: tokensError } = await admin.rpc('get_group_member_tokens', {
    p_group_id:             group_id,
    p_exclude_guardian_id:  caller_id,
  });

  if (tokensError) {
    console.error('[delete-group] get_group_member_tokens error:', tokensError.message);
  }

  // ── Get deleter's display name ────────────────────────────────────────────
  const { data: deleter } = await admin
    .from('guardians')
    .select('name')
    .eq('id', caller_id)
    .single();

  const deleterName = deleter?.name ?? 'Someone';

  // ── Delete group first (cascades members, children, settings) ────────────
  // Delete before notifying so that a failed delete never triggers false
  // "group deleted" notifications.
  const { error: deleteError } = await admin
    .from('groups')
    .delete()
    .eq('id', group_id);

  if (deleteError) {
    console.error('[delete-group] delete error:', deleteError.message);
    return new Response(JSON.stringify({ error: deleteError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Send notifications (best-effort, group is already gone) ──────────────
  let sent = 0;
  for (const member of (members ?? [])) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to:    member.expo_push_token,
          title: 'הקבוצה נמחקה / Group deleted',
          body:  `${deleterName} מחק את "${group.name}" / deleted "${group.name}"`,
          data:  { type: 'group_deleted', group_name: group.name },
          sound: 'default',
        }),
      });
      if (!res.ok) {
        console.error('[delete-group] Expo push error:', res.status, await res.text());
      } else {
        sent++;
      }
    } catch (e) {
      console.error('[delete-group] push error for', member.guardian_id, e);
    }
  }

  console.log('[delete-group] done, notified:', sent);
  return new Response(JSON.stringify({ sent }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
