-- Birleşik/tam-detaylı konum sütunları ekler. latitude & longitude korunur (uygulama
-- bunları gönderir); aşağıdaki sütunlar onlardan OTOMATİK türer (GENERATED STORED),
-- yani uygulama tarafında hiçbir değişiklik gerekmez ve mevcut satırlar için de dolar.

-- 1) Gerçek coğrafi nokta: tek sütunda enlem+boylam. Supabase tablo editöründe HARİTADA
--    görünür; mesafe/yakınlık sorguları yapılabilir. PostGIS gerektirir (Supabase'de mevcut).
create extension if not exists postgis with schema extensions;

alter table public.notification_location_diagnostics
  add column if not exists location extensions.geography(Point, 4326)
    generated always as (
      extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
    ) stored;

-- 2) Tek bakışta okunur/tıklanır kolaylık sütunları (isteğe bağlı; PostGIS'siz de çalışır).
alter table public.notification_location_diagnostics
  add column if not exists location_text text
    generated always as (latitude::text || ',' || longitude::text) stored,
  add column if not exists maps_url text
    generated always as ('https://maps.google.com/?q=' || latitude::text || ',' || longitude::text) stored;

notify pgrst, 'reload schema';
