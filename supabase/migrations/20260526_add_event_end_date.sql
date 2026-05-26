alter table events
  add column if not exists event_end_date timestamptz;
