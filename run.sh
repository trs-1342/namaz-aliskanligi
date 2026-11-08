#!/usr/bin/env bash
set -euo pipefail

TARGET="03:10"

echo "[INFO] Bekleniyor: $TARGET"

while true; do
    if [[ "$(date +%H:%M)" == "$TARGET" ]]; then
        echo "[INFO] $(date) - Claude Code başlatılıyor..."

        claude \
          --permission-mode bypassPermissions \
          --dangerously-skip-permissions \
          "# GÖREV BİLİNCİ, KAYNAK YÖNETİMİ VE DEVAMLILIK

Bu görevi yüzeysel biçimde tamamlaman kabul edilmeyecektir.

Projeyi, mimariyi ve mevcut çalışma düzenini anlayarak hareket et. Sana verilen geniş yetki; rastgele değişiklik yapma yetkisi değil, doğru teknik kararları bağımsız biçimde verebilme sorumluluğudur.

Görevini eksiksiz, dikkatli ve mühendislik disiplinine uygun biçimde yerine getir.

## MİMARİ SORUMLULUK

Bu çalışma boyunca sistem mimarisini bütün olarak düşün.

Tek bir dosyaya veya tek bir güvenlik ayarına odaklanıp sistemin geri kalanını göz ardı etme.

Her değişiklikte aşağıdaki zinciri birlikte değerlendir:

* JavaScript ve TypeScript katmanı
* Hermes bundle davranışı
* Babel dönüşümleri
* React Native runtime
* Expo SDK 54
* committed-native Android projesi
* Gradle release yapılandırması
* R8 ve resource shrinking
* native modüller
* background task yaşam döngüsü
* Android işletim sistemi kısıtlamaları
* üreticiye özgü pil optimizasyonları
* ağ kesintileri
* Supabase istemci ve sunucu akışı
* RLS ve Edge Function sınırları
* release artifact güvenliği
* fiziksel cihaz davranışı

Yerel bir değişikliğin sistem genelindeki etkisini hesaplamadan uygulama.

Kodun yalnızca sözdizimsel doğruluğunu değil, çalışma zamanı sonuçlarını düşün.

## YETKİNİN ANLAMI

Sana bu görevi doğru tamamlayabilmen için teknik karar alma alanı verilmektedir.

Bu yetkiyi:

* daha doğru analiz yapmak,
* çakışmaları önceden fark etmek,
* güvenli uygulama sırasını belirlemek,
* gerekli statik kontrolleri çalıştırmak,
* dosyalar arasındaki bağımlılıkları çözmek,
* fiziksel cihaz risklerini öngörmek,
* güvenli rollback hazırlamak

için kullan.

Bu yetkiyi:

* özellik kaldırmak,
* davranış değiştirmek,
* gereksiz refactor yapmak,
* mimariyi keyfine göre dönüştürmek,
* kullanıcı kararlarını geçersiz kılmak,
* kapsamı genişletmek

için kullanamazsın.

Bağımsız ol fakat kontrolsüz olma.

Kararlı ol fakat aceleci olma.

Kapsamlı ol fakat görev dışına çıkma.

## TOKEN VE BAĞLAM YÖNETİMİ

Token bütçesini bilinçli kullan.

Aynı dosyayı veya aynı çıktıyı gereksiz yere tekrar tekrar okuma.

Uzun dosyalarda:

* önce sembol, fonksiyon ve yapılandırma araması yap,
* yalnızca ilgili bölümleri oku,
* değişiklikten önce gerekli bağlamı genişlet,
* ilgisiz binlerce satırı tekrar üretme.

Komut çıktılarında:

* gereksiz ayrıntıyı bastır,
* hedefli aramalar kullan,
* uzun logları dosyaya yönlendir,
* yalnızca hata, uyarı ve sonuç bölümlerini incele,
* aynı kontrolü gerekmedikçe tekrarlama.

Token tasarrufu uğruna analizi yüzeyselleştirme.

Ancak gereksiz açıklamalarla, tekrarlarla veya kontrolsüz terminal çıktılarıyla bağlamı tüketme.

Öncelik sırası:

1. Mevcut sistemi doğru anla.
2. Riskleri belirle.
3. Güvenli değişiklikleri uygula.
4. Değişiklikleri doğrula.
5. Eksiksiz rapor hazırla.

