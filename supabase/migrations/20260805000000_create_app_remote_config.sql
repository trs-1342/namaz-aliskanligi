-- app_remote_config — uygulamanın uzaktan yönetilen ayarları.
--
-- NEDEN: Bugüne kadar her ayar değişikliği (kadans, açma/kapama, test penceresi)
-- yeni bir APK derleyip test cihazlarına dağıtmayı gerektiriyordu. Kapalı test
-- sırasında bu sürdürülemez. Bu tablo, uygulamanın davranışını belirleyen
-- değerleri Supabase panelinden düzenlenebilir hale getirir; cihazlar değeri
-- periyodik olarak çeker ve uyar. Build gerekmez.
--
-- BİÇİM TERCİHİ: key/value değil, İSİMLİ SÜTUNLU TEK SATIR. Panelin tablo
-- düzenleyicisinde tek satırı açıp alanları doğrudan değiştirmek, key/value
-- satırları arasında dolaşmaktan çok daha az hata üretir; ayrıca her alan kendi
-- tipini ve CHECK kısıtını taşır (panele saçma bir değer yazılamaz).
--
-- ÖMÜR: Bu tablonun son kullanma tarihi YOKTUR ve `namaz-diagnostics-expiry`
-- cron job'ı onu DÜŞÜRMEZ. Tanılama tablosunun aksine bu tablo kontrol
-- düzlemidir: silinirse test penceresini yeniden açmanın veya özelliği uzaktan
-- kapatmanın hiçbir yolu kalmaz.

