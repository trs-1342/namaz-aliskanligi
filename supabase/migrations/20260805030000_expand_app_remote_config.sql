-- app_remote_config genişletmesi — uygulamanın uzaktan yönetilen TÜM kaldıraçları.
--
-- ── NEDEN ───────────────────────────────────────────────────────────────────
-- İki istek:
--   1) "Sürenin tarihini veritabanına taşı, dosya bazlı değil." Kesim anı artık
--      TEK OTORİTE olarak buradadır: istemci uzaktan gelen değeri KIRPMADAN
--      uygular. Önceki sürümde istemci, uzatmayı yerleşik tarih + 180 gün ile
--      sınırlıyordu; bu tavan KALDIRILDI. Sonuç: pencere tamamen bu satırdan
--      yönetilir, kötü bir durumda buradan müdahale edilir.
--      (Kod tarafındaki `LOCATION_DIAGNOSTICS_CUTOFF_ISO` yalnız İLK BAŞARILI
--      config çekilene kadar geçerli bir önyükleme değeridir; bir kez çekildikten
--      sonra değer yerel önbellekte kalıcıdır ve dosyadaki tarih bir daha
--      kullanılmaz.)
--   2) "Sadece tarih değil, başka şeyler de eklenebilir olsun." Aşağıdaki
--      sütunların HEPSİ istemcide gerçekten bağlıdır — ölü ayar yoktur. Ayrıca
--      ileride migration yazmadan anahtar eklemek için `extras jsonb` vardır.
--
-- ── SIRA ────────────────────────────────────────────────────────────────────
-- 20260805000000 ve 20260805010000 bundan ÖNCE çalışmış olmalı.

-- ── 1. Tanılama davranışı ───────────────────────────────────────────────────

-- WorkManager görevi (ağ varken uyanan yol) ayrı ayrı kapatılabilsin. Ön plan
-- servisinden bağımsız: pil şikâyeti gelirse yalnız biri kapatılabilir.
alter table public.app_remote_config
  add column if not exists background_task_enabled boolean not null default true;

-- Uygulama AÇIKKEN çalışan periyodik deneme (dakika). Kova tekilleştirmesi
-- yüzünden bu değer kadanstan küçük olmalı; büyükse pencereler kaçırılır.
alter table public.app_remote_config
  add column if not exists foreground_timer_minutes smallint not null default 5;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_foreground_timer_minutes_check;
alter table public.app_remote_config
  add constraint app_remote_config_foreground_timer_minutes_check
    check (foreground_timer_minutes between 1 and 60);

-- Konum doğruluğu. 'low' pili belirgin biçimde korur, 'high' GPS'i zorlar.
-- Ön plan servisi ve beacon'un tek seferlik ölçümü bu değeri kullanır.
alter table public.app_remote_config
  add column if not exists location_accuracy text not null default 'balanced';
alter table public.app_remote_config
  drop constraint if exists app_remote_config_location_accuracy_check;
alter table public.app_remote_config
  add constraint app_remote_config_location_accuracy_check
    check (location_accuracy in ('lowest', 'low', 'balanced', 'high', 'highest'));

-- false: koordinat HİÇ toplanmaz; yalnız "hayatta" kaydı (no_location_reason
-- dolu) gider. Gizlilik şikâyeti veya beklenmedik bir durumda konum toplamayı
-- uygulamayı güncellemeden durdurmanın yolu.
alter table public.app_remote_config
  add column if not exists collect_location boolean not null default true;

-- `collect_location=false` iken istemci yeni bir neden gönderir; tanılama
-- tablosundaki CHECK bunu tanımalı. Bu değer YALNIZCA yukarıdaki sütun var
-- olduğunda (yani bu migration çalıştıktan sonra) üretilebilir, dolayısıyla
-- sıralama güvenlidir.
--
-- DİKKAT: 20260804020000'deki kısıt sütun üzerinde ADSIZ tanımlanmıştı, yani
-- Postgres ona `<tablo>_<sütun>_check` otomatik adını verdi. Yalnız kendi
-- adımızı düşürmek yetmez — eski (dar) kısıt yerinde kalır ve yeni değeri
-- reddetmeye devam ederdi. Aşağıdaki DO bloğu, sütuna dokunan BÜTÜN check
-- kısıtlarını bulup düşürür (tutarlılık kısıtları hariç: onlar korunmalı).
do $drop_reason_checks$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class rel on rel.oid = con.conrelid
      join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'notification_location_diagnostics'
       and con.contype = 'c'
       and pg_catalog.pg_get_constraintdef(con.oid) like '%no_location_reason%'
       -- Konum/neden tutarlılık kısıtlarına DOKUNMA; onlar hâlâ geçerli.
       and con.conname not in (
         'diagnostics_location_or_reason',
         'diagnostics_location_timestamp_pairing'
       )
  loop
    execute format(
      'alter table public.notification_location_diagnostics drop constraint %I',
      constraint_name
    );
  end loop;
