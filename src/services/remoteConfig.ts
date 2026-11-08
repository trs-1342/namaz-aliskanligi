import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildSupabasePublicHeaders,
  clampRemoteConfig,
  DEFAULT_REMOTE_CONFIG,
  parseRemoteConfigRow,
  readRemoteConfigExtra,
  type RemoteConfig,
} from './locationDiagnosticsPolicy';

/**
 * Supabase'den çekilen uzaktan yapılandırma.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Kapalı test sırasında her ayar değişikliği (kadans, açma/kapama, test
 * penceresinin uzatılması) yeni bir APK derleyip cihazlara dağıtmayı
 * gerektiriyordu. Değerler artık `public.app_remote_config` tablosundaki tek
 * satırdan okunur; panelde alan değiştirilir, cihazlar en geç `configPollMinutes`
 * içinde uyar. Sunucu tarafı da aynı satırı okur (RLS policy, kapasite trigger'ı,
 * pg_cron temizlik job'ı), yani kesim tarihi tek bir yerden yönetilir.
 *
 * ── SENKRON OKUMA TASARIMI ──────────────────────────────────────────────────
 * `isLocationDiagnosticsAvailable()`, `beaconBucketIso()` gibi çağrı yerlerinin
 * hepsi senkron. Bunları async'e çevirmek bütün çağrı zincirini değiştirirdi.
 * Bunun yerine modülde BELLEK İÇİ bir snapshot tutulur: senkron okuyucular
 * `getRemoteConfig()` ile onu okur. Snapshot en kötü ihtimalle varsayılanlardır,
 * yani config hiç gelmese bile davranış bu değişiklikten önceki davranıştır.
 *
 * ── GİRİŞ NOKTALARI ─────────────────────────────────────────────────────────
 * `hydrateRemoteConfig()` HER giriş noktasında ilk iş olarak await edilmelidir:
 * App açılışı, WorkManager görevi ve konum servisi görevi. Arka plan görevleri
 * kendi JS bağlamlarında koşar; oradaki modül snapshot'ı başlangıçta boştur.
 *
 * ── FAIL-SAFE (ZORUNLU) ─────────────────────────────────────────────────────
 * Config isteğinin HİÇBİR hatası tanılamanın kill-switch sayaçlarına
 * (`recordPermanentSignal`) dokunmaz. Config tablosu yoksa 404 gelir; bu
 * tamamen normaldir (migration henüz çalışmamış olabilir) ve tanılamayı
 * kapatmak için sebep değildir. Başarısızlıkta sırayla: önbellek → varsayılan.
 */

const CONFIG_KEY = 'namaz-aliskanligi:remote-config:v1';
const CONFIG_FETCHED_AT_KEY = 'namaz-aliskanligi:remote-config:fetched-at:v1';
// Cihazın EN SON GÖRDÜĞÜ dirilme jetonu. Sunucudaki değer bundan farklıysa
// kapatma/duraklatma kayıtları silinir (bkz. consumeKillSwitchResetToken).
const RESET_TOKEN_SEEN_KEY = 'namaz-aliskanligi:remote-config:reset-token-seen:v1';
// Config isteğinin kendi zaman aşımı. Bilerek SABİT: `request_timeout_ms`
// config'ten okunuyor ve config'i çekmek için config'e ihtiyaç duyulamaz.
const REQUEST_TIMEOUT_MS = 10_000;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const SUPABASE_PUBLIC_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export type { RemoteConfig };

