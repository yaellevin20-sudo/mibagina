-- =============================================================================
-- Gap Plan Part 1: Schema additions + simple RPC updates
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 4k: Add created_by to groups table
-- Needed to return the inviter's name in the join-group edge function.
-- ---------------------------------------------------------------------------
alter table groups add column if not exists created_by uuid references guardians(id) on delete set null;

-- Backfill: for existing groups, point to the group admin (only one admin at creation time)
update groups g
set created_by = (
  select guardian_id from group_admins where group_id = g.id limit 1
)
where g.created_by is null;

-- Update create_group() to capture the creator
create or replace function create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardian_id uuid := auth.uid();
  v_group_id    uuid;
begin
  if v_guardian_id is null then raise exception 'Not authenticated'; end if;
  if trim(p_name) = '' then raise exception 'Group name cannot be empty'; end if;

  insert into groups (name, created_by)
  values (trim(p_name), v_guardian_id)
  returning id into v_group_id;

  insert into group_admins (group_id, guardian_id)
  values (v_group_id, v_guardian_id)
  on conflict do nothing;

  insert into guardian_group_settings (guardian_id, group_id)
  values (v_guardian_id, v_group_id)
  on conflict do nothing;

  return v_group_id;
end;
$$;
revoke execute on function create_group(text) from anon;
grant  execute on function create_group(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5a: Add posted_by to notification_queue
-- The dispatch-notifications function uses this to exclude only the poster
-- (not all checked-in guardians) from receiving the notification.
-- ---------------------------------------------------------------------------
alter table notification_queue add column if not exists posted_by uuid references guardians(id) on delete set null;

-- Update enqueue_group_notification to capture the poster
create or replace function enqueue_group_notification(p_playground_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_guardian_id uuid := auth.uid();
  v_group_id    uuid;
begin
  if v_guardian_id is null then raise exception 'Not authenticated'; end if;

  for v_group_id in
    select distinct gcg.group_id
    from guardian_child_groups gcg
    join check_ins ci on ci.child_id = gcg.child_id
    join groups gr on gr.id = gcg.group_id
      and (gr.expires_at is null or gr.expires_at >= current_date)
    where gcg.guardian_id  = v_guardian_id
      and ci.posted_by     = v_guardian_id
      and ci.playground_id = p_playground_id
      and ci.status       != 'expired'
      and ci.expires_at    > now()
  loop
    insert into notification_queue (group_id, playground_id, posted_by, fire_at)
    values (v_group_id, p_playground_id, v_guardian_id, now() + interval '60 seconds')
    on conflict do nothing;
  end loop;
end;
$$;

revoke execute on function enqueue_group_notification(uuid) from anon;
grant  execute on function enqueue_group_notification(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4a: Update get_my_groups() to include child_count
-- child_count = distinct children in the group (not guardian count)
-- Keep member_count (used for isOnlyMember guard in groups.tsx)
-- ---------------------------------------------------------------------------
create or replace function get_my_groups()
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
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',           g.id,
        'name',         g.name,
        'invite_token', g.invite_token,
        'expires_at',   g.expires_at,
        'created_at',   g.created_at,
        'is_admin',     exists(
          select 1 from group_admins ga
          where ga.group_id = g.id and ga.guardian_id = viewer_id
        ),
        'my_children',  coalesce((
          select jsonb_agg(jsonb_build_object(
            'child_id',   c.id,
            'first_name', c.first_name,
            'last_name',  c.last_name
          ) order by c.first_name)
          from guardian_child_groups gcg
          join children c on c.id = gcg.child_id
          where gcg.group_id = g.id and gcg.guardian_id = viewer_id
        ), '[]'::jsonb),
        'member_count', (
          select count(distinct gcg2.guardian_id)
          from guardian_child_groups gcg2
          where gcg2.group_id = g.id
        ),
        'child_count',  (
          select count(distinct gcg3.child_id)
          from guardian_child_groups gcg3
          where gcg3.group_id = g.id
        )
      ) order by g.created_at desc
    ), '[]'::jsonb)
    from groups g
    where (
      exists(select 1 from guardian_child_groups gcg where gcg.group_id = g.id and gcg.guardian_id = viewer_id)
      or exists(select 1 from group_admins ga where ga.group_id = g.id and ga.guardian_id = viewer_id)
    )
    and (g.expires_at is null or g.expires_at >= current_date)
  );
end;
$$;
revoke execute on function get_my_groups() from anon;
grant  execute on function get_my_groups() to authenticated;

-- ---------------------------------------------------------------------------
-- 3a: Update get_my_playgrounds() to sort by most recently used
-- ---------------------------------------------------------------------------
create or replace function get_my_playgrounds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardian_id uuid := auth.uid();
begin
  if v_guardian_id is null then raise exception 'Not authenticated'; end if;

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',   p.id,
        'name', p.name
      ) order by last_used desc
    ), '[]'::jsonb)
    from (
      select distinct on (ci.playground_id)
        p.id,
        p.name,
        max(ci.checked_in_at) as last_used
      from check_ins ci
      join playgrounds p on p.id = ci.playground_id
      where ci.posted_by = v_guardian_id
      group by p.id, p.name
    ) sub
  );
end;
$$;
revoke execute on function get_my_playgrounds() from anon;
grant  execute on function get_my_playgrounds() to authenticated;
