import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import {
  APP_STATE_KEY,
  replaceAppState,
  restoreRawAppState,
  waitForAppStateWrites,
} from '../storage/appStateStorage';

import {
  BackupError,
  BackupFile,
  BackupLanguage,
  HTML_LABELS,
  buildBackup,
  parseBackup,
  renderHtml,
} from './backupFormat';

export { BackupError, BACKUP_MAGIC, BACKUP_SCHEMA, summarizeBackup, countTrackedDays } from './backupFormat';
export type { BackupFile, BackupLanguage } from './backupFormat';

// Uygulama verisinin tutulduğu AsyncStorage anahtarları (App.tsx ve tracking/storage.ts ile aynı).
const TRACKING_KEY = 'namaz-aliskanligi:tracking:v1';

// ─── Toplama / geri yükleme ─────────────────────────────────────────────────

/** Tüm uygulama verisini AsyncStorage'dan tek bir yedek nesnesinde toplar. */
export async function collectBackup(appVersion: string): Promise<BackupFile> {
  await waitForAppStateWrites();
  const [rawState, rawTracking] = await Promise.all([
    AsyncStorage.getItem(APP_STATE_KEY),
    AsyncStorage.getItem(TRACKING_KEY),
  ]);

  let appState: Record<string, any> | null = null;
  let tracking: any[] = [];
  try {
    appState = rawState ? JSON.parse(rawState) : null;
  } catch (e) {
    console.warn('collectBackup: appState JSON.parse başarısız', e);
  }
  try {
    tracking = rawTracking ? JSON.parse(rawTracking) : [];
  } catch (e) {
    console.warn('collectBackup: tracking JSON.parse başarısız', e);
  }

  return buildBackup(appVersion, appState, tracking);
}

/**
 * Yedek nesnesini AsyncStorage'a yazarak veriyi geri yükler.
 * `data` `parseBackup` tarafından zaten alan bazında doğrulanmış olmalıdır.
 * Yazım sırasında bir hata oluşursa (ör. appState yazılır, tracking yazımı
 * başarısız olursa) yarım kalmış tutarsız state depoda bırakılmaz; önceki
 * değerlere geri dönülür ve hata yeniden fırlatılır.
 */
export async function restoreBackup(data: BackupFile): Promise<void> {
  await waitForAppStateWrites();
  const [prevState, prevTracking] = await Promise.all([
    AsyncStorage.getItem(APP_STATE_KEY),
    AsyncStorage.getItem(TRACKING_KEY),
  ]);

  try {
    if (data.appState && typeof data.appState === 'object') {
      const gpsOnlyState = { ...data.appState } as Record<string, unknown>;
      delete gpsOnlyState.locationEnabled;
      delete gpsOnlyState.diyanetCityId;
      delete gpsOnlyState.diyanetDistrictId;
      delete gpsOnlyState.coords;
      delete gpsOnlyState.locationLabel;
      delete gpsOnlyState.locationCountryCode;
      delete gpsOnlyState.cachedPrayerDays;
      delete gpsOnlyState.scheduledPrayerNotificationIds;
      gpsOnlyState.locationSourceVersion = 2;
      await replaceAppState(gpsOnlyState);
    }
    await AsyncStorage.setItem(TRACKING_KEY, JSON.stringify(Array.isArray(data.tracking) ? data.tracking : []));
  } catch (e) {
    console.warn('restoreBackup: yazım başarısız, önceki veri geri yükleniyor', e);
    await Promise.all([
      restoreRawAppState(prevState),
      prevTracking != null
        ? AsyncStorage.setItem(TRACKING_KEY, prevTracking)
        : AsyncStorage.removeItem(TRACKING_KEY),
    ]);
    throw e instanceof BackupError ? e : new BackupError('invalid', 'restore failed');
  }
}

// ─── Dışa aktarma (dosya yaz + paylaş) ──────────────────────────────────────

function stamp(): string {
  // 2026-06-05_14-30 → dosya adı için güvenli zaman damgası
  return new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
}

function writeFile(name: string, content: string): File {
  const file = new File(Paths.cache, name);
  try {
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('writeFile: eski dosya silinemedi', e);
  }
  file.create({ overwrite: true });
  file.write(content);
  return file;
}

/** JSON yedeğini diske yazıp paylaşım sayfasını açar. */
export async function exportJson(appVersion: string, language: BackupLanguage): Promise<boolean> {
  const backup = await collectBackup(appVersion);
  const file = writeFile(`namaz-yedek-${stamp()}.json`, JSON.stringify(backup, null, 2));
  return shareFile(file.uri, 'application/json', 'public.json', HTML_LABELS[language].shareTitle);
}

/** Tasarımlı HTML raporunu diske yazıp paylaşım sayfasını açar (içinde geri-yükleme verisi gömülü). */
export async function exportHtml(appVersion: string, language: BackupLanguage): Promise<boolean> {
  const backup = await collectBackup(appVersion);
  const file = writeFile(`namaz-yedek-${stamp()}.html`, renderHtml(backup, language));
  return shareFile(file.uri, 'text/html', 'public.html', HTML_LABELS[language].shareTitle);
}

async function shareFile(uri: string, mimeType: string, uti: string, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType, UTI: uti, dialogTitle });
  return true;
}

// ─── İçe aktarma (dosya seç + oku + ayrıştır) ───────────────────────────────

/** Kullanıcıya dosya seçtirir, JSON veya HTML yedeğini okuyup ayrıştırır. */
export async function pickAndReadBackup(): Promise<BackupFile> {
  let res: DocumentPicker.DocumentPickerResult;
  try {
    res = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/html', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch {
    throw new BackupError('read');
  }

  if (res.canceled || !res.assets?.length) throw new BackupError('cancelled');

  let text: string;
  try {
    text = await new File(res.assets[0].uri).text();
  } catch {
    throw new BackupError('read');
  }

  return parseBackup(text);
}
