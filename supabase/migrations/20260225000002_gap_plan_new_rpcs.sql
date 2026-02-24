-- =============================================================================
-- Gap Plan Part 2: New RPCs + feed/children RPC updates
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 2a: get_my_active_checkin()
-- Returns the caller's current active check-in session if any.
-- Filters: status = 'active' AND expires_at > now()
-- Returns null if no active session.
-- ---------------------------------------------------------------------------
create or replace function get_my_active_checkin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardian_id uuid := auth.uid();
  v_result      jsonb;
begin
  if v_guardian_id is null then raise exception 'Not authenticated'; end if;

  select jsonb_build_object(
    'playground_id',   p.id,
    'playground_name', p.name,
    'child_names',     (
      select jsonb_agg(c.first_name order by c.first_name)
      from check_ins ci2
      join children c on c.id = ci2.child_id
      where ci2.posted_by   = v_guardian_id
        and ci2.playground_id = p.id
        and ci2.status       != 'expired'
        and ci2.expires_at    > now()
    ),
    'child_ids',       (
      select jsonb_agg(ci2.child_id order by ci2.child_id)
      from check_ins ci2
      where ci2.posted_by   = v_guardian_id
        and ci2.playground_id = p.id
        and ci2.status       != 'expired'
        and ci2.expires_at    > now()
    ),
    'check_in_ids',    (
      select jsonb_agg(ci2.id order by ci2.id)
      from check_ins ci2
      where ci2.posted_by   = v_guardian_id
        and ci2.playground_id = p.id
        and ci2.status       != 'expired'
        and ci2.expires_at    > now()
    ),
    'checked_in_at',   min(ci.checked_in_at)
  )
  into v_result
  from check_ins ci
  join playgrounds p on p.id = ci.playground_id
  where ci.posted_by  = v_guardian_id
    and ci.status    != 'expired'
    and ci.expires_at > now()
  group by p.id, p.name
  limit 1;

  return v_result;
end;
$$;
revoke execute on function get_my_active_checkin() from anon;
grant  execute on function get_my_active_checkin() to authenticated;

