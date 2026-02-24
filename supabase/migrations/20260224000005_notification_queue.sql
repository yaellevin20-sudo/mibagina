-- =============================================================================
-- notification_queue: 60-second bundled group check-in notifications
-- =============================================================================

-- ── Table ─────────────────────────────────────────────────────────────────────
create table notification_queue (
  id            uuid        not null primary key default gen_random_uuid(),
  group_id      uuid        not null references groups(id) on delete cascade,
  playground_id uuid        not null references playgrounds(id) on delete cascade,
  fire_at       timestamptz not null,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- One unsent batch per (group, playground) at a time.
-- Cleared when dispatch sets sent_at, so new check-ins can create a fresh row.
create unique index notification_queue_pending_unique
  on notification_queue (group_id, playground_id)
  where sent_at is null;

-- No direct client access — all writes via security definer RPC, reads via service_role.
alter table notification_queue enable row level security;
revoke all on notification_queue from anon, authenticated;

-- ── RPC: enqueue_group_notification ──────────────────────────────────────────
-- Called fire-and-forget by the client after a successful check-in.
-- Creates a pending batch row (fire_at = now + 60s) for each group the posting
-- guardian belongs to at this playground. ON CONFLICT DO NOTHING preserves any
-- existing pending window so all check-ins in that window are bundled together.

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
    -- Only active, non-expired groups
    join groups gr on gr.id = gcg.group_id
      and (gr.expires_at is null or gr.expires_at >= current_date)
    where gcg.guardian_id  = v_guardian_id
      and ci.posted_by     = v_guardian_id
      and ci.playground_id = p_playground_id
      and ci.status       != 'expired'
      and ci.expires_at    > now()
  loop
    -- If a pending batch already exists, leave it — it will collect all check-ins
    -- when it fires. The dispatch function claims batches atomically via
    -- UPDATE...RETURNING, freeing the unique slot so a fresh row can be inserted
    -- for any check-in that arrives after the claim.
    insert into notification_queue (group_id, playground_id, fire_at)
    values (v_group_id, p_playground_id, now() + interval '60 seconds')
    on conflict do nothing;
  end loop;
end;
$$;

revoke execute on function enqueue_group_notification(uuid) from anon;
grant  execute on function enqueue_group_notification(uuid) to authenticated;

-- ── RPC: get_notification_batch_targets ──────────────────────────────────────
-- Service-role only. Returns a JSONB array of recipients with bundled children
-- for a (group, playground) batch. Called by dispatch-notifications edge function.

create or replace function get_notification_batch_targets(p_group_id uuid, p_playground_id uuid)
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
      -- All distinct active children at (group, playground).
      -- Scoped to group via guardian_child_groups join (Issue 2 + 10).
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
      -- Exclude guardians who are themselves checked in here (Issue 1)
      and not exists (
        select 1
        from check_ins ci_self
        join guardian_child_groups gcg_self
          on gcg_self.child_id   = ci_self.child_id
         and gcg_self.group_id   = p_group_id
         and gcg_self.guardian_id = gcg_notify.guardian_id
        where ci_self.posted_by     = gcg_notify.guardian_id
          and ci_self.playground_id = p_playground_id
          and ci_self.status       != 'expired'
          and ci_self.expires_at    > now()
      )
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

revoke execute on function get_notification_batch_targets(uuid, uuid) from anon, authenticated;
-- service_role retains its default execute privilege (no explicit grant needed)

-- ── Cron job: dispatch-group-notifications — every minute ─────────────────────
do $$
begin
  perform cron.unschedule('dispatch-group-notifications');
  exception when others then null;
end $$;

select cron.schedule(
  'dispatch-group-notifications',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://mtjycclnrukylxqszfqe.supabase.co/functions/v1/dispatch-notifications',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer 8e216620e6597b9a81c8766a8c0f62107f0dd0088adfee78ba544145016e4642"}'::jsonb,
      body    := '{}'::jsonb
    );
  $cron$
);