## TOKEN YETMEZSE UYGULANACAK PROTOKOL

Kalan bağlamın görevin güvenli biçimde tamamlanmasına yetmeyeceğini fark edersen yeni ve büyük bir değişikliğe başlama.

Özellikle aşağıdaki işlere, tamamlayacak yeterli bağlam olmadan başlama:

* Gradle veya ProGuard değişikliği
* Babel yapılandırması değişikliği
* Edge Function oluşturma
* RLS migration hazırlama
* istemci veri yolunu değiştirme
* birden fazla dosyaya yayılan güvenlik düzenlemesi

Yarım bırakılmış, doğrulanmamış veya raporlanmamış değişiklik kabul edilmez.

Token sınırına yaklaşırsan şu sırayı uygula:

1. Devam eden atomik değişikliği güvenli bir noktada tamamla.
2. Dosyaları bozuk veya yarım durumda bırakma.
3. Uygulanmış değişikliklerin diff’ini incele.
4. Yapılanları ve yapılmayanları bir devam dosyasına kaydet.
5. Sonraki oturumda kullanılacak kesin devam komutunu hazırla.
6. Yeni değişiklik başlatma.
7. Kısmi durum raporu ver.

Devam dosyası olarak proje kökünde geçici biçimde aşağıdakini kullanabilirsin:

`SECURITY_HARDENING_CONTINUATION.md`

Bu dosyada şunlar bulunmalıdır:

* görevin değişmez kuralları,
* tamamlanan adımlar,
* değiştirilmiş dosyalar,
* çalıştırılmış kontroller,
* alınan sonuçlar,
* devam eden fakat tamamlanmamış hiçbir değişiklik bulunmadığının doğrulaması,
* sıradaki kesin adım,
* yasak işlemler,
* build ve deploy izni olmadığı,
* Git komutlarına ilişkin kısıtlamalar,
* kalan riskler,
* rollback bilgileri.

Bu dosya yalnızca oturum devamlılığı içindir. Proje davranışına etki etmemelidir.

## RESET SAATİ İÇİN DEVAM MEKANİZMASI

Token kullanım sınırı nedeniyle çalışma devam ettirilemeyecekse ve ortam zamanlanmış bir terminal komutuna izin veriyorsa, yalnızca kullanıcı alanında çalışan güvenli bir zamanlayıcı hazırlayabilirsin.

Amaç, limitin sıfırlandığı saatte Claude Code’u yeniden başlatıp devam dosyasındaki görevden sürdürmektir.

Bu işlem için kurallar:

* Zamanlayıcı yalnızca bu görevin devamını başlatmalıdır.
* Root yetkisi istememelidir.
* Sistem dosyalarını değiştirmemelidir.
* Kalıcı servis oluşturmamalıdır.
* Kullanıcının shell profilini değiştirmemelidir.
* Git işlemi çalıştırmamalıdır.
* Build veya deploy başlatmamalıdır.
* Aynı komutun birden fazla kez çalışmasını önlemelidir.
* Çıktıyı ayrıntılı bir log dosyasına yazmalıdır.
* Çalıştırılacak prompt açık ve deterministik olmalıdır.
* Devam dosyasını okumadan değişiklik yapmamalıdır.
* Kullanılan zaman dilimi ve hedef saat açıkça doğrulanmalıdır.

Mevcut bağlama göre limit sıfırlanma zamanı **4 Ağustos 2026 saat 04:00, Europe/Istanbul** olarak kabul edilebilir; ancak zamanlayıcı oluşturmadan önce sistem saatini ve zaman dilimini terminalden doğrula.

Saat geçmişse aynı güne ait geçmiş bir zamanı kullanma. Bir sonraki geçerli çalışma zamanını hesapla.

Ortamda `systemd-run --user`, `at` veya benzeri güvenli bir kullanıcı zamanlayıcısı varsa en uygun olanı seç.

Zamanlayıcı kullanılamıyorsa sistemi zorlamaya çalışma. Bunun yerine çalıştırılmaya hazır tek bir shell komutu üret ve rapora ekle.

Zamanlayıcı kurmadan önce:

