# Onboarding Onayı ve Offline Bildirim Telemetrisi Raporu

Tarih: 2026-08-01
Sürüm: 1.4.0 / Android versionCode 40

## TODO / Sonuç

- [x] **CONSENT-01:** Hoş geldiniz/onboarding tamamlandıktan sonra, yalnız daha önce karar vermemiş kullanıcıya hassas konum testi için zorunlu Evet/Hayır diyaloğu gösterildi.
- [x] **CONSENT-02:** Ret kararı kalıcı olarak kaydedildi; ret veya ayarlardan geri çekme anında bekleyen outbox silindi.
- [x] **OFFLINE-01:** Onaylı kullanıcıda uygulamanın işlediği prayer notification sırasında internet yoksa yakalanan payload app-private AsyncStorage outbox'a alındı.
- [x] **OFFLINE-02:** Outbox 8 benzersiz event ile sınırlandı; aynı event ID'nin yeniden eklenmesi önlendi.
- [x] **OFFLINE-03:** Bağlantı geri geldiğinde ve uygulama yeniden active olduğunda outbox sıralı olarak Supabase'e gönderildi; başarılı/duplicate kayıt kuyruktan çıkarıldı.
- [x] **EXPIRY-01:** Feature config kaldırıldığında veya 2026-08-04T00:00:00+03:00 cutoff'u geldiğinde yerel outbox silindi ve yeni capture/upload kapandı.
- [x] **DISCLOSURE-01:** Türkçe, İngilizce ve Arapça uygulama metinleri ile gizlilik politikası offline saklama, 8 kayıt sınırı, gönderim ve silme koşullarıyla güncellendi.
- [x] **TEST-01:** Cutoff, maksimum 8 kayıt ve duplicate normalizasyonu otomatik testlere eklendi.
- [x] **BUILD-01:** EAS remote production keystore ile side-by-side test APK üretildi ve APK Signature Scheme v2 doğrulandı.

## Doğrulama

- `npm run check`: başarılı.
- TypeScript: temiz.
- Testler: 89/89 assertion başarılı.
- `npm audit --audit-level=high`: 0 vulnerability.
- Android EAS local release build: `BUILD SUCCESSFUL`.
- APK: `releases/namaz-aliskanligi-v1.4.0-test.apk`.
- Package: `com.trs1342.namazaliskanligi.test` (Play sürümüyle yan yana kurulur).
- Version: `1.4.0` / `40`.
- SHA-256: `20c2c2d62485604a46998ea9652432f31cb207f6948ec3c98259c4b5ed7a67cc`.

## Platform sınırı

Bu mekanizma bir delivery receipt değildir. İşletim sistemi uygulama JavaScript'ini killed + non-alarm bildiriminde çalıştırmazsa o olayda konum ölçümü yapılamaz. Ölçüm foreground notification receive veya son 60 saniyelik Android alarm cold-start sırasında yapılır; sürekli/background location izni özellikle eklenmemiştir.

## Peer review notu

Claude Code için bağımsız diff incelemesi başlatıldı ancak CLI yanıt üretmeden takıldığı için sonlandırıldı; bu tur için başarılı peer review iddiasında bulunulmamıştır. Codex incelemesi, otomatik kalite kapısı ve gerçek signed release build tamamlanmıştır.
