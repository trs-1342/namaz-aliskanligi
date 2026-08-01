# Proje Analiz Raporu

> **Remediation güncellemesi — 1 Ağustos 2026:** Bu rapordaki 16 bulgunun kaynak/config düzeltmeleri tamamlandı. Güncel kapanış durumu için `PROJECT_REMEDIATION_TODO.md`, uygulama kanıtları için `CODEX_WORK_REPORT.md` ve yardımcı mühendis çıktısı için `CLAUDE_CODE_WORK_REPORT.md` esas alınmalıdır. Aşağıdaki skor ve “Production: Hayır” yargısı düzeltme öncesi snapshot'tır.

**Skor formülü:** Genel sağlık = `Güvenlik×0,35 + Hata/Bug×0,25 + Mimari×0,15 + Performans×0,10 + Kod Kalitesi×0,10 + Test×0,05`; bulgu risk skoru = `Etki (1–5) × Olasılık (1–5)` ve `≥15` Acil kabul edilmiştir.

## 0. Meta Bilgi

- **Analiz tarihi:** 1 Ağustos 2026 (Europe/Istanbul)
- **Branch / commit:** `master` / `a1ddb3f8714e5f03182656d880a6fb745b345e91`
- **Çalışma ağacı:** Commitlenmemiş değişiklikler içeriyor; analiz commit snapshot'ı yerine mevcut çalışma ağacını esas almıştır. Başlangıçta değişmiş görünen dosyalar: `App.tsx`, `android/app/build.gradle`, `app.json`, `src/services/backup.ts`, `src/services/backupFormat.test.ts`, `src/services/backupFormat.ts`, `src/services/diyanetTimes.ts`, `src/styles/appStyles.ts`, `src/tracking/TrackingScreen.tsx`.
- **Taranan kaynak/metin dosyası:** 46 tracked dosya, 16.688 satır.
- **Dil/framework dağılımı:** TypeScript 11 dosya/1.871 satır; TSX (React Native) 2/4.301; JavaScript (Metro + Expo config plugin) 2/427; Kotlin 2/117; Gradle/Groovy 3/245; Android XML 11/136; JSON 5/9.148 (8.989 satırı lockfile); HTML 2/169; Markdown 2/69; diğer build/config metinleri 6/205. Ana yığın Expo SDK 54, React Native 0.81.5, React 19.1 ve TypeScript strict mode'dur.
- **Doğrulamalar:** `npx tsc --noEmit` başarılı; `node --experimental-strip-types src/services/backupFormat.test.ts` sonucu 33/33 başarılı; `npm audit --json` sonucu 20 advisory (2 critical, 5 high, 12 moderate, 1 low); `npx expo install --check` yerel Expo eşleme tablosuna göre başarılı fakat ağ kapalı olduğundan kendi ifadesiyle güvenilir değil.
- **Kapsam dışı:** Binary APK/AAB/JAR/keystore, PNG/WebP/MP3 içerikleri, `node_modules`, `.expo`, Gradle/CMake cache ve generated build çıktıları satır bazlı incelenmedi; tersine mühendislik, gerçek cihaz alarm/izin davranışı, iOS build, Google Play/App Store politikası ve backend/API penetration testi yapılmadı. Paketlerin son sürümleri resmi npm registry'den 1 Ağustos 2026 tarihinde sorgulandı.

## 1. Yönetici Özeti (Executive Summary)

| Boyut | Sağlık skoru | Ağırlık | Katkı |
|---|---:|---:|---:|
| Güvenlik | 45 | %35 | 15,75 |
| Hata/Bug | 55 | %25 | 13,75 |
| Mimari | 58 | %15 | 8,70 |
| Performans | 75 | %10 | 7,50 |
| Kod Kalitesi | 62 | %10 | 6,20 |
| Test | 35 | %5 | 1,75 |
| **Genel sağlık** | **54/100** | **%100** | **53,65 → 54** |

Kategori puanları, kanıtlanmış bulguların etki/olasılık dağılımı, koruyucu kontroller ve doğrulama kapsamı birlikte değerlendirilerek verilmiştir; ağırlıklı toplam yukarıdaki formülle mekanik olarak hesaplanmıştır.

**En kritik üç bulgu:**

