import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import {
  flushLocationDiagnosticsOutbox,
  getBeaconIntervalMinutes,
  getLocationAccuracy,
  getLocationDiagnosticsConsent,
  isLocationDiagnosticsAvailable,
  isLocationDiagnosticsPermanentlyDisabled,
  sendDiagnosticsBeacon,
} from './locationDiagnostics';
import { getRemoteConfig, loadRemoteConfigForBackgroundTask } from './remoteConfig';

export const BACKGROUND_LOCATION_BEACON_TASK = 'namaz-aliskanligi:location-beacon-updates';

// Servisin hangi AYARLARLA başlatıldığının imzası (aralık | doğruluk | bildirim
// metni). Uzaktan herhangi biri değişince servis yeniden kurulmalı —
// `startLocationUpdatesAsync` zaten çalışan bir görev için no-op olur.
const STARTED_INTERVAL_KEY = 'namaz-aliskanligi:location-diagnostics:fgs-interval:v1';

/**
 * "Uygulama kapalı + internet yok" boşluğunun tek gerçek çözümü.
 *
 * NEDEN WORKMANAGER YETMİYOR: expo-background-task, işi `NetworkType.CONNECTED`
 * kısıtıyla kuyruğa alır (BackgroundTaskScheduler.kt) — yani ağ yokken görev HİÇ
 * uyanmaz, o pencerelerin verisi tamamen kaybolur. Ayrıca Doze'da 15 dakikalık
 * aralık saatlerce ertelenebilir.
 *
 * BU GÖREV NE YAPAR: expo-location'ın ön plan servisi destekli konum güncellemeleri
 * (Android'de kalıcı bildirimli bir foreground service) uygulamayı süreç olarak ayakta
 * tutar. Konum işletim sisteminden doğrudan gelir:
 *   • ağ GEREKTİRMEZ  → internetsizken de kayıt üretilir ve yerel kuyruğa yazılır,
 *   • uygulama kapalıyken de çalışır,
 *   • ayrı bir GPS isteği yapılmaz (ölçüm görevle birlikte gelir).
 * Ağ döndüğünde kuyruk buradan da boşaltılır; kullanıcının uygulamayı açması gerekmez.
 *
 * BEDELİ (bilinçli kabul): kalıcı bir sistem bildirimi ve artan pil tüketimi.
 * Panelden (`app_remote_config.foreground_service_enabled`) kapatılabilir; test
 * penceresi kapanınca da görev kendini durdurur.
 *
 * GEREKSİNİM: "her zaman izin ver" (ACCESS_BACKGROUND_LOCATION). İzin yoksa sessizce
 * başlatılmaz; diğer tetikleyiciler çalışmaya devam eder.
 *
 * BİLİNEN SINIR: cihaz yeniden başlatıldığında servis kendiliğinden dönmez
 * (manifest'te boot receiver yok). O aralıkta WorkManager görevi — androidx.work'ün
 * kendi boot receiver'ı sayesinde — kayıt üretmeyi sürdürür; ön plan servisi
 * kullanıcı uygulamayı bir kez açtığında geri gelir.
 */
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  BACKGROUND_LOCATION_BEACON_TASK,
  async ({ data, error }) => {
    if (error) {
      console.warn('[location-diagnostics] background location task error', error);
      return;
    }

    try {
      // Arka plan bağlamında config snapshot'ı boştur; önce yüklenmeli.
      await loadRemoteConfigForBackgroundTask();

      // Kill-switch / rıza / pencere / uzaktan kapatma: artık geçerli değilse durdur.
      if (
        !isLocationDiagnosticsAvailable() ||
        !getRemoteConfig().foregroundServiceEnabled ||
        (await isLocationDiagnosticsPermanentlyDisabled()) ||
        !(await getLocationDiagnosticsConsent())
      ) {
        await stopBackgroundLocationBeaconAsync();
        return;
      }

      const locations = data?.locations ?? [];
      const position = locations.length > 0 ? locations[locations.length - 1] : null;

      // Ölçüm elimizde: beacon ayrıca GPS istemez, kayıt kesinlikle koordinatlı olur.
      await sendDiagnosticsBeacon('background', { position, beaconSource: 'location_service' });

      // Ağ varsa çevrimdışıyken biriken kuyruğu da boşalt (uygulama kapalı olsa bile).
      await flushLocationDiagnosticsOutbox();

      if (await isLocationDiagnosticsPermanentlyDisabled()) {
        await stopBackgroundLocationBeaconAsync();
      }
    } catch (taskError) {
      console.warn('[location-diagnostics] background location task failed', taskError);
    }
  }
);

