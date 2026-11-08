-- Tanılama penceresini ve sunucu limitlerini app_remote_config'e bağlar.
--
-- ── PROBLEM ─────────────────────────────────────────────────────────────────
-- Kesim tarihi '2026-08-11 00:00:00+03' bugün DÖRT yerde sabit:
--   1) tablo CHECK'i  `diagnostics_cutoff`        (20260804000000:55)
--   2) RLS policy     "temporary anonymous ..."   (20260804000000:75-82)
--   3) pg_cron job    'namaz-diagnostics-expiry'  (20260804000000:136-150)
--   4) istemci        LOCATION_DIAGNOSTICS_CUTOFF_ISO
-- (3) tabloyu DÜŞÜRÜYOR. Yani testi uzatmak için hem üç sunucu yerini elle
-- değiştirmek hem de yeni bir APK dağıtmak gerekiyordu; tablo bir kez düştükten
-- sonra da geri gelmiyordu (04 Ağustos'ta tam olarak bu yaşandı).
--
-- ── ÇÖZÜM ───────────────────────────────────────────────────────────────────
-- Üç sunucu yeri de app_remote_config.diagnostics_cutoff'u okur. Bundan sonra
-- testi uzatmak = panelde TEK bir alanı ileri almak. İstemci de aynı değeri
-- REST üzerinden çeker (src/services/remoteConfig.ts), yani (4) de düşer.
--
-- ── SIRA ────────────────────────────────────────────────────────────────────
-- 20260805000000 (app_remote_config) BUNDAN ÖNCE çalışmış olmalı.
-- Bu betik tek transaction içinde çalışır: policy düşüp yenisi kurulmadan
-- yarıda kalırsa sahadaki cihazlar 403 alır ve (üç aralıklı sinyalden sonra)
-- 6 saat duraklar. `supabase db push` her dosyayı tek transaction'da çalıştırır;
-- elle çalıştırıyorsanız `begin; ... commit;` içine alın.

-- ── 1. Tablo CHECK'ini kaldır ───────────────────────────────────────────────
-- CHECK kısıtı alt sorgu içeremez (immutable olmak zorunda), dolayısıyla config'e
-- bağlanamaz. Kesim sınırını bundan sonra RLS policy uygular — anon'un tabloya
-- tek erişimi INSERT policy'si olduğu için koruma eşdeğerdir.
alter table public.notification_location_diagnostics
  drop constraint if exists diagnostics_cutoff;

-- ── 2. Config okuyucuları ───────────────────────────────────────────────────
-- `security definer`: policy ve cron gövdesi anon'un grant'lerine bağlı kalmasın.
-- `coalesce(...)`: config satırı silinirse ESKİ SABİT TARİHE düşer. Yani tablo
-- kazara boşalırsa sistem "sınırsız toplama" moduna DEĞİL, eski kapanış tarihine
-- düşer — fail-safe yön güvenli taraftadır.
create or replace function public.diagnostics_cutoff()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select c.diagnostics_cutoff from public.app_remote_config c where c.id = 1),
    timestamptz '2026-08-11 00:00:00+03'
  );
$function$;

-- Ana şalter. Config satırı yoksa true (eski davranış).
create or replace function public.diagnostics_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select c.diagnostics_enabled from public.app_remote_config c where c.id = 1),
    true
  );
$function$;

revoke all on function public.diagnostics_cutoff() from public;
revoke all on function public.diagnostics_enabled() from public;
grant execute on function public.diagnostics_cutoff() to anon;
grant execute on function public.diagnostics_enabled() to anon;

-- ── 3. RLS policy'yi config'e bağla ─────────────────────────────────────────
drop policy if exists "temporary anonymous diagnostics insert"
  on public.notification_location_diagnostics;

create policy "temporary anonymous diagnostics insert"
on public.notification_location_diagnostics
for insert
to anon
with check (
  public.diagnostics_enabled()
  and now() < public.diagnostics_cutoff()
  and created_at < public.diagnostics_cutoff()
);

