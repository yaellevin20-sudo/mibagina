-- ==========================================================================
-- Phase 6: Check-in flow + "Still There?" scheduler RPCs
-- ==========================================================================

-- Enable pgcrypto for HMAC (session token derivation)
create extension if not exists pgcrypto schema extensions;

-- Add Expo push token column to guardians
alter table guardians add column if not exists expo_push_token text;

-- ==========================================================================
-- _app_session_secret()
-- Internal helper for session token derivation. Never exposed to clients.
-- TODO: Replace with Supabase Vault secret in production.
-- Callable from other security-definer functions (same owner) regardless
-- of role grants, because SECURITY DEFINER runs as the function owner.
-- ==========================================================================
create or replace function _app_session_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select 'mibagina-session-secret-v1-change-in-prod'
$$;
revoke execute on function _app_session_secret() from anon, authenticated;

-- ==========================================================================
-- set_push_token(p_token text)
-- Registers or clears the guardian's Expo push token.
-- ==========================================================================
create or replace function set_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update guardians set expo_push_token = nullif(trim(p_token), '') where id = auth.uid();
end;
$$;
revoke execute on function set_push_token(text) from anon;
grant  execute on function set_push_token(text) to authenticated;

-- ==========================================================================
-- get_my_playgrounds() → jsonb [{id, name}]
-- Playgrounds from check-in history of guardian and their co-guardians.
-- ==========================================================================
create or replace function get_my_playgrounds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then raise exception 'Not authenticated'; end if;

  return (
    select coalesce(
      jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name),
      '[]'::jsonb
    )
    from playgrounds p
    where p.id in (
      select distinct ci.playground_id
      from check_ins ci
      where ci.child_id in (
        select child_id from guardian_children
        where guardian_id in (
          -- Me and all guardians sharing at least one child with me
          select distinct gc2.guardian_id
          from guardian_children gc1
          join guardian_children gc2 on gc2.child_id = gc1.child_id
          where gc1.guardian_id = viewer_id
        )
      )
    )
  );
end;
$$;
revoke execute on function get_my_playgrounds() from anon;
grant  execute on function get_my_playgrounds() to authenticated;