1. Devam dosyasını eksiksiz yaz.
2. Çalışma ağacının yarım değişiklik içermediğini doğrula.
3. Çalıştırılacak Claude Code komutunu açıkça göster.
4. Log dosyasının konumunu belirle.
5. Aynı görevin ikinci kez paralel başlamasını engelleyen lock mekanizması kullan.
6. Zamanlayıcının gerçekten kaydedildiğini doğrula.

Önerilen log konumu:

`./security-hardening-resume.log`

Önerilen lock konumu:

`./.security-hardening-resume.lock`

Devam komutu şu mantığı taşımalıdır:

* Proje dizinine gir.
* Lock kontrolü yap.
* `SECURITY_HARDENING_CONTINUATION.md` dosyasını oku.
* Önceki görevin bütün yasaklarını ve sınırlarını aynen uygula.
* Yalnızca sıradaki tamamlanmamış adımdan devam et.
* Build, deploy veya Git write işlemi yapma.
* İşlem sonunda nihai rapor üret.
* Başarılı tamamlanırsa lock ve geçici zamanlayıcıyı temizle.
* Hata oluşursa ayrıntılı log bırak ve sistemi yarım değişiklikte bırakma.

Zamanlayıcı kurma işlemi güvenli veya doğrulanabilir değilse zamanlayıcı oluşturma.

## ÇALIŞMA PLANI

Göreve şu sırayla yaklaş:

### Aşama 1 — Envanter

* İlgili dosyaları tespit et.
* Mevcut yapılandırmaları belirle.
* Package sürümlerini doğrula.
* Native Android release ayarlarını tespit et.
* Supabase diagnostics akışını uçtan uca çıkar.
* Mevcut log noktalarını sınıflandır.
* Hermes durumunu belirle.
* R8 ve shrinking durumunu belirle.

### Aşama 2 — Etki analizi

Her planlanan değişiklik için:

* etkilenecek dosyaları,
* çalışma zamanı etkisini,
* cihaz riskini,
* background task etkisini,
* rollback yöntemini,
* doğrulama yöntemini

belirle.

### Aşama 3 — Atomik uygulama

Değişiklikleri birbirinden bağımsız ve küçük gruplar hâlinde yap.

Her atomik adımdan sonra diff’i kontrol et.

Bir sonraki adıma, önceki adımın kapsam dışı değişiklik yapmadığını doğrulamadan geçme.

### Aşama 4 — Statik doğrulama

İzin verilen kontrolleri çalıştır.

Başarısız bir kontrolü gizleme.

Hata nedeniyle risk oluşuyorsa ilgili değişikliği geri al veya güvenli hâle getir.

### Aşama 5 — Bütünlük kontrolü

Özellikle aşağıdaki işlevlerin kod düzeyinde hâlâ korunduğunu doğrula:

* namaz vakti alma
* Diyanet veri yolu
* Adhan fallback
* GPS akışı
* reverse geocode
* IlceID çözümleme
* yerel bildirim zamanlama
* erken hatırlatma
* exact alarm
* onboarding
* konum paneli
* tüm verileri sıfırlama
* diagnostics onayı
* diagnostics cutoff
* 30 dakikalık beacon
* background task registration
* konumsuz heartbeat
* internet ve 404 kill-switch ayrımı
* mevcut retry ve hata yakalama davranışı

Bu alanlarda beklenmeyen bir diff varsa görevi tamamlanmış sayma.

### Aşama 6 — Raporlama

Raporu çalışmanın zorunlu bir parçası kabul et.

Rapor için token bırakmadan bütün bütçeyi kod değişikliklerinde tüketme.

## NİHAİ RAPOR ZORUNLULUĞU

Görev sonunda tek ve kapsamlı bir rapor ver.

Rapor şu başlıkları içermelidir:

### 1. Yönetici özeti

* Ne yapıldı?
* Güvenlik seviyesi nasıl değişti?
* Uygulama davranışının korunup korunmadığı
* Build ve cihaz testi yapılmadığı için kesinleştirilemeyen noktalar

### 2. Başlangıç durumu

* Hermes durumu
* Babel production log durumu
* R8/ProGuard durumu
* resource shrinking durumu
* Supabase istemci yazma yolu
* RLS ve Edge Function durumu
* bulunan secret veya hassas log riskleri

### 3. Değiştirilen dosyalar

Her dosya için:

* dosya yolu,
* yapılan değişiklik,
* değişiklik gerekçesi,
* çalışma zamanı etkisi,
* risk seviyesi,
* rollback yöntemi.