let cachedConfig: RemoteConfig = DEFAULT_REMOTE_CONFIG;
let hydrated = false;
let hydrationInFlight: Promise<RemoteConfig> | null = null;
let refreshInFlight: Promise<RemoteConfig> | null = null;
// Son BAŞARILI çekme anı (ms). Durum panelinde gösterilir; 0 = hiç çekilmedi.
let lastFetchedAt = 0;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('remote config timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Bellek içi snapshot. SENKRON — hiçbir zaman beklemez, hiçbir zaman fırlatmaz.
 * `hydrateRemoteConfig()` çağrılmadıysa varsayılanları döndürür.
 */
export function getRemoteConfig(): RemoteConfig {
  return cachedConfig;
}

/** Durum paneli için: config en son ne zaman sunucudan çekildi? (0 = hiç) */
export function getRemoteConfigFetchedAt(): number {
  return lastFetchedAt;
}

/** Durum paneli için: snapshot varsayılanlardan mı ibaret, yoksa gerçek veri mi? */
export function isRemoteConfigLoaded(): boolean {
  return lastFetchedAt > 0;
}

/**
 * Yerel önbellekten snapshot'ı doldurur. Ağ ERİŞİMİ YOKTUR — açılış yolunu
 * yavaşlatmaz. Aynı anda birden çok çağrı gelirse tek işe indirgenir.
 */
export function hydrateRemoteConfig(): Promise<RemoteConfig> {
  if (hydrated) return Promise.resolve(cachedConfig);
  if (hydrationInFlight) return hydrationInFlight;

  hydrationInFlight = (async () => {
    try {
      const [raw, fetchedAtRaw] = await Promise.all([
        AsyncStorage.getItem(CONFIG_KEY),
        AsyncStorage.getItem(CONFIG_FETCHED_AT_KEY),
      ]);
      if (raw) {
        // Önbellek de clamp'ten geçer: eski bir sürüm sınır dışı bir değer
        // yazmış olabilir ya da alanlar bu sürümde daralmış olabilir.
        cachedConfig = clampRemoteConfig(parseRemoteConfigRow(JSON.parse(raw)));
      }
      const parsedFetchedAt = Number(fetchedAtRaw);
      if (Number.isFinite(parsedFetchedAt) && parsedFetchedAt > 0) lastFetchedAt = parsedFetchedAt;
    } catch (error) {
      console.warn('[remote-config] cached config could not be read', error);
    } finally {
      hydrated = true;
      hydrationInFlight = null;
    }
    return cachedConfig;
  })();

  return hydrationInFlight;
}

/** `configPollMinutes` dolmadan tekrar çekmeye gerek var mı? */
function isRefreshDue(nowMs: number): boolean {
  if (lastFetchedAt <= 0) return true;
  return nowMs - lastFetchedAt >= cachedConfig.configPollMinutes * 60_000;
}

/**
 * Config'i sunucudan çeker ve snapshot'ı günceller.
 *
 * @param options.force Poll aralığını atlar (Ayarlar'daki "şimdi dene" ve
 *   kullanıcı tetiklemeli yollar için).
 *
 * ASLA FIRLATMAZ ve asla tanılama hata sayaçlarına dokunmaz; başarısızlıkta
 * eldeki snapshot aynen korunur.
 */
export function refreshRemoteConfig(options?: { force?: boolean }): Promise<RemoteConfig> {
  const force = options?.force === true;
  // Sıradan çağrılar devam eden isteğe katılır. `force` ise KATILMAZ: Ayarlar'daki
  // "şimdi dene" düğmesi, o an arka planda poll aralığı yüzünden ağa hiç çıkmayan
  // bir istek varsa ona bağlanıp sessizce hiçbir şey yapmazdı — oysa o düğmenin
  // tek işi panelde yapılan değişikliğin cihaza indiğini kanıtlamak.
  const pending = refreshInFlight;
  if (pending && !force) return pending;

  // `self`, finally bloğunda kendi kaydımızı tanımak için gerekli. Atama IIFE'den
  // sonra tamamlandığı için tipi açıkça belirtiliyor.
  let self: Promise<RemoteConfig> | null = null;
  self = (async () => {
    try {
      if (pending) await pending.catch(() => undefined);
      await hydrateRemoteConfig();
      if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) return cachedConfig;
      if (!force && !isRefreshDue(Date.now())) return cachedConfig;

      const response = await withTimeout(
        fetch(`${SUPABASE_URL}/rest/v1/app_remote_config?select=*&id=eq.1`, {
          method: 'GET',
          headers: {
            ...buildSupabasePublicHeaders(SUPABASE_PUBLIC_KEY),
            Accept: 'application/json',
          },
        }),
        REQUEST_TIMEOUT_MS
      );

      // 404 = config tablosu henüz yok (migration çalışmamış). Beklenen durum:
      // sessizce varsayılanlarla devam et, ASLA tanılamayı kapatma.
      if (!response.ok) {
        console.warn('[remote-config] fetch rejected', response.status);
        return cachedConfig;
      }

      const body = (await response.json()) as unknown;
      const row = Array.isArray(body) ? body[0] : body;
      if (!row || typeof row !== 'object') return cachedConfig;

      const next = clampRemoteConfig(parseRemoteConfigRow(row));
      cachedConfig = next;
      lastFetchedAt = Date.now();
      await Promise.all([
        AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next)),
        AsyncStorage.setItem(CONFIG_FETCHED_AT_KEY, String(lastFetchedAt)),
      ]);
    } catch (error) {
      // Ağ yok / DNS / TLS / timeout / bozuk JSON — hepsi zararsız.
      console.warn('[remote-config] refresh failed, keeping current values', error);
    } finally {
      // Yalnız KENDİ kaydımızı temizle: `force` araya girip yeni bir istek
      // kurmuşsa onu sıfırlamamalıyız (yoksa dedupe tamamen bozulur).
      if (refreshInFlight === self) refreshInFlight = null;
    }
    return cachedConfig;
  })();

  refreshInFlight = self;
  return self;
}

