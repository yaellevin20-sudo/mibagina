-- Fix get_my_playgrounds: outer query referenced alias "p" from subquery
-- (error 42P01). Use subquery alias "sub" instead.

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
        'id',   sub.id,
        'name', sub.name
      ) order by sub.last_used desc
    ), '[]'::jsonb)
    from (
      select
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
