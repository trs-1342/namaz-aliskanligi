-- ============================================================================
--  BU DOSYA supabase/migrations/ ALTINDA DEĞİLDİR — `supabase db push` BUNU
--  ÇALIŞTIRMAZ. ELLE, YALNIZCA AŞAĞIDAKİ ŞARTLARIN HEPSİ SAĞLANINCA ÇALIŞTIRIN.
-- ============================================================================
--
-- Amaç: anon rolünün notification_location_diagnostics tablosuna doğrudan INSERT
-- yetkisini geri almak. Ondan sonra tabloya tek giriş yolu diagnostics-ingest
-- Edge Function'ı (service_role ile yazar) olur.
--
-- ÖN ŞARTLAR (hepsi zorunlu):
--   1. `supabase functions deploy diagnostics-ingest` yapılmış olmalı.
--   2. İstemci (src/services/locationDiagnostics.ts) postDiagnosticsPayload()
--      içinde `/rest/v1/notification_location_diagnostics` yerine
--      `/functions/v1/diagnostics-ingest` çağırıyor olmalı.
--   3. O istemci sürümü BÜTÜN test cihazlarına kurulmuş olmalı.
--
-- BU SIRA BOZULURSA NE OLUR (gerçek risk, teorik değil):
--   Eski istemci doğrudan INSERT denediğinde 401/403 alır. İstemci bunu
--   isPermanentDiagnosticsFailure() ile "kalıcı hata" sayar; >= 3 dakika arayla
--   3 kez tekrarlanınca kill-switch devreye girer (DISABLED_KEY yazılır), arka
--   plan görevi kendini iptal eder ve o cihazda tanılama BİR DAHA AÇILMAZ —
--   uygulama verisi sıfırlanana kadar. Yani sıra hatası testi kalıcı bozar.
--
-- Geri alma (rollback): en alttaki blok.

begin;

revoke insert on table public.notification_location_diagnostics from anon;
revoke usage on sequence public.notification_location_diagnostics_id_seq from anon;

drop policy if exists "temporary anonymous diagnostics insert"
  on public.notification_location_diagnostics;

-- RLS açık kalır; service_role RLS'i baypas ettiği için Edge Function yazmaya
-- devam eder. anon/authenticated için tabloya hiçbir yol kalmaz.

commit;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------ doğrulama
-- Beklenen: anon için insert yetkisi YOK, policy YOK.
--
-- select grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_name = 'notification_location_diagnostics';
--
-- select polname, polroles::regrole[]
--   from pg_policy
--  where polrelid = 'public.notification_location_diagnostics'::regclass;
--
-- Anon anahtarla doğrudan INSERT denemesi 401/403 dönmeli:
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -X POST "$SUPABASE_URL/rest/v1/notification_location_diagnostics" \
--     -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d '{}'

-- ------------------------------------------------------------------ rollback
-- begin;
-- grant insert on table public.notification_location_diagnostics to anon;
-- grant usage on sequence public.notification_location_diagnostics_id_seq to anon;
-- create policy "temporary anonymous diagnostics insert"
--   on public.notification_location_diagnostics
--   for insert to anon
--   with check (
--     now() < timestamptz '2026-08-11 00:00:00+03'
--     and created_at < timestamptz '2026-08-11 00:00:00+03'
--   );
-- commit;
-- notify pgrst, 'reload schema';
