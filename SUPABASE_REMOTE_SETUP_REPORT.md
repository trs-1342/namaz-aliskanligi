# Supabase Remote Kurulum Raporu

Tarih: 2026-08-01

## Proje

- Organizasyon: `socialmediaofhalil@gmail.com's Org`
- Proje: `namaz-aliskanligi-diagnostics`
- Project ref: `chnandwrakzpangwnzsa`
- Region: `eu-central-1` (Frankfurt)
- Durum: `ACTIVE_HEALTHY`
- Workspace link: başarılı

## Migration

- [x] Local migration: `20260801000000_create_notification_location_diagnostics.sql`
- [x] Hardening: `20260801010000_harden_notification_location_diagnostics.sql`
- [x] Smoke cleanup: `20260801020000_cleanup_diagnostics_smoke_rows.sql`
- [x] Automatic expiry: `20260801030000_schedule_diagnostics_expiry.sql`
- [x] Data minimization, rate/cap and cron assertion: `20260801040000_minimize_and_bound_diagnostics.sql`
- [x] Complete table/function expiry command: `20260801050000_complete_diagnostics_expiry.sql`
- [x] Altı migration local/remote history'de birebir eşleşiyor.
- [x] Remote schema dump ile tablo ve constraints doğrulandı.
- [x] RLS aktif.
- [x] Anon table grant yalnız `INSERT`.
- [x] Cutoff remote policy'de `2026-08-03 21:00:00+00` — `2026-08-04 00:00:00+03:00` ile aynı an.
- [x] Service role dışındaki client rolleri için table read/update/delete grant yok.
- [x] Anon sequence grant yalnız `USAGE`; `SELECT` yok.
- [x] Son remote data dump'ta kullanıcı/smoke satırı yok; yalnız identity sequence değeri mevcut.
- [x] `namaz-diagnostics-expiry` işi 4 Ağustos 00:05 İstanbul için aktif; job veya tam table+function cleanup command'i yoksa son migration exception ile deploy'u durduruyor.
- [x] Trigger sınırı: kurulum başına 16 insert/saat, tüm test için 2000 satır.

## Environment

- [x] `EXPO_PUBLIC_LOCATION_DIAGNOSTICS_ENABLED=true`
- [x] `EXPO_PUBLIC_SUPABASE_URL=https://chnandwrakzpangwnzsa.supabase.co`
- [x] Public Publishable key ignored `.env.local` içinde tanımlı; uygulama yeni `sb_publishable_` header biçimini kullanıyor ve legacy anon JWT fallback'i destekliyor.

CLI'nin API-key listeleme komutu public key ile birlikte `service_role` gibi gizli anahtarları da döndürebildiğinden güvenlik katmanı bu erişimi reddetti. Service-role key uygulamaya konulmamalıdır.

## Gerçek REST smoke sonucu

- [x] Geçerli anon `POST` → `201`.
- [x] Aynı unique event → `409`.
- [x] Geçersiz latitude ve fazla uzun device name → `400`.
- [x] Anon `GET`, `PATCH`, `DELETE` → `401`.
- [x] Sentetik `smoke-test-%` kayıtları cleanup migration ile silindi.

## Kalan manuel kontrol

- [ ] 4 Ağustos'ta tabloyu cron'un düşürdüğünü kontrol et; çalışmadıysa idempotent teardown SQL'i uygula.
- [ ] Gerçek Android cihazdan onay/UI/foreground/alarm/offline matrisini çalıştır.
