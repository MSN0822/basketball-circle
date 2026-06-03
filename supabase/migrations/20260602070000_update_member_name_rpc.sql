-- Update a member name and active participant snapshots atomically.

create or replace function public.update_member_name(
  p_member_id uuid,
  p_auth_user_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member members%rowtype;
begin
  if p_member_id is null or p_auth_user_id is null or nullif(trim(p_name), '') is null then
    return jsonb_build_object('error', 'member_id and name are required', 'status', 400);
  end if;

  update members
     set name = trim(p_name)
   where id = p_member_id
     and auth_user_id = p_auth_user_id
   returning * into v_member;

  if not found then
    return jsonb_build_object('error', 'member not found', 'status', 404);
  end if;

  update participants
     set name = trim(p_name)
   where member_id = p_member_id
     and status in ('active', 'waitlist');

  return jsonb_build_object('member', row_to_json(v_member));
end;
$$;

revoke all on function public.update_member_name(uuid, uuid, text) from public;
grant execute on function public.update_member_name(uuid, uuid, text) to service_role;