1. **SEC-01:** Release artefact debug anahtarıyla imzalanıyor; dağıtım başlamadan düzeltilmezse güvenilir update zinciri baştan zayıf kurulacaktır.
2. **BUG-01:** Alan bazında doğrulanmayan yedek kalıcı state'e yazılabiliyor; kullanıcı bugün tek bir bozuk dosya seçerek uygulamayı sonraki açılışlarda loader'da kilitleyebilir.
3. **DEP-01:** Mevcut lockfile 2 critical ve 5 high advisory taşıyor; build/CI girdileri güvenilmeyen içerik işlediğinde bilinen açıklar bugün tetiklenebilir durumdadır.

**Production yargısı: HAYIR.** Typecheck ve mevcut 33 yedek-format testi olumlu olsa da SEC-01 ve BUG-01 release blocker'dır; DEP-01 çözümlenmeden supply-chain/build güveni yeterli değildir. En az Faz 1 tamamlanıp release imza, kötü amaçlı yedek, notification scheduling ve gerçek cihaz smoke test kanıtları alınmadan production dağıtımı önerilmez.

## 2. Risk Matrisi (Etki × Olasılık)

Bu tablo tüm Kritik/Yüksek öncelikli bulguları içerir.

| Bulgu ID | Etki (1-5) | Olasılık (1-5) | Risk Skoru (Etki×Olasılık) | Kategori |
|---|---:|---:|---:|---|
| SEC-01 | 5 | 4 | 20 | Güvenlik |
| BUG-01 | 5 | 4 | 20 | Hata/Bug |
| DEP-01 | 5 | 3 | 15 | Bağımlılıklar |
| SEC-02 | 4 | 3 | 12 | Güvenlik |
| BUG-02 | 4 | 3 | 12 | Hata/Bug |
| BUG-03 | 4 | 3 | 12 | Hata/Bug |
| TEST-01 | 4 | 3 | 12 | Test |
| TODO-01 | 4 | 3 | 12 | Yarım İşler |

**Acil:** SEC-01, BUG-01, DEP-01.

## 3. Bulgular Envanteri (Tam Liste)

| ID | Öncelik | Kategori | Dosya:Satır | Sorun (1 cümle) | Risk Skoru |
|---|---|---|---|---|---:|
| SEC-01 | Kritik | Güvenlik | `android/app/build.gradle:100` | Release build, depoda bulunan ve parolası bilinen debug keystore ile imzalanıyor. | 20 |
| BUG-01 | Kritik | Hata/Bug | `src/services/backupFormat.ts:64` | Yedek yalnızca üst düzey birkaç alanla doğrulanıp kalıcı state'e yazıldığı için yanlış iç tipler açılışta kalıcı crash/loader döngüsü yaratabiliyor. | 20 |
| DEP-01 | Yüksek | Bağımlılıklar | `package-lock.json:1` | Lockfile üzerinde `npm audit` 2 critical, 5 high, 12 moderate ve 1 low advisory raporluyor. | 15 |
| SEC-02 | Yüksek | Güvenlik | `android/app/src/main/AndroidManifest.xml:35` | Android Auto Backup açıkken kesin konum ve ibadet takip verisi AsyncStorage'dan cihaz dışı yedeğe çıkabilir. | 12 |
| BUG-02 | Yüksek | Hata/Bug | `App.tsx:639` | AsyncStorage için eşzamanlı read-modify-write çağrıları atomik olmadığından son yazan eski snapshot yeni ayarları kaybedebilir. | 12 |
| BUG-03 | Yüksek | Hata/Bug | `App.tsx:1328` | Takip hatırlatması yalnızca planlama gününe bir kez kuruluyor; 30 günlük namaz bildirimlerine karşı sonraki günlerin takip hatırlatmaları yok. | 12 |
| TEST-01 | Yüksek | Test | `package.json:6` | `test`, `typecheck` ve CI quality gate yok; alarm, tarih geçişi, storage race ve native release akışları otomatik test edilmiyor. | 12 |
| TODO-01 | Yüksek | Yarım İşler | `app.json:43` | Kilit ekranı/full-screen alarm için yazılan config plugin kayıtlı değil ve üreteceği native modül mevcut Android kaynaklarında yok. | 12 |
| ARCH-01 | Orta | Mimari | `App.tsx:685` | 3.000 satırlık root component state, persistence, izin, alarm scheduling, import ve üç ekranı tek yaşam döngüsünde topluyor. | 9 |
| BUG-04 | Orta | Hata/Bug | `src/utils/time.ts:23` | Kalan süre hesabı saniye sıfır değilken dakika farkını bir dakika fazla gösteriyor. | 6 |
| BUG-05 | Orta | Hata/Bug | `src/tracking/TrackingScreen.tsx:257` | `today` yalnızca mount anında hesaplandığından ekran gece yarısını açık geçirirse günlük/haftalık/aylık sınırlar eski günde kalıyor. | 6 |
| SEC-03 | Orta | Güvenlik | `App.tsx:672` | Error boundary production arayüzünde ham hata mesajı ve stack trace göstererek iç dosya/component bilgisini açığa çıkarıyor. | 6 |
| QUAL-01 | Orta | Kod Kalitesi | `src/tracking/storage.ts:15` | Çok sayıda boş `catch` persistence ve notification hatalarını görünmez veri kaybına dönüştürüyor. | 6 |
| PERF-01 | Düşük | Performans | `App.tsx:755` | Saniyelik root `clock` güncellemesi settings/tracking görünümünde dahi tüm `App` ağacını yeniden render ediyor. | 4 |
| QUAL-02 | Düşük | Kod Kalitesi | `releases/namaz-aliskanligi-v1.0.4.apk` | 75 MB APK tracked olduğu için Git pack yaklaşık 40,89 MiB gereksiz binary geçmiş taşıyor. | 4 |
| CFG-01 | Düşük | Config | `package.json:3` | NPM paket sürümü 1.1.1 iken Expo/Android uygulama sürümü 1.3.8; tek release version kaynağı yok. | 3 |

