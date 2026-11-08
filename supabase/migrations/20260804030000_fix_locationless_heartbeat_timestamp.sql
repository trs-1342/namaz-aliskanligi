-- DÜZELTME: konumsuz "hayatta" (heartbeat) kaydı sunucuda hâlâ REDDEDİLİYOR.
--
-- ── KANIT ZİNCİRİ ───────────────────────────────────────────────────────────
-- 1) İstemci gerçekten NULL gönderiyor:
--      src/services/locationDiagnostics.ts:447-452  (bildirim yakalama)
--      src/services/locationDiagnostics.ts:574-579  (30 dk beacon)
--    Her ikisinde de:
--      latitude:  position ? … : null
--      longitude: position ? … : null
--      location_timestamp: position ? new Date(position.timestamp).toISOString() : null
--      no_location_reason: <position varsa null, yoksa geçerli neden>
--    (neden ataması: aynı dosya, satır 424 ve 549 — `position ? null : resolveNoLocationReason(...)`)
--
-- 2) Mevcut şema bunu reddediyor:
--      20260804000000_recreate_diagnostics_extended_to_0811.sql:52
--        `location_timestamp timestamptz not null`
--      20260804020000_allow_locationless_heartbeat.sql:10-11
--        yalnız `latitude` ve `longitude` için `drop not null` yapıldı;
--        `location_timestamp` NOT NULL olarak KALDI.
--    → konumsuz insert 23502 (not-null violation) → PostgREST HTTP 400.
--
-- 3) 400'ün istemcideki sonucu:
--      locationDiagnosticsPolicy.ts → isPermanentDiagnosticsFailure(400) = true
--      locationDiagnostics.ts       → recordPermanentSignal(): birbirinden >= 3 dk
--      ayrı 3 sinyalde permanentlyDisable() → KILL-SWITCH. Arka plan görevi de
--      kendini iptal eder. Yani konum izni vermeyen testçide tanılama kalıcı ölür —
--      tam olarak 20260804020000'in çözmeye çalıştığı "sessiz körlük".
--
-- ── ÇÖZÜM ───────────────────────────────────────────────────────────────────
-- location_timestamp'i NULL'lanabilir yap ve veriyi TAM OLARAK İKİ biçime kilitle.

-- ÖN KONTROL — bu migration'ı çalıştırmadan ÖNCE çalıştırın. 0 dönmezse
-- migration `add constraint` adımında hata verir (mevcut satır kısıtı çiğniyor):
--
--   select count(*) as ihlal
--     from public.notification_location_diagnostics
--    where not (
--            (latitude is not null and longitude is not null
--             and location_timestamp is not null and no_location_reason is null)
--         or (latitude is null and longitude is null
--             and location_timestamp is null and no_location_reason is not null)
--          );
--
-- (Bu oturumda uzak veritabanına bağlanılmadı; kısıtın mevcut satırlarda
--  geçeceği İSTEMCİ DAVRANIŞINDAN çıkarıldı — istemci hiçbir zaman "koordinat +
--  neden" birlikte göndermez — fakat elle eklenmiş test satırları için ön
--  kontrol yine de zorunludur.)

alter table public.notification_location_diagnostics
  alter column location_timestamp drop not null;

-- Tam olarak iki geçerli biçim; başka hiçbir kombinasyona izin yok:
--   (a) latitude + longitude + location_timestamp DOLU  ve  no_location_reason NULL
--   (b) latitude + longitude + location_timestamp NULL  ve  no_location_reason DOLU
-- (b) şıkkındaki değerin geçerliliğini 20260804020000'deki enum CHECK'i sağlar.
alter table public.notification_location_diagnostics
  drop constraint if exists diagnostics_location_timestamp_pairing;

alter table public.notification_location_diagnostics
  add constraint diagnostics_location_timestamp_pairing
    check (
      (
        latitude is not null
        and longitude is not null
        and location_timestamp is not null
        and no_location_reason is null
      )
      or (
        latitude is null
        and longitude is null
        and location_timestamp is null
        and no_location_reason is not null
      )
    );

-- Not: 20260804020000'deki `diagnostics_location_or_reason` kısıtı yerinde kalır;
-- yukarıdaki kısıt onu kapsar (daha dar), çakışma yoktur.
--
-- Not: 20260804010000'deki generated sütunlar (location / location_text / maps_url)
-- koordinat NULL olunca kendiliğinden NULL üretir; ek işlem gerekmez.

-- PostgREST şema önbelleğini tazele (yoksa kısa süre PGRST204/PGRST205 görülebilir).
notify pgrst, 'reload schema';

-- ── ROLLBACK (elle; veri kaybı/başarısızlık riski AŞAĞIDA) ──────────────────
--   alter table public.notification_location_diagnostics
--     drop constraint if exists diagnostics_location_timestamp_pairing;
--
--   -- DİKKAT: aşağıdaki SET NOT NULL, migration sonrasında en az bir konumsuz
--   -- heartbeat satırı düştüyse "column contains null values" hatasıyla
--   -- BAŞARISIZ OLUR. Şemayı gerçekten eski hâline döndürmek isteniyorsa o
--   -- satırların ÖNCE SİLİNMESİ gerekir — bu, veri KAYBIDIR ve tam olarak
--   -- ölçülmek istenen "konum vermeyen testçi" kayıtlarını yok eder:
--   --   delete from public.notification_location_diagnostics
--   --    where location_timestamp is null;   -- ← veri kaybı
--   alter table public.notification_location_diagnostics
--     alter column location_timestamp set not null;
--
--   notify pgrst, 'reload schema';
--
-- Pratik öneri: geri alma gerekiyorsa yalnız CHECK kısıtını düşürmek yeterlidir;
-- sütunu tekrar NOT NULL yapmak kill-switch hatasını geri getirir.