type ForegroundServiceText = {
  notificationTitle: string;
  notificationBody: string;
};

/**
 * Konum güncelleme görevini başlatır. "Her zaman" konum izni yoksa sessizce
 * çıkar — kullanıcıya ek bir diyalog gösterilmez. Zaten aynı aralıkla çalışıyorsa
 * no-op; uzaktan aralık değiştiyse servis yeniden başlatılır.
 */
export async function startBackgroundLocationBeaconAsync(text: ForegroundServiceText): Promise<void> {
  try {
    // ÖNCE DURDURMA KOŞULLARI. Bu blok `return` değil `stop + return` yapmalı:
    // servis zaten çalışıyorken özellik uzaktan kapatılırsa (ya da pencere
    // kapanırsa) sadece "başlatmayı atlamak" kalıcı bildirimi ve pil tüketimini
    // olduğu gibi bırakırdı.
    //
    // WorkManager görevinden farklı olarak burada gerçekten DURDURUYORUZ: ön plan
    // servisini boşuna ayakta tutmanın bedeli (kalıcı bildirim + pil) yüksek.
    // Bunun sonucu, uzaktan tekrar açıldığında servisin kullanıcı uygulamayı bir
    // kez açana kadar geri gelmemesidir — bilinçli bir denge.
    if (!isLocationDiagnosticsAvailable() || !getRemoteConfig().foregroundServiceEnabled) {
      await stopBackgroundLocationBeaconAsync();
      return;
    }
    if (await isLocationDiagnosticsPermanentlyDisabled()) {
      await stopBackgroundLocationBeaconAsync();
      return;
    }
    if (!(await getLocationDiagnosticsConsent())) {
      await stopBackgroundLocationBeaconAsync();
      return;
    }

    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') return;
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.status !== 'granted') return;

    const config = getRemoteConfig();
    const intervalMinutes = getBeaconIntervalMinutes();
    // Servisin hangi AYARLARLA başlatıldığının imzası. `startLocationUpdatesAsync`
    // zaten çalışan bir görev için no-op olduğundan, uzaktan değişen her ayar
    // (aralık, doğruluk, bildirim metni) ancak servis yeniden kurulursa etkili
    // olur. İmza değişmediyse hiçbir şey yapılmaz.
    const desiredSignature = [
      intervalMinutes,
      config.locationAccuracy,
      config.foregroundServiceTitle ?? text.notificationTitle,
      config.foregroundServiceBody ?? text.notificationBody,
    ].join('|');
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_BEACON_TASK)) {
      if ((await AsyncStorage.getItem(STARTED_INTERVAL_KEY)) === desiredSignature) return;
      // Ayarlar uzaktan değişti: eski ayarlarla koşan servisi durdurup yenisini kur.
      await stopBackgroundLocationBeaconAsync();
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_BEACON_TASK, {
      accuracy: getLocationAccuracy(),
      timeInterval: intervalMs,
      // Sabit duran cihazda da kayıt üretilsin: mesafe eşiği yok.
      distanceInterval: 0,
      deferredUpdatesInterval: intervalMs,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        // Kalıcı bildirimin metni uzaktan geçersiz kılınabilir: testçilere
        // gösterilen ifadeyi uygulama güncellemesi olmadan değiştirmek için.
        // Alan boşsa (null) uygulamanın kendi çevrilmiş metni kullanılır.
        notificationTitle: config.foregroundServiceTitle ?? text.notificationTitle,
        notificationBody: config.foregroundServiceBody ?? text.notificationBody,
        killServiceOnDestroy: false,
      },
    });
    await AsyncStorage.setItem(STARTED_INTERVAL_KEY, desiredSignature);
  } catch (error) {
    console.warn('[location-diagnostics] background location updates could not be started', error);
  }
}

/** Rıza kalkınca, kill-switch tetiklenince veya test penceresi kapanınca durdurur. */
export async function stopBackgroundLocationBeaconAsync(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_BEACON_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_BEACON_TASK);
    }
    await AsyncStorage.removeItem(STARTED_INTERVAL_KEY);
  } catch (error) {
    console.warn('[location-diagnostics] background location updates could not be stopped', error);
  }
}

/** Durum paneli için: ön plan servisi şu an çalışıyor mu? */
export async function isBackgroundLocationBeaconRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_BEACON_TASK);
  } catch {
    return false;
  }
}
