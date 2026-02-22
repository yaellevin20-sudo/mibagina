-- ==========================================================================
-- Phase 5: merge_child_into_group
-- Atomic 7-step merge called exclusively from the join-group Edge Function
-- (service role). Blocked for anon and authenticated roles.
-- ==========================================================================

create or replace function merge_child_into_group(
  p_guardian_id      uuid,
  p_my_child_id      uuid,   -- the duplicate child in guardian's account
  p_existing_child_id uuid,  -- the child already in the group
  p_group_id         uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  -- Block calls from authenticated (non-service) sessions
  if auth.uid() is not null then
    raise exception 'Reserved for service-role use';
  end if;

  -- Step 1: Link guardian to existing child
  insert into guardian_children (guardian_id, child_id)
  values (p_guardian_id, p_existing_child_id)
  on conflict do nothing;

  -- Step 2: Add existing child to group for this guardian
  insert into guardian_child_groups (guardian_id, child_id, group_id)
  values (p_guardian_id, p_existing_child_id, p_group_id)
  on conflict do nothing;

  -- Step 3: Remove all guardian_child_groups rows for the duplicate child in this group
  delete from guardian_child_groups
  where group_id = p_group_id
    and child_id = p_my_child_id;

  -- Step 4: Delete guardian's link to duplicate child (cascades remaining guardian_child_groups)
  delete from guardian_children
  where guardian_id = p_guardian_id
    and child_id    = p_my_child_id;

  -- Step 5: Delete duplicate child if now orphaned
  select count(*) into v_remaining
  from guardian_children
  where child_id = p_my_child_id;

  if v_remaining = 0 then
    delete from children where id = p_my_child_id;
  end if;

  -- Step 6: Rebuild co_guardian_visibility for existing child (bidirectional)
  -- guardian → others
  insert into co_guardian_visibility (child_id, from_guardian_id, to_guardian_id, can_see_checkins)
  select p_existing_child_id, p_guardian_id, gc.guardian_id, true
  from guardian_children gc
  where gc.child_id    = p_existing_child_id
    and gc.guardian_id != p_guardian_id
  on conflict do nothing;

  -- others → guardian
  insert into co_guardian_visibility (child_id, from_guardian_id, to_guardian_id, can_see_checkins)
  select p_existing_child_id, gc.guardian_id, p_guardian_id, true
  from guardian_children gc
  where gc.child_id    = p_existing_child_id
    and gc.guardian_id != p_guardian_id
  on conflict do nothing;

  -- Step 7: Push notifications handled by Edge Function after this returns
end;
$$;

revoke execute on function merge_child_into_group(uuid, uuid, uuid, uuid) from anon;
revoke execute on function merge_child_into_group(uuid, uuid, uuid, uuid) from authenticated;
grant  execute on function merge_child_into_group(uuid, uuid, uuid, uuid) to service_role;
