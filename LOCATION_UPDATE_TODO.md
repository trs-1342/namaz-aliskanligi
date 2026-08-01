# Konum ve Geçici Notification Telemetrisi — TODO

Tarih: 2026-08-01
Sürüm: 1.3.9 / Android versionCode 36
Kesin bitiş: 2026-08-03 23:59:59 Europe/Istanbul

## Kod

- [x] **LOC-01:** Manuel şehir/ilçe seçimini, Diyanet Türkiye şehir servisini ve ilgili UI/state alanlarını kaldır.
- [x] **LOC-02:** Son bilinen konum fallback'ini kaldır; her senkronu `getCurrentPositionAsync(High)` ile yap.
- [x] **LOC-03:** GPS'ten çözülen ISO ülke koduna göre TR=`Turkey`, SA=`UmmAlQura`, diğer ülkeler=`MuslimWorldLeague` metodunu uygula.
- [x] **MIG-01:** Eski şehir/Diyanet cache'ini, eski koordinat takvimini ve eski notification schedule'ını yükseltmede bir kez temizle; kullanıcı tercihleri ve namaz takip geçmişini koru.
- [x] **MIG-02:** Eski yedek geri yüklenirse kaldırılan şehir alanlarını ve eski koordinat takvimini yeniden içeri alma; canlı GPS senkronu zorunlu olsun.
- [x] **TEL-01:** Supabase için insert-only, RLS korumalı `notification_location_diagnostics` şemasını ekle.
- [x] **TEL-02:** Rastgele `installation_id`/`tester_code`, cihaz adı/modeli, OS/app sürümleri, notification zamanları ile latitude/longitude/accuracy/opsiyonel altitude gönder; gereksiz locale/timezone/heading/speed alanlarını kaldır.
- [x] **TEL-03:** Veri toplamayı ayrı ve açık uygulama içi onaya bağla; rıza durumunu backup dışında sakla.
- [x] **TEL-04:** Yalnız prayer notification foreground-received ve 60 saniyelik Android alarm cold-start olayını tetikleyici kabul et.
- [x] **TEL-05:** Retry kuyruğu kullanma; event claim geçmişi ve DB unique constraint ile duplicate'i engelle.
- [x] **TEL-06:** İstemci ve RLS cutoff'unu 3 Ağustos 2026 gün sonuna sabitle.
- [x] **TEL-07:** Tablo/proje silinirse kalıcı 4xx'te hemen, bağlantı/5xx/429 için üç ardışık uzak hatada cihazda kalıcı no-op'a geç; sayaç yarışını seri kuyrukla engelle.
- [x] **TEL-08:** Publishable-key/legacy-JWT header ayrımını ve DB duplicate `409/23505` sonucunu testli olarak yönet.
- [x] **TEL-09:** Rıza geri çekildiğinde devam eden capture'ı nesil kontrolüyle iptal et; kalıcı disable sonrası UI switch durumunu tazele.
- [x] **PRIV-01:** Türkçe/İngilizce/Arapça gizlilik politikasını geçici test, Supabase ve hassas konum açıklamasıyla güncelle.
- [x] **REL-01:** Uygulama sürümünü 1.3.9, Android versionCode'u 36 yap; imzalı AAB/APK üretimini ve artefact doğrulamasını tamamla.
- [x] **VER-01:** Typecheck, 85 assertion, high audit, Android Kotlin compile ve production Android Expo export doğrulamalarını tamamla.
- [x] **PEER-01:** Claude Code ile iki bağımsız security/runtime/SQL incelemesi yap; son bulguları kapat.

## Operasyon

- [x] **OPS-00:** Boş kapasiteli yeni Supabase CLI hesabını ve organizasyonu doğrula.
- [x] **OPS-01:** Proje URL'si, feature flag ve yalnız public Publishable key'i ignored `.env.local` içinde tanımla; secret/service-role anahtarı kullanma.
- [x] **OPS-02:** `namaz-aliskanligi-diagnostics` projesini Frankfurt'ta oluştur, workspace'e link et ve migration'ı uygula.
- [x] **OPS-02B:** Gerçek Publishable-key REST smoke testinde POST=201, duplicate=409, invalid=400, GET/PATCH/DELETE=401 sonuçlarını doğrula ve sentetik satırları temizle.
- [x] **OPS-02C:** Uzak DB'de altı migration'ı eşleştir; RLS insert-only, veri minimizasyonu, byte bounds, saatlik 16/kurulum ve toplam 2000 kayıt sınırını uygula.
- [ ] **OPS-03:** Play Console Data Safety ve kapalı test açıklamasını güncel gizlilik metniyle eşleştir.
- [ ] **OPS-04:** Riyad/Türkiye gerçek cihaz matrisi: foreground, locked alarm cold-start, alarm kapalı, offline ve izin reddi senaryolarını smoke test et.
- [x] **OPS-05:** `pg_cron` ile tabloyu ve test trigger function'ını 4 Ağustos 2026 00:05 İstanbul'da otomatik düşürüp job'u kendi kendine kaldıracak işi kur; job adı/schedule/active/command durumunu assertion ile doğrula.
- [ ] **OPS-06:** 4 Ağustos 2026'da otomatik silmenin gerçekleştiğini Dashboard/CLI'dan doğrula; gerekirse idempotent `supabase/teardown/drop_notification_location_diagnostics.sql` dosyasını çalıştır.

Not: Remote proje `chnandwrakzpangwnzsa` aktif ve linked; altı migration local/remote history'de eşleşiyor ve tablo son dump'ta boş. Kod tarafı tamamlandı. Yalnız Play Console beyanı, gerçek cihaz matrisi ve tarih geldikten sonraki silme teyidi manuel kalmıştır.
