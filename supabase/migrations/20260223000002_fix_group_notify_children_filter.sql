-- Fix get_group_notification_targets: filter children by group membership.
--
-- Previously the children subquery returned ALL of the poster's active check-ins
-- at the playground, regardless of which group they belong to. This meant Group A
-- members could see children only registered in Group B.
--
-- Now children are scoped to the notified group: only children that are
-- (a) checked in by p_posted_by at p_playground_id AND
-- (b) registered in the same group as the recipient.

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

  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into v_result
  from (
    select
      g.id                as guardian_id,
      g.expo_push_token   as expo_push_token,
      gr.name             as group_name,
      v_playground_name   as playground_name,
      -- Only the poster's children that belong to THIS group.
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'first_name', ch.first_name,
          'last_name',  ch.last_name
        )), '[]'::jsonb)
        from check_ins ci2
        join children ch on ch.id = ci2.child_id
        -- Must be registered in the same group as the recipient.
        join guardian_child_groups gcg_child
          on  gcg_child.child_id    = ci2.child_id
          and gcg_child.group_id    = gcg_notify.group_id
          and gcg_child.guardian_id = p_posted_by
        where ci2.posted_by     = p_posted_by
          and ci2.playground_id = p_playground_id
          and ci2.status        != 'expired'
          and (ci2.expires_at is null or ci2.expires_at > now())
      ) as children
    from guardian_child_groups gcg_notify
    join groups gr on gr.id = gcg_notify.group_id
      and (gr.expires_at is null or gr.expires_at >= current_date)
    join guardians g on g.id = gcg_notify.guardian_id
    where gcg_notify.guardian_id != p_posted_by
      -- The group must contain at least one child of p_posted_by with an active check-in.
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
          where ggs2.guardian_id              = gcg_notify.guardian_id
            and ggs2.group_id                 = gcg_notify.group_id
            and ggs2.notification_threshold   is not null
        )
        or exists (
          select 1
          from guardian_group_settings ggs3
          where ggs3.guardian_id = gcg_notify.guardian_id
            and ggs3.group_id   = gcg_notify.group_id
            and ggs3.notification_threshold is not null
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
    -- One row per (guardian, group) — a guardian in multiple groups gets one
    -- notification per group, each with that group's children only.
    group by g.id, g.expo_push_token, gr.name
  ) t;

  return v_result;
end;
$$;

revoke execute on function get_group_notification_targets(uuid, uuid) from anon, authenticated;
grant  execute on function get_group_notification_targets(uuid, uuid) to service_role;
