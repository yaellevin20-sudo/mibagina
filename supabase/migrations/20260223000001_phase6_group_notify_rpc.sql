-- Phase 6: get_group_notification_targets
--
-- Returns push notification targets when a guardian posts a check-in.
-- Callable by service_role only (invoked from the notify-group-checkin Edge Function).
--
-- Returns JSONB array of:
--   { guardian_id, expo_push_token, group_name, playground_name, children[] }
-- where children are the posted-by guardian's children active at the playground.

create or replace function get_group_notification_targets(
  p_playground_id uuid,
  p_posted_by     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_playground_name text;
  v_result          jsonb;
begin
  -- Resolve playground name.
  select name into v_playground_name
  from playgrounds
  where id = p_playground_id;

  if not found then
    return '[]'::jsonb;
  end if;

  -- Build result.
  -- For each group that has active children at p_playground_id:
  --   Find all guardians in that group (via guardian_child_groups).
  --   Exclude p_posted_by (they are the one checking in).
  --   Filter by: push token not null, not muted.
  --   Respect notification_threshold (NULL → always notify; treat as threshold 1).
  --   Include the posted-by guardian's children active at this playground
  --   as the "children" payload for the notification body.
  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into v_result
  from (
    select
      g.id                as guardian_id,
      g.expo_push_token   as expo_push_token,
      gr.name             as group_name,
      v_playground_name   as playground_name,
      -- Children of p_posted_by currently active at the playground
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'first_name', ch.first_name,
          'last_name',  ch.last_name
        )), '[]'::jsonb)
        from check_ins ci2
        join children ch on ch.id = ci2.child_id
        where ci2.posted_by     = p_posted_by
          and ci2.playground_id = p_playground_id
          and ci2.status        != 'expired'
          and (ci2.expires_at is null or ci2.expires_at > now())
      ) as children
    from guardian_child_groups gcg_notify
    -- The group must have at least one active check-in at this playground
    -- (i.e. the posted-by guardian's children are already in a shared group).
    join groups gr on gr.id = gcg_notify.group_id
      and (gr.expires_at is null or gr.expires_at >= current_date)
    -- The notified guardian must be in the same group.
    join guardians g on g.id = gcg_notify.guardian_id
    -- Exclude the guardian who just checked in.
    where gcg_notify.guardian_id != p_posted_by
      -- The group must contain at least one child of p_posted_by.
      and exists (
        select 1
        from guardian_child_groups gcg_poster
        join check_ins ci3 on ci3.child_id = gcg_poster.child_id
        where gcg_poster.group_id    = gcg_notify.group_id
          and gcg_poster.guardian_id = p_posted_by
          and ci3.playground_id      = p_playground_id
          and ci3.status             != 'expired'
          and (ci3.expires_at is null or ci3.expires_at > now())
      )
      -- Must have a push token.
      and g.expo_push_token is not null
      -- Must not be muted for this group.
      and not exists (
        select 1
        from guardian_group_settings ggs
        where ggs.guardian_id = gcg_notify.guardian_id
          and ggs.group_id    = gcg_notify.group_id
          and ggs.muted_at    is not null
      )
      -- Respect notification_threshold (NULL = always notify).
      and (
        not exists (
          select 1
          from guardian_group_settings ggs2
          where ggs2.guardian_id          = gcg_notify.guardian_id
            and ggs2.group_id             = gcg_notify.group_id
            and ggs2.notification_threshold is not null
        )
        or exists (
          select 1
          from guardian_group_settings ggs3
          where ggs3.guardian_id = gcg_notify.guardian_id
            and ggs3.group_id   = gcg_notify.group_id
            and ggs3.notification_threshold is not null
            -- At least threshold many active check-ins at this playground in this group.
            and (
              select count(distinct ci4.child_id)
              from check_ins ci4
              join guardian_child_groups gcg4 on gcg4.child_id = ci4.child_id
              where gcg4.group_id       = gcg_notify.group_id
                and ci4.playground_id   = p_playground_id
                and ci4.status          != 'expired'
                and (ci4.expires_at is null or ci4.expires_at > now())
            ) >= ggs3.notification_threshold
        )
      )
    -- Deduplicate: one row per (guardian, group). Pick the first group_name alphabetically.
    group by g.id, g.expo_push_token, gr.name
  ) t;

  return v_result;
end;
$$;

-- Service role only — not accessible by anon or authenticated users.
revoke execute on function get_group_notification_targets(uuid, uuid) from anon, authenticated;
grant  execute on function get_group_notification_targets(uuid, uuid) to service_role;
