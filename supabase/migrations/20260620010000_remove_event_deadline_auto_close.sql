-- Remove date-based automatic event closing.
-- Capacity-based closing and threshold-based reopening remain unchanged.

update public.events
   set closes_at = null
 where closes_at is not null;

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
    return jsonb_build_object('error', '招待者の会員情報が必要です', 'status', 400);
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

revoke all on function public.join_event(uuid, text, text, uuid, boolean) from public;
revoke execute on function public.join_event(uuid, text, text, uuid, boolean) from anon, authenticated;
grant execute on function public.join_event(uuid, text, text, uuid, boolean) to service_role;

create or replace function public.cancel_participant(
  p_participant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_participant participants%rowtype;
  v_cancelled participants%rowtype;
  v_event events%rowtype;
  v_was_active boolean;
  v_active_count int;
  v_active_before_cancel int;
  v_reopened boolean := false;
begin
  if p_participant_id is null then
    return jsonb_build_object('error', 'participant_id は必須です', 'status', 400);
  end if;

  select event_id
    into v_event_id
    from participants
   where id = p_participant_id;

  if not found then
    return jsonb_build_object('error', '参加者が見つかりません', 'status', 404);
  end if;

  select *
    into v_event
    from events
   where id = v_event_id
   for update;

  if not found then
    return jsonb_build_object('error', 'イベントが見つかりません', 'status', 404);
  end if;

  select *
    into v_participant
    from participants
   where id = p_participant_id
   for update;

  if not found then
    return jsonb_build_object('error', '参加者が見つかりません', 'status', 404);
  end if;

  if v_participant.status not in ('active', 'waitlist') then
    return jsonb_build_object('error', 'すでにキャンセル済みです', 'status', 400);
  end if;

  perform id
    from participants
   where event_id = v_event.id
     and status in ('active', 'waitlist')
   order by id
   for update;

  v_was_active := v_participant.status = 'active';

  update participants
     set status = 'cancelled'
   where id = p_participant_id
   returning * into v_cancelled;

  with ranked as (
    select
      id,
      row_number() over (
        order by
          case status when 'active' then 0 else 1 end,
          slot_number nulls last,
          created_at,
          id
      ) as next_slot_number
    from participants
    where event_id = v_event.id
      and status in ('active', 'waitlist')
  )
  update participants p
     set slot_number = -ranked.next_slot_number
    from ranked
   where p.id = ranked.id;

  with ranked as (
    select
      id,
      row_number() over (
        order by
          case status when 'active' then 0 else 1 end,
          abs(slot_number) nulls last,
          created_at,
          id
      ) as next_slot_number
    from participants
    where event_id = v_event.id
      and status in ('active', 'waitlist')
  )
  update participants p
     set slot_number = ranked.next_slot_number
    from ranked
   where p.id = ranked.id;

  select count(*)
    into v_active_count
    from participants
   where event_id = v_event.id
     and status = 'active';

  if v_was_active and v_event.status <> 'draft' and not v_event.is_manual_close then
    v_active_before_cancel := v_active_count + 1;

    if v_active_count < v_event.max_participants
       and v_event.status = 'closed'
       and v_active_count < v_event.threshold
       and v_active_before_cancel >= v_event.threshold then
      update events
         set status = 'accepting',
             max_participants = v_event.threshold
       where id = v_event.id;

      v_reopened := true;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'participant', row_to_json(v_cancelled),
    'active_count', v_active_count,
    'reopened', v_reopened
  );
end;
$$;

revoke all on function public.cancel_participant(uuid) from public;
revoke execute on function public.cancel_participant(uuid) from anon, authenticated;
grant execute on function public.cancel_participant(uuid) to service_role;
