-- =============================================================================
-- Phase 8: Profile RPCs
-- get_my_profile, update_display_name, delete_my_account
-- =============================================================================

-- -----------------------------------------------------------------------
-- get_my_profile()
-- Returns the current guardian's profile data.
-- -----------------------------------------------------------------------
create or replace function get_my_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id             uuid;
  v_name           text;
  v_email          text;
  v_last_active_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select id, name, email, last_active_at
    into v_id, v_name, v_email, v_last_active_at
    from guardians
   where id = auth.uid();

  if not found then return null; end if;

  return jsonb_build_object(
    'id',             v_id,
    'name',           v_name,
    'email',          v_email,
    'last_active_at', v_last_active_at
  );
end;
$$;
revoke execute on function get_my_profile() from anon;
grant  execute on function get_my_profile() to authenticated;

-- -----------------------------------------------------------------------
-- update_display_name(p_name text)
-- Updates the guardian's display name.
-- -----------------------------------------------------------------------
create or replace function update_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if trim(p_name) = '' then raise exception 'Name cannot be empty'; end if;

  update guardians
     set name = trim(p_name)
   where id = auth.uid();

  if not found then raise exception 'Guardian not found'; end if;
end;
$$;
revoke execute on function update_display_name(text) from anon;
grant  execute on function update_display_name(text) to authenticated;

-- -----------------------------------------------------------------------
-- delete_my_account()
-- DB-side saga step 1: cleans up all guardian data.
-- Auth deletion (auth.users) is handled by the delete-account Edge Function
-- after this RPC returns successfully.
--
-- Cascade chain:
--   DELETE FROM guardians → cascades to:
--     guardian_children, guardian_child_groups, guardian_group_settings,
--     group_admins, co_guardian_visibility (from+to), check_ins (posted_by)
--   Then DELETE FROM children WHERE id = ANY(orphaned_ids) → cascades to:
--     check_ins (child_id), co_guardian_visibility (child_id)
--
-- Non-cascading FKs that need manual NULL-out:
--   children.created_by_guardian_id (no ON DELETE action)
--   playgrounds.created_by (no ON DELETE action)
-- -----------------------------------------------------------------------
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_orphaned_ids uuid[];
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- 1. Collect child IDs that will become orphaned after this guardian is removed
  --    (children linked ONLY to this guardian, no other guardian shares them).
  select array_agg(gc.child_id)
    into v_orphaned_ids
    from guardian_children gc
   where gc.guardian_id = v_uid
     and not exists (
       select 1 from guardian_children gc2
        where gc2.child_id    = gc.child_id
          and gc2.guardian_id != v_uid
     );

  -- 2. NULL out non-cascading FKs to avoid constraint violations on DELETE.
  update children
     set created_by_guardian_id = null
   where created_by_guardian_id = v_uid;

  update playgrounds
     set created_by = null
   where created_by = v_uid;

  -- 3. Delete the guardians row.
  --    Cascades to: guardian_children, guardian_child_groups,
  --    guardian_group_settings, group_admins, co_guardian_visibility
  --    (both from_guardian_id and to_guardian_id), check_ins (posted_by).
  delete from guardians where id = v_uid;

  -- 4. Delete orphaned children.
  --    Cascades to: check_ins (child_id), co_guardian_visibility (child_id).
  if v_orphaned_ids is not null and array_length(v_orphaned_ids, 1) > 0 then
    delete from children where id = any(v_orphaned_ids);
  end if;
end;
$$;
revoke execute on function delete_my_account() from anon;
grant  execute on function delete_my_account() to authenticated;
