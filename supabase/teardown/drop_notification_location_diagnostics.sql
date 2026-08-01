-- Otomatik cron işine ek olarak elle erken kapatma/temizleme seçeneği.
do $teardown$
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
$teardown$;

drop table if exists public.notification_location_diagnostics;
drop function if exists public.enforce_notification_diagnostics_limits();
