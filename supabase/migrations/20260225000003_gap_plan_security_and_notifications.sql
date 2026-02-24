-- =============================================================================
-- Gap Plan Part 3: Security/permission updates + push notifications from RPCs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 4d/4e: Update remove_child_from_group
-- New rules:
--   • Admin: remove any child globally (all guardian rows for that child in group)
--   • Non-admin: remove only THEIR OWN enrollment; if last child → cascade self-remove
-- ---------------------------------------------------------------------------
create or replace function remove_child_from_group(p_group_id uuid, p_child_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_is_admin       boolean;
  v_remaining_cnt  int;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  v_is_admin := exists (
    select 1 from group_admins where group_id = p_group_id and guardian_id = v_caller
  );

  if v_is_admin then
    -- Admin removes child from all guardians in this group
    delete from guardian_child_groups
    where group_id = p_group_id and child_id = p_child_id;
  else
    -- Non-admin: must own this child's enrollment in the group
    if not exists (
      select 1 from guardian_child_groups
      where group_id    = p_group_id
        and guardian_id = v_caller
        and child_id    = p_child_id
    ) then
      raise exception 'Access denied';
    end if;

    delete from guardian_child_groups
    where group_id    = p_group_id
      and guardian_id = v_caller
      and child_id    = p_child_id;

    -- Cascade: if caller has no remaining children in this group, self-remove
    select count(*) into v_remaining_cnt
    from guardian_child_groups
    where group_id = p_group_id and guardian_id = v_caller;

    if v_remaining_cnt = 0 then
      delete from guardian_group_settings where group_id = p_group_id and guardian_id = v_caller;
      delete from group_admins             where group_id = p_group_id and guardian_id = v_caller;
    end if;
  end if;
end;
$$;
revoke execute on function remove_child_from_group(uuid, uuid) from anon;
grant  execute on function remove_child_from_group(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4i: Update remove_guardian_from_group to send push to removed guardian
-- Only sends when an admin is removing another guardian (not on self-leave).
-- Uses pg_net (already enabled via cron jobs).
-- ---------------------------------------------------------------------------
create or replace function remove_guardian_from_group(p_group_id uuid, p_guardian_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_admin_count    int;
  v_push_token     text;
  v_group_name     text;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  -- Must be admin OR self-leave
  if v_caller != p_guardian_id then
    if not exists (
      select 1 from group_admins
      where group_id = p_group_id and guardian_id = v_caller
    ) then
      raise exception 'Access denied';
    end if;
  end if;

  -- Block if removing the last admin
  if exists (
    select 1 from group_admins
    where group_id = p_group_id and guardian_id = p_guardian_id
  ) then
    select count(*) into v_admin_count
    from group_admins where group_id = p_group_id;

    if v_admin_count <= 1 then
      raise exception 'Cannot remove the last admin — assign another admin first';
    end if;
  end if;

  -- Fetch push token and group name before deleting (for notification)
  if v_caller != p_guardian_id then
    select g.expo_push_token into v_push_token
    from guardians g where g.id = p_guardian_id;

    select name into v_group_name from groups where id = p_group_id;
  end if;

  -- 1. guardian_child_groups
  delete from guardian_child_groups
  where group_id = p_group_id and guardian_id = p_guardian_id;

  -- 2. guardian_group_settings
  delete from guardian_group_settings
  where group_id = p_group_id and guardian_id = p_guardian_id;

  -- 3. group_admins (if present)
  delete from group_admins
  where group_id = p_group_id and guardian_id = p_guardian_id;

  -- 4. Send push notification to removed guardian (admin-initiated removal only)
  if v_caller != p_guardian_id and v_push_token is not null and v_group_name is not null then
    perform net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,
      body    := jsonb_build_object(
        'to',   v_push_token,
        'title', 'מי בגינה',
        'body',  'הוסרת מהקבוצה ' || v_group_name,
        'data',  jsonb_build_object('type', 'removed_from_group', 'group_name', v_group_name)
      )::text
    );
  end if;
end;
$$;
revoke execute on function remove_guardian_from_group(uuid, uuid) from anon;
grant  execute on function remove_guardian_from_group(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5a: Update get_notification_batch_targets to exclude poster only.
-- Adds p_posted_by param. Replaces NOT EXISTS (ci_self...) with != p_posted_by.
-- This ensures checked-in guardians still receive notifications (they want to
-- know which friends are also at the playground). Only the poster is excluded.
-- ---------------------------------------------------------------------------
create or replace function get_notification_batch_targets(
  p_group_id     uuid,
  p_playground_id uuid,
  p_posted_by    uuid default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_group_name      text;
  v_playground_name text;
  v_result          jsonb;
begin
  select name into v_group_name from groups
  where id = p_group_id
    and (expires_at is null or expires_at >= current_date);
  if not found then return '[]'::jsonb; end if;

  select name into v_playground_name from playgrounds where id = p_playground_id;
  if not found then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_result
  from (
    select
      g.id              as guardian_id,
      g.expo_push_token as expo_push_token,
      v_group_name      as group_name,
      v_playground_name as playground_name,
      -- All distinct active children at (group, playground) scoped to group.
      (
        select coalesce(jsonb_agg(distinct jsonb_build_object(
          'first_name', ch.first_name
        )), '[]'::jsonb)
        from check_ins ci2
        join children ch on ch.id = ci2.child_id
        join guardian_child_groups gcg_ch
          on gcg_ch.child_id = ci2.child_id
         and gcg_ch.group_id = p_group_id
        where ci2.playground_id = p_playground_id
          and ci2.status       != 'expired'
          and ci2.expires_at    > now()
      ) as children
    from guardian_child_groups gcg_notify
    join guardians g on g.id = gcg_notify.guardian_id
    where gcg_notify.group_id = p_group_id
      and g.expo_push_token is not null
      -- Exclude only the poster (not all checked-in guardians)
      and (p_posted_by is null or gcg_notify.guardian_id != p_posted_by)
      -- Exclude muted guardians
      and not exists (
        select 1 from guardian_group_settings ggs
        where ggs.guardian_id = gcg_notify.guardian_id
          and ggs.group_id    = p_group_id
          and ggs.muted_at    is not null
      )
    group by g.id, g.expo_push_token
  ) t;

  return v_result;
end;
$$;

revoke execute on function get_notification_batch_targets(uuid, uuid, uuid) from anon, authenticated;
-- service_role retains its default execute privilege (no explicit grant needed)
