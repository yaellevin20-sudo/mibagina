-- =============================================================================
-- Phase 9: Maintenance helpers
-- =============================================================================

-- -----------------------------------------------------------------------
-- get_orphaned_children()
-- Returns children that have no guardian_children row (should be zero).
-- Called by the orphan-monitor Edge Function (service role only).
-- Alert ops if any rows are returned — do NOT silently delete.
-- -----------------------------------------------------------------------
create or replace function get_orphaned_children()
returns table(id uuid, first_name text, last_name text)
language sql
security definer
set search_path = public
as $$
  select id, first_name, last_name
  from children
  where id not in (select child_id from guardian_children);
$$;

-- Maintenance use only — not exposed to end users.
revoke execute on function get_orphaned_children() from anon;
revoke execute on function get_orphaned_children() from authenticated;
-- Service role retains implicit execute (bypasses REVOKE).