### 4. Değiştirilmeyen kritik alanlar

Mevcut özelliklerin korunması için özellikle dokunulmayan dosya ve akışları belirt.

### 5. Çalıştırılan komutlar

Çalıştırılan bütün inceleme ve doğrulama komutlarını listele.

Git write, build veya deploy komutu çalıştırılmadığını açıkça belirt.

### 6. Kontrol sonuçları

Her kontrol için:

* komut,
* sonuç,
* başarılı veya başarısız durumu,
* başarısızsa nedeni,
* uygulanan düzeltme.

### 7. Diff denetimi

* Beklenen değişiklikler
* Beklenmeyen değişiklik bulunup bulunmadığı
* Lockfile değişimi
* Native dosya değişimi
* versionName/versionCode değişimi
* signing yapılandırması değişimi
* permission değişimi
* özellik veya işlev kaybı olup olmadığı

### 8. Android fiziksel cihaz test planı

En az şu senaryoları ver:

* temiz kurulum
* sürüm yükseltme
* cold start
* foreground
* background
* force-stop sonrası açılış
* ekran kapalıyken bildirim
* Android 13+ exact alarm
* GPS izni verilmiş
* GPS izni reddedilmiş
* geç GPS sonucu
* internet yok
* zayıf internet
* Wi-Fi ve mobil veri geçişi
* Diyanet API hatası
* Adhan fallback
* 30 dakikalık beacon
* konumsuz heartbeat
* Supabase 2xx
* Supabase 4xx
* Supabase 5xx
* kill-switch 404
* battery saver
* uygulama veri sıfırlama
* yeniden başlatma
* release logcat kontrolü

Her test için beklenen sonucu yaz.

### 9. Supabase deploy planı

* hazırlanmış function
* hazırlanmış migration
* gerekli secrets
* deploy sırası
* geçiş stratejisi
* rollback
* eski doğrudan insert yolunun ne zaman kaldırılacağı
* RLS doğrulama sorguları

Gerçek deploy yapılmadığını açıkça belirt.

### 10. Kalan riskler

Riskleri önem seviyesine göre sırala.

Teorik risklerle gerçek ve uygulanabilir riskleri ayır.

### 11. Devam işlemleri

Kullanıcının daha sonra çalıştırması gereken:

* build komutları,
* cihaz testleri,
* Supabase deploy komutları,
* doğrulama komutları

ayrı ayrı ver.

Bu komutları kendin çalıştırma.

### 12. Rollback

Her değişikliğin tek tek nasıl geri alınacağını yaz.

Git restore veya reset komutunu otomatik çalıştırma.

### 13. Commit mesajı

Yalnızca önerilen commit mesajını ver.

Commit oluşturma.

### 14. Zamanlayıcı durumu

Zamanlayıcı oluşturulduysa:

* kullanılan yöntem,
* çalışma zamanı,
* zaman dilimi,
* çalışan komut,
* log konumu,
* lock konumu,
* doğrulama sonucu,
* iptal komutu.

Zamanlayıcı oluşturulmadıysa neden oluşturulmadığını açıkça belirt.

## BAŞARI KRİTERİ

Görev ancak aşağıdaki şartların tamamı karşılanırsa başarılıdır:

* Mevcut özelliklerin hiçbiri kaldırılmamıştır.
* Kullanıcıya görünen davranış değiştirilmemiştir.
* Background ve notification akışları korunmuştur.
* Güvenlik değişiklikleri yalnızca hedeflenen kapsamda kalmıştır.
* Yapılan değişiklikler statik olarak doğrulanmıştır.
* Yarım veya doğrulanmamış değişiklik bırakılmamıştır.
* Build, deploy ve Git write yasağına uyulmuştur.
* Token bütçesi nihai raporu verecek şekilde yönetilmiştir.
* Nihai rapor eksiksiz hazırlanmıştır.

Görevi “bazı ayarları değiştirdim” seviyesinde ele alma.

Bu çalışma, üretimde çalışan mobil bir sistem üzerinde kontrollü güvenlik sağlamlaştırmasıdır.

Her kararını bu sorumluluğa uygun ver.
"

        echo "[INFO] Claude tamamlandı."
        exit 0
    fi

    sleep 5
done