## 4. Derinlemesine Analiz — Acil/Kritik Bulgular

### SEC-01 — Release build debug anahtarıyla imzalanıyor

- **Konum:** `android/app/build.gradle:100`
- **Mevcut kod:**

```groovy
signingConfigs {
    debug {
        storeFile file('debug.keystore')
        storePassword 'android'
        keyAlias 'androiddebugkey'
        keyPassword 'android'
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.debug
    }
}
```

- **Neden risk:** Android update kabulü paket adı kadar imza sertifikası eşleşmesine de bağlıdır. Debug keystore ve parolaları standart/bilinen değerlerdir ve keystore ayrıca repoda tracked'dır; doğrudan dağıtılan APK bu anahtarla imzalanırsa aynı package name ile sahte artefact üretme bariyeri ortadan kalkar. Google Play App Signing yeniden imzalama yapıyorsa son kullanıcı anahtarı korunabilir, ancak debug anahtarını upload key yapmak yine release zincirini ve kurtarma sürecini zayıflatır.
- **Olası senaryo:** Kullanıcı APK'yı web sitesinden/sideload kanalından kurar; saldırgan repodaki debug anahtarıyla zararlı aynı-package APK üretip resmi güncelleme gibi dağıtır ve Android imza eşleştiği için kurulum kabul edilir.
- **Önerilen çözüm:**

```diff
 signingConfigs {
     debug {
         storeFile file('debug.keystore')
         storePassword 'android'
         keyAlias 'androiddebugkey'
         keyPassword 'android'
     }
+    release {
+        storeFile file(System.getenv('NAMAZ_RELEASE_STORE_FILE'))
+        storePassword System.getenv('NAMAZ_RELEASE_STORE_PASSWORD')
+        keyAlias System.getenv('NAMAZ_RELEASE_KEY_ALIAS')
+        keyPassword System.getenv('NAMAZ_RELEASE_KEY_PASSWORD')
+    }
 }
 buildTypes {
     release {
-        signingConfig signingConfigs.debug
+        signingConfig signingConfigs.release
     }
 }
```

Keystore ve dört secret repo dışında CI/EAS credential store'da tutulmalı; release görevi değişkenler yoksa fail-fast etmelidir.
- **Doğrulama adımı:** `cd android && ./gradlew clean assembleRelease && apksigner verify --verbose --print-certs app/build/outputs/apk/release/app-release.apk`; certificate SHA-256 değerinin güvenli kayıtlı production fingerprint ile aynı, `keytool -list -v -keystore android/app/debug.keystore` çıktısından farklı olduğunu CI assertion ile kanıtla.
- **Efor tahmini:** M (2–8 saat)

