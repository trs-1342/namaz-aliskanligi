-- ════════════════════════════════════════════════════════════════════════════
--  app_remote_config — UYGULAMANIN VERİTABANINDAN YÖNETİLEN HER ŞEYİ
-- ════════════════════════════════════════════════════════════════════════════
--
-- Bu dosya `migrations/` DIŞINDADIR: şemayı değiştirmez, `supabase db push`
-- tarafından çalıştırılmaz. Panelin SQL editöründe elle kullanılacak referans.
--
-- TABLO AYRI: `app_remote_config`, tanılama tablosundan (`notification_location_
-- diagnostics`) tamamen bağımsızdır. Tanılama tablosu 11 Ağustos'ta (ya da
-- cutoff ne ise o tarihte) düşürülür; BU TABLO DÜŞÜRÜLMEZ — yoksa özelliği geri
-- açmanın veya pencereyi uzatmanın yolu kalmaz.
--
-- ERİŞİM: anon YALNIZ SELECT yapabilir. Yazma yalnız panel/service_role ile.
--
-- İSTEMCİ DAVRANIŞI (hepsi kasıtlı):
--   • Değerler en geç `config_poll_minutes` içinde cihaza iner. Uygulama öne
--     geldiğinde, ağ geri geldiğinde ve her arka plan uyanışında da tazelenir.
--   • Config çekilemezse (ağ yok / tablo yok) SON BİLİNEN değerler kullanılır;
--     hiç çekilememişse uygulamanın yerleşik varsayılanları geçerlidir.
--   • Config isteğinin hatası ASLA cihazı kapatmaz (kill-switch'e dokunmaz).
--   • Boolean alanlar `true/false` yanında `1/0` ve `'true'/'off'/'yes'` gibi
--     metinleri de kabul eder. Anlamsız değer varsayılanı korur.

-- ── MEVCUT DURUMU GÖR ───────────────────────────────────────────────────────
select * from public.app_remote_config where id = 1;


-- ════════════════════════════════════════════════════════════════════════════
--  1) ANA ŞALTERLER — "süre bitmese bile kapatmak istersek"
-- ════════════════════════════════════════════════════════════════════════════
--
-- diagnostics_enabled        boolean  varsayılan true
--   EN ÖNEMLİ ALAN. false yapıldığında:
--     • istemci hiçbir istek üretmez (ne beacon, ne bildirim yakalama, ne kuyruk),
--     • sunucu RLS'i anon insert'lerini REDDEDER (403) — yani güncellenmemiş
--       eski istemciler de yazamaz.
--   İki katmanlı olması bilinçli: tek başına istemciye güvenilmez.
--   Kesim tarihinden BAĞIMSIZDIR; süre dolmamışken de kapatır.
--
-- foreground_service_enabled boolean  varsayılan true
--   Kalıcı bildirimli ön plan servisi. Uygulama KAPALIYKEN ve internet yokken
--   kayıt üretebilen tek yol. false → servis durur, kalıcı bildirim kaybolur,
--   pil tüketimi düşer. Tekrar true yapılınca kullanıcının uygulamayı bir kez
--   açması gerekir (servis kendiliğinden geri gelmez).
--
-- background_task_enabled    boolean  varsayılan true
--   WorkManager yolu (yalnız ağ varken uyanır). Ön plan servisinden bağımsız
--   kapatılabilir. false → görev uyanır ama hiçbir şey yapmaz; İPTAL EDİLMEZ,
--   dolayısıyla true yapılınca kendiliğinden devam eder (uygulama açmak gerekmez).
--
-- notification_capture_enabled boolean varsayılan true
--   Namaz bildirimi tetiklendiğinde konum yakalama. VAKİT BİLDİRİMLERİNİN
--   KENDİSİNİ ETKİLEMEZ — yalnız tanılama kaydını durdurur.
--
-- show_diagnostics_panel     boolean  varsayılan FALSE
--   Ayarlar'daki teknik teşhis paneli (env/url/son deneme/"şimdi dene").
--   Sıradan kullanıcıya gösterilmez. Bir testçide sorun araştırırken açılır,
--   iş bitince kapatılır. Config okunamazsa panel GİZLİ kalır (güvenli yön).
--
-- collect_location           boolean  varsayılan true
--   false → koordinat HİÇ toplanmaz (taze ölçüm de, kayıtlı koordinat da
--   kullanılmaz); yalnız "hayatta" kaydı gider ve nedeni
--   `no_location_reason = 'location_disabled_remotely'` olur. Gizlilik
--   şikâyetinde konum toplamayı durdurup sinyal akışını korumanın yolu.

-- her şeyi durdur:
--   update public.app_remote_config set diagnostics_enabled = false where id = 1;
-- pil şikâyeti: kalıcı bildirimi kaldır, WorkManager'la devam et:
--   update public.app_remote_config set foreground_service_enabled = false where id = 1;
-- konum toplamayı durdur, "hayatta" sinyali sürsün:
--   update public.app_remote_config set collect_location = false where id = 1;


