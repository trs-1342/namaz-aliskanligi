import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  flushLocationDiagnosticsOutbox,
  getBeaconIntervalMinutes,
  getLocationDiagnosticsConsent,
  isLocationDiagnosticsAvailable,
  isLocationDiagnosticsPermanentlyDisabled,
  reconcileDiagnosticsShutdownState,
  sendDiagnosticsBeacon,
} from './locationDiagnostics';
import { getRemoteConfig, loadRemoteConfigForBackgroundTask } from './remoteConfig';

export const BACKGROUND_BEACON_TASK = 'namaz-aliskanligi:location-beacon';

// Kayıtlı görevin hangi aralıkla kurulduğunu tutar. Aralık uzaktan değiştiğinde
// (app_remote_config.beacon_interval_minutes) görev yeniden kurulmalı; yoksa eski
// aralık mevcut kurulumlarda kalıcı olur.
const REGISTERED_INTERVAL_KEY = 'namaz-aliskanligi:location-diagnostics:bg-interval:v1';

// Kesim anı geçtikten sonra görevin kayıtlı kalmaya devam edeceği süre. Amaç:
// "süre doldu, sonra panelden uzattım" senaryosunda arka plan teslimatının
// kullanıcı uygulamayı açmadan devam edebilmesi. Bu süre dolduğunda görev
// gerçekten iptal edilir; aksi hâlde test bittikten sonra da sonsuza dek 15
// dakikada bir uyanan bir zombi görev kalırdı.
const POST_CUTOFF_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * WorkManager UYANMA aralığı (dakika). Kayıt aralığı DEĞİLDİR: gönderim sıklığını
 * locationDiagnostics içindeki kova tekilleştirmesi belirler.
 *
 * Kayıt aralığının YARISI kadar sık uyanmak istiyoruz — Doze/OEM kısıtlarında
 * gecikebilen uyanmalara karşı her kovayı yakalama şansı ikiye katlanır. 15,
 * WorkManager'ın izin verdiği en küçük değer; altına inilemez.
 */
export function getBackgroundBeaconIntervalMinutes(): number {
  return Math.max(15, Math.floor(getBeaconIntervalMinutes() / 2));
}

