-- Fix cancel_participant lock ordering.
-- The previous version locked the target participant before the event row, which
-- could deadlock when two participants from the same event were cancelled at
-- the same time. Lock the event row first so same-event cancellation work is
-- serialized before participant row locks are acquired.

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
             max_participants = v_event.threshold,
             closes_at = case
               when v_event.closes_at is not null and v_event.closes_at <= now() then null
               else v_event.closes_at
             end
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
grant execute on function public.cancel_participant(uuid) to service_role;
