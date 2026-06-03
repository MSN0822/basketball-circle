-- H-8 安全網: join_event の participants INSERT を unique_violation でガードする。
--
-- 通常運用では events 行への FOR UPDATE ロックで直列化されるため
-- participants_event_slot_active_uq（event_id, slot_number の部分ユニークインデックス）
-- に違反することはまず無いが、万一違反した場合に PL/pgSQL の生例外が
-- app/api/participants/route.ts 経由で status:500 + 生 Postgres メッセージとして
-- ユーザーへ露出するのを防ぐ。違反時は 409 + 安全なメッセージを返す。
--
-- 20260527010000_allow_guest_invites_until_capacity.sql の定義をベースに、
-- INSERT 部分のみ begin/exception ブロックで囲んだ版に置き換える。

create or replace function public.join_event(
  p_event_id uuid,
  p_name text,
  p_user_code text,
  p_member_id uuid default null,
  p_is_guest boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_active_count int;
  v_slot_number int;
  v_existing_status text;
  v_participant participants%rowtype;
begin
  if p_event_id is null or nullif(trim(p_name), '') is null or nullif(trim(p_user_code), '') is null then
    return jsonb_build_object('error', '名前とイベントIDは必須です', 'status', 400);
  end if;

  if p_is_guest and p_member_id is null then
    return jsonb_build_object('error', '招待元の会員情報が必要です', 'status', 400);
  end if;

  select *
    into v_event
    from events
   where id = p_event_id
   for update;

  if not found then
    return jsonb_build_object('error', 'イベントが見つかりません', 'status', 404);
  end if;

  if not p_is_guest and p_member_id is not null then
    select status
      into v_existing_status
      from participants
     where event_id = p_event_id
       and member_id = p_member_id
       and status <> 'cancelled'
     order by created_at asc
     limit 1;

    if found then
      return jsonb_build_object(
        'error', 'すでにこのイベントに登録済みです',
        'status', 409,
        'participant_status', v_existing_status
      );
    end if;
  end if;

  select count(*)
    into v_active_count
    from participants
   where event_id = p_event_id
     and status = 'active';

  if v_event.closes_at is not null and v_event.closes_at <= now() then
    if v_event.status = 'accepting' then
      update events
         set status = 'closed'
       where id = p_event_id;
    end if;

    return jsonb_build_object(
      'error', '締切日時を過ぎたため参加申請を受け付けていません',
      'status', 409
    );
  end if;

  if v_event.status <> 'accepting' then
    return jsonb_build_object(
      'error', '現在は参加申請を受け付けていません',
      'status', 409
    );
  end if;

  if v_active_count >= v_event.max_participants then
    update events
       set status = 'closed'
     where id = p_event_id;

    return jsonb_build_object(
      'error', '定員に達したため締め切りました。参加枠が閾値未満になるまで追加申請できません',
      'status', 409
    );
  end if;

  v_slot_number := v_active_count + 1;

  -- 安全網: スロット番号のユニーク制約違反を捕捉し、安全なメッセージで返す
  begin
    insert into participants (event_id, name, user_code, member_id, status, slot_number)
    values (
      p_event_id,
      trim(p_name),
      p_user_code,
      case when p_is_guest then null else p_member_id end,
      'active',
      v_slot_number
    )
    returning * into v_participant;
  exception
    when unique_violation then
      return jsonb_build_object(
        'error', '席の確保に失敗しました。もう一度お試しください',
        'status', 409
      );
  end;

  if v_slot_number >= v_event.max_participants then
    update events
       set status = 'closed'
     where id = p_event_id;
  end if;

  return jsonb_build_object(
    'participant', row_to_json(v_participant),
    'waitlist', false
  );
end;
$$;

grant execute on function public.join_event(uuid, text, text, uuid, boolean) to anon, authenticated;
