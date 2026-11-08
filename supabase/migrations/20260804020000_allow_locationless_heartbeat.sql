-- Konumsuz "hayatta" (heartbeat) kaydına izin ver.
--
-- Amaç: konum izni yok / cihaz GPS'i kapalı / ilk sabit alınamadı durumlarında bile
-- uygulamanın çalıştığını görebilmek. Böylece "kaç testçi uygulamayı açtı ama konum
-- vermedi" sorusunu yanıtlarız (şu an bu durumda hiç satır düşmüyordu → sessiz körlük).

-- 1) Koordinatları opsiyonel yap. (Mevcut aralık CHECK'leri NULL'ı zaten geçirir; bir
--    CHECK yalnız sonuç FALSE olduğunda reddeder, NULL/unknown'da geçer.)
alter table public.notification_location_diagnostics
  alter column latitude drop not null,
  alter column longitude drop not null;

-- 2) Konum yoksa NEDENİNİ tutan sütun.
alter table public.notification_location_diagnostics
  add column if not exists no_location_reason text
    check (
      no_location_reason is null
      or no_location_reason in (
        'permission_denied',    -- konum izni verilmemiş
        'services_disabled',    -- cihazın konum servisi (GPS) kapalı
        'position_unavailable', -- izin var ama sabit alınamadı (kapalı alan vb.)
        'background_no_fix'      -- arka planda çalışırken taze konum alınamadı
      )
    );

-- 3) Tutarlılık: ya koordinatlar (ikisi birden) olacak, ya da bir neden bulunacak.
alter table public.notification_location_diagnostics
  add constraint diagnostics_location_or_reason
    check (
      (latitude is not null and longitude is not null)
      or no_location_reason is not null
    );

-- Not: location / location_text / maps_url generated sütunları koordinat NULL olunca
-- kendiliğinden NULL olur; ek işlem gerekmez.

notify pgrst, 'reload schema';
