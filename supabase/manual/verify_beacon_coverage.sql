-- Kapsama raporu — "uygulama arka planda gerçekten gönderiyor mu?"
--
-- Bu dosya bilerek `migrations/` DIŞINDADIR: şemayı değiştirmez, `supabase db push`
-- tarafından çalıştırılmaz. Panelin SQL editöründe elle çalıştırılacak sorgular.
--
-- Kadans config'ten (app_remote_config.beacon_interval_minutes) okunur; panelde
-- aralığı değiştirdiğinizde rapor kendiliğinden yeni aralığa göre hesaplanır.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ÖZET — hangi cihaz, hangi yollardan, ne kadar kapsamayla yazdı?
--    background_rows = 0 olan bir kurulum, arka planın ÇALIŞMADIĞI anlamına gelir.
-- ════════════════════════════════════════════════════════════════════════════
with cfg as (
  select coalesce(
           (select beacon_interval_minutes from public.app_remote_config where id = 1), 15
         )::int as interval_min
),
win as (
  -- Son 24 saat. Başka bir pencere için '24 hours' değerini değiştirin.
  select now() - interval '24 hours' as from_ts, now() as to_ts from cfg
),
rows_in_window as (
  select d.*,
         to_timestamp(
           floor(extract(epoch from d.created_at) / (c.interval_min * 60))
           * (c.interval_min * 60)
         ) as bucket
    from public.notification_location_diagnostics d
   cross join cfg c
   cross join win w
   where d.created_at >= w.from_ts and d.created_at < w.to_ts
),
per_install as (
  select installation_id,
         min(tester_code)                as tester_code,
         min(device_model)               as device_model,
         min(app_version)                as app_version,
         count(*)                        as rows_total,
         count(distinct bucket)          as buckets_covered,
         count(*) filter (where beacon_source in ('location_service','workmanager'))  as background_rows,
         count(*) filter (where beacon_source = 'location_service')                   as fgs_rows,
         count(*) filter (where beacon_source = 'workmanager')                        as workmanager_rows,
         count(*) filter (where beacon_source is null)                                as legacy_rows,
         count(*) filter (where latitude is null)                                     as locationless_rows,
         max(created_at)                 as last_seen
    from rows_in_window
   group by installation_id
)
select p.tester_code,
       p.device_model,
       p.app_version,
       p.rows_total,
       p.buckets_covered,
       -- Beklenen kova sayısı: 24 saat / aralık.
       (24 * 60 / c.interval_min)                                        as buckets_expected,
       round(100.0 * p.buckets_covered / (24 * 60 / c.interval_min), 1)  as coverage_pct,
       p.background_rows,
       p.fgs_rows,
       p.workmanager_rows,
       p.legacy_rows,
       p.locationless_rows,
       p.last_seen
  from per_install p
 cross join cfg c
 order by coverage_pct asc, p.last_seen desc;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) EKSİK PENCERELER — hangi kovada kayıt DÜŞTÜ?
--    Cihazın ilk görüldüğü andan itibaren beklenen bütün kovaları üretip
--    gerçekleşenlerle karşılaştırır. Ardışık boşluklar Doze/OEM kısıtına,
--    dağınık tekil boşluklar geçici ağ hatasına işaret eder.
-- ════════════════════════════════════════════════════════════════════════════
with cfg as (
  select coalesce(
           (select beacon_interval_minutes from public.app_remote_config where id = 1), 15
         )::int as interval_min
),
win as (
  select now() - interval '24 hours' as from_ts, now() as to_ts from cfg
),
rows_in_window as (
  select d.installation_id,
         d.tester_code,
         d.beacon_source,
         to_timestamp(
           floor(extract(epoch from d.created_at) / (c.interval_min * 60))
           * (c.interval_min * 60)
         ) as bucket
    from public.notification_location_diagnostics d
   cross join cfg c
   cross join win w
   where d.created_at >= w.from_ts and d.created_at < w.to_ts
),
installs as (
  select installation_id, min(tester_code) as tester_code, min(bucket) as first_bucket
    from rows_in_window group by installation_id
),
expected as (
  select i.installation_id,
         i.tester_code,
         generate_series(
           i.first_bucket,
           to_timestamp(floor(extract(epoch from w.to_ts) / (c.interval_min * 60)) * (c.interval_min * 60)),
           make_interval(mins => c.interval_min)
         ) as bucket
    from installs i cross join cfg c cross join win w
)
select e.tester_code,
       e.bucket             as missing_bucket,
       -- Boşluğun hemen öncesindeki kaynak: hangi yol düştü?
       (select r2.beacon_source
          from rows_in_window r2
         where r2.installation_id = e.installation_id and r2.bucket < e.bucket
         order by r2.bucket desc limit 1) as previous_source
  from expected e
  left join rows_in_window r
    on r.installation_id = e.installation_id and r.bucket = e.bucket
 where r.bucket is null
 order by e.tester_code, e.bucket;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) SON KAYITLAR — hızlı göz kontrolü
-- ════════════════════════════════════════════════════════════════════════════
select created_at,
       tester_code,
       beacon_source,
       capture_mode,
       no_location_reason,
       location_text,
       accuracy_m,
       app_version
  from public.notification_location_diagnostics
 order by created_at desc
 limit 50;
