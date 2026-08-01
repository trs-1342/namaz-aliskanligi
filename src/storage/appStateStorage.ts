import AsyncStorage from '@react-native-async-storage/async-storage';

export const APP_STATE_KEY = 'namaz-aliskanligi:v1';

let mutationQueue: Promise<void> = Promise.resolve();

function enqueue(operation: () => Promise<void>): Promise<void> {
  const result = mutationQueue.then(operation);
  // A rejected write must be observable to its caller without poisoning later writes.
  mutationQueue = result.catch(() => undefined);
  return result;
}

export async function loadAppState<T extends object>(): Promise<Partial<T> | null> {
  await mutationQueue;
  const raw = await AsyncStorage.getItem(APP_STATE_KEY);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored app state is not an object');
  }
  return parsed as Partial<T>;
}

export function updateAppState<T extends object>(state: Partial<T>): Promise<void> {
  return enqueue(async () => {
    const oldRaw = await AsyncStorage.getItem(APP_STATE_KEY);
    const oldState: unknown = oldRaw ? JSON.parse(oldRaw) : {};
    if (!oldState || typeof oldState !== 'object' || Array.isArray(oldState)) {
      throw new Error('Stored app state is not mergeable');
    }
    await AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify({ ...oldState, ...state }));
  });
}

export function replaceAppState(state: object): Promise<void> {
  return enqueue(() => AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify(state)));
}

export function restoreRawAppState(raw: string | null): Promise<void> {
  return enqueue(() => raw == null
    ? AsyncStorage.removeItem(APP_STATE_KEY)
    : AsyncStorage.setItem(APP_STATE_KEY, raw));
}

export function clearAppState(): Promise<void> {
  return enqueue(() => AsyncStorage.removeItem(APP_STATE_KEY));
}

/**
 * Eski Türkiye/Diyanet konum moduna ait alanları ve dinamik önbellekleri siler.
 * Kullanıcının ayar ve namaz takip verileri korunur; yalnız kaldırılan konum
 * kaynağı bir sonraki açılışta tekrar etkinleşemez.
 */
export async function migrateAppStateToGpsOnly(): Promise<boolean> {
  let migrated = false;
  await enqueue(async () => {
    const raw = await AsyncStorage.getItem(APP_STATE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const next = { ...(parsed as Record<string, unknown>) };
        if (next.locationSourceVersion !== 2) {
          migrated = true;
          delete next.coords;
          delete next.locationLabel;
          delete next.locationCountryCode;
          delete next.cachedPrayerDays;
          delete next.scheduledPrayerNotificationIds;
        }
        delete next.locationEnabled;
        delete next.diyanetCityId;
        delete next.diyanetDistrictId;
        next.locationSourceVersion = 2;
        await AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify(next));
      }
    }

    const keys = await AsyncStorage.getAllKeys();
    const obsolete = keys.filter((key) =>
      key === 'diyanet:cities:v1' || key.startsWith('diyanet:districts:v1:')
    );
    if (obsolete.length > 0) await AsyncStorage.multiRemove(obsolete);
  });
  return migrated;
}

export async function waitForAppStateWrites(): Promise<void> {
  await mutationQueue;
}