### BUG-01 — Doğrulanmayan yedek kalıcı açılış kilidi yaratabiliyor

- **Konum:** `src/services/backupFormat.ts:64`, `src/services/backup.ts:45`, `App.tsx:786`
- **Mevcut kod:**

```ts
if (!data || data.magic !== BACKUP_MAGIC || typeof data.schema !== 'number') {
  throw new BackupError('invalid');
}
if (data.appState != null && typeof data.appState !== 'object') {
  throw new BackupError('invalid');
}
// ...
await AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify(data.appState));
```

- **Neden risk:** JavaScript'te array ve birçok yanlış yapı `typeof value === 'object'` kontrolünü geçer. `cachedPrayerDays`, `snoozedUntilByKey`, `coords`, `prayerPrefs` ve tracking içeriği doğrulanmıyor. Örneğin `cachedPrayerDays: {}` depoya yazıldıktan sonra `getTodayFromCache(nextCache)` içindeki `.find` çağrısı hata verir; hydration promise'inde recovery/catch bulunmadığı için `setHydrated(true)` çalışmaz ve sonraki açılışlar loader'da kalır.
- **Olası senaryo:** Kullanıcı mesajla gelen, magic/schema alanları doğru fakat `appState.cachedPrayerDays={}` içeren JSON'u import eder; restore başarıyla mevcut veriyi ezer, `applyStored` throw eder ve uygulama her yeniden açılışta aynı bozuk state'i okuyup takılır.
- **Önerilen çözüm:** Alan bazında strict schema doğrulaması ekle, daha yeni schema'yı yalnızca uyarma yerine reddet ve doğrulanmış değeri restore et:

```diff
+import { z } from 'zod';
+
+const PrayerSchema = z.object({
+  key: z.string(), name: z.string(), time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
+  notification: z.boolean(), vibration: z.boolean(), alarm: z.boolean(),
+});
+const StoredStateSchema = z.object({
+  language: z.enum(['tr', 'en', 'ar']).optional(),
+  coords: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable().optional(),
+  cachedPrayerDays: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), prayers: z.array(PrayerSchema) })).optional(),
+  snoozedUntilByKey: z.record(z.string(), z.number().finite()).optional(),
+}).passthrough();
+const TrackingSchema = z.array(z.object({
+  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
+  statuses: z.record(z.string(), z.enum(['onTime', 'late', 'missed']).nullable()),
+}));

-if (!data || data.magic !== BACKUP_MAGIC || typeof data.schema !== 'number') {
+if (!data || data.magic !== BACKUP_MAGIC || data.schema !== BACKUP_SCHEMA) {
   throw new BackupError('invalid');
 }
-if (data.appState != null && typeof data.appState !== 'object') {
-  throw new BackupError('invalid');
-}
+const stateResult = data.appState == null ? { success: true, data: null } : StoredStateSchema.safeParse(data.appState);
+const trackingResult = TrackingSchema.safeParse(data.tracking ?? []);
+if (!stateResult.success || !trackingResult.success) throw new BackupError('invalid');
 return {
   ...data,
-  appState: data.appState ?? null,
-  tracking: Array.isArray(data.tracking) ? data.tracking : [],
+  appState: stateResult.data,
+  tracking: trackingResult.data,
 };
```

Ayrıca restore öncesi mevcut iki AsyncStorage değeri geçici snapshot olarak tutulmalı ve import/reapply başarısızsa rollback yapılmalıdır.
- **Doğrulama adımı:** `node --experimental-strip-types src/services/backupFormat.test.ts` testlerine `{cachedPrayerDays:{}}`, array `appState`, geçersiz koordinat, bozuk prayer, bozuk tracking ve `schema: BACKUP_SCHEMA+1` fixture'ları ekle; her birinin `BackupError('invalid')` verdiğini, ardından Detox/E2E ile bozuk import sonrası uygulamanın yeniden açılıp eski state'i koruduğunu doğrula.
- **Efor tahmini:** M (2–8 saat)

### DEP-01 — Lockfile critical/high advisory içeriyor

- **Konum:** `package-lock.json:1`
- **Mevcut kod:**

```json
"expo": "~54.0.35",
"react-native": "0.81.5",
"@babel/core": "^7.25.2",
"@expo/ngrok": "^4.1.3"
```

