-- =============================================================================
-- Phase: Group deletion + ownership transfer
-- =============================================================================

-- ---------------------------------------------------------------------------
-- transfer_group_ownership(p_group_id, p_new_admin_id)
-- Promotes another member to admin. Caller stays in the group — they leave
-- separately via remove_guardian_from_group once this succeeds.
-- New admin must already be a member (row in guardian_child_groups).
-- ---------------------------------------------------------------------------
create or replace function transfer_group_ownership(p_group_id uuid, p_new_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from group_admins
    where group_id = p_group_id and guardian_id = v_caller
  ) then
    raise exception 'Access denied';
  end if;

  if not exists (
    select 1 from guardian_child_groups
    where group_id = p_group_id and guardian_id = p_new_admin_id
  ) then
    raise exception 'New owner is not a group member';
  end if;

  insert into group_admins (group_id, guardian_id)
  values (p_group_id, p_new_admin_id)
  on conflict do nothing;
end;
$$;
revoke execute on function transfer_group_ownership(uuid, uuid) from anon;
grant  execute on function transfer_group_ownership(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_group_member_tokens(p_group_id, p_exclude_guardian_id)
-- Returns push tokens for all group members except the excluded guardian.
-- SERVICE ROLE ONLY — used by the delete-group edge function before deleting.
-- Members = anyone with a row in guardian_child_groups OR group_admins.
-- ---------------------------------------------------------------------------
create or replace function get_group_member_tokens(p_group_id uuid, p_exclude_guardian_id uuid)
returns table (
  guardian_id     uuid,
  expo_push_token text,
  name            text
)
language sql
security definer
set search_path = public
as $$
  select distinct g.id, g.expo_push_token, g.name
  from guardians g
  where g.expo_push_token is not null
    and g.id != p_exclude_guardian_id
    and (
      exists (
        select 1 from guardian_child_groups gcg
        where gcg.group_id = p_group_id and gcg.guardian_id = g.id
      )
      or exists (
        select 1 from group_admins ga
        where ga.group_id = p_group_id and ga.guardian_id = g.id
      )
    );
$$;
-- Intentionally no grant to authenticated — service role only.
revoke execute on function get_group_member_tokens(uuid, uuid) from anon;
revoke execute on function get_group_member_tokens(uuid, uuid) from authenticated;