-- ==========================================================================
-- search_playground(p_normalized_name text) → jsonb [{id, name}]
-- Returns existing playgrounds with matching normalized name.
-- Used for "Did you mean?" deduplication before creating a new playground.
-- ==========================================================================
create or replace function search_playground(p_normalized_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if trim(p_normalized_name) = '' then
    raise exception 'Normalized name cannot be empty';
  end if;

  return (
    select coalesce(
      jsonb_agg(jsonb_build_object('id', id, 'name', name)),
      '[]'::jsonb
    )
    from playgrounds
    where normalized_name = p_normalized_name
  );
end;
$$;
revoke execute on function search_playground(text) from anon;
grant  execute on function search_playground(text) to authenticated;

-- ==========================================================================
-- create_playground(p_name text, p_normalized_name text) → uuid
-- ==========================================================================
create or replace function create_playground(p_name text, p_normalized_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if trim(p_name) = '' or trim(p_normalized_name) = '' then
    raise exception 'Playground name cannot be empty';
  end if;

  insert into playgrounds (name, normalized_name, created_by)
  values (trim(p_name), trim(p_normalized_name), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function create_playground(text, text) from anon;
grant  execute on function create_playground(text, text) to authenticated;

-- ==========================================================================
-- post_checkin(p_child_ids uuid[], p_playground_id uuid) → jsonb
-- Returns: { session_token, check_ins: [{id, child_id}] }
-- INVARIANTS:
--   • checked_in_at and expires_at are always set server-side.
--   • session_id is generated server-side and NEVER returned to the client.
--   • session_token is a derived HMAC token (session_id.hex_hmac).
--   • Daily limit and single-active-per-child are enforced by triggers.
-- ==========================================================================
create or replace function post_checkin(
  p_child_ids     uuid[],
  p_playground_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardian_id   uuid := auth.uid();
  v_session_id    uuid := gen_random_uuid();
  v_session_token text;
  v_owned_count   int;
  v_child_id      uuid;
  v_checkin_id    uuid;
  v_result_arr    jsonb := '[]'::jsonb;
begin
  if v_guardian_id is null then raise exception 'Not authenticated'; end if;

  if p_child_ids is null or array_length(p_child_ids, 1) is null then
    raise exception 'No children specified';
  end if;

  -- Verify guardian owns ALL requested children
  select count(*) into v_owned_count
  from guardian_children
  where guardian_id = v_guardian_id
    and child_id    = any(p_child_ids);

  if v_owned_count <> array_length(p_child_ids, 1) then
    raise exception 'Invalid children';
  end if;

  -- Verify playground exists
  if not exists (select 1 from playgrounds where id = p_playground_id) then
    raise exception 'Invalid playground';
  end if;

  -- Insert one check_in row per child.
  -- Triggers enforce: daily limit (10/day) and single active check-in per child.
  foreach v_child_id in array p_child_ids loop
    insert into check_ins (
      child_id, playground_id, posted_by, session_id,
      checked_in_at, expires_at
    ) values (
      v_child_id, p_playground_id, v_guardian_id, v_session_id,
      now(), now() + interval '1 hour'
    ) returning id into v_checkin_id;

    v_result_arr := v_result_arr || jsonb_build_object(
      'id',       v_checkin_id,
      'child_id', v_child_id
    );
  end loop;

  -- Derive session_token: "session_id.hex(HMAC-SHA256(session_id, secret))"
  -- The client uses this token for "Still There?" responses.
  -- session_id itself is NEVER included in the response.
  v_session_token :=
    v_session_id::text || '.' ||
    encode(
      extensions.hmac(v_session_id::text, _app_session_secret(), 'sha256'),
      'hex'
    );

  return jsonb_build_object(
    'session_token', v_session_token,
    'check_ins',     v_result_arr
  );
end;
$$;
revoke execute on function post_checkin(uuid[], uuid) from anon;
grant  execute on function post_checkin(uuid[], uuid) to authenticated;

-- ==========================================================================
-- respond_still_there(p_check_in_id uuid)
-- Extends the check-in by 30 minutes and sets status = 'extended'.
-- Only the guardian who posted the check-in can respond.
-- ==========================================================================
create or replace function respond_still_there(p_check_in_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update check_ins
  set expires_at = now() + interval '30 minutes',
      status     = 'extended'
  where id        = p_check_in_id
    and posted_by = auth.uid()
    and status    in ('active', 'extended')
    and expires_at > now();

  if not found then
    raise exception 'Check-in not found or already expired';
  end if;
end;
$$;
revoke execute on function respond_still_there(uuid) from anon;
grant  execute on function respond_still_there(uuid) to authenticated;

-- ==========================================================================
-- leave_checkin(p_check_in_id uuid)
-- Immediately expires the check-in (guardian is leaving).
-- ==========================================================================
create or replace function leave_checkin(p_check_in_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  update check_ins
  set status     = 'expired',
      expires_at = least(expires_at, now())
  where id        = p_check_in_id
    and posted_by = auth.uid()
    and status    in ('active', 'extended');

  if not found then
    raise exception 'Check-in not found';
  end if;
end;
$$;
revoke execute on function leave_checkin(uuid) from anon;
grant  execute on function leave_checkin(uuid) to authenticated;

-- ==========================================================================
-- get_pending_prompts() → jsonb  [service_role only]
-- Returns sessions where status='active', checked_in_at <= now()-45min,
-- and still_there_prompted_at IS NULL. Grouped by session_id.
-- Includes session_token (for push payload) and session_id (for mark_prompted).
-- NOTE: session_id is internal — the Edge Function must NOT forward it to clients.
-- ==========================================================================
create or replace function get_pending_prompts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'session_id',   s.session_id,
          'session_token',
            s.session_id::text || '.' ||
            encode(
              extensions.hmac(s.session_id::text, _app_session_secret(), 'sha256'),
              'hex'
            ),
          'guardian_id',      s.guardian_id,
          'expo_push_token',  g.expo_push_token,
          'check_ins',        ci_agg.rows
        )
      ),
      '[]'::jsonb
    )
    from (
      select distinct session_id, posted_by as guardian_id
      from check_ins
      where status                 = 'active'
        and checked_in_at          <= now() - interval '45 minutes'
        and still_there_prompted_at is null
    ) s
    join guardians g on g.id = s.guardian_id
    cross join lateral (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'check_in_id', ci.id,
            'first_name',  ch.first_name,
            'age_years',   extract(year from age(ch.date_of_birth))::int
          )
        ),
        '[]'::jsonb
      ) as rows
      from check_ins ci
      join children ch on ch.id = ci.child_id
      where ci.session_id              = s.session_id
        and ci.status                  = 'active'
        and ci.still_there_prompted_at is null
    ) ci_agg
  );
end;
$$;
revoke execute on function get_pending_prompts() from anon, authenticated;
grant  execute on function get_pending_prompts() to service_role;

-- ==========================================================================
-- mark_prompted(p_session_id uuid)  [service_role only]
-- Sets still_there_prompted_at = now() for all check-ins in the session.
-- One prompt per check-in row maximum (only updates where IS NULL).
-- ==========================================================================
create or replace function mark_prompted(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update check_ins
  set still_there_prompted_at = now()
  where session_id              = p_session_id
    and still_there_prompted_at is null;
end;
$$;
revoke execute on function mark_prompted(uuid) from anon, authenticated;
grant  execute on function mark_prompted(uuid) to service_role;

-- ==========================================================================
-- mark_expired_checkins()  [service_role only]
-- Scheduled cleanup: marks overdue rows as expired.
-- Always updates BOTH status AND expires_at (spec invariant).
-- ==========================================================================
create or replace function mark_expired_checkins()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update check_ins
  set status     = 'expired',
      expires_at = least(expires_at, now())
  where expires_at <= now()
    and status     != 'expired';
end;
$$;
revoke execute on function mark_expired_checkins() from anon, authenticated;
grant  execute on function mark_expired_checkins() to service_role;