- **Neden risk:** `npm audit` lock çözümünde `shell-quote` ve `tar` için critical; `brace-expansion`, `js-yaml`, `postcss`, `undici` ve `ws` için high advisory buldu. Bunlar çoğunlukla build/dev zincirinde transitiftir; yine de Metro/Expo/CI'nin güvenilmeyen source map, CSS, archive, WebSocket veya komut girdisi işlemesi bilgi sızıntısı, command injection ya da DoS mekanizmasına erişebilir. Risk mobil runtime'dan çok geliştirici ve release pipeline'ındadır.
- **Olası senaryo:** CI, pull request'ten gelen crafted source map/CSS veya archive'ı eski Expo toolchain ile işler; vulnerable parser yerel dosya okur, aşırı CPU/RAM tüketir ya da build agent üzerinde komut bağlamını bozar.
- **Önerilen çözüm:** Expo modüllerini tek tek rastgele yükseltmek yerine SDK 57 uyumlu seti migration branch'inde birlikte yükselt:

```diff
-"expo": "~54.0.35",
-"expo-asset": "~12.0.8",
-"expo-notifications": "~0.32.17",
-"react": "19.1.0",
-"react-native": "0.81.5",
-"@babel/core": "^7.25.2",
+"expo": "~57.0.9",
+"expo-asset": "~57.0.8",
+"expo-notifications": "~57.0.8",
+"react": "19.2.3",
+"react-native": "0.86.2",
+"@babel/core": "^7.29.7",
```

Kalan Expo paketleri Bölüm 7'deki SDK 57 satırlarıyla `npx expo install --fix` üzerinden hizalanmalı; major Babel/React Native uyumluluğu Expo migration rehberine göre test edilmeli, kör `overrides` uygulanmamalıdır.
- **Doğrulama adımı:** Temiz checkout'ta `npm ci && npm audit --audit-level=high && npx expo install --check && npx tsc --noEmit`; ardından Android release ve iOS archive build, gerçek cihazda notification/location/audio/backup smoke suite. Kabul kriteri: 0 critical/high veya her kalan advisory için belgelenmiş, süreli risk kabulü.
- **Efor tahmini:** L (>8 saat)

## 5. Etki × Efor Matrisi (Aksiyon Önceliklendirme)

Efor sınırı: düşük=S (`<2h`), yüksek=M/L (`≥2h`); yüksek etki, Etki puanı 4–5 olarak alınmıştır.

| | Düşük Efor | Yüksek Efor |
|---|---|---|
| **Yüksek Etki** | → **HEMEN YAP:** SEC-02 | → **PLANLA:** SEC-01, BUG-01, DEP-01, BUG-02, BUG-03, TEST-01, TODO-01 |
| **Düşük Etki** | → **BOŞ ZAMANDA:** BUG-04, BUG-05, SEC-03, PERF-01, QUAL-02, CFG-01 | → **ERTELE/YOK SAY:** ARCH-01, QUAL-01 |

## 6. Kategori Bazlı Özet Tablolar

| Kategori | Bulgu sayısı | En ciddi bulgu | Sağlık durumu |
|---|---:|---|---|
| Mimari | 1 | ARCH-01 | 🟡 Dikkat |
| Hata | 5 | BUG-01 | 🔴 Kritik |
| Güvenlik | 3 | SEC-01 | 🔴 Kritik |
| Performans | 1 | PERF-01 | 🟡 Dikkat |
| Kod Kalitesi | 2 | QUAL-01 | 🟡 Dikkat |
| Test | 1 | TEST-01 | 🔴 Kritik |
| Yarım İşler | 1 | TODO-01 | 🔴 Kritik |
| Config | 1 | CFG-01 | 🟡 Dikkat |
| Bağımlılıklar | 1 | DEP-01 | 🔴 Kritik |

## 7. Bağımlılık Risk Raporu

“Mevcut” sütunu lockfile/`npm ls`, “Son” sütunu 1 Ağustos 2026 resmi npm registry `latest` etiketi; CVE/advisory sütunu aynı tarihteki `npm audit` sonucudur. `Bulgu yok`, güvenlik garantisi değil, bu audit'te advisory eşleşmediği anlamına gelir. Expo managed paketleri SDK ile birlikte yükseltilmelidir.