-- ── 4. Hız/kapasite limitlerini config'e bağla ──────────────────────────────
-- Eski sabitler: 2000 satır toplam, kurulum başına saatte 16. 15 dakikalık kadans
-- kurulum başına saatte 4 kayıt üretir; buna kuyruk boşaltmaları eklenince 16'lık
-- sınır kolayca aşılıyor ve P0001 → HTTP 400 → istemcide duraklama oluşuyordu.
-- Değerler artık panelden ayarlanabilir; config yoksa eski sabitlere düşülür.
create or replace function public.enforce_notification_diagnostics_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cap_total integer;
  cap_hourly integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(1342, 20260803);

  select c.max_rows_total, c.max_rows_per_install_hourly
    into cap_total, cap_hourly
    from public.app_remote_config c
   where c.id = 1;

  cap_total := coalesce(cap_total, 2000);
  cap_hourly := coalesce(cap_hourly, 16);

  if (select count(*) from public.notification_location_diagnostics) >= cap_total then
    raise exception 'diagnostics test capacity reached' using errcode = 'P0001';
  end if;

  if (
    select count(*)
      from public.notification_location_diagnostics
     where installation_id = new.installation_id
       and created_at >= pg_catalog.now() - interval '1 hour'
  ) >= cap_hourly then
    raise exception 'diagnostics installation rate limit reached' using errcode = 'P0001';
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_notification_diagnostics_limits() from public, anon, authenticated;

-- Trigger tanımı değişmiyor (fonksiyon gövdesi değişti), yine de idempotent kur.
drop trigger if exists enforce_notification_diagnostics_limits
  on public.notification_location_diagnostics;
create trigger enforce_notification_diagnostics_limits
before insert on public.notification_location_diagnostics
for each row execute function public.enforce_notification_diagnostics_limits();

-- ── 5. Temizlik job'ını "tek seferlik infaz"dan "günlük kontrol"e çevir ─────
-- Eski job: '5 21 10 8 *' → 10 Ağustos 21:05 UTC'de bir kez çalışır ve tabloyu
-- düşürür. Cutoff ileri alınsa bile job o tarihte tetiklenip veriyi silerdi.
-- Yeni job: her gün çalışır, ama SADECE config'teki cutoff geçtiyse siler.
-- Kendini UNSCHEDULE ETMEZ: tablo yeniden oluşturulup pencere tekrar açılırsa
-- temizlik mekanizmasının hâlâ yerinde olması gerekir.
create extension if not exists pg_cron with schema pg_catalog;

do $schedule$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'namaz-diagnostics-expiry';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$schedule$;

-- Her gün 21:05 UTC = 00:05 İstanbul.
select cron.schedule(
  'namaz-diagnostics-expiry',
  '5 21 * * *',
  $job$
    do $expiry$
    begin
      if now() >= public.diagnostics_cutoff() then
        drop table if exists public.notification_location_diagnostics;
        drop function if exists public.enforce_notification_diagnostics_limits();
      end if;
    end
    $expiry$;
  $job$
);

notify pgrst, 'reload schema';

-- ── DOĞRULAMA ───────────────────────────────────────────────────────────────
--   select public.diagnostics_cutoff(), public.diagnostics_enabled();
--   select jobname, schedule from cron.job where jobname = 'namaz-diagnostics-expiry';
--   -- anon insert 201 dönmeli; sonra:
--   update public.app_remote_config set diagnostics_enabled = false where id = 1;
--   -- aynı insert 403 dönmeli (RLS), sonra geri al:
--   update public.app_remote_config set diagnostics_enabled = true where id = 1;
--   -- pencereyi uzatmak (build gerekmez):
--   update public.app_remote_config
--      set diagnostics_cutoff = timestamptz '2026-09-15 00:00:00+03' where id = 1;
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   drop policy if exists "temporary anonymous diagnostics insert"
--     on public.notification_location_diagnostics;
--   create policy "temporary anonymous diagnostics insert"
--     on public.notification_location_diagnostics for insert to anon
--     with check (now() < timestamptz '2026-08-11 00:00:00+03'
--                 and created_at < timestamptz '2026-08-11 00:00:00+03');
--   alter table public.notification_location_diagnostics
--     add constraint diagnostics_cutoff
--     check (created_at < timestamptz '2026-08-11 00:00:00+03');
--   -- DİKKAT: yukarıdaki CHECK, cutoff'u geçmiş satırlar varsa BAŞARISIZ olur.
--   drop function if exists public.diagnostics_cutoff();
--   drop function if exists public.diagnostics_enabled();
--   notify pgrst, 'reload schema';
