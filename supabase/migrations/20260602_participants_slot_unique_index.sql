-- Preflight duplicate check. Run this query manually before applying if you want
-- a read-only preview of rows that would block the unique index:
--
-- select event_id, slot_number, count(*) as duplicate_count, array_agg(id order by created_at, id) as participant_ids
--   from participants
--  where status in ('active', 'waitlist')
--    and slot_number is not null
--  group by event_id, slot_number
-- having count(*) > 1;

do $$
declare
  v_duplicate record;
begin
  select event_id, slot_number, count(*) as duplicate_count
    into v_duplicate
    from participants
   where status in ('active', 'waitlist')
     and slot_number is not null
   group by event_id, slot_number
  having count(*) > 1
   limit 1;

  if found then
    raise exception
      'Cannot create participants_event_slot_active_uq: duplicate active/waitlist slot found (event_id=%, slot_number=%, count=%)',
      v_duplicate.event_id,
      v_duplicate.slot_number,
      v_duplicate.duplicate_count;
  end if;
end;
$$;

create unique index if not exists participants_event_slot_active_uq
  on participants (event_id, slot_number)
  where status in ('active', 'waitlist');