end
$drop_reason_checks$;

alter table public.notification_location_diagnostics
  add constraint diagnostics_no_location_reason_valid
    check (
      no_location_reason is null
      or no_location_reason in (
        'permission_denied',
        'services_disabled',
        'position_unavailable',
        'background_no_fix',
        'location_disabled_remotely'
      )
    );

-- Namaz bildirimi tetiklendiğinde konum yakalama yolu. Vakit bildirimlerinin
-- kendisini ETKİLEMEZ; yalnız tanılama kaydını kapatır.
alter table public.app_remote_config
  add column if not exists notification_capture_enabled boolean not null default true;

-- Sunucuya yapılan tek isteğin zaman aşımı (ms). Yavaş şebekelerde yükseltilebilir.
alter table public.app_remote_config
  add column if not exists request_timeout_ms integer not null default 12000;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_request_timeout_ms_check;
alter table public.app_remote_config
  add constraint app_remote_config_request_timeout_ms_check
    check (request_timeout_ms between 2000 and 60000);

-- ── 2. Kill-switch / duraklatma hassasiyeti ─────────────────────────────────
-- Bunlar "kötü bir şey olduğunda müdahale" kaldıraçlarının çekirdeği. Sunucuda
-- bir hata yüzünden cihazlar duraklarsa süre buradan kısaltılır; şema geçişi
-- sırasında geçici hatalar bekleniyorsa eşik buradan yükseltilir.

-- Doğrulanmış kalıcı hata sonrası duraklatma süresi (saat).
alter table public.app_remote_config
  add column if not exists pause_hours smallint not null default 6;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_pause_hours_check;
alter table public.app_remote_config
  add constraint app_remote_config_pause_hours_check
    check (pause_hours between 1 and 168);

-- Kaç ardışık kalıcı sinyal kill-switch'i tetiklesin.
alter table public.app_remote_config
  add column if not exists permanent_signal_threshold smallint not null default 3;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_permanent_signal_threshold_check;
alter table public.app_remote_config
  add constraint app_remote_config_permanent_signal_threshold_check
    check (permanent_signal_threshold between 1 and 20);

-- Sinyaller arasındaki asgari aralık (dakika). Şema-cache tazelenirken görülen
-- kısa PGRST205 patlamalarının tek sinyal sayılmasını sağlar.
alter table public.app_remote_config
  add column if not exists permanent_signal_spacing_minutes smallint not null default 3;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_permanent_signal_spacing_check;
alter table public.app_remote_config
  add constraint app_remote_config_permanent_signal_spacing_check
    check (permanent_signal_spacing_minutes between 1 and 120);

-- ── 3. UZAKTAN DİRİLTME (en önemli müdahale kaldıracı) ──────────────────────
-- Kendini kalıcı kapatmış (kill-switch) veya duraklatmış cihazlar, bu alandaki
-- değer DEĞİŞTİĞİNDE yerel kapatma/duraklatma kayıtlarını siler ve yeniden
-- denemeye başlar. Değer serbest metindir; ÖNEMLİ OLAN DEĞİŞMESİDİR (istemci
-- en son gördüğü değeri saklar). Örnek kullanım:
--   update public.app_remote_config set kill_switch_reset_token = 'reset-2026-08-06';
--
-- Neden gerekli: 2026-08-04'te APK'ya geçersiz bir anahtar gömülünce sahadaki
-- cihazlar 401 alıp kendilerini kapattı; kapatma kaydı cihazda kaldığı için yeni
-- sürüm kurulsa bile ölü kalıyorlardı. Bu alan, o durumu yeni sürüm gerektirmeden
-- panelden çözer.
alter table public.app_remote_config
  add column if not exists kill_switch_reset_token text;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_kill_switch_reset_token_size;
alter table public.app_remote_config
  add constraint app_remote_config_kill_switch_reset_token_size
    check (kill_switch_reset_token is null or octet_length(kill_switch_reset_token) <= 128);