| Paket | Mevcut Versiyon | Son Versiyon | Bilinen CVE/advisory | Aksiyon |
|---|---:|---:|---|---|
| `@expo-google-fonts/inter` | 0.4.2 | 0.4.2 | Bulgu yok | Tut |
| `@expo-google-fonts/noto-serif` | 0.4.2 | 0.4.2 | Bulgu yok | Tut |
| `@expo-google-fonts/space-grotesk` | 0.2.3 | 0.4.1 | Bulgu yok | Expo uyumluluğunu test ederek yükselt |
| `@expo/vector-icons` | 15.1.1 | 15.1.1 | Bulgu yok | Tut |
| `@react-native-async-storage/async-storage` | 2.2.0 | 3.1.1 | Bulgu yok | RN/Expo migration ile yükselt |
| `@react-native-community/netinfo` | 11.4.1 | 12.0.1 | Bulgu yok | Major değişiklikleri test et |
| `adhan` | 4.4.3 | 4.4.4 | Bulgu yok | Patch yükselt |
| `expo` | 54.0.35 | 57.0.9 | Moderate transitif zincir | SDK 57 migration planı |
| `expo-asset` | 12.0.13 | 57.0.8 | Moderate transitif zincir | SDK 57 ile hizala |
| `expo-audio` | 1.1.1 | 57.0.3 | Bulgu yok | SDK 57 ile hizala |
| `expo-document-picker` | 14.0.8 | 57.0.1 | Bulgu yok | SDK 57 ile hizala |
| `expo-file-system` | 19.0.23 | 57.0.1 | Bulgu yok | SDK 57 ile hizala; File API regression testi |
| `expo-font` | 14.0.12 | 57.0.1 | Bulgu yok | SDK 57 ile hizala |
| `expo-location` | 19.0.8 | 57.0.7 | Bulgu yok | SDK 57 ile hizala; izin testi |
| `expo-notifications` | 0.32.17 | 57.0.8 | Moderate transitif zincir | SDK 57 ile hizala; gerçek cihaz alarm testi |
| `expo-sharing` | 14.0.8 | 57.0.8 | Bulgu yok | SDK 57 ile hizala |
| `expo-status-bar` | 3.0.9 | 57.0.1 | Bulgu yok | SDK 57 ile hizala |
| `react` | 19.1.0 | 19.2.8 | Bulgu yok | Expo'nun önerdiği 19.2.3 ile hizala |
| `react-native` | 0.81.5 | 0.86.2 | High transitif (`brace-expansion`, `js-yaml`, `shell-quote`, `ws`) | Expo migration ile yükselt |
| `react-native-safe-area-context` | 5.6.2 | 5.8.0 | Bulgu yok | Minor yükselt/test |
| `@babel/core` | 7.29.0 | 8.0.1 | Low, GHSA-4x5r-pxfx-6jf8 | Expo uyumunu koruyarak güvenli 7.29.7 patch'ine yükselt; Babel 8'i ayrıca planla |
| `@expo/ngrok` | 4.1.3 | 4.1.3 | Moderate transitif `uuid` | Production deps'ten ayrı tut; tunnel gerekmiyorsa kaldır |
| `@types/react` | 19.1.17 | 19.2.18 | Bulgu yok | React ile hizala |
| `typescript` | 5.9.3 | 7.0.2 | Bulgu yok | Expo destek matrisi gelmeden major yükseltme yapma |
| `shell-quote` (transitif) | 1.8.3 | 1.10.0 | Critical/High: GHSA-w7jw-789q-3m8p, GHSA-395f-4hp3-45gv | Üst paket/RN üzerinden düzelt |
| `tar` (transitif) | 7.5.16 | 7.5.22 | Critical/High/Moderate | Expo CLI üzerinden ≥7.5.22'ye getir |
| `brace-expansion` (transitif) | 1.1.14/2.1.1/5.0.5 | 5.0.9 | High/Moderate DoS | Üst paketleri yükselt; çoklu major için kör override yapma |
| `js-yaml` (transitif) | 3.14.2/4.2.0 | 5.2.3 | High/Moderate DoS | Üst paketleri yükselt |
| `postcss` (transitif) | 8.4.49 | 8.5.25 | High/Moderate file read/XSS | Expo Metro config üzerinden ≥8.5.18'e getir |
| `undici` (transitif) | 6.26.0 | 8.9.0 | High/Moderate/Low | Expo CLI üzerinden güvenli 6.x+ patch'e getir |
| `ws` (transitif) | 6.2.3/7.5.10/8.21.0 | 8.21.1 | High DoS (eski 6.x/7.x) | Üst paketleri yükselt |
| `uuid` (transitif) | 3.4.0/7.0.3 | 14.0.1 | Moderate | `@expo/ngrok`/`xcode` üst paketleri üzerinden düzelt |

