create or replace function public.register_member(
  p_name text,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest_number int;
  v_member_number text;
  v_member members%rowtype;
begin
  if nullif(trim(p_name), '') is null or p_auth_user_id is null then
    return jsonb_build_object('error', 'name と auth_user_id は必須です', 'status', 400);
  end if;

  perform pg_advisory_xact_lock(hashtext('register_member_number'));

  select max(member_number::int)
    into v_latest_number
    from members
   where member_number ~ '^[0-9]+$';

  v_member_number := lpad(((coalesce(v_latest_number, 0) + 1)::text), 3, '0');

  insert into members (name, member_number, auth_user_id)
  values (trim(p_name), v_member_number, p_auth_user_id)
  returning * into v_member;

  return jsonb_build_object('member', row_to_json(v_member));
exception
  when unique_violation then
    return jsonb_build_object('error', '会員情報はすでに登録されています', 'status', 409);
end;
$$;

grant execute on function public.register_member(text, uuid) to anon, authenticated;
