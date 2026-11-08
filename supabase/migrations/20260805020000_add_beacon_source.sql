-- beacon_source — kaydı HANGİ tetikleyicinin ürettiğini saklar.
--
-- NEDEN: Asıl sorulan soru "uygulama arka planda gerçekten gönderiyor mu?".
-- Bugün veriden bunu cevaplamak mümkün değil: `capture_mode` CHECK'i yalnız iki
-- değer kabul ediyor ('foreground_received' / 'android_alarm_cold_start') ve
-- istemci bütün arka plan yollarını ikincisine sıkıştırıyor. Yani WorkManager
-- görevi mi, ön plan servisi mi, yoksa soğuk açılıştaki bildirim yakalaması mı
-- yazdı — ayırt edilemiyor. Kaynak ayrı bir sütunda tutulunca "arka plan çalıştı"
-- iddiası doğrudan veriyle kanıtlanır:
--   beacon_source = 'location_service'  → uygulama kapalıyken ön plan servisi yazdı
--   beacon_source = 'workmanager'       → WorkManager görevi yazdı
--
-- `capture_mode` OLDUĞU GİBİ KALIR. CHECK'ini genişletmek eski istemcilerle
-- uyumu bozma riski taşır ve gerek yok; iki sütun birlikte daha çok bilgi verir.
--
-- NULLABLE: bu sütunu göndermeyen eski build'ler (sahada kurulu APK'lar) yazmaya
-- devam etsin. İstemci ayrıca PGRST204 alırsa alanı düşürüp bir kez daha dener,
-- yani bu migration çalışmadan ÖNCE de yeni istemci kırılmaz.

alter table public.notification_location_diagnostics
  add column if not exists beacon_source text;

alter table public.notification_location_diagnostics
  drop constraint if exists diagnostics_beacon_source_valid;

alter table public.notification_location_diagnostics
  add constraint diagnostics_beacon_source_valid
    check (
      beacon_source is null
      or beacon_source in (
        -- arka plan (asıl kanıt)
        'location_service',   -- expo-location ön plan servisi; uygulama kapalı, ağ gerekmez
        'workmanager',        -- expo-background-task; yalnız ağ varken uyanır
        -- ön plan / olay tetiklemeli
        'foreground_timer',   -- uygulama açıkken periyodik zamanlayıcı
        'app_active',         -- uygulama öne geldi
        'net_reconnect',      -- bağlantı geri geldi
        'notification',       -- namaz bildirimi alındı / dokunuldu
        'gps_sync',           -- vakit hesabı için taze konum alındı
        'manual',             -- Ayarlar'daki "şimdi dene"
        'outbox_flush'        -- çevrimdışı kuyruktan geç gönderim
      )
    );

comment on column public.notification_location_diagnostics.beacon_source is
  'Which client trigger produced this row. location_service/workmanager prove background delivery.';

notify pgrst, 'reload schema';

-- ── DOĞRULAMA ───────────────────────────────────────────────────────────────
--   select beacon_source, count(*)
--     from public.notification_location_diagnostics
--    group by 1 order by 2 desc;
--   -- Kapsama raporu: supabase/manual/verify_beacon_coverage.sql
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   alter table public.notification_location_diagnostics
--     drop constraint if exists diagnostics_beacon_source_valid;
--   alter table public.notification_location_diagnostics
--     drop column if exists beacon_source;
--   notify pgrst, 'reload schema';
