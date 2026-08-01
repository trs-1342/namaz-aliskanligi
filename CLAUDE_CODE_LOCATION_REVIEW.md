# Claude Code — Konum Güncellemesi Peer Review

Tarih: 2026-08-01

## Tasarım incelemesi

- Diyanet akışının hem normal GPS sync hem backup reapply noktasından kaldırılması gerektiğini doğruladı.
- Local notification'ın killed + non-alarm halinde JavaScript delivery callback garantisi vermediğini; foreground listener ve Android full-screen alarm cold-start'ın ölçüm proxy'si olarak açıkça belgelenmesi gerektiğini belirtti.
- Rızanın Play kapalı test üyeliğinden ayrı, uygulama içinde açıkça alınmasını istedi.
- Telemetri state'inin backup'tan ayrı tutulmasını, client+RLS cutoff ve table-missing permanent disable uygulanmasını önerdi.
- Background location'ın test/analytics amacıyla eklenmemesi gerektiğini belirtti.

## İlk uygulama sonrası inceleme

Claude Code incelenen security/runtime/SQL alanlarında blocker veya high bulgu bulmadı. Aşağıdaki kriterleri doğruladı:

- [x] Explicit consent her capture öncesi yeniden kontrol ediliyor.
- [x] Canlı GPS `getCurrentPositionAsync(High)` ile alınıyor.
- [x] Client ve SQL cutoff aynı timestamp'i kullanıyor (son kapsam: 2026-08-04T00:00:00+03:00).
- [x] RLS ve grant modeli anon role için insert-only.
- [x] Retry kuyruğu yok.
- [x] 404/410/PGRST204/PGRST205 kalıcı disable oluşturuyor.
- [x] DB unique constraint server-side duplicate satırı engelliyor.

Düşük seviye tek not: ilk uygulamada istemci yalnız son event ID'sini tutuyordu. Codex bunu review sonrasında seri claim kuyruğu ve son 64 event'i saklayan bounded geçmişe çevirdi.

## Son bağımsız inceleme ve kapanış

Claude Code raporlara güvenmeden güncel kaynakları yeniden taradı; blocker bulmadı. İşaretlediği maddelerin durumu:

- [x] Remote failure sayacındaki read-modify-write race, ayrı promise queue ile kapatıldı.
- [x] Publishable key'in `Authorization: Bearer` olarak yanlış gönderilme riski pure helper ve testlerle kapatıldı.
- [x] Duplicate `409/23505` başarısızlık değil deduplication sonucu olarak sınıflandırıldı.
- [x] Kalıcı 400/422 benzeri 4xx hataları fail-closed kapsama alındı; 408/425/429 geçici hata sayacına bağlandı.
- [x] Onay metninden daha geniş payload sorunu veri minimizasyonuyla kapatıldı; gereksiz yedi kolon remote tablodan da düşürüldü ve üç dilde metinler gerçek alanlarla eşitlendi.
- [x] Kalıcı disable sonrası Ayarlar switch'i, capture tamamlandığında storage'dan yeniden okunuyor.
- [x] `pg_cron` job'unun adı/schedule/active durumu beşinci, tam table+function cleanup command'i altıncı remote migration assertion'ıyla kanıtlandı.
- [x] Public key kaynaklı sınırsız maliyet riskine karşı atomik trigger ile 16 kayıt/kurulum/saat ve 2000 toplam kayıt sınırı eklendi.

Kalanlar kod bulgusu değildir: `USE_EXACT_ALARM`/`USE_FULL_SCREEN_INTENT` Play Console değerlendirmesi, kilitli gerçek cihaz davranışı ve 4 Ağustos tarihinden sonra cron sonucunun gözlemlenmesi.

## Kapanış yeniden doğrulaması

Son düzeltmelerden sonra Claude Code hedefli incelemeyi tekrarladı ve **kalan Blocker/High/Medium bulgu olmadığını** bildirdi. Race/dedup, publishable header, consent withdrawal, 4xx fail-closed, UI sync, cron assertion/command, minimize edilmiş payload, atomik rate bound, teardown ve üç dilli privacy metni güncel kaynakta yeniden doğrulandı.