-- ════════════════════════════════════════════════════════════════════════════
--  2) TEST PENCERESİ — tek otorite burasıdır
-- ════════════════════════════════════════════════════════════════════════════
--
-- diagnostics_cutoff  timestamptz  varsayılan 2026-08-11 00:00+03
--   Bu alan ÜÇ yeri birden sürer:
--     • istemcinin pencere kontrolü,
--     • tablonun RLS insert policy'si (public.diagnostics_cutoff()),
--     • tabloyu düşüren günlük pg_cron job'ı.
--   Üst sınır YOKTUR ve istemci değeri KIRPMAZ: ne yazarsanız o uygulanır.
--   Kod tarafındaki tarih yalnız "hiç config çekememiş cihaz" için önyükleme
--   değeridir; bir kez çekildikten sonra bir daha kullanılmaz.

-- testi uzat (build gerekmez, migration gerekmez):
--   update public.app_remote_config
--      set diagnostics_cutoff = timestamptz '2026-09-30 00:00:00+03',
--          config_notes = 'kapalı test 2. faza uzatıldı'
--    where id = 1;
-- testi hemen bitir:
--   update public.app_remote_config set diagnostics_cutoff = now() where id = 1;

select public.diagnostics_cutoff() as yururlukteki_kesim,
       public.diagnostics_enabled() as ana_salter;


-- ════════════════════════════════════════════════════════════════════════════
--  3) ZAMANLAMA
-- ════════════════════════════════════════════════════════════════════════════
--
-- beacon_interval_minutes   smallint  varsayılan 15   (15..720)
--   Kayıt aralığı. Kova genişliği, ön plan servisinin ölçüm aralığı ve
--   WorkManager uyanma periyodu (bunun yarısı, en az 15) bundan türer.
--   Alt sınır 15: WorkManager daha küçüğünü kabul etmez.
--
-- foreground_timer_minutes  smallint  varsayılan 5    (1..60)
--   Uygulama AÇIKKEN yapılan periyodik deneme. Kadanstan küçük olmalı.
--
-- config_poll_minutes       smallint  varsayılan 60   (5..1440)
--   Config'in yeniden çekilme sıklığı. Küçültmek ayarların cihazlara daha hızlı
--   yayılmasını sağlar; test sırasında 5-15 arası pratiktir.

-- ════════════════════════════════════════════════════════════════════════════
--  4) AĞ / KUYRUK
-- ════════════════════════════════════════════════════════════════════════════
--
-- request_timeout_ms     integer   varsayılan 12000  (2000..60000)
-- max_uploads_per_flush  smallint  varsayılan 12     (1..24)
--   Tek kuyruk boşaltmada gönderilecek azami kayıt. AŞAĞIDAKİ saatlik kotanın
--   ALTINDA tutun; aşarsa P0001 üretir (kayıp değil, sadece gecikme).
-- max_outbox_entries     smallint  varsayılan 48     (12..500)
--   Çevrimdışıyken saklanacak azami kayıt. 15 dk kadansında 48 ≈ 12 saat.

-- ════════════════════════════════════════════════════════════════════════════
--  5) KONUM
-- ════════════════════════════════════════════════════════════════════════════
--
-- location_accuracy  text  varsayılan 'balanced'
--   'lowest' | 'low' | 'balanced' | 'high' | 'highest'
--   Hem ön plan servisinin hem tek seferlik ölçümün doğruluğu. 'low' pili
--   belirgin biçimde korur, 'high' GPS'i zorlar. Değişiklik ön plan servisini
--   yeniden başlatır (istemci ayar imzasını takip eder).

-- ════════════════════════════════════════════════════════════════════════════
--  6) SUNUCU KAPASİTE / HIZ SINIRLARI
-- ════════════════════════════════════════════════════════════════════════════
--
-- max_rows_total               integer   varsayılan 20000
--   Tablodaki toplam satır tavanı. 15 dk kadansında bir testçi günde ~96 satır
--   üretir; 5 testçi ≈ 480/gün. Aşılınca insert P0001 ile reddedilir.
-- max_rows_per_install_hourly  smallint  varsayılan 40
--   Kurulum başına saatlik tavan. Kadans 4/saat üretir; kalanı kuyruk
--   boşaltmalarına pay bırakır.
--
-- Bu ikisini trigger okur; değiştirmek için migration GEREKMEZ.
-- P0001, istemcide "geçici" sayılır (duraklatmaya yol açmaz).

select count(*) as toplam_satir,
       (select max_rows_total from public.app_remote_config where id = 1) as tavan
  from public.notification_location_diagnostics;


