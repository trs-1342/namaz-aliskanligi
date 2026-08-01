# Codex Konum Güncellemesi Çalışma Raporu

## Sonuç

Şehir seçimi ve Türkiye'ye özel Diyanet zinciri kaldırıldı. Namaz vakitleri yalnız canlı GPS koordinatından hesaplanıyor; ülke kodu yalnız hesap convention'ını seçiyor. Suudi Arabistan `UmmAlQura`, Türkiye `Turkey`, diğer ülkeler `MuslimWorldLeague` kullanıyor.

Geçici notification/location teşhisi açık rıza, kısa süre, veri minimizasyonu ve fail-closed kurallarıyla eklendi. Feature flag veya Supabase public config yoksa UI görünmez ve ağ isteği yapılmaz.

## Veri akışı

1. Kullanıcı ayarlarda geçici teste açıkça onay verir.
2. Uygulamanın planladığı prayer notification foreground'da alınırsa veya Android alarmı son 60 saniye içinde cold-start oluşturursa olay kabul edilir.
3. O anda `High` accuracy canlı GPS fix'i alınır; cache/last-known kullanılmaz.
4. Event daha önce denenmediyse Supabase REST'e bir kez insert edilir; background retry kuyruğu yoktur.
5. Duplicate `409/23505` başarı kabul edilir. Kalıcı 4xx'te hemen; bağlı görünürken üç ardışık network/5xx/429 hatasında özellik kalıcı no-op olur.
6. 2026-08-04T00:00:00+03:00 anında istemci/RLS insert'i keser; 00:05'te doğrulanmış `pg_cron` işi tabloyu ve kendi job kaydını siler.

## Saklanan alanlar

`installation_id` rastgele installation UUID'dir; Google/Gmail veya donanım kimliği değildir. İlk sekiz hex karakterden otomatik `tester_code` üretilir. Device name/model, OS/app sürümü, notification ID/türü/prayer key, notification/schedule/capture/location zamanları, capture modu, latitude, longitude, accuracy ve varsa altitude saklanır. Claude incelemesi sonrası manufacturer/type/locale/timezone/altitudeAccuracy/heading/speed hem payload'dan hem uzak tablodan kaldırıldı. Uygulama tabloyu okuyamaz, güncelleyemez veya silemez.

## Eski sürüm geçişi

`locationSourceVersion=2` migration'ı eski manual/Diyanet alanlarını, şehir cache'ini, eski koordinat takvimini ve eski planlı notification'ları bir kez temizler. Dil, tema, notification tercihleri ve namaz takip geçmişi korunur. Eski backup içe aktarımında da kaldırılan location-derived alanlar atılır ve canlı GPS yeniden istenir.

## Doğrulama

- `npm run check`: başarılı.
- TypeScript: temiz.
- Testler: 85/85 assertion başarılı.
- `npm audit --audit-level=high`: 0 vulnerability.
- `./gradlew :app:compileDebugKotlin`: BUILD SUCCESSFUL.
- Expo config ve package: version 1.4.0, Android versionCode 40.
- Production Android Expo export: başarılı (916 module, Hermes bundle).
- Expo dependency check: güncel.
- Uzak Supabase: altı migration eşleşiyor, tablo boş, RLS/grants ve tam expiry command assertion doğrulandı.
- Claude Code peer review: blocker yok; race, consent kapsamı, 4xx/UI ve cron doğrulama notları kapatıldı.

## Bilinen platform sınırı

Local notification killed + non-alarm durumunda işletim sistemi JavaScript'i çalıştırmak zorunda değildir. Bu nedenle ölçüm delivery receipt değildir; foreground received ve Android alarm cold-start proxy'sidir. Background location izni eklenmemiştir. Google Play kapalı test track'lerini de background-location incelemesine dahil ettiğinden bu tercih policy ve veri minimizasyonu gereğidir.

## Açık operasyonel kapılar

Yeni Supabase projesi Frankfurt bölgesinde oluşturuldu (`chnandwrakzpangwnzsa`), link edildi, public key güvenli biçimde ignored `.env.local` içine kondu ve gerçek REST yetki matrisi geçti. Kod/altyapı tarafında açık kapı yoktur. Play Data Safety beyanı, Riyad/Türkiye fiziksel cihaz smoke testi ve 4 Ağustos sonrasında otomatik silme teyidi dış operasyon olarak kalır. Expo Doctor'ın tek uyarısı native `android/` klasörü ile app.json prebuild alanlarının birlikte tutulmasıdır; mevcut native değerler ayrıca kontrol edildi, uyarı gizlenmedi.

## Android release build sonucu

- EAS remote release credential ile production AAB ve preview APK yerel EAS build üzerinden başarıyla üretildi; debug keystore fallback'i kullanılmadı.
- İlk doğrulama artefact'ları `1.3.9` / versionCode `36` olarak üretildi. Play Console'daki `1.3.7` sürümüne karşı ek güvenlik payı için son production AAB `1.4.0` / versionCode `40` olarak yeniden üretildi; EAS remote versionCode da `40` yapıldı.
- APK Signature Scheme v2 doğrulaması geçti; AAB `jarsigner` bütünlük doğrulaması geçti.
- Final merged manifestte `allowBackup=false`; `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO` ve `FOREGROUND_SERVICE_MICROPHONE` izinleri yoktur.
- APK SHA-256: `f95cd42ce2e648a8a9cb131b38506a454ecb4aa3346b2be41ebecf4d83fa4e4c`.
- İlk `1.3.9` AAB SHA-256: `1f64165fc90ef52d14353e7e75952c844145f0bc232aa63c49ee7dff086db093`.
- Son `1.4.0` AAB SHA-256: `44c61476c12106a0887db76abfb8a321bd58786e9977224ff2fd804ad43d9f72`.
- Bundletool manifest doğrulaması: package `com.trs1342.namazaliskanligi`, versionName `1.4.0`, versionCode `40`.
- Bağlı Android cihaz bulunmadığından install/killed/locked/reboot smoke testi yapılmadı; bu operasyonel kapı açık kalır.

Kaynaklar: [Expo Notifications SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/), [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/), [Google Play background location policy](https://support.google.com/googleplay/android-developer/answer/9799150), [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).
