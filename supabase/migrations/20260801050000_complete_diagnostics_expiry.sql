do $migration$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'namaz-diagnostics-expiry';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$migration$;

select cron.schedule(
  'namaz-diagnostics-expiry',
  '5 21 3 8 *',
  $job$
    do $expiry$
    begin
      if now() >= timestamptz '2026-08-04 00:00:00+03' then
        drop table if exists public.notification_location_diagnostics;
        drop function if exists public.enforce_notification_diagnostics_limits();
        perform cron.unschedule('namaz-diagnostics-expiry');
      end if;
    end
    $expiry$;
  $job$
);

do $verification$
begin
  if not exists (
    select 1
      from cron.job
     where jobname = 'namaz-diagnostics-expiry'
       and schedule = '5 21 3 8 *'
       and active
       and command like '%drop function if exists public.enforce_notification_diagnostics_limits()%'
  ) then
    raise exception 'complete diagnostics expiry job is missing or inactive';
  end if;
end
$verification$;