-- ---------------------------------------------------------------------------
-- 1f: add_children_to_group(p_group_id, p_child_ids)
-- Adds caller's children to a group they admin (post-create step).
-- Also creates co_guardian_visibility rows for existing group members.
-- ---------------------------------------------------------------------------
create or replace function add_children_to_group(p_group_id uuid, p_child_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardian_id uuid := auth.uid();
  v_child_id    uuid;
begin
  if v_guardian_id is null then raise exception 'Not authenticated'; end if;
  if array_length(p_child_ids, 1) is null then return; end if;

  -- Caller must be admin of the group
  if not exists (
    select 1 from group_admins
    where group_id = p_group_id and guardian_id = v_guardian_id
  ) then
    raise exception 'Access denied';
  end if;

  -- Verify caller owns all supplied children
  if exists (
    select unnest(p_child_ids) as cid
    except
    select child_id from guardian_children where guardian_id = v_guardian_id
  ) then
    raise exception 'One or more children not found';
  end if;

  foreach v_child_id in array p_child_ids loop
    -- Add child to group
    insert into guardian_child_groups (guardian_id, child_id, group_id)
    values (v_guardian_id, v_child_id, p_group_id)
    on conflict do nothing;

    -- co_guardian_visibility: from me → existing co-guardians in this group
    insert into co_guardian_visibility (child_id, from_guardian_id, to_guardian_id, can_see_checkins)
    select distinct v_child_id, v_guardian_id, gcg_other.guardian_id, true
    from guardian_child_groups gcg_other
    where gcg_other.group_id    = p_group_id
      and gcg_other.guardian_id != v_guardian_id
    on conflict do nothing;

    -- co_guardian_visibility: from existing co-guardians → me
    insert into co_guardian_visibility (child_id, from_guardian_id, to_guardian_id, can_see_checkins)
    select distinct v_child_id, gcg_other.guardian_id, v_guardian_id, true
    from guardian_child_groups gcg_other
    where gcg_other.group_id    = p_group_id
      and gcg_other.guardian_id != v_guardian_id
    on conflict do nothing;
  end loop;
end;
$$;
revoke execute on function add_children_to_group(uuid, uuid[]) from anon;
grant  execute on function add_children_to_group(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4e: get_child_group_context(p_group_id, p_child_id)
-- Pre-check before removing a child from a group. Read-only.
-- Returns context to inform which confirmation copy to show the user.
-- ---------------------------------------------------------------------------
create or replace function get_child_group_context(p_group_id uuid, p_child_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardian_id         uuid := auth.uid();
  v_other_guardians_cnt int;
  v_my_child_count      int;
  v_owner_removed       boolean;
  v_active_checkins     boolean;
begin
  if v_guardian_id is null then raise exception 'Not authenticated'; end if;

  -- Count other guardians who also have this child in this group
  select count(distinct guardian_id)
  into v_other_guardians_cnt
  from guardian_child_groups
  where group_id    = p_group_id
    and child_id    = p_child_id
    and guardian_id != v_guardian_id;

  -- Count caller's remaining children in this group (excluding this child)
  select count(distinct child_id)
  into v_my_child_count
  from guardian_child_groups
  where group_id    = p_group_id
    and guardian_id = v_guardian_id
    and child_id   != p_child_id;

  -- Would the caller be removed from the group (last child for them)?
  v_owner_removed := (v_my_child_count = 0);

  -- Are there active check-ins for this child in this group right now?
  select exists (
    select 1 from check_ins ci
    join guardian_child_groups gcg on gcg.child_id = ci.child_id and gcg.group_id = p_group_id
    where ci.child_id  = p_child_id
      and ci.status   != 'expired'
      and ci.expires_at > now()
  ) into v_active_checkins;

  return jsonb_build_object(
    'other_guardians_count',  v_other_guardians_cnt,
    'is_last_child_for_me',   v_owner_removed,
    'owner_would_be_removed', v_owner_removed and exists(
      select 1 from group_admins where group_id = p_group_id and guardian_id = v_guardian_id
    ),
    'active_checkins_exist',  v_active_checkins
  );
end;
$$;
revoke execute on function get_child_group_context(uuid, uuid) from anon;
grant  execute on function get_child_group_context(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4g: demote_to_member(p_group_id)
-- Removes caller from group_admins but keeps their guardian_child_groups rows.
-- Used after transferring ownership when the previous owner wants to stay.
-- ---------------------------------------------------------------------------
create or replace function demote_to_member(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller      uuid := auth.uid();
  v_admin_count int;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;

  -- Must be an admin to demote themselves
  if not exists (
    select 1 from group_admins where group_id = p_group_id and guardian_id = v_caller
  ) then
    raise exception 'Not an admin of this group';
  end if;

  -- Block if this would leave the group with no admins
  select count(*) into v_admin_count
  from group_admins where group_id = p_group_id;

  if v_admin_count <= 1 then
    raise exception 'Cannot demote the last admin — transfer ownership first';
  end if;

  delete from group_admins
  where group_id = p_group_id and guardian_id = v_caller;
end;
$$;
revoke execute on function demote_to_member(uuid) from anon;
grant  execute on function demote_to_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2b: Update get_group_active_checkins() to include last_name + checked_in_at
-- ---------------------------------------------------------------------------
create or replace function get_group_active_checkins(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from guardian_child_groups
    where group_id = p_group_id and guardian_id = viewer_id
    union all
    select 1 from group_admins
    where group_id = p_group_id and guardian_id = viewer_id
  ) then
    raise exception 'Access denied';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'playground_id',   pg.id,
          'playground_name', pg.name,
          'named',           named_agg.rows,
          'anonymous_ages',  anon_agg.ages
        )
      ),
      '[]'::jsonb
    )
    from (
      select distinct ci.playground_id
      from check_ins ci
      where ci.expires_at > now()
        and ci.status != 'expired'
        and ci.child_id in (
          select child_id from guardian_child_groups where group_id = p_group_id
        )
    ) active_pg
    join playgrounds pg on pg.id = active_pg.playground_id
    cross join lateral (
      -- Named: visible to viewer
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'child_id',      t.child_id,
            'first_name',    t.first_name,
            'last_name',     t.last_name,
            'age_years',     t.age_years,
            'check_in_id',   t.check_in_id,
            'posted_by',     t.posted_by,
            'checked_in_at', t.checked_in_at
          )
        ),
        '[]'::jsonb
      ) as rows
      from (
        select distinct on (ci.child_id)
          ci.child_id,
          ch.first_name,
          ch.last_name,
          extract(year from age(ch.date_of_birth))::int as age_years,
          ci.id                                         as check_in_id,
          ci.posted_by,
          ci.checked_in_at
        from check_ins ci
        join children ch on ch.id = ci.child_id
        where ci.playground_id = active_pg.playground_id
          and ci.expires_at > now()
          and ci.status != 'expired'
          and ci.child_id in (
            select child_id from guardian_child_groups where group_id = p_group_id
          )
          and not exists (
            select 1 from co_guardian_visibility cgv
            where cgv.child_id         = ci.child_id
              and cgv.from_guardian_id = ci.posted_by
              and cgv.to_guardian_id   = viewer_id
              and cgv.can_see_checkins = false
          )
        order by ci.child_id, ci.checked_in_at desc
      ) t
    ) named_agg
    cross join lateral (
      -- Anonymous: hidden by co_guardian_visibility
      select coalesce(
        jsonb_agg(t.age_val),
        '[]'::jsonb
      ) as ages
      from (
        select distinct on (ci.child_id)
          extract(year from age(ch.date_of_birth))::int as age_val
        from check_ins ci
        join children ch on ch.id = ci.child_id
        where ci.playground_id = active_pg.playground_id
          and ci.expires_at > now()
          and ci.status != 'expired'
          and ci.child_id in (
            select child_id from guardian_child_groups where group_id = p_group_id
          )
          and exists (
            select 1 from co_guardian_visibility cgv
            where cgv.child_id         = ci.child_id
              and cgv.from_guardian_id = ci.posted_by
              and cgv.to_guardian_id   = viewer_id
              and cgv.can_see_checkins = false
          )
        order by ci.child_id, ci.checked_in_at desc
      ) t
    ) anon_agg
  );
