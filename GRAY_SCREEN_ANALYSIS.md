# Gri Ekran Sorunu — Tam Teknik Analiz

Bu belge, başka bir AI'ın projeyi anlayıp görev verebilmesi için hazırlanmıştır.

---

## Proje Özeti

- **Uygulama**: Namaz Alışkanlığı — Android namaz vakti hatırlatma uygulaması
- **Stack**: React Native + Expo (managed workflow), TypeScript
- **Paket adı**: `com.trs1342.namazaliskanligi`
- **Ana dosya**: `App.tsx` (~2100 satır)
- **Native plugin**: `plugins/withAndroidAlarm.js` (Expo Config Plugin)
- **Build sistemi**: EAS Build (cloud)
- **Repo**: https://github.com/trs-1342/namaz-aliskanligi

---

## Özellik: Android Alarm Sistemi

Uygulama namaz vakitlerinde alarm çalar. Alarm sistemi:

1. `expo-notifications` ile bildirim planlanır
2. Bildirim tetiklenince `fullScreenIntent` ile uygulama kilit ekranı üzerinde açılır
3. React Native tarafında `activeAlarm` state'i set edilir, alarm UI gösterilir
4. Kullanıcı "Sustur" derse `stopAlarm()` çalışır

Native tarafta `AlarmWindowModule.kt` adlı özel bir React Native modülü var:
- `setFlags(true/false)` → `FLAG_SHOW_WHEN_LOCKED`, `FLAG_TURN_SCREEN_ON` yönetir
- `moveToBackground()` → `activity.moveTaskToBack(true)` çağırır
- `isScreenLocked()` → `KeyguardManager.isKeyguardLocked` döner
- `getDeviceInfo()` → API seviyesi, izin durumları döner

---

## Sorun: Gri Ekran

### Semptom

Kullanıcılar ve test edenler şunu görüyor:
- Telefon kilitlenip açıldığında uygulama kilit ekranı **üzerinde** boş/gri/koyu bir ekranla açılıyor
- İçerik yüklenmiyor, ekran donuyor
- Kilit ekranına veya ana ekrana ulaşılamıyor

### Kök Neden

`AndroidManifest.xml`'de şu statik flag'ler var:

```xml
android:showWhenLocked="true"
android:turnScreenOn="true"
```

Bu flag'ler **`fullScreenIntent` (alarm) için zorunlu**. Olmadan alarm kilit ekranında gösterilemiyor. Ama aynı zamanda **alarm olmadan da** uygulama foreground'dayken kilit açıldığında ekranın üstüne çıkıyor.

### İki Farklı Senaryo

**Senaryo A — Kullanıcı kilitleyip açtı:**
```
App foreground → Ekran kilitlendi → Ekran açıldı
→ Android: showWhenLocked=true → App kilit üstünde resume oluyor
→ React Native henüz render etmedi → Boş koyu ekran görünür
→ Kullanıcı içeriğe ulaşamıyor
```

**Senaryo B — Alarm çaldı, app kapalıydı:**
```
Alarm bildirimi → fullScreenIntent → App soğuk başlangıç
→ React Native yüklenme süresi: 500–2000ms
→ Bu sürede native splash arka planı (#121414 koyu) görünür
→ Kullanıcı bunu "gri ekran" olarak görüyor
→ Sonra alarm UI geliyor (normal)
```

Senaryo A tamamen düzeltilebilir. Senaryo B kısmen kaçınılmaz (React Native yükleme süresi).

---

## Yapılan Düzeltme Denemeleri

### Deneme 1: `moveToBackground()` eklendi
`stopAlarm()` fonksiyonunda alarm kapandıktan sonra `moveToBackground()` çağrısı eklendi.

**Sonuç**: Alarm kapandıktan sonraki durumu düzeltiyor ama alarm olmadan oluşan gri ekranı düzeltmiyor.

### Deneme 2: `retreatIfLocked()` — AppState 'active'de
```javascript
AppState 'active' → 1000ms bekle → isScreenLocked() → moveToBackground()
```
**Sonuç**: 1 saniye gecikmede kullanıcı gri ekranı zaten görüyor. Geç kalınan müdahale.