-- ════════════════════════════════════════════════════════════════════════════
--  7) KILL-SWITCH HASSASİYETİ VE UZAKTAN DİRİLTME
-- ════════════════════════════════════════════════════════════════════════════
--
-- pause_hours                       smallint varsayılan 6   (1..168)
--   Doğrulanmış "sunucuda düzeltilebilir" hata sonrası duraklatma süresi.
--   Sunucuyu düzelttikten sonra cihazların hızlı dönmesi için 1 yapılabilir.
--
-- permanent_signal_threshold        smallint varsayılan 3   (1..20)
-- permanent_signal_spacing_minutes  smallint varsayılan 3   (1..120)
--   Kaç adet ve ne kadar aralıklı kalıcı sunucu sinyali kill-switch'i tetiklesin.
--   Şema geçişi sırasında geçici hata bekliyorsanız eşiği yükseltin.
--
-- kill_switch_reset_token  text  varsayılan NULL
--   ★ EN GÜÇLÜ MÜDAHALE. Bu alanın DEĞERİ DEĞİŞTİĞİNDE, cihazlar yerel
--   kapatma/duraklatma kayıtlarını siler ve yeniden denemeye başlar — kapatma
--   gerekçesi ne olursa olsun (404/PGRST205 dahil). İçeriği önemli değildir,
--   ÖNEMLİ OLAN DEĞİŞMESİDİR.
--   Neden gerekli: 2026-08-04'te APK'ya geçersiz anahtar gömülünce sahadaki
--   cihazlar 401 alıp kendilerini kapattı ve yeni sürüm kurulsa bile ölü
--   kalıyorlardı. Artık tek satırlık bir update yetiyor.
--   SINIR: kendini KALICI kapatmış cihazda arka plan görevi de iptal olduğu
--   için diriltme, kullanıcı uygulamayı açtığında gerçekleşir. Yalnız
--   DURAKLATILMIŞ cihazlar arka planda da dirilir.

-- kendini kapatmış cihazları dirilt:
--   update public.app_remote_config
--      set kill_switch_reset_token = 'reset-' || now()::text where id = 1;


-- ════════════════════════════════════════════════════════════════════════════
--  8) KULLANICIYA GÖRÜNEN METİN
-- ════════════════════════════════════════════════════════════════════════════
--
-- foreground_service_title  text  NULL → uygulamanın kendi çevirisi
-- foreground_service_body   text  NULL → uygulamanın kendi çevirisi
--   Kalıcı bildirimin metni. Testçilere gösterilen ifadeyi uygulama
--   güncellemesi olmadan değiştirmeyi sağlar. Alanı boşaltmak (NULL veya boş
--   metin) "varsayılana dön" demektir. Değişiklik servisi yeniden başlatır.

--   update public.app_remote_config
--      set foreground_service_title = 'Kapalı test — konum tanılama',
--          foreground_service_body  = 'Test 30 Eylül''e kadar sürecek.'
--    where id = 1;


-- ════════════════════════════════════════════════════════════════════════════
--  9) GENİŞLETİLEBİLİRLİK — migration yazmadan yeni anahtar
-- ════════════════════════════════════════════════════════════════════════════
--
-- extras  jsonb  varsayılan '{}'
--   Serbest anahtar/değer alanı. İstemcide `getRemoteConfigExtra(anahtar,
--   varsayılan)` ile sayı/boolean/metin olarak okunur.
--   SINIR (dürüst olmak gerekirse): YEPYENİ bir davranış yine istemci kodu
--   gerektirir. Bu alanın kazandırdığı şey, okuyucusu zaten uygulamada bulunan
--   bir anahtarı migration YAZMADAN eklemek/değiştirmektir. Kalıcı hale gelen
--   bir anahtar sonradan kendi sütununa taşınmalıdır.
--
-- config_notes  text  "bu değeri neden değiştirdim" notu (yalnız panelde okunur)

--   update public.app_remote_config
--      set extras = extras || '{"ornek_esik": 42}'::jsonb where id = 1;
--   -- tek anahtar sil:
--   update public.app_remote_config set extras = extras - 'ornek_esik' where id = 1;


-- ════════════════════════════════════════════════════════════════════════════
--  10) DEĞİŞİKLİK SONRASI DOĞRULAMA
-- ════════════════════════════════════════════════════════════════════════════
-- `updated_at` her update'te trigger ile tazelenir.
select updated_at, config_notes from public.app_remote_config where id = 1;

-- Cihaza indi mi? Uygulamada Ayarlar → teşhis panelindeki "config ✓" satırı ve
-- "config çekildi" zamanı bunu gösterir; "▶ şimdi dene" düğmesi config'i zorla
-- tazeler. Cihaz beklemeden görsün istiyorsanız config_poll_minutes'ı düşürün.

-- Kayıtlar geliyor mu ve arka plandan mı geliyor? → verify_beacon_coverage.sql
select beacon_source, count(*), max(created_at) as son
  from public.notification_location_diagnostics
 where created_at > now() - interval '6 hours'
 group by 1 order by 2 desc;