## 8. Önerilen Aksiyon Yol Haritası (Sıralı)

- **Faz 1 (Bugün–Bu Hafta):** SEC-01, BUG-01, SEC-02, BUG-02, BUG-03, TEST-01 — önce update/data güvenliği ve günlük notification doğruluğu; ardından bu davranışları kilitleyen otomatik quality gate.
- **Faz 2 (Bu Ay):** DEP-01, TODO-01, ARCH-01, QUAL-01 — SDK migration ve native alarm hattı gerçek cihaz matrisiyle birlikte; ayrıştırma observability eklenerek yapılmalı.
- **Faz 3 (Backlog):** BUG-04, BUG-05, SEC-03, PERF-01, QUAL-02, CFG-01 — düşük riskli doğruluk, bilgi ifşası, render maliyeti ve repo/release hijyeni.

## 9. Kapsam Dışı / Manuel İnceleme Gereken Alanlar

- **Alarm güvenilirliği:** OEM battery optimization, Doze, exact-alarm izni, Android 12–16 full-screen intent kısıtları ve iOS 64 notification limiti statik analizle kanıtlanamaz; en az Samsung/Xiaomi/Pixel ve desteklenen iPhone sürümlerinde ekran kilitli, uygulama killed ve reboot sonrası manuel test edilmelidir.
- **Store politikası:** `USE_EXACT_ALARM`, `SCHEDULE_EXACT_ALARM`, foreground-service ve full-screen intent kullanımının 2026 Google Play/App Store kurallarına uygunluğu hukuk/policy sahibi tarafından kontrol edilmelidir; bu konuda kesin karar veremiyorum.
- **İmza altyapısı:** Google Play App Signing/EAS credentials gerçek durumu repoda görünmüyor; mevcut yayın sertifikası fingerprint'i, upload key rotasyonu ve kurtarma yetkileri manuel doğrulanmalıdır.
- **İş mantığı doğruluğu:** Diyanet API takviminin resmi/izinli kaynak statüsü, ilçe fuzzy matching'in doğru ilçe seçmesi ve `adhan` fallback'in Diyanet ile kabul edilen fark toleransı domain uzmanıyla örneklem bazında kontrol edilmelidir.
- **Gizlilik ve onay:** Kesin koordinat, ibadet geçmişi ve HTML içine gömülü restore payload'ının kullanıcı beklentisi/KVKK-GDPR metniyle uyumu hukuk ve ürün tarafından kontrol edilmelidir; statik analiz “rıza yeterli” diyemez.
- **Yedek uyumluluğu:** Schema migration politikası ve daha yeni sürüm yedeğinin reddedilmesi ürün kararıdır; ancak sessiz veri bozulması kabul edilmemelidir.
- **UX/accessibility:** Arapça RTL, screen reader etiketleri, dynamic font scaling, renk kontrastı ve uzun metin taşmaları cihaz üzerinde insan gözü ve accessibility araçlarıyla kontrol edilmelidir.
- **Remote servis güvenilirliği:** `https://ezanvakti.emushaf.net` için SLA, certificate/network failure davranışı ve veri sözleşmesi repoda yok; servis sahibi ve operasyon ekibiyle manuel teyit gerekir.
- **Binary artefact'lar:** Tracked APK, mevcut AAB/APK'ler, keystore ve ses/görsel dosyaları malware/SBOM/reproducible-build açısından incelenmedi; release artefact'ı temiz CI'da yeniden üretilip hash/provenance ile karşılaştırılmalıdır.
- **Dinamik güvenlik:** Cihaz backup extraction, crafted deep link, büyük backup dosyasıyla memory pressure ve native config plugin patch davranışı emulator/cihaz üzerinde ayrıca fuzz/penetration test gerektirir.