// Görev tanımı modül yüklenince (global kapsamda) kaydolur; bu dosyanın en az bir
// kez import edilmesi şarttır. App.tsx bu modülü import ederek tetikler.
TaskManager.defineTask(BACKGROUND_BEACON_TASK, async () => {
  try {
    // Uzaktan yapılandırma ÖNCE yüklenir: arka plan görevi ayrı bir JS bağlamında
    // koşar, oradaki modül snapshot'ı başlangıçta boştur. Aşağıdaki bütün kontroller
    // (ana şalter, kesim anı, aralık) config'e bağlı olduğu için bu sıra şart.
    const config = await loadRemoteConfigForBackgroundTask();

    // UZAKTAN KAPATMA GERİ ALINABİLİR OLMALI. Panelden `diagnostics_enabled`
    // false yapıldığında görevi İPTAL ETMİYORUZ, yalnız bu turu atlıyoruz:
    // iptal edersek panelden tekrar açıldığında görev geri gelmez ve kullanıcı
    // uygulamayı açana kadar arka plan ölü kalır. Uyanıp hiçbir şey yapmamanın
    // maliyeti ihmal edilebilir; geri dönülemez bir kapatmanın maliyeti değil.
    // (Kalıcı kapanma — kill-switch, rıza iptali, pencere kapanışı — aşağıda
    // ayrıca ele alınır ve görevi gerçekten iptal eder.)
    // `background_task_enabled` ayrı bir anahtar: pil şikâyeti gelirse WorkManager
    // yolu tek başına kapatılabilir, ön plan servisi çalışmaya devam eder.
    if (!config.diagnosticsEnabled || !config.backgroundTaskEnabled) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // Uzaktan diriltme: panelde jeton değiştiyse duraklatma kaydını burada da
    // temizle. (Kalıcı kapanmış cihazlarda bu görev zaten iptal edilmiş olur;
    // orada diriltme yalnız uygulama açılışında gerçekleşir.)
    await reconcileDiagnosticsShutdownState();

    // PENCERE YENİ KAPANDIYSA GÖREVİ ÖLDÜRME. Kesim anı geçtiğinde iptal edersek,
    // panelden tarih ileri alındığında görev geri gelmez ve arka plan teslimatı
    // kullanıcı uygulamayı açana kadar ölü kalır — oysa uzatma kararının amacı
    // tam tersi. Bu yüzden kesimden sonra kısa bir tolerans penceresi boyunca
    // görev KAYITLI kalır, sadece hiçbir şey yapmaz. Tolerans dolduğunda test
    // gerçekten bitmiş sayılır ve görev iptal edilir (kalıcı bir zombi görev
    // bırakmamak için).
    const cutoffMs = config.cutoffMs;
    if (Number.isFinite(cutoffMs) && Date.now() >= cutoffMs) {
      if (Date.now() - cutoffMs < POST_CUTOFF_GRACE_MS) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      await unregisterBackgroundBeaconAsync();
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // Kill-switch veya rıza iptali: bunlar GERİ DÖNÜLEBİLİR değildir (rızayı
    // yalnız kullanıcı verir, kill-switch'i yalnız diriltme jetonu açar), o yüzden
    // görev gerçekten iptal edilir. (Geçici duraklatma burada iptal ETTİRMEZ;
    // sendDiagnosticsBeacon kendi içinde sessizce döner.)
    if (
      !isLocationDiagnosticsAvailable() ||
      (await isLocationDiagnosticsPermanentlyDisabled()) ||
      !(await getLocationDiagnosticsConsent())
    ) {
      await unregisterBackgroundBeaconAsync();
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    await sendDiagnosticsBeacon('background', { beaconSource: 'workmanager' });

    // Bu görev yalnız AĞ VARKEN uyanır (WorkManager NetworkType.CONNECTED kısıtı),
    // yani kuyruğu boşaltmak için ideal an. Kullanıcının uygulamayı açmasını
    // beklemeden çevrimdışıyken biriken kayıtlar buradan gider.
    await flushLocationDiagnosticsOutbox();

    // Config uzaktan değiştiyse (ör. aralık 15 → 30) görevi yeni aralıkla yeniden
    // kur. Uygulamanın açılmasını beklemeden kadans değişikliği yayılır.
    await registerBackgroundBeaconAsync();

    // Gönderim sırasında sunucu tabloyu silmiş olabilir (PGRST205) → kalıcı kapandıysa
    // görevi bir daha uyanmaması için iptal et.
    if (await isLocationDiagnosticsPermanentlyDisabled()) {
      await unregisterBackgroundBeaconAsync();
    }
  } catch (error) {
    console.warn('[location-diagnostics] background beacon task failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
  return BackgroundTask.BackgroundTaskResult.Success;
});

/**
 * Arka plan beacon görevini (WorkManager) kaydeder. Yalnız özellik açık, pencere
 * açık, rıza var ve kalıcı olarak kapatılmamışsa çalışır. Kayıtlı görevin aralığı
 * güncel değerden farklıysa görev yeniden kurulur; aynıysa no-op.
 */
export async function registerBackgroundBeaconAsync(): Promise<void> {
  try {
    if (!isLocationDiagnosticsAvailable()) return;
    // Uzaktan kapatıldıysa görevi KURMA (kayıtlıysa da bırak: bir sonraki uyanışta
    // turu atlar ve panelden geri açıldığında kendiliğinden devam eder).
    if (!getRemoteConfig().backgroundTaskEnabled) return;
    if (await isLocationDiagnosticsPermanentlyDisabled()) return;
    if (!(await getLocationDiagnosticsConsent())) return;

    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      console.warn('[location-diagnostics] background tasks restricted by system');
      return;
    }

    const intervalMinutes = getBackgroundBeaconIntervalMinutes();
    const desiredInterval = String(intervalMinutes);
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_BEACON_TASK);
    if (isRegistered) {
      if ((await AsyncStorage.getItem(REGISTERED_INTERVAL_KEY)) === desiredInterval) return;
      // Aralık değişmiş (ör. uzaktan 15 → 30): eski kaydı bırakıp yenisini kur.
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_BEACON_TASK);
    }

    await BackgroundTask.registerTaskAsync(BACKGROUND_BEACON_TASK, {
      minimumInterval: intervalMinutes,
    });
    await AsyncStorage.setItem(REGISTERED_INTERVAL_KEY, desiredInterval);
  } catch (error) {
    console.warn('[location-diagnostics] background beacon could not be registered', error);
  }
}

/** Arka plan görevini iptal eder (rıza kalkınca veya kill-switch tetiklenince). */
export async function unregisterBackgroundBeaconAsync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_BEACON_TASK)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_BEACON_TASK);
    }
    await AsyncStorage.removeItem(REGISTERED_INTERVAL_KEY);
  } catch (error) {
    console.warn('[location-diagnostics] background beacon could not be unregistered', error);
  }
}

/** Durum paneli için: WorkManager görevi şu an kayıtlı mı? */
export async function isBackgroundBeaconRegistered(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(BACKGROUND_BEACON_TASK);
  } catch {
    return false;
  }
}