/**
 * `extras` içinden tipli okuma — ileride migration YAZMADAN eklenen anahtarlar için.
 * Panelde `extras` alanına `{"anahtar": değer}` yazmak yeterlidir.
 */
export function getRemoteConfigExtra(key: string, fallback: number): number;
export function getRemoteConfigExtra(key: string, fallback: boolean): boolean;
export function getRemoteConfigExtra(key: string, fallback: string): string;
export function getRemoteConfigExtra(
  key: string,
  fallback: number | boolean | string
): number | boolean | string {
  // Aşırı yükleme çözümü için tekil çağrılara ayrılıyor.
  if (typeof fallback === 'boolean') return readRemoteConfigExtra(cachedConfig.extras, key, fallback);
  if (typeof fallback === 'number') return readRemoteConfigExtra(cachedConfig.extras, key, fallback);
  return readRemoteConfigExtra(cachedConfig.extras, key, fallback);
}

/**
 * UZAKTAN DİRİLTME. Sunucudaki `kill_switch_reset_token` cihazın en son gördüğü
 * değerden farklıysa `true` döner ve yeni değeri işaretler; çağıran taraf
 * (locationDiagnostics) yerel kapatma/duraklatma kayıtlarını siler.
 *
 * NEDEN: kendini kalıcı kapatmış bir cihaz, sebep sunucuda düzeltilse bile
 * kapatma kaydı AsyncStorage'da kaldığı için ölü kalıyordu — 2026-08-04'te
 * geçersiz anahtar yüzünden sahada tam olarak bu yaşandı ve tek çare yeni sürüm
 * dağıtmaktı. Artık panelde bu alanı değiştirmek yeterli.
 *
 * Jeton NULL ise hiçbir şey yapılmaz (varsayılan durum). "Farklı olması" önemlidir,
 * içeriği değil; aynı jetonla ikinci kez sıfırlama yapılmaz.
 */
export async function consumeKillSwitchResetToken(): Promise<boolean> {
  const token = cachedConfig.killSwitchResetToken;
  if (!token) return false;
  try {
    const seen = await AsyncStorage.getItem(RESET_TOKEN_SEEN_KEY);
    if (seen === token) return false;
    await AsyncStorage.setItem(RESET_TOKEN_SEEN_KEY, token);
    // İlk kurulumda jeton zaten doluysa "sıfırlama" anlamsızdır: silinecek bir
    // kapatma kaydı yoktur ve çağıran taraf bunu zararsız biçimde yutar. Yine de
    // jetonu işaretlemek, sonraki gerçek değişikliğin algılanmasını sağlar.
    return true;
  } catch (error) {
    console.warn('[remote-config] reset token could not be processed', error);
    return false;
  }
}

/** Arka plan görevleri için: önce önbellekten doldur, sonra (gerekiyorsa) tazele. */
export async function loadRemoteConfigForBackgroundTask(): Promise<RemoteConfig> {
  await hydrateRemoteConfig();
  return refreshRemoteConfig();
}

/** Veri sıfırlamada çağrılır; snapshot'ı da varsayılanlara döndürür. */
export async function clearRemoteConfigCache(): Promise<void> {
  cachedConfig = DEFAULT_REMOTE_CONFIG;
  lastFetchedAt = 0;
  hydrated = false;
  try {
    await AsyncStorage.multiRemove([CONFIG_KEY, CONFIG_FETCHED_AT_KEY, RESET_TOKEN_SEEN_KEY]);
  } catch (error) {
    console.warn('[remote-config] cache could not be cleared', error);
  }
}
