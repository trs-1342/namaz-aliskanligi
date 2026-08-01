create extension if not exists pg_cron with schema pg_catalog;

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

-- pg_cron UTC kullanır: 3 Ağustos 2026 21:05 UTC = 4 Ağustos 00:05 İstanbul.
select cron.schedule(
  'namaz-diagnostics-expiry',
  '5 21 3 8 *',
  $job$
    do $expiry$
    begin
      if now() >= timestamptz '2026-08-04 00:00:00+03' then
        drop table if exists public.notification_location_diagnostics;
        perform cron.unschedule('namaz-diagnostics-expiry');
      end if;
    end
    $expiry$;
  $job$
);
