alter table public.notification_location_diagnostics
  drop column if exists device_manufacturer,
  drop column if exists device_type,
  drop column if exists device_locale,
  drop column if exists device_timezone,
  drop column if exists altitude_accuracy_m,
  drop column if exists heading_deg,
  drop column if exists speed_mps;

create or replace function public.enforce_notification_diagnostics_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Küçük kapalı test için hatalı istemcinin veya anahtar kötüye kullanımının
  -- sınırsız kayıt/maliyet üretmesini engelle. Global lock sayımları atomik yapar.
  perform pg_catalog.pg_advisory_xact_lock(1342, 20260803);

  if (select count(*) from public.notification_location_diagnostics) >= 2000 then
    raise exception 'diagnostics test capacity reached' using errcode = 'P0001';
  end if;

  if (
    select count(*)
      from public.notification_location_diagnostics
     where installation_id = new.installation_id
       and created_at >= pg_catalog.now() - interval '1 hour'
  ) >= 16 then
    raise exception 'diagnostics installation rate limit reached' using errcode = 'P0001';
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_notification_diagnostics_limits() from public, anon, authenticated;

drop trigger if exists enforce_notification_diagnostics_limits
  on public.notification_location_diagnostics;
create trigger enforce_notification_diagnostics_limits
before insert on public.notification_location_diagnostics
for each row execute function public.enforce_notification_diagnostics_limits();

-- Önceki migration başarıyla çalışmış olsa bile job kaydını ayrıca doğrula;
-- yoksa deploy başarılı görünmesin.
do $verification$
begin
  if not exists (
    select 1
      from cron.job
     where jobname = 'namaz-diagnostics-expiry'
       and schedule = '5 21 3 8 *'
       and active
  ) then
    raise exception 'namaz-diagnostics-expiry cron job is missing or inactive';
  end if;
end
$verification$;
