create or replace function public.publish_due_draft_events()
returns void
language sql
security definer
set search_path = public
as $$
  update public.events
     set status = 'accepting',
         is_manual_close = false
   where status = 'draft'
     and publishes_at is not null
     and publishes_at <= now();
$$;

create extension if not exists pg_cron;

do $$
begin
  if exists (
    select 1
      from cron.job
     where jobname = 'publish_due_draft_events'
  ) then
    perform cron.unschedule('publish_due_draft_events');
  end if;

  perform cron.schedule(
    'publish_due_draft_events',
    '* * * * *',
    'select public.publish_due_draft_events();'
  );
end $$;