### Deneme 3: AppState 'inactive'de `setFlags(false)`
```javascript
AppState 'inactive' veya 'background' → setFlags(false)
```
**Sorun**: `setFlags(false)` runtime'da `FLAG_SHOW_WHEN_LOCKED`'ı temizliyor. Ama bu sadece mevcut window session için geçerli. Activity yeniden resume olduğunda manifest'teki statik flag tekrar etkin oluyor. Kalıcı çözüm değil.

### Deneme 4: MainActivity.onStart() patch — SharedPreferences (Mevcut kod)

Bu doğru yaklaşım. Üç bileşeni var:

**Bileşen A — ExpoNotificationBuilder.kt patch:**
Alarm bildirimi oluşturulduğunda SharedPreferences'a yazar:
```kotlin
context.getSharedPreferences("AlarmWindow", MODE_PRIVATE)
  .edit()
  .putLong("alarmFiredAt", System.currentTimeMillis())
  .putBoolean("alarmActive", true)
  .apply()
```

**Bileşen B — AlarmWindowModule.setFlags():**
JS'den çağrıldığında SharedPreferences'ı günceller:
```kotlin
prefs().edit()
  .putBoolean("alarmActive", enable)
  .putLong("alarmFiredAt", if (!enable) 0L else prefs().getLong("alarmFiredAt", 0L))
  .apply()
```

**Bileşen C — MainActivity.onStart() override:**
```kotlin
override fun onStart() {
  super.onStart()
  val prefs = getSharedPreferences("AlarmWindow", MODE_PRIVATE)
  val alarmActive = prefs.getBoolean("alarmActive", false)
  val alarmFiredAt = prefs.getLong("alarmFiredAt", 0L)
  val isRecent = alarmFiredAt > 0L && (System.currentTimeMillis() - alarmFiredAt) < 90_000L
  val show = alarmActive || isRecent
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
    setShowWhenLocked(show)
    setTurnScreenOn(show)
  }
  if (!show) {
    window.clearFlags(FLAG_SHOW_WHEN_LOCKED or FLAG_TURN_SCREEN_ON or FLAG_KEEP_SCREEN_ON)
  }
}
```

**Neden bu yaklaşım doğru:**
- `onStart()`, `onResume()`'dan önce çağrılır
- Pencere `onResume()`'da kullanıcıya gösterilir
- Dolayısıyla `onStart()`'ta `setShowWhenLocked(false)` çağrısı pencere görünmeden önce etkili olur
- SharedPreferences sayesinde alarm durumu JS olmadan okunabilir

**Prebuild doğrulaması:**
```
npx expo prebuild --platform android --no-install
→ [withAndroidAlarm] ✓ MainActivity.kt — onStart patch
```
Patch kod üretiminde çalışıyor.

---

## Hâlâ Sorun Yaşanmasının Nedeni

### Neden 1: Play Store'da Eski Sürüm
Test edenler büyük ihtimalle onStart() patch'i içermeyen eski sürümü (1.2.0 veya 1.3.0) kullanıyor. Patch'li sürüm henüz geniş kullanıcı kitlesine yayılmadı.

### Neden 2: Emülatörde Test Edilemiyor
```
Android 17 emülatör + newArchEnabled:true  → BridgelessReact handleHostException (null)
Android 14 emülatör + newArchEnabled:false → StackOverflowError (AppCompatCallbacks)
Android 14 AOSP    + newArchEnabled:false → StackOverflowError (aynı)
```
Tüm emülatörler crash yapıyor. Gerçek ARM64 cihazda test yapılamadı.

### Neden 3: Senaryo B Kısmen Kaçınılmaz
Alarm soğuk başlangıçta tetiklenirse React Native yüklenene kadar (~500-2000ms) boş native arka plan görünür. Bu tamamen engellemek için ayrı bir native `AlarmActivity` gerekir.

---

## Mevcut Dosya Yapısı

```
App.tsx                          ← Ana React Native bileşeni
plugins/withAndroidAlarm.js      ← Expo Config Plugin
  ├── addManifestFlags()         → AndroidManifest.xml'e showWhenLocked ekler
  ├── addAlarmWindowModule()     → AlarmWindowModule.kt, AlarmWindowPackage.kt yazar
  ├── patchMainActivity()        → MainActivity.kt'ye onStart() override ekler
  └── patchFullScreenIntent()    → ExpoNotificationBuilder.kt'ye alarm patch'i ekler
src/services/prayerTimes.ts      ← adhan kütüphanesiyle lokal namaz vakti hesabı
src/tracking/                    ← Namaz takip ekranı
app.json                         ← Expo config (newArchEnabled: true, versionCode EAS'ta)
eas.json                         ← Build profilleri: development, preview, apk, production
scripts/test-android.sh          ← ADB test yardımcısı
```