create table if not exists public.app_remote_config (
  id smallint primary key default 1 check (id = 1),

  -- ── ANA ŞALTER ──────────────────────────────────────────────────────────
  -- false: istemci hiç istek üretmez (isLocationDiagnosticsAvailable false döner)
  -- VE sunucu RLS policy'si anon insert'lerini reddeder. İki katmanlı kapatma;
  -- eski istemciler güncellenmemiş olsa bile sunucu tarafı bağlayıcıdır.
  diagnostics_enabled boolean not null default true,

  -- ── KADANS ──────────────────────────────────────────────────────────────
  -- Kayıt aralığı (dakika). İstemcideki kova tekilleştirmesinin genişliği ve
  -- WorkManager uyanma aralığı bu değerden türetilir.
  -- Alt sınır 15: WorkManager'ın izin verdiği en küçük periyot; daha küçük bir
  -- değer sessizce 15'e yuvarlanır ve panelde yanıltıcı olur.
  beacon_interval_minutes smallint not null default 15
    check (beacon_interval_minutes between 15 and 720),

  -- Ön plan servisli konum güncellemeleri (kalıcı bildirim). Uygulama kapalıyken
  -- ve internet yokken çalışan tek yol; pil bedeli olduğu için uzaktan
  -- kapatılabilir olması gerekir.
  foreground_service_enabled boolean not null default true,

  -- ── TEST PENCERESİ ──────────────────────────────────────────────────────
  -- Kesim anı. Bu değeri ileri almak testi uzatır: RLS policy, pg_cron temizlik
  -- job'ı ve istemcinin pencere kontrolü hepsi buradan okur (bkz. 20260805010000).
  -- Varsayılan, bu migration'dan önceki sabit değerin aynısıdır.
  diagnostics_cutoff timestamptz not null default timestamptz '2026-08-11 00:00:00+03',

  -- ── KUYRUK / AKIŞ SINIRLARI (istemci) ───────────────────────────────────
  -- Tek boşaltmada gönderilecek azami kuyruk kaydı. Sunucudaki saatlik kurulum
  -- limitinin ALTINDA tutulmalı; yoksa tek boşaltma kotayı yakıp P0001 üretir.
  -- Varsayılan, istemcideki yerleşik varsayılanla (LOCATION_DIAGNOSTICS_MAX_
  -- UPLOADS_PER_FLUSH) BİLEREK aynıdır: config okunamayan bir cihaz ile okuyabilen
  -- bir cihaz aynı davranmalı, yoksa saha teşhisi yanıltıcı olur.
  max_uploads_per_flush smallint not null default 12
    check (max_uploads_per_flush between 1 and 24),

  -- Çevrimdışıyken saklanacak azami kayıt (48 ≈ 15 dk kadansında 12 saat).
  -- Daha uzun çevrimdışılık bekleniyorsa panelden yükseltin (500'e kadar).
  max_outbox_entries smallint not null default 48
    check (max_outbox_entries between 12 and 500),

  -- İstemci config'i en fazla bu sıklıkta çeker. Küçük değer = ayar değişikliği
  -- cihazlara daha hızlı yayılır, ama daha çok istek.
  config_poll_minutes smallint not null default 60
    check (config_poll_minutes between 5 and 1440),

  -- ── SUNUCU KAPASİTE / HIZ SINIRLARI ─────────────────────────────────────
  -- enforce_notification_diagnostics_limits() bunları okur (bkz. 20260805010000).
  -- Eski sabitler 2000 / 16 idi; 15 dk kadansı (kurulum başına saatte 4 kayıt)
  -- ve birkaç testçi ile 2000 satır bir haftayı doldurmuyordu.
  max_rows_total integer not null default 20000
    check (max_rows_total between 100 and 1000000),
  max_rows_per_install_hourly smallint not null default 40
    check (max_rows_per_install_hourly between 1 and 500),

  updated_at timestamptz not null default now()
);

comment on table public.app_remote_config is
  'Single-row remote configuration for the mobile client and the diagnostics pipeline. Anon may SELECT only.';

-- Panelden yapılan her değişiklik damgalanır; istemci durum panelinde
-- "config ne zaman değişti" bilgisi bundan okunur.
create or replace function public.touch_app_remote_config()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$function$;

drop trigger if exists touch_app_remote_config on public.app_remote_config;
create trigger touch_app_remote_config
before update on public.app_remote_config
for each row execute function public.touch_app_remote_config();

-- Tekil satır. Zaten varsa dokunulmaz (migration yeniden çalıştırılabilir olsun).
insert into public.app_remote_config (id) values (1)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ erişim
-- Anon YALNIZ okur. Yazma yetkisi verilmez: anahtar APK'dan çıkarılabildiği için
-- INSERT/UPDATE açılırsa herkes uygulamanın davranışını uzaktan değiştirebilirdi.
alter table public.app_remote_config enable row level security;

revoke all on table public.app_remote_config from public, anon, authenticated;
grant select on table public.app_remote_config to anon;

drop policy if exists "public read remote config" on public.app_remote_config;
create policy "public read remote config"
on public.app_remote_config
for select
to anon
using (true);

revoke all on function public.touch_app_remote_config() from public, anon, authenticated;

-- PostgREST şema önbelleğini tazele; yoksa istemci bir süre PGRST205 görür.
notify pgrst, 'reload schema';

-- ── DOĞRULAMA ───────────────────────────────────────────────────────────────
--   select * from public.app_remote_config;                      -- tek satır
--   -- anon anahtarla (okuma 200 dönmeli, yazma 401/403 dönmeli):
--   curl -s "$URL/rest/v1/app_remote_config?select=*&id=eq.1" -H "apikey: $ANON"
--   curl -s -X PATCH "$URL/rest/v1/app_remote_config?id=eq.1" -H "apikey: $ANON" \
--        -H 'Content-Type: application/json' -d '{"diagnostics_enabled":false}'
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   DİKKAT: 20260805010000 bu tabloya bağımlıdır. Önce onu geri alın, yoksa
--   diagnostics_cutoff() coalesce ile sabit tarihe düşer ve pencere uzatılamaz.
--   drop table if exists public.app_remote_config;
--   drop function if exists public.touch_app_remote_config();