-- ── 4. Ön plan servisi bildirimi (kullanıcıya GÖRÜNEN metin) ────────────────
-- NULL: uygulamanın kendi çevrilmiş metni kullanılır. Dolu: bu metin gösterilir.
-- Kalıcı bildirimin ifadesini uygulama güncellemesi olmadan değiştirmeyi sağlar.
alter table public.app_remote_config
  add column if not exists foreground_service_title text;
alter table public.app_remote_config
  add column if not exists foreground_service_body text;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_foreground_service_text_size;
alter table public.app_remote_config
  add constraint app_remote_config_foreground_service_text_size
    check (
      (foreground_service_title is null or octet_length(foreground_service_title) <= 128)
      and (foreground_service_body is null or octet_length(foreground_service_body) <= 256)
    );

-- ── 5. GENİŞLETİLEBİLİRLİK ──────────────────────────────────────────────────
-- İleride migration yazmadan anahtar eklemek için serbest alan. İstemcide
-- `getRemoteConfigExtra(key, fallback)` ile okunur (sayı/metin/boolean).
-- SINIR: yepyeni bir DAVRANIŞ yine istemci kodu gerektirir; bu alanın kazandırdığı
-- şey, okuyucusu zaten gönderilmiş bir anahtarı migration'sız eklemektir.
alter table public.app_remote_config
  add column if not exists extras jsonb not null default '{}'::jsonb;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_extras_is_object;
alter table public.app_remote_config
  add constraint app_remote_config_extras_is_object
    check (jsonb_typeof(extras) = 'object');

-- Operatör notu: "bu değeri neden değiştirdim". Yalnız panelde okunur.
alter table public.app_remote_config
  add column if not exists config_notes text;
alter table public.app_remote_config
  drop constraint if exists app_remote_config_config_notes_size;
alter table public.app_remote_config
  add constraint app_remote_config_config_notes_size
    check (config_notes is null or octet_length(config_notes) <= 1000);

-- ── 6. Kesim anı üst sınırı YOK ─────────────────────────────────────────────
-- `diagnostics_cutoff` üzerinde bilerek hiçbir üst sınır kısıtı tanımlanmamıştır:
-- pencerenin tek otoritesi bu alandır. Aynı şekilde istemcideki 180 günlük tavan
-- da kaldırıldı. Bunun anlamı: buraya yazılan tarih ne ise cihazlar onu uygular.
-- Sorumluluk operatördedir — testçilere duyurulan süreyle tutarlı tutun.

notify pgrst, 'reload schema';

-- ── DOĞRULAMA ───────────────────────────────────────────────────────────────
--   select * from public.app_remote_config where id = 1;
--   -- anon hâlâ yalnız okuyabilmeli:
--   curl -s "$URL/rest/v1/app_remote_config?select=*&id=eq.1" -H "apikey: $ANON"
--
-- ── SIK KULLANILAN MÜDAHALELER ──────────────────────────────────────────────
--   -- testi uzat:
--   update public.app_remote_config set diagnostics_cutoff = '2026-09-30 00:00:00+03' where id = 1;
--   -- her şeyi durdur:
--   update public.app_remote_config set diagnostics_enabled = false where id = 1;
--   -- pil şikâyeti: kalıcı bildirimi kaldır, WorkManager'la devam et:
--   update public.app_remote_config set foreground_service_enabled = false where id = 1;
--   -- kendini kapatmış cihazları dirilt:
--   update public.app_remote_config set kill_switch_reset_token = 'reset-' || now()::date where id = 1;
--   -- konum toplamayı durdur, hayatta sinyali sürsün:
--   update public.app_remote_config set collect_location = false where id = 1;
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   alter table public.app_remote_config
--     drop column if exists background_task_enabled,
--     drop column if exists foreground_timer_minutes,
--     drop column if exists location_accuracy,
--     drop column if exists collect_location,
--     drop column if exists notification_capture_enabled,
--     drop column if exists request_timeout_ms,
--     drop column if exists pause_hours,
--     drop column if exists permanent_signal_threshold,
--     drop column if exists permanent_signal_spacing_minutes,
--     drop column if exists kill_switch_reset_token,
--     drop column if exists foreground_service_title,
--     drop column if exists foreground_service_body,
--     drop column if exists extras,
--     drop column if exists config_notes;
--   notify pgrst, 'reload schema';
--   -- İstemci eksik alanları varsayılana düşürür; kırılmaz.