### App.tsx'teki Kritik Fonksiyonlar

```typescript
// Alarm başlatma
function startAlarm(prayer: PrayerTime) {
  setActiveAlarm(prayer);
  NativeModules.AlarmWindow?.setFlags(true); // SharedPreferences'a yazar
  alarmPlayerRef.current?.play?.();
  // ...
}

// Alarm durdurma
function stopAlarm() {
  NativeModules.AlarmWindow?.setFlags(false);  // SharedPreferences temizler
  NativeModules.AlarmWindow?.moveToBackground?.();
  setActiveAlarm(null);
}

// Gri ekran güvenlik katmanı (JS tarafı)
useEffect(() => {
  // Ekran kilitlenince: flags'leri hemen temizle
  AppState.addEventListener('change', async (state) => {
    if ((state === 'inactive' || state === 'background') && !activeAlarmRef.current) {
      NativeModules.AlarmWindow?.setFlags?.(false);
    }
    // Ekran açılınca: güvenlik kontrolü
    if (state === 'active') {
      await new Promise(r => setTimeout(r, 1000));
      if (!activeAlarmRef.current) {
        const locked = await NativeModules.AlarmWindow?.isScreenLocked?.();
        if (locked) NativeModules.AlarmWindow?.moveToBackground?.();
      }
    }
  });
}, []);
```

---

## Doğrulanmamış Noktalar

1. **onStart() patch gerçek cihazda çalışıyor mu?** Prebuild'de üretiliyor ama gerçek ARM64 cihazda test edilmedi.

2. **ExpoNotificationBuilder.kt patch doğru mu?** `content.body?.optBoolean("isAlarm")` — Expo'nun iç yapısında `body` alanı gerçekten alarm data'sını içeriyor mu? Kod çalışıyor gibi görünüyor ama bağımsız doğrulama yapılmadı.

3. **onResume'da da gerekli mi?** `onStart()` yeterli mi yoksa `onResume()`'a da aynı mantık eklenmeli mi?

4. **SharedPreferences timing**: ExpoNotificationBuilder `alarmFiredAt`'ı yazıyor, ardından fullScreenIntent tetikleniyor, ardından `onStart()` okuyor. Bu sıralama her cihazda garanti mi?

---

## Önerilen Sonraki Adımlar

### Kısa Vade
1. `eas build -p android --profile production` → Play Store'a yükle
2. Testerlardan güncelleme isteyin
3. Gerçek Android 13/14/15 cihazda test et

### Orta Vade
- `onResume()` override da eklenebilir (onStart'a ek güvence)
- `scripts/test-android.sh` ile adb logcat'ten gri ekran anında log alınabilir

### Uzun Vade (Gerçek Çözüm)
Ayrı bir native `AlarmActivity` oluştur:
- `android:showWhenLocked="true"` sadece bu Activity'de olur
- `MainActivity`'de olmaz → normal kullanımda kilit üstüne çıkmaz
- Alarm tetiklenince `AlarmActivity` başlar → React Native yüklenene kadar native UI gösterir
- React Native hazır olunca `AlarmActivity` kapanır, `MainActivity` alarm UI'ını gösterir

Bu yaklaşım hem Senaryo A hem B'yi tamamen çözer ama önemli native geliştirme gerektirir.

---

## Sürüm Geçmişi

| Sürüm | versionCode | Durum | Not |
|-------|-------------|-------|-----|
| 1.0.4 | 4 | Play Store'da | İlk yayın |
| 1.2.0 | 6 | Play Store'da | Namaz takibi eklendi, gri ekran sorunu var |
| 1.3.0 | 7-9 | Yalnızca lokal test | newArchEnabled değişiklikleri, emülatörde crash |
| 1.3.1 | 10 | Son build | onStart patch dahil, gerçek cihazda test edilmedi |