end;
$$;
revoke execute on function get_group_active_checkins(uuid) from anon;
grant  execute on function get_group_active_checkins(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6a: Update get_my_children() to include groups per child
-- groups = groups where THIS guardian has enrolled the child
-- ---------------------------------------------------------------------------
create or replace function get_my_children()
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
        'id',           c.id,
        'first_name',   c.first_name,
        'last_name',    c.last_name,
        'age_years',    extract(year from age(c.date_of_birth))::int,
        'created_at',   c.created_at,
        'co_guardians', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'guardian_id',        g.id,
              'name',               g.name,
              'can_see_my_checkins', coalesce(cgv.can_see_checkins, true)
            ) order by g.name
          )
          from guardian_children gc2
          join guardians g on g.id = gc2.guardian_id
          left join co_guardian_visibility cgv
            on cgv.child_id         = c.id
            and cgv.from_guardian_id = viewer_id
            and cgv.to_guardian_id   = g.id
          where gc2.child_id    = c.id
            and gc2.guardian_id != viewer_id
        ), '[]'::jsonb),
        'groups',       coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id',   gr.id,
              'name', gr.name
            ) order by gr.name
          )
          from guardian_child_groups gcg
          join groups gr on gr.id = gcg.group_id
          where gcg.child_id    = c.id
            and gcg.guardian_id = viewer_id
            and (gr.expires_at is null or gr.expires_at >= current_date)
        ), '[]'::jsonb)
      ) order by c.first_name
    ), '[]'::jsonb)
    from children c
    join guardian_children gc on gc.child_id = c.id
    where gc.guardian_id = viewer_id
  );
end;
$$;
revoke execute on function get_my_children() from anon;
grant  execute on function get_my_children() to authenticated;
