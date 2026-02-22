-- =============================================================================
-- Phase 3: create_guardian RPC
-- Creates a guardians row for the authenticated user on first login.
-- Gets email from auth.users server-side — never from the client.
-- ON CONFLICT DO NOTHING for idempotency.
-- =============================================================================

create or replace function create_guardian(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if trim(p_name) = '' then raise exception 'Name cannot be empty'; end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then raise exception 'User email not found'; end if;

  insert into guardians (id, name, email)
  values (auth.uid(), trim(p_name), v_email)
  on conflict (id) do nothing;
end;
$$;
revoke execute on function create_guardian(text) from anon;
grant  execute on function create_guardian(text) to authenticated;
