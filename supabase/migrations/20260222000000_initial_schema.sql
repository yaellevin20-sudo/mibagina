-- =============================================================================
-- mi bagina — Phase 1: Initial Schema Migration
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type checkin_status  as enum ('active', 'extended', 'expired');
create type checkin_source  as enum ('app', 'whatsapp');
create type audit_operation as enum ('INSERT', 'UPDATE', 'DELETE');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table guardians (
  id             uuid        not null references auth.users(id) primary key,
  name           text        not null,
  email          text        not null unique,
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- No direct client writes — all mutations via security-definer functions.
create table children (
  id                     uuid        not null primary key default gen_random_uuid(),
  first_name             text        not null,
  last_name              text        not null,
  date_of_birth          date        not null check (date_of_birth <= current_date),
  created_by_guardian_id uuid        references guardians(id),
  created_at             timestamptz not null default now()
);

create table guardian_children (
  guardian_id uuid not null references guardians(id) on delete cascade,
  child_id    uuid not null references children(id)  on delete cascade,
  primary key (guardian_id, child_id)
);

-- Directional, per-child. Distinct guardian pairs only (enforced by CHECK).
create table co_guardian_visibility (
  child_id         uuid    not null references children(id)  on delete cascade,
  from_guardian_id uuid    not null references guardians(id) on delete cascade,
  to_guardian_id   uuid    not null references guardians(id) on delete cascade,
  can_see_checkins boolean not null default true,
  primary key (child_id, from_guardian_id, to_guardian_id),
  check (from_guardian_id <> to_guardian_id)
);

-- Active = expires_at IS NULL OR expires_at >= current_date (DATE granularity).
-- In MVP, expires_at is always NULL. Do not treat NULL as inactive.
-- invite_token is NOT NULL always. Rotate (not null) to disable joining.
create table groups (
  id           uuid        not null primary key default gen_random_uuid(),
  name         text        not null,
  invite_token text        not null unique default gen_random_uuid()::text,
  is_public    boolean     not null default false,
  expires_at   date,
  created_at   timestamptz not null default now()
);

create table group_admins (
  group_id    uuid not null references groups(id)    on delete cascade,
  guardian_id uuid not null references guardians(id) on delete cascade,
  primary key (group_id, guardian_id)
);

-- Composite FK to guardian_children: guardian can only link children they own.
create table guardian_child_groups (
  guardian_id uuid not null references guardians(id) on delete cascade,
  child_id    uuid not null references children(id)  on delete cascade,
  group_id    uuid not null references groups(id)    on delete cascade,
  primary key (guardian_id, child_id, group_id),
  foreign key (guardian_id, child_id)
    references guardian_children(guardian_id, child_id) on delete cascade
);

create table guardian_group_settings (
  guardian_id            uuid        not null references guardians(id) on delete cascade,
  group_id               uuid        not null references groups(id)    on delete cascade,
  -- TODO: add CHECK constraint on notification_threshold once value range is finalized.
  notification_threshold integer,
  muted_at               timestamptz,
  primary key (guardian_id, group_id)
);

-- normalized_name must not be empty after stripping generic words (enforced in app).
create table playgrounds (
  id              uuid        not null primary key default gen_random_uuid(),
  name            text        not null,
  normalized_name text        not null check (char_length(trim(normalized_name)) > 0),
  created_by      uuid        references guardians(id),
  created_at      timestamptz not null default now()
);

-- session_id is INTERNAL ONLY — never return to client.
-- checked_in_at and expires_at are always set server-side. Never accept from client.
-- INVARIANT: Always filter by BOTH expires_at > now() AND status != 'expired'.
create table check_ins (
  id                      uuid           not null primary key default gen_random_uuid(),
  child_id                uuid           not null references children(id)    on delete cascade,
  playground_id           uuid           not null references playgrounds(id) on delete cascade,
  posted_by               uuid           not null references guardians(id)   on delete cascade,
  session_id              uuid           not null,  -- INTERNAL ONLY, never return to client
  still_there_prompted_at timestamptz,
  checked_in_at           timestamptz    not null default now(),
  expires_at              timestamptz    not null,
  status                  checkin_status not null default 'active',
  source                  checkin_source not null default 'app',
  created_at              timestamptz    not null default now()
);

-- actor_id is null for service-role / scheduled Edge Function writes — expected.
create table audit_log (
  id          uuid            not null primary key default gen_random_uuid(),
  table_name  text            not null,
  operation   audit_operation not null,
  row_pk      jsonb,
  actor_id    uuid,   -- null = service-initiated (expected, not suspicious)
  old_data    jsonb,
  new_data    jsonb,
  occurred_at timestamptz not null default now()
);

-- ip_hash: SHA-256 of client IP (never store raw IP).
-- Any request to the endpoint counts as an attempt, not just invalid tokens.
create table rate_limit_log (
  id           uuid        not null primary key default gen_random_uuid(),
  ip_hash      text        not null,
  endpoint     text        not null,
  attempted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index on check_ins (child_id, expires_at);
create index on check_ins (posted_by, checked_in_at);
create index on guardian_child_groups (group_id, child_id);
create index on guardian_children (child_id);
create index on rate_limit_log (endpoint, ip_hash, attempted_at desc);
-- co_guardian_visibility PK covers its queries

-- ---------------------------------------------------------------------------
-- Type-Shape Views (TypeScript generation only)
-- DO NOT use for data access. DO NOT add RLS policies.
-- ---------------------------------------------------------------------------

-- TYPE SHAPE ONLY — NOT AUTH/CORRECTNESS SOURCE. Use RPCs for all client queries.
create view v_shape_checkins_public as
  select id, child_id, playground_id, posted_by,
         still_there_prompted_at, checked_in_at, expires_at,
         status, source, created_at
  from check_ins;

-- TYPE SHAPE ONLY — NOT AUTH/CORRECTNESS SOURCE.
create view v_shape_children_private as
  select *,
         extract(year from age(date_of_birth))::int as age_years
  from children
  where id in (
    select child_id from guardian_children where guardian_id = auth.uid()
  );

-- TYPE SHAPE ONLY — NOT AUTH/CORRECTNESS SOURCE.
create view v_shape_children_shared as
  select c.id, c.first_name, c.last_name,
         extract(year from age(c.date_of_birth))::int as age_years
  from children c
  where c.id in (
    select child_id from guardian_child_groups
    where group_id in (
      select group_id from guardian_child_groups where guardian_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table guardians               enable row level security;
alter table children                enable row level security;
alter table guardian_children       enable row level security;
alter table co_guardian_visibility  enable row level security;
alter table groups                  enable row level security;
alter table group_admins            enable row level security;
alter table guardian_child_groups   enable row level security;
alter table guardian_group_settings enable row level security;
alter table playgrounds             enable row level security;
alter table check_ins               enable row level security;
alter table audit_log               enable row level security;
alter table rate_limit_log          enable row level security;

-- guardians: own row only
create policy "guardians: select own" on guardians
  for select using (auth.uid() = id);
create policy "guardians: update own" on guardians
  for update using (auth.uid() = id);

-- children: no direct client access (no policies = no access)

-- guardian_children: read if linked to the child
create policy "guardian_children: select linked" on guardian_children
  for select using (
    guardian_id = auth.uid()
    or child_id in (
      select child_id from guardian_children where guardian_id = auth.uid()
    )
  );

-- co_guardian_visibility: read if participant; update only as from_guardian
create policy "co_guardian_visibility: select participant" on co_guardian_visibility
  for select using (
    from_guardian_id = auth.uid() or to_guardian_id = auth.uid()
  );
create policy "co_guardian_visibility: update from_guardian" on co_guardian_visibility
  for update using (from_guardian_id = auth.uid());

-- check_ins: no direct client access (no policies = no access)

-- guardian_child_groups: read if member of the group
create policy "guardian_child_groups: select member" on guardian_child_groups
  for select using (
    guardian_id = auth.uid()
    or group_id in (
      select group_id from guardian_child_groups where guardian_id = auth.uid()
    )
  );

-- groups: read if member or admin; update/delete if admin
-- Active = expires_at IS NULL OR expires_at >= current_date. Do not reject NULL.
create policy "groups: select member or admin" on groups
  for select using (
    id in (select group_id from guardian_child_groups where guardian_id = auth.uid())
    or id in (select group_id from group_admins where guardian_id = auth.uid())
  );
create policy "groups: update admin" on groups
  for update using (
    id in (select group_id from group_admins where guardian_id = auth.uid())
  );
create policy "groups: delete admin" on groups
  for delete using (
    id in (select group_id from group_admins where guardian_id = auth.uid())
  );

-- group_admins: read own rows + co-admins for shared groups
create policy "group_admins: select" on group_admins
  for select using (
    guardian_id = auth.uid()
    or group_id in (
      select group_id from group_admins where guardian_id = auth.uid()
    )
  );

-- guardian_group_settings: own rows only
create policy "guardian_group_settings: all own" on guardian_group_settings
  for all using (guardian_id = auth.uid());

-- playgrounds: read via group check-in history (not a global list); insert as creator
create policy "playgrounds: select via group history" on playgrounds
  for select using (
    id in (
      select playground_id from check_ins
      where child_id in (
        select child_id from guardian_child_groups
        where group_id in (
          select group_id from guardian_child_groups where guardian_id = auth.uid()
        )
      )
    )
  );
create policy "playgrounds: insert own" on playgrounds
  for insert with check (created_by = auth.uid());

-- audit_log: no client access (no policies = no access)
-- rate_limit_log: no client access (no policies = no access)

-- ---------------------------------------------------------------------------
-- Trigger Functions
-- ---------------------------------------------------------------------------

-- 1. Daily check-in limit: 10/guardian/day (Israel TZ), source-global.
--    Uses coalesce(new.checked_in_at, now()) because BEFORE INSERT defaults
--    may not yet be materialized.
create or replace function check_daily_checkin_limit()
returns trigger as $$
declare
  effective_ts timestamptz := coalesce(new.checked_in_at, now());
begin
  if (
    select count(*) from check_ins
    where posted_by = new.posted_by
      and timezone('Asia/Jerusalem', checked_in_at)::date
        = timezone('Asia/Jerusalem', effective_ts)::date
  ) >= 10 then
    raise exception 'Daily check-in limit reached';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger enforce_checkin_limit
  before insert on check_ins
  for each row execute function check_daily_checkin_limit();

-- 3. One active check-in per child, source-global.
--    Sets both status = expired AND expires_at = least(expires_at, now()).
--    Race: two concurrent inserts can both pass before either trigger runs.
--    Acceptable for MVP — get_playground_children() uses DISTINCT ON for UI safety.
create or replace function expire_previous_checkins()
returns trigger as $$
begin
  update check_ins
  set status     = 'expired',
      expires_at = least(expires_at, now())
  where child_id = new.child_id
    and status in ('active', 'extended')
    and id != new.id;
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger enforce_single_active_checkin
  after insert on check_ins
  for each row execute function expire_previous_checkins();

-- 4a. Update last_active_at from check_ins.posted_by
create or replace function update_last_active_from_posted_by()
returns trigger as $$
begin
  update guardians set last_active_at = now() where id = new.posted_by;
  return new;
end;
$$ language plpgsql set search_path = public;

-- 4b. Update last_active_at from guardian_id column (group joins, child adds)
create or replace function update_last_active_from_guardian_id()
returns trigger as $$
begin
  update guardians set last_active_at = now() where id = new.guardian_id;
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger track_activity_checkins
  after insert on check_ins
  for each row execute function update_last_active_from_posted_by();

create trigger track_activity_group_joins
  after insert on guardian_group_settings
  for each row execute function update_last_active_from_guardian_id();

create trigger track_activity_child_adds
  after insert on guardian_children
  for each row execute function update_last_active_from_guardian_id();

-- 5. Audit logging. security definer required for auth.uid() access.
--    actor_id is null for service-role / scheduled Edge Function ops — expected.
create or replace function audit_trigger_func()
returns trigger as $$
begin
  insert into audit_log (table_name, operation, row_pk, actor_id, old_data, new_data)
  values (
    TG_TABLE_NAME,
    TG_OP::audit_operation,
    case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end,
    auth.uid(),
    case when TG_OP = 'DELETE' then to_jsonb(old) else null end,
    case when TG_OP != 'DELETE' then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;

create trigger audit_children
  after insert or update or delete on children
  for each row execute function audit_trigger_func();

create trigger audit_guardian_children
  after insert or update or delete on guardian_children
  for each row execute function audit_trigger_func();

create trigger audit_check_ins
  after insert or update or delete on check_ins
  for each row execute function audit_trigger_func();

-- ---------------------------------------------------------------------------
-- Security-Definer RPCs
-- ---------------------------------------------------------------------------

-- touch_last_active()
-- Returns boolean: true = updated, false = guardian row not found (log, not error).
-- Call after login and on every session restore.
create or replace function touch_last_active()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update guardians set last_active_at = now() where id = auth.uid();
  return found;
end;
$$;
revoke execute on function touch_last_active() from anon;
grant  execute on function touch_last_active() to authenticated;

-- get_my_children()
-- Returns jsonb array of own children including server-computed age_years.
-- Used by Children tab. Never use v_shape_children_shared for own-child cards.
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
        'id',         c.id,
        'first_name', c.first_name,
        'last_name',  c.last_name,
        'age_years',  extract(year from age(c.date_of_birth))::int,
        'created_at', c.created_at
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

-- get_playground_children(p_playground_id uuid)
-- Returns jsonb: { named[], anonymous_ages[], no_visible_children }
-- Access denied  = genuine auth failure (null uid or no group connection at all).
-- no_visible_children = true is a timing race — render "No one here right now", not an error.
-- DISTINCT ON prevents duplicate children during concurrent-insert race window.
-- co_guardian_visibility enforced in both named and anonymous branches.
create or replace function get_playground_children(p_playground_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
  named_arr jsonb;
  anon_arr  jsonb;
begin
  if viewer_id is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1
    from check_ins ci
    join guardian_child_groups gcg_child  on gcg_child.child_id    = ci.child_id
    join guardian_child_groups gcg_viewer on gcg_viewer.group_id   = gcg_child.group_id
                                         and gcg_viewer.guardian_id = viewer_id
    where ci.playground_id = p_playground_id
  ) then
    raise exception 'Access denied';
  end if;

  -- Named branch: active, group overlap, visibility allows
  select coalesce(jsonb_agg(row_data), '[]'::jsonb) into named_arr
  from (
    select distinct on (ci.child_id)
      jsonb_build_object(
        'child_id',   c.id,
        'first_name', c.first_name,
        'age_years',  extract(year from age(c.date_of_birth))::int
      ) as row_data
    from check_ins ci
    join children c on c.id = ci.child_id
    where ci.playground_id = p_playground_id
      and ci.expires_at > now()
      and ci.status != 'expired'
      and c.id in (
        select child_id from guardian_child_groups
        where group_id in (
          select group_id from guardian_child_groups where guardian_id = viewer_id
        )
      )
      and not exists (
        select 1 from co_guardian_visibility cgv
        where cgv.child_id         = ci.child_id
          and cgv.from_guardian_id = ci.posted_by
          and cgv.to_guardian_id   = viewer_id
          and cgv.can_see_checkins = false
      )
    order by ci.child_id, ci.checked_in_at desc
  ) subq;

  -- Anonymous branch: active, no group overlap or hidden by co_guardian_visibility
  select coalesce(jsonb_agg(age_val), '[]'::jsonb) into anon_arr
  from (
    select distinct on (ci.child_id)
      extract(year from age(c.date_of_birth))::int as age_val
    from check_ins ci
    join children c on c.id = ci.child_id
    where ci.playground_id = p_playground_id
      and ci.expires_at > now()
      and ci.status != 'expired'
      and (
        c.id not in (
          select child_id from guardian_child_groups
          where group_id in (
            select group_id from guardian_child_groups where guardian_id = viewer_id
          )
        )
        or exists (
          select 1 from co_guardian_visibility cgv
          where cgv.child_id         = ci.child_id
            and cgv.from_guardian_id = ci.posted_by
            and cgv.to_guardian_id   = viewer_id
            and cgv.can_see_checkins = false
        )
      )
    order by ci.child_id, ci.checked_in_at desc
  ) subq;

  return jsonb_build_object(
    'named',               named_arr,
    'anonymous_ages',      anon_arr,
    'no_visible_children', (jsonb_array_length(named_arr) = 0
                            and jsonb_array_length(anon_arr) = 0)
  );
end;
$$;
revoke execute on function get_playground_children(uuid) from anon;
grant  execute on function get_playground_children(uuid) to authenticated;
