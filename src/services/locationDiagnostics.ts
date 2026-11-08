import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';

import {
  buildSupabasePublicHeaders,
  buildDiagnosticsEventId,
  isDuplicateDiagnosticsResponse,
  isLocationDiagnosticsWindowOpen,
  isPermanentDiagnosticsFailure,
  isRecoverableDiagnosticsFailure,
  isRecoverableDisableReason,
  normalizeDiagnosticsOutboxEntries,
  shouldDisableAfterRemoteFailures,
} from './locationDiagnosticsPolicy';
import {
  clearRemoteConfigCache,
  consumeKillSwitchResetToken,
  getRemoteConfig,
  getRemoteConfigFetchedAt,
  isRemoteConfigLoaded,
} from './remoteConfig';
import { loadAppState } from '../storage/appStateStorage';

const CONSENT_KEY = 'namaz-aliskanligi:location-diagnostics:consent:v1';
const DISABLED_KEY = 'namaz-aliskanligi:location-diagnostics:disabled:v2';
const INSTALLATION_ID_KEY = 'namaz-aliskanligi:location-diagnostics:installation-id:v1';
const ATTEMPT_HISTORY_KEY = 'namaz-aliskanligi:location-diagnostics:attempt-history:v1';
const REMOTE_FAILURE_COUNT_KEY = 'namaz-aliskanligi:location-diagnostics:remote-failures:v1';
// KESİN kalıcı sunucu sinyalinin (silinmiş tablo / yetki / kısıt) zaman-aralıklı sayacı.
const PERMANENT_SIGNAL_KEY = 'namaz-aliskanligi:location-diagnostics:permanent-signal:v1';
const OUTBOX_KEY = 'namaz-aliskanligi:location-diagnostics:outbox:v1';
// Sunucuda düzeltilebilir bir kalıcı hata doğrulanınca kalıcı kapatma YERİNE
// yazılan geçici duraklatma damgası (bkz. pauseDiagnostics).
const PAUSED_UNTIL_KEY = 'namaz-aliskanligi:location-diagnostics:paused-until:v1';
// "Her zaman konum" izninin bir kez istendiğini KALICI olarak işaretler. Android 11+
// bu izni uygulama içi diyalogla vermiyor, kullanıcıyı ayarlar sayfasına yönlendiriyor;
// bellek içi bir bayrak her açılışta sıfırlandığı için kullanıcı her seferinde ayarlara
// atılıyordu. Bu anahtar sayesinde istem kurulum başına bir kez gösterilir.
const BACKGROUND_PERMISSION_ASKED_KEY = 'namaz-aliskanligi:location-diagnostics:bg-permission-asked:v1';
// Son sunucu denemesinin sonucu. Üretimde log alınamadığı için sahadaki tek
// teşhis kaynağı budur; Ayarlar'daki durum panelinde gösterilir.
const LAST_ATTEMPT_KEY = 'namaz-aliskanligi:location-diagnostics:last-attempt:v1';
// Saatlik beacon'un o saat için gönderildiğini işaretler (saat kovası ISO'su).
const LAST_BEACON_HOUR_KEY = 'namaz-aliskanligi:location-diagnostics:last-beacon-hour:v1';

// ── Uzaktan yönetilen davranış değerleri ────────────────────────────────────
// Hepsi `app_remote_config`'ten okunur; config çekilememişse yerleşik varsayılan
// (DEFAULT_REMOTE_CONFIG) geçerlidir. Fonksiyon olmaları şart: sabit olarak
// okunsalardı modül yüklenirken (config gelmeden) donarlardı.

/** Tek sunucu isteğinin zaman aşımı (ms). */
function requestTimeoutMs(): number {
  return getRemoteConfig().requestTimeoutMs;
}

/** Doğrulanmış kalıcı hata sonrası duraklatma süresi (ms). */
function pauseDurationMs(): number {
  return getRemoteConfig().pauseHours * 60 * 60 * 1000;
}

/** Kalıcı sinyaller arasında sayılmak için gereken asgari aralık (ms). */
function permanentSignalSpacingMs(): number {
  return getRemoteConfig().permanentSignalSpacingMinutes * 60_000;
}

/** Konum doğruluğu — ön plan servisi ve tek seferlik ölçüm bunu kullanır. */
export function getLocationAccuracy(): Location.LocationAccuracy {
  switch (getRemoteConfig().locationAccuracy) {
    case 'lowest': return Location.Accuracy.Lowest;
    case 'low': return Location.Accuracy.Low;
    case 'high': return Location.Accuracy.High;
    case 'highest': return Location.Accuracy.Highest;
    default: return Location.Accuracy.Balanced;
  }
}

// BAYRAK SEMANTİĞİ BİLEREK TERSİNE ÇEVRİLDİ: eskiden `=== 'true'` idi; değişken
// herhangi bir nedenle pakete girmezse (EAS ortamı çözülemedi, profil farklı vb.)
// tanılama SESSİZCE tamamen kapanıyordu ve sahada bunu anlamanın hiçbir yolu yoktu.
// Artık yalnız açıkça 'false' yazılırsa kapanır. Özelliğin asıl kapısı zaten URL ve
// anahtarın varlığıdır (bkz. isLocationDiagnosticsAvailable) — onlar yoksa hiçbir
// istek üretilmez, dolayısıyla bu gevşetme yanlışlıkla veri toplamaya yol açmaz.
const FEATURE_ENABLED = process.env.EXPO_PUBLIC_LOCATION_DIAGNOSTICS_ENABLED !== 'false';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const SUPABASE_PUBLIC_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

type CaptureMode = 'foreground_received' | 'android_alarm_cold_start';

export type DiagnosticsNotification = {
  identifier: string;
  date: number | Date;
  data: Record<string, unknown>;
};

type ConsentRecord = {
  enabled: boolean;
  decidedAt: string;
  consentedAt?: string;
};

type DiagnosticsPayload = Record<string, unknown>;

/**
 * Kaydı hangi tetikleyicinin ürettiği. Sunucudaki `beacon_source` sütununun
 * CHECK listesiyle birebir aynı olmalı (20260805020000 migration'ı).
 *
 * NEDEN: asıl sorulan soru "uygulama arka planda gerçekten gönderiyor mu?".
 * `capture_mode` yalnız iki değer alabildiği için bütün arka plan yolları tek
 * kovaya düşüyordu. `location_service` / `workmanager` satırlarının varlığı
 * arka plan teslimatının doğrudan kanıtıdır.
 */
export type BeaconSource =
  | 'location_service'
  | 'workmanager'
  | 'foreground_timer'
  | 'app_active'
  | 'net_reconnect'
  | 'notification'
  | 'gps_sync'
  | 'manual'
  | 'outbox_flush';

/**
 * Sunucuda BULUNMAYABİLECEK sütunlar. PGRST204 ("şema önbelleğinde sütun yok")
 * alındığında bu alanlar sırayla düşürülüp istek yeniden denenir; böylece
 * migration'lar henüz uygulanmamışken de yeni istemci veri göndermeye devam eder.
 * Sıralama önem taşır: en yeni (en az kritik) sütun önce düşer.
 */
const OPTIONAL_PAYLOAD_COLUMNS = ['beacon_source', 'no_location_reason'] as const;

type DiagnosticsOutboxEntry = {
  eventId: string;
  queuedAt: number;
  payload: DiagnosticsPayload;
};

type UploadResult = 'sent' | 'retryable' | 'permanent';

const attemptsInFlight = new Set<string>();
let attemptClaimQueue: Promise<void> = Promise.resolve();
let permanentSignalQueue: Promise<void> = Promise.resolve();
let outboxQueue: Promise<void> = Promise.resolve();
let installationIdPromise: Promise<string> | null = null;
let diagnosticsStateGeneration = 0;
// Aynı saat kovası için eşzamanlı (önplan timer + arka plan görevi) çift göndermeyi engeller.
let beaconInFlightBucket: string | null = null;

async function claimEventAttempt(eventId: string): Promise<boolean> {
  let claimed = false;
  const operation = attemptClaimQueue.then(async () => {
    const raw = await AsyncStorage.getItem(ATTEMPT_HISTORY_KEY);
    let history: string[] = [];
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) history = parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      history = [];
    }
    if (history.includes(eventId)) return;
    claimed = true;
    await AsyncStorage.setItem(ATTEMPT_HISTORY_KEY, JSON.stringify([eventId, ...history].slice(0, 64)));
  });
  attemptClaimQueue = operation.catch(() => undefined);
  await operation;
  return claimed;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('diagnostics timeout')), timeoutMs);
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

function notificationDateToIso(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

async function getInstallationId(): Promise<string> {
  if (!installationIdPromise) {
    installationIdPromise = (async () => {
      const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
      if (existing) return existing;
      const created = Crypto.randomUUID();
      await AsyncStorage.setItem(INSTALLATION_ID_KEY, created);
      return created;
    })();
  }
  try {
    return await installationIdPromise;
  } catch (error) {
    installationIdPromise = null;
    throw error;
  }
}

async function permanentlyDisable(reason: string): Promise<void> {
  await AsyncStorage.setItem(DISABLED_KEY, JSON.stringify({ reason, disabledAt: new Date().toISOString() }));
  await AsyncStorage.removeItem(OUTBOX_KEY);
  await AsyncStorage.removeItem(PERMANENT_SIGNAL_KEY);
  await AsyncStorage.removeItem(PAUSED_UNTIL_KEY);
}

// Sunucuda düzeltilebilir bir hata (kısıt/şema/kapasite) doğrulandığında kalıcı
// kapatma yerine çağrılır: 6 saat boyunca hiç denenmez, sonra kendiliğinden
// yeniden başlar. Kuyruk KORUNUR; migration çalıştırılınca biriken kayıtlar gider.
async function pauseDiagnostics(reason: string): Promise<void> {
  await AsyncStorage.setItem(PAUSED_UNTIL_KEY, JSON.stringify({
    reason,
    pausedAt: new Date().toISOString(),
    until: Date.now() + pauseDurationMs(),
  }));
  // Duraklatma sonrası yeniden başlarken sayaç sıfırdan işlesin.
  await AsyncStorage.removeItem(PERMANENT_SIGNAL_KEY);
}

/** Geçici duraklatma sürüyor mu? Süresi dolan damga temizlenir. */
export async function isLocationDiagnosticsPaused(nowMs: number = Date.now()): Promise<boolean> {
  const raw = await AsyncStorage.getItem(PAUSED_UNTIL_KEY);
  if (!raw) return false;
  let until = 0;
  try {
    const parsed = JSON.parse(raw) as { until?: unknown };
    if (typeof parsed.until === 'number' && Number.isFinite(parsed.until)) until = parsed.until;
  } catch {
    until = 0;
  }
  // Cihaz saati ileri alınmışsa damga sonsuza dek geçerli görünmesin.
  if (nowMs < until && until - nowMs <= pauseDurationMs()) return true;
  await AsyncStorage.removeItem(PAUSED_UNTIL_KEY);
  return false;
}

/**
 * Açılışta bir kez çağrılır. Eski sürümlerde KALICI kapatılmış bir cihaz, kapatma
 * gerekçesi sunucuda düzeltilebilir sınıftaysa (400/422/PGRST204/kapasite) yeniden
 * etkinleştirilir. Tablo silinmesi (404/PGRST205) ve yetki iptali (401/403) kalıcı kalır.
 */
export async function reconcileDiagnosticsShutdownState(): Promise<'none' | 'kept' | 'cleared'> {
  // UZAKTAN DİRİLTME önce denenir. Panelde `kill_switch_reset_token` değiştiyse
  // kapatma gerekçesine BAKILMADAN yerel kapatma/duraklatma kayıtları silinir —
  // 404/PGRST205 ile kapanmış (yani "gerçekten kalıcı") cihazlar dahil. Tablo
  // yeniden oluşturulduğunda o cihazları geri getirmenin tek yolu budur ve
  // kararı veren sunucudur, cihaz değil.
  if (await consumeKillSwitchResetToken()) {
    await AsyncStorage.multiRemove([DISABLED_KEY, PERMANENT_SIGNAL_KEY, PAUSED_UNTIL_KEY]);
    return 'cleared';
  }

  const raw = await AsyncStorage.getItem(DISABLED_KEY);
  if (!raw) return 'none';
  let reason: unknown = null;
  try {
    reason = (JSON.parse(raw) as { reason?: unknown }).reason;
  } catch {
    reason = null;
  }
  if (!isRecoverableDisableReason(reason)) return 'kept';
  await AsyncStorage.multiRemove([DISABLED_KEY, PERMANENT_SIGNAL_KEY, PAUSED_UNTIL_KEY]);
  return 'cleared';
}

// Başarılı bir gönderimde (veya kopya) kalıcı-sinyal sayacını sıfırlar. Tablo yeniden
// oluşturulup tekrar 201 vermeye başlayınca kill-switch'in tetiklenmemesini sağlar.
async function resetPermanentSignal(): Promise<void> {
  const operation = permanentSignalQueue.then(() => AsyncStorage.removeItem(PERMANENT_SIGNAL_KEY));
  permanentSignalQueue = operation.catch(() => undefined);
  await operation;
}

// Sunucudan KESİN kalıcı bir yanıt (silinmiş tablo PGRST205/404, yetki 401/403, kısıt
// 400/422) geldiğinde çağrılır. Zaman-aralıklı sayaç: yalnız birbirinden en az
// permanentSignalSpacingMs() ayrı, art arda (araya başarı girmeden) 3 sinyal
// birikince kill-switch'i tetikler. Böylece tablo yeniden oluşturulurken geçici görülen
// PGRST205 (şema-cache tazelenmesi) yanlış pozitif üretmez. Ağ hataları buraya HİÇ gelmez.
// Dönüş: kalıcı olarak kapatılmalı mı?
async function recordPermanentSignal(): Promise<boolean> {
  let shouldDisable = false;
  const operation = permanentSignalQueue.then(async () => {
    const raw = await AsyncStorage.getItem(PERMANENT_SIGNAL_KEY);
    let count = 0;
    let lastAt = 0;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        count = Number.isInteger(parsed.count) && parsed.count > 0 ? parsed.count : 0;
        lastAt = Number.isFinite(parsed.lastAt) ? parsed.lastAt : 0;
      }
    } catch {
      count = 0;
      lastAt = 0;
    }
    const now = Date.now();
    // Aynı geçici pencere içindeki hızlı tekrarları saymayarak şema-cache blip'lerini ele.
    if (count === 0 || now - lastAt >= permanentSignalSpacingMs()) {
      count += 1;
      await AsyncStorage.setItem(PERMANENT_SIGNAL_KEY, JSON.stringify({ count, lastAt: now }));
    }
    shouldDisable = shouldDisableAfterRemoteFailures(count, getRemoteConfig().permanentSignalThreshold);
  });
  permanentSignalQueue = operation.catch(() => undefined);
  await operation;
  return shouldDisable;
}

export type DiagnosticsStatus = {
  featureFlag: boolean;
  hasUrl: boolean;
  hasKey: boolean;
  windowOpen: boolean;
  consent: boolean;
  disabledReason: string | null;
  pausedUntil: string | null;
  outboxCount: number;
  testerCode: string | null;
  lastAttemptAt: string | null;
  lastAttemptResult: string | null;
  lastBucket: string | null;
  // ── uzaktan yapılandırma (app_remote_config) ──────────────────────────────
  /** Config sunucudan çekilebildi mi? false ise aşağıdakiler YERLEŞİK varsayılanlardır. */
  configLoaded: boolean;
  /** Config'in en son başarıyla çekildiği an; hiç çekilmediyse null. */
  configFetchedAt: string | null;
  /** Yürürlükteki kayıt aralığı (dakika). */
  intervalMinutes: number;
  /** Yürürlükteki kesim anı — pencereyi uzatmak bu değeri değiştirmekle olur. */
  cutoffAt: string | null;
  /** Panelden yönetilen ana şalter. */
  remoteEnabled: boolean;
  /** Ön plan servisi (kalıcı bildirim) uzaktan açık mı? */
  foregroundServiceEnabled: boolean;
  /** WorkManager yolu uzaktan açık mı? */
  backgroundTaskEnabled: boolean;
  /** Koordinat toplanıyor mu? false ise yalnız "hayatta" kaydı gider. */
  collectLocation: boolean;
  /** Yürürlükteki konum doğruluğu. */
  locationAccuracy: string;
  /** Teşhis paneli gösterilsin mi? Sunucudan açılmadıkça false. */
  showPanel: boolean;
  /**
   * Çalışma ortamı — "arka plan neden çalışmıyor" sorusunun en sık cevabı.
   *
   * Expo Go'da `nativeApplicationVersion` Expo Go'nun kendi sürümünü (ör. 54.0.6)
   * ve `applicationId` `host.exp.exponent` döndürür. Bu ortamda WorkManager görevi
   * ve ön plan servisli konum güncellemeleri ÇALIŞMAZ — özel derleme şarttır.
   * Gerçek APK'da sürüm app.json'daki değerdir (1.4.0) ve paket adı projenindir.
   */
  runtimeVersion: string | null;
  runtimePackage: string | null;
  isExpoGo: boolean;
};

/**
 * Ayarlar'daki teşhis panelinin veri kaynağı. Üretim derlemesinde loglar
 * kaldırıldığı için sahada "neden veri gitmiyor" sorusunun tek yanıtı budur.
 */
export async function getDiagnosticsStatus(): Promise<DiagnosticsStatus> {
  const [disabledRaw, pausedRaw, consent, outboxRaw, lastAttemptRaw, lastBucket, installationId] =
    await Promise.all([
      AsyncStorage.getItem(DISABLED_KEY),
      AsyncStorage.getItem(PAUSED_UNTIL_KEY),
      getLocationDiagnosticsConsent(),
      AsyncStorage.getItem(OUTBOX_KEY),
      AsyncStorage.getItem(LAST_ATTEMPT_KEY),
      AsyncStorage.getItem(LAST_BEACON_HOUR_KEY),
      AsyncStorage.getItem(INSTALLATION_ID_KEY),
    ]);

  const readField = (raw: string | null, field: string): string | null => {
    if (!raw) return null;
    try {
      const value = (JSON.parse(raw) as Record<string, unknown>)[field];
      return value == null ? null : String(value);
    } catch {
      return null;
    }
  };

  const pausedUntilMs = Number(readField(pausedRaw, 'until') ?? NaN);
  const config = getRemoteConfig();
  const configFetchedAt = getRemoteConfigFetchedAt();

  return {
    featureFlag: FEATURE_ENABLED,
    configLoaded: isRemoteConfigLoaded(),
    configFetchedAt: configFetchedAt > 0 ? new Date(configFetchedAt).toISOString() : null,
    intervalMinutes: config.beaconIntervalMinutes,
    cutoffAt: Number.isFinite(config.cutoffMs) ? new Date(config.cutoffMs).toISOString() : null,
    remoteEnabled: config.diagnosticsEnabled,
    foregroundServiceEnabled: config.foregroundServiceEnabled,
    backgroundTaskEnabled: config.backgroundTaskEnabled,
    collectLocation: config.collectLocation,
    locationAccuracy: config.locationAccuracy,
    showPanel: config.showDiagnosticsPanel,
    runtimeVersion: Application.nativeApplicationVersion,
    runtimePackage: Application.applicationId,
    isExpoGo: Application.applicationId === 'host.exp.exponent',
    hasUrl: Boolean(SUPABASE_URL),
    hasKey: Boolean(SUPABASE_PUBLIC_KEY),
    windowOpen: windowOpen(),
    consent,
    disabledReason: readField(disabledRaw, 'reason'),
    pausedUntil: Number.isFinite(pausedUntilMs) ? new Date(pausedUntilMs).toISOString() : null,
    outboxCount: parseOutbox(outboxRaw).length,
    testerCode: installationId ? installationId.replace(/-/g, '').slice(0, 8).toUpperCase() : null,
    lastAttemptAt: readField(lastAttemptRaw, 'at'),
    lastAttemptResult: readField(lastAttemptRaw, 'result'),
    lastBucket,
  };
}

/**
 * Test penceresi açık mı — UZAKTAN yönetilen kesim anına göre.
 *
 * Bu dosyadaki bütün pencere kontrolleri buradan geçer. Uzaktan yapılandırma
 * okunamadıysa `getRemoteConfig()` varsayılanları döndürür, yani yerleşik
 * `LOCATION_DIAGNOSTICS_CUTOFF_ISO` geçerli olur — davranış değişmez.
 * Pencereyi uzatmak için tek yapılacak şey Supabase panelinde
 * `app_remote_config.diagnostics_cutoff` alanını ileri almaktır; sunucu tarafı
 * (RLS policy + temizlik job'ı) da aynı değeri okur.
 */
function windowOpen(): boolean {
  return isLocationDiagnosticsWindowOpen(Date.now(), getRemoteConfig().cutoffMs);
}

export function isLocationDiagnosticsAvailable(): boolean {
  // `diagnosticsEnabled`: panelden kapatılabilen ana şalter. Sunucu RLS'i de aynı
  // alanı okuyup insert'leri reddeder, yani güncellenmemiş istemciler de durur.
  return FEATURE_ENABLED &&
    Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY) &&
    getRemoteConfig().diagnosticsEnabled &&
    windowOpen();
}

// Kill-switch: sunucu tabloyu silince (PGRST205) veya kalıcı 4xx sonrası bu
// bayrak set edilir ve bir daha asla gönderilmez. Arka plan görevi de bunu
// görüp kendini iptal eder.
export async function isLocationDiagnosticsPermanentlyDisabled(): Promise<boolean> {
  return Boolean(await AsyncStorage.getItem(DISABLED_KEY));
}

/** "Her zaman konum" izni bu kurulumda daha önce istendi mi? */
export async function hasAskedBackgroundLocationPermission(): Promise<boolean> {
  return Boolean(await AsyncStorage.getItem(BACKGROUND_PERMISSION_ASKED_KEY));
}

/** İstemi göstermeden ÖNCE çağrılır: ayarlar sayfasında süreç öldürülse bile tekrar sormayalım. */
export async function markBackgroundLocationPermissionAsked(): Promise<void> {
  await AsyncStorage.setItem(BACKGROUND_PERMISSION_ASKED_KEY, new Date().toISOString());
}

export async function getLocationDiagnosticsConsent(): Promise<boolean> {
  if (!isLocationDiagnosticsAvailable()) return false;
  if (await AsyncStorage.getItem(DISABLED_KEY)) return false;
  const raw = await AsyncStorage.getItem(CONSENT_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    return parsed.enabled === true && typeof parsed.consentedAt === 'string';
  } catch {
    return false;
  }
}

export async function hasLocationDiagnosticsConsentDecision(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(CONSENT_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    return typeof parsed.enabled === 'boolean' &&
      (typeof parsed.decidedAt === 'string' || typeof parsed.consentedAt === 'string');
  } catch {
    return false;
  }
}

export async function setLocationDiagnosticsConsent(enabled: boolean): Promise<void> {
  if (!enabled) {
    diagnosticsStateGeneration += 1;
    await runOutboxOperation(async () => {
      await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify({
        enabled: false,
        decidedAt: new Date().toISOString(),
      } satisfies ConsentRecord));
      await AsyncStorage.removeItem(OUTBOX_KEY);
    });
    return;
  }
  if (!isLocationDiagnosticsAvailable()) return;
  const now = new Date().toISOString();
  await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify({
    enabled: true,
    decidedAt: now,
    consentedAt: now,
  } satisfies ConsentRecord));
}

export async function clearLocationDiagnosticsLocalState(): Promise<void> {
  diagnosticsStateGeneration += 1;
  await Promise.allSettled([
    attemptClaimQueue,
    permanentSignalQueue,
    outboxQueue,
    installationIdPromise ?? Promise.resolve(),
  ]);
  installationIdPromise = null;
  await AsyncStorage.multiRemove([
    CONSENT_KEY,
    DISABLED_KEY,
    INSTALLATION_ID_KEY,
    ATTEMPT_HISTORY_KEY,
    REMOTE_FAILURE_COUNT_KEY,
    PERMANENT_SIGNAL_KEY,
    PAUSED_UNTIL_KEY,
    BACKGROUND_PERMISSION_ASKED_KEY,
    LAST_BEACON_HOUR_KEY,
    OUTBOX_KEY,
  ]);
  // Uzaktan yapılandırma önbelleği de sıfırlanır: veri sıfırlama sonrası cihaz
  // yerleşik varsayılanlarla başlar ve config'i sunucudan yeniden çeker.
  await clearRemoteConfigCache();
}

function parseOutbox(raw: string | null): DiagnosticsOutboxEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is DiagnosticsOutboxEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<DiagnosticsOutboxEntry>;
      return typeof candidate.eventId === 'string' &&
        typeof candidate.queuedAt === 'number' &&
        candidate.payload != null &&
        typeof candidate.payload === 'object' &&
        !Array.isArray(candidate.payload);
    });
  } catch {
    return [];
  }
}

function validOutboxEntries(entries: DiagnosticsOutboxEntry[]): DiagnosticsOutboxEntry[] {
  const config = getRemoteConfig();
  return normalizeDiagnosticsOutboxEntries(entries, config.maxOutboxEntries, config.cutoffMs);
}

function runOutboxOperation(operation: () => Promise<void>): Promise<void> {
  const next = outboxQueue.then(operation);
  outboxQueue = next.catch(() => undefined);
  return next;
}

async function enqueueDiagnosticsPayload(eventId: string, payload: DiagnosticsPayload): Promise<void> {
  await runOutboxOperation(async () => {
    if (!(await getLocationDiagnosticsConsent()) || !windowOpen()) return;
    const entries = validOutboxEntries(parseOutbox(await AsyncStorage.getItem(OUTBOX_KEY)));
    const withoutDuplicate = entries.filter((entry) => entry.eventId !== eventId);
    const next = validOutboxEntries([...withoutDuplicate, { eventId, queuedAt: Date.now(), payload }]);
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
  });
}

/** Her denemenin sonucunu kalıcı olarak yazar (panelde gösterilir). Hata yutulur. */
async function recordAttempt(result: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_ATTEMPT_KEY, JSON.stringify({ at: new Date().toISOString(), result }));
  } catch {
    // Teşhis kaydı yazılamazsa akış etkilenmemeli.
  }
}

async function postDiagnosticsPayload(payload: DiagnosticsPayload): Promise<UploadResult> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      ...buildSupabasePublicHeaders(SUPABASE_PUBLIC_KEY),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    };
    response = await withTimeout(fetch(`${SUPABASE_URL}/rest/v1/notification_location_diagnostics`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }), requestTimeoutMs());
  } catch (error) {
    // KRİTİK AYRIM: fetch burada FIRLATTIYSA sunucuya hiç ulaşılamadı — internet yok,
    // DNS/TLS hatası, timeout ya da sunucu erişilemez. Bu bir "internet yok" durumudur,
    // "veritabanı silinmiş" DEĞİLDİR. Bu yüzden ASLA kill-switch tetiklemez; kayıt
    // kuyrukta bekler ve bağlantı gelince tekrar denenir. (Eski kod burada ardışık
    // hataları sayıp kalıcı kapatıyordu — bu, uzun süre çevrimdışı kalınca özelliği
    // yanlışlıkla öldürüyordu; kaldırıldı.)
    console.warn('[location-diagnostics] sunucuya ulaşılamadı (ağ/timeout) — kuyrukta beklenecek', error);
    await recordAttempt(`AĞ HATASI: ${error instanceof Error ? error.message : String(error)}`.slice(0, 120));
    return 'retryable';
  }

  // Buraya geldiysek sunucuya ULAŞILDI ve bir HTTP yanıtı döndü. Yani "internet var".
  // Aşağıdaki kalıcı/geçici sınıflandırması yalnız gerçek sunucu yanıtları içindir.
  //
  // Başarı ölçütü KESİN 201'dir: PostgREST, `Prefer: return=minimal` ile yapılan
  // insert'e 201 Created döner. Diğer 2xx'ler (ör. araya giren bir portal/proxy'nin
  // döndürdüğü 200 + HTML) kayıt düşmediği hâlde "gönderildi" sayılırdı; artık
  // kuyrukta bekletilip yeniden denenir. Gerçekten yazılmış bir kaydın tekrarı
  // benzersizlik kısıtına takılır (409/23505) ve zaten "gönderildi" sayılır.
  if (response.status === 201) {
    await recordAttempt('201 — kayıt gitti');
    await resetPermanentSignal();
    return 'sent';
  }
  if (response.ok) {
    console.warn('[location-diagnostics] beklenmeyen 2xx (kayıt doğrulanamadı) — kuyrukta beklenecek', response.status);
    return 'retryable';
  }

  let responseCode: string | undefined;
  let responseMessage: string | undefined;
  try {
    const body = await response.json() as { code?: unknown; message?: unknown };
    if (typeof body.code === 'string') responseCode = body.code;
    // Mesaj, PGRST204'te EKSİK SÜTUNUN ADINI taşır; teşhis için hayati.
    if (typeof body.message === 'string') responseMessage = body.message;
  } catch {
    // Gövde okunamasa da HTTP durum kodu sınıflandırma için yeterlidir.
  }

  await recordAttempt(`${response.status} ${responseCode ?? ''} ${responseMessage ?? ''}`.trim().slice(0, 160));

  if (isDuplicateDiagnosticsResponse(response.status, responseCode)) {
    await resetPermanentSignal();
    return 'sent';
  }

  // ŞEMA GERİYE UYUMLULUĞU: PGRST204 = "sütun şema önbelleğinde yok". Sunucudaki
  // migration'lar henüz uygulanmadıysa yeni sütunlar (`no_location_reason`,
  // `beacon_source`) yoktur ve bütün kayıtlar — koordinatlı olanlar bile —
  // reddedilir. 2026-08-04'te yaşanan durum tam olarak buydu.
  //
  // Çözüm: opsiyonel sütunları TEK TEK düşürüp yeniden dene. Her yeniden çağrıda
  // düşürülen alan artık payload'da bulunmadığından aynı alan ikinci kez seçilemez;
  // liste tükenince dal kapanır (sonsuz döngü yok). `no_location_reason` yalnız
  // NULL ise düşürülür — dolu olduğunda kaydın tek konum bilgisi odur, düşürmek
  // sunucudaki tutarlılık kısıtını çiğner.
  if (responseCode === 'PGRST204') {
    const droppable = OPTIONAL_PAYLOAD_COLUMNS.find(
      (column) =>
        column in payload && (column !== 'no_location_reason' || payload.no_location_reason == null)
    );
    if (droppable) {
      console.warn(`[location-diagnostics] eski şema algılandı, ${droppable} olmadan yeniden denenecek`, responseMessage);
      const { [droppable]: _omitted, ...legacyPayload } = payload;
      return postDiagnosticsPayload(legacyPayload);
    }
  }

  // Kalıcı istemci hatası = sunucu erişilebilir ama isteği kalıcı reddediyor:
  //   • tablo silinmiş/yok        → 404 + PGRST205
  //   • yetki yok / RLS           → 401 / 403
  //   • şema/kısıt uyuşmazlığı     → 400 / 422 (payload asla kendiliğinden düzelmez)
  // Bunların hiçbiri "internet yok" değildir. Yine de TEK bir PGRST205 geçici olabilir
  // (tablo yeniden oluşturulurken şema-cache tazelenene dek). Bu yüzden hemen kapatmıyoruz:
  // zaman-aralıklı doğrulama (recordPermanentSignal) 3 kez birikmeden kill-switch tetiklenmez.
  if (isPermanentDiagnosticsFailure(response.status, responseCode)) {
    if (await recordPermanentSignal()) {
      const reason = `remote-permanent-confirmed:${response.status}:${responseCode ?? 'unknown'}`;
      // Sunucuda düzeltilebilir sınıf (şema/kısıt/kapasite): kalıcı kapatma YERİNE
      // 6 saatlik duraklatma. Aksi hâlde tek bir sunucu hatası cihazdaki tanılamayı
      // sonsuza dek öldürüyordu. Tablo silinmesi/yetki iptali kalıcı kalmaya devam eder.
      if (isRecoverableDiagnosticsFailure(response.status, responseCode)) {
        await pauseDiagnostics(reason);
        console.warn('[location-diagnostics] geçici duraklatma (sunucu tarafı düzeltilebilir)', response.status, responseCode, responseMessage);
        return 'retryable';
      }
      await permanentlyDisable(reason);
      return 'permanent';
    }
    console.warn('[location-diagnostics] kalıcı sinyal (henüz doğrulanmadı, tekrar denenecek)', response.status, responseCode, responseMessage);
    return 'retryable';
  }

  // Geriye kalan (5xx / 408 / 429 / 425): sunucu geçici olarak veremiyor ama erişilebilir.
  // Kalıcı kapatma SAYILMAZ — kuyrukta beklet, sonra yeniden dene.
  console.warn('[location-diagnostics] geçici sunucu hatası — kuyrukta beklenecek', response.status, responseCode);
  return 'retryable';
}

export async function flushLocationDiagnosticsOutbox(): Promise<void> {
  if (!FEATURE_ENABLED || !SUPABASE_URL || !SUPABASE_PUBLIC_KEY || !windowOpen()) {
    await runOutboxOperation(() => AsyncStorage.removeItem(OUTBOX_KEY));
    return;
  }
  if (!(await getLocationDiagnosticsConsent())) return;
  // Geçici duraklatma: kuyruk KORUNUR, yalnız ağ denemesi yapılmaz.
  if (await isLocationDiagnosticsPaused()) return;
  // AĞ KAPISI — bilerek GEVŞEK: yalnız "hiç bağlantı yok" durumunda vazgeçilir.
  // `isInternetReachable`, Android'de işletim sisteminin NET_CAPABILITY_VALIDATED
  // yeteneğinden gelir ve VPN altında (ayrıca bazı kurumsal/filtreli ağlarda) internet
  // çalışırken bile false döner. Buna güvenmek, kuyruğun hiç boşalmadığı SESSİZ bir
  // ölüme yol açıyordu. Gerçekten bağlantı yoksa fetch zaten fırlatır ve kayıt
  // kuyrukta kalır — yani denemenin maliyeti yok, faydası büyük.
  const network = await NetInfo.fetch();
  if (network.isConnected === false) return;

  await runOutboxOperation(async () => {
    const entries = validOutboxEntries(parseOutbox(await AsyncStorage.getItem(OUTBOX_KEY)));
    const remaining: DiagnosticsOutboxEntry[] = [];

    for (let index = 0; index < entries.length; index += 1) {
      if (!(await getLocationDiagnosticsConsent()) || !windowOpen()) break;
      // Tek turda gönderim üst sınırı: arka plan görevinin süre bütçesi ve sunucudaki
      // saatlik insert sınırı için. Kalanlar bir sonraki tetiklemede gider.
      // Panelden ayarlanabilir (max_uploads_per_flush) — sunucudaki saatlik kotanın
      // altında tutulmalı, yoksa tek boşaltma kotayı yakıp P0001 üretir.
      if (index >= getRemoteConfig().maxUploadsPerFlush) {
        remaining.push(...entries.slice(index));
        break;
      }
      const result = await postDiagnosticsPayload(entries[index].payload);
      if (result === 'sent') continue;
      if (result === 'retryable') remaining.push(...entries.slice(index));
      break;
    }

    if (remaining.length > 0) {
      await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(validOutboxEntries(remaining)));
    } else {
      await AsyncStorage.removeItem(OUTBOX_KEY);
    }
  });
}

export async function captureNotificationLocation(
  notification: DiagnosticsNotification,
  captureMode: CaptureMode
): Promise<void> {
  if (!isLocationDiagnosticsAvailable()) return;
  // Uzaktan kapatılabilir: bildirim tetiklemeli yakalamayı kapatmak, vakit
  // bildirimlerinin KENDİSİNİ etkilemez — yalnız tanılama kaydını durdurur.
  if (!getRemoteConfig().notificationCaptureEnabled) return;
  if (notification.data.locationDiagnosticsEvent !== 'prayer_notification') return;
  if (!(await getLocationDiagnosticsConsent())) return;
  if (await isLocationDiagnosticsPaused()) return;
  const captureGeneration = diagnosticsStateGeneration;

  const notificationSentAt = notificationDateToIso(notification.date);
  const eventId = buildDiagnosticsEventId(notification.identifier, notificationSentAt);
  if (attemptsInFlight.has(eventId) || !(await claimEventAttempt(eventId))) return;

  attemptsInFlight.add(eventId);

  try {
    // Konumu almayı dene ama ZORUNLU kılma: alınamasa bile bildirimin tetiklendiğini
    // (asıl tanı sinyali) kaydet; koordinat yerine nedeni yazılır.
    // `collect_location=false`: koordinat HİÇ toplanmaz, yalnız "hayatta" kaydı
    // gider (nedeni `location_disabled_remotely`). İzin varmış gibi davranmıyoruz —
    // izin durumu ayrı bir bilgi, bu bilinçli bir kapatma.
    const collectLocation = getRemoteConfig().collectLocation;
    const permission = collectLocation
      ? await Location.getForegroundPermissionsAsync()
      : null;
    const permissionGranted = permission?.status === 'granted';
    let position: Location.LocationObject | null = null;
    if (permissionGranted) {
      try {
        position = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: getLocationAccuracy() }),
          requestTimeoutMs()
        );
      } catch (error) {
        console.warn('[location-diagnostics] current location unavailable', error);
      }
    }
    // Canlı fix yoksa uygulamanın kayıtlı koordinatına düş; o da yoksa nedeni yaz.
    // `collect_location=false` iken kayıtlı koordinat da KULLANILMAZ — aksi hâlde
    // uzaktan kapatma, kayıtlı konumun gönderilmeye devam etmesi yüzünden işe yaramazdı.
    const cachedCoords = position || !collectLocation ? null : await loadStoredAppCoords();
    const noLocationReason = position || cachedCoords
      ? null
      : await resolveNoLocationReason('foreground', permissionGranted);

    if (!windowOpen()) return;
    if (captureGeneration !== diagnosticsStateGeneration || !(await getLocationDiagnosticsConsent())) return;

    const userId = await getInstallationId();
    const payload = {
      installation_id: userId,
      tester_code: userId.replace(/-/g, '').slice(0, 8).toUpperCase(),
      device_name: clampText(Device.deviceName, 200),
      device_model: clampText(Device.modelName, 200),
      operating_system: clampText(Device.osName ?? Platform.OS, 200),
      operating_system_version: clampText(Device.osVersion, 100),
      app_version: clampText(Application.nativeApplicationVersion, 60),
      app_build_version: clampText(Application.nativeBuildVersion, 60),
      notification_id: notification.identifier,
      notification_kind: notification.data.notificationKind ?? 'prayer',
      prayer_key: notification.data.prayerKey ?? null,
      notification_sent_at: notificationSentAt,
      notification_scheduled_at:
        typeof notification.data.scheduledAt === 'string' ? notification.data.scheduledAt : null,
      captured_at: new Date().toISOString(),
      capture_mode: captureMode,
      latitude: position ? position.coords.latitude : cachedCoords ? cachedCoords.latitude : null,
      longitude: position ? position.coords.longitude : cachedCoords ? cachedCoords.longitude : null,
      // accuracy_m === null && latitude !== null  ->  kayıtlı (canlı olmayan) koordinat
      accuracy_m: position ? position.coords.accuracy : null,
      altitude_m: position ? position.coords.altitude : null,
      location_timestamp: position
        ? new Date(position.timestamp).toISOString()
        : cachedCoords
          ? new Date().toISOString()
          : null,
      no_location_reason: noLocationReason,
      beacon_source: 'notification' satisfies BeaconSource,
    };

    if (captureGeneration !== diagnosticsStateGeneration || !(await getLocationDiagnosticsConsent())) return;
    // Yalnız "hiç bağlantı yok" durumunda denemeden kuyruğa al (VPN gerekçesi için
    // bkz. flushLocationDiagnosticsOutbox içindeki açıklama).
    const network = await NetInfo.fetch();
    if (network.isConnected === false) {
      await enqueueDiagnosticsPayload(eventId, payload);
      return;
    }

    const result = await postDiagnosticsPayload(payload);
    if (result === 'retryable') await enqueueDiagnosticsPayload(eventId, payload);
  } catch (error) {
    console.warn('[location-diagnostics] capture skipped', error);
  } finally {
    attemptsInFlight.delete(eventId);
  }
}

// KAYIT aralığı: 15 dakika (saatte 4 kayıt). Geçerli kovayı ISO olarak döndürür
// (dakika :00/:15/:30/:45'e, saniye/ms sıfıra yuvarlanmış). Her kova için en fazla
// bir kayıt gider; bütün tetikleyiciler aynı kovaya düşer.
export const BEACON_INTERVAL_MINUTES = 15;

/**
 * Yürürlükteki kayıt aralığı (dakika). Kaynak: uzaktan yapılandırma
 * (`app_remote_config.beacon_interval_minutes`), okunamazsa yukarıdaki varsayılan.
 * Kadansı değiştirmek için panelde bu alanı düzenlemek yeterli — yeni build yok.
 */
export function getBeaconIntervalMinutes(): number {
  return getRemoteConfig().beaconIntervalMinutes;
}

function beaconBucketIso(now: Date = new Date()): string {
  const interval = getBeaconIntervalMinutes();
  const bucket = new Date(now);
  // Kova, GÜN İÇİ dakikaya göre hizalanır. `now.getMinutes()` yalnız saat içindeki
  // dakikayı verdiği için 60'ı bölmeyen aralıklarda (ör. 45 dk) kovalar her saat
  // başında kayıyordu; gün içi dakika kullanınca hizalama tutarlı kalır.
  const minutesIntoDay = now.getHours() * 60 + now.getMinutes();
  const bucketMinutes = Math.floor(minutesIntoDay / interval) * interval;
  bucket.setHours(Math.floor(bucketMinutes / 60), bucketMinutes % 60, 0, 0);
  return bucket.toISOString();
}

async function markBeaconBucketSent(bucketIso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_BEACON_HOUR_KEY, bucketIso);
  } catch (error) {
    console.warn('[location-diagnostics] beacon bucket could not be stored', error);
  }
}

/**
 * Metin alanlarını sunucudaki boyut kısıtlarının ALTINDA tutar.
 *
 * NEDEN: expo-device Android'de `osName` için önce `Build.VERSION.BASE_OS` döndürür
 * (DeviceModule.kt:170). Birçok üretici ROM'unda bu, tam bir yapı imzasıdır
 * ("Xiaomi/lisa/lisa:13/RKQ1.../V14...:user/release-keys") ve 64 baytlık sütun
 * kısıtını aşar. 2026-08-04'te sahadaki iki Android cihazın da sessizce
 * reddedilmesinin (23514 / diagnostics_operating_system_size) sebebi buydu;
 * iOS'ta aynı alan "iOS" olduğu için sorun hiç görünmüyordu.
 *
 * Sınırlar karakter cinsindendir ve sütunların bayt sınırlarına göre bilinçli
 * olarak muhafazakâr seçilmiştir (çok baytlı karakterlerde bile taşmaz).
 */
function clampText(value: string | null | undefined, maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars);
}

type StoredCoords = { latitude: number; longitude: number };

/**
 * Canlı konum alınamadığında son çare: uygulamanın namaz vakitlerini hesaplamak
 * için zaten kaydettiği koordinat.
 *
 * NEDEN: Arka planda (özellikle "her zaman" konum izni yokken) taze fix de son
 * bilinen konum da alınamıyor. Eskiden bu durumda koordinatsız satır gönderiliyor,
 * sunucu bunu reddediyor (location_timestamp NOT NULL) ve cihaz kill-switch'e
 * gidiyordu — yani hiç veri gelmiyordu. Kayıtlı koordinat kullanınca kayıt her
 * zaman geçerli oluyor ve migration'a bağımlılık ortadan kalkıyor.
 *
 * VERİ KALİTESİ: Bu kayıtlar canlı ölçüm DEĞİLDİR. İki işaretle ayırt edilir:
 *   • beacon'da notification_id  -> "beacon-cached:<kova>"
 *   • her iki yolda accuracy_m   -> null (canlı Android fix'i her zaman doğruluk taşır)
 */
async function loadStoredAppCoords(): Promise<StoredCoords | null> {
  try {
    const stored = await loadAppState<{ coords?: unknown }>();
    const coords = stored?.coords;
    if (!coords || typeof coords !== 'object' || Array.isArray(coords)) return null;
    const { latitude, longitude } = coords as Partial<StoredCoords>;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

type NoLocationReason =
  | 'permission_denied'
  | 'services_disabled'
  | 'position_unavailable'
  | 'background_no_fix'
  | 'location_disabled_remotely';

// Konum alınamadığında NEDENİNİ sınıflandırır. Böylece koordinatsız kayıtta
// "izin mi yok, GPS mi kapalı, sabit mi alınamadı, uzaktan mı kapatıldı" ayırt edilebilir.
async function resolveNoLocationReason(
  source: 'foreground' | 'background',
  permissionGranted: boolean
): Promise<NoLocationReason> {
  // Uzaktan kapatma, izin durumundan ÖNCE gelir: sebebin "izin yok" görünmesi
  // saha analizinde yanlış sonuca götürürdü.
  if (!getRemoteConfig().collectLocation) return 'location_disabled_remotely';
  if (!permissionGranted) return 'permission_denied';
  try {
    if (!(await Location.hasServicesEnabledAsync())) return 'services_disabled';
  } catch {
    // Servis durumu okunamadıysa aşağıdaki genel nedene düş.
  }
  return source === 'background' ? 'background_no_fix' : 'position_unavailable';
}

async function acquireBeaconPosition(): Promise<Location.LocationObject | null> {
  try {
    return await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: getLocationAccuracy() }),
      requestTimeoutMs()
    );
  } catch (error) {
    console.warn('[location-diagnostics] beacon current position unavailable, trying last known', error);
    try {
      return await Location.getLastKnownPositionAsync();
    } catch (fallbackError) {
      console.warn('[location-diagnostics] beacon last known position unavailable', fallbackError);
      return null;
    }
  }
}

/**
 * 30 dakikalık konum beacon'u. Çağıran tetikleyiciler:
 *   • önplan zamanlayıcısı (5 dk) ve açılış/rıza telafisi           — App.tsx
 *   • AppState 'active' ve NetInfo 'online' geçişleri                — App.tsx
 *   • namaz bildirimi alındığında / bildirime dokunulduğunda         — App.tsx
 *   • GPS senkronu taze konum aldığında (position devredilir)        — App.tsx
 *   • arka plan görevi (WorkManager, 15 dk deneme aralığı)           — backgroundBeacon.ts
 *
 * 30-dk kova tekilleştirmesi hepsini pencere başına tek kayda indirir.
 *
 * @param options.position Çağıran taze bir konum ölçümüne zaten sahipse devreder;
 *   böylece ikinci bir GPS isteği yapılmaz ve kayıt kesinlikle koordinatlı olur.
 */
export async function sendDiagnosticsBeacon(
  source: 'foreground' | 'background',
  options?: {
    position?: Location.LocationObject | null;
    force?: boolean;
    /**
     * Kaydı üreten tetikleyici. `beacon_source` sütununa yazılır ve "arka planda
     * gerçekten gönderdi mi" sorusunun veriden cevaplanmasını sağlar. Verilmezse
     * `source`'a göre kabaca türetilir.
     */
    beaconSource?: BeaconSource;
  }
): Promise<void> {
  // `force`: Ayarlar'daki "şimdi dene" düğmesi. Kova ve duraklatma atlanır ki
  // kullanıcı sonucu anında görebilsin; rıza ve kalıcı kapatma yine bağlayıcıdır.
  const force = options?.force === true;
  if (!isLocationDiagnosticsAvailable()) return;
  if (await isLocationDiagnosticsPermanentlyDisabled()) return;
  if (!(await getLocationDiagnosticsConsent())) return;
  if (!force && (await isLocationDiagnosticsPaused())) return;

  const bucketIso = beaconBucketIso();
  // Bu kova zaten gönderildi mi? (kalıcı, yeniden başlatmayı da kapsar)
  if (!force && (await AsyncStorage.getItem(LAST_BEACON_HOUR_KEY)) === bucketIso) return;
  // Eşzamanlı çağrılar arasında bellek-içi kilit.
  if (beaconInFlightBucket === bucketIso) return;
  beaconInFlightBucket = bucketIso;

  const captureGeneration = diagnosticsStateGeneration;
  const eventId = `beacon:${bucketIso}`;

  try {
    // Konum sırası: (1) çağıranın devrettiği taze ölçüm, (2) canlı fix / son bilinen
    // konum, (3) uygulamanın vakit hesabı için kaydettiği koordinat, (4) hiçbiri yoksa
    // koordinatsız "hayatta" kaydı + nedeni.
    // `collect_location=false` iken hiçbir koordinat kullanılmaz: çağıranın
    // devrettiği taze ölçüm de, kayıtlı koordinat da atılır. Yalnız "hayatta"
    // kaydı gider (neden: location_disabled_remotely).
    const collectLocation = getRemoteConfig().collectLocation;
    let position = collectLocation ? options?.position ?? null : null;
    let permissionGranted = true;
    if (!position && collectLocation) {
      const permission = await Location.getForegroundPermissionsAsync();
      permissionGranted = permission.status === 'granted';
      position = permissionGranted ? await acquireBeaconPosition() : null;
    }
    const cachedCoords = position || !collectLocation ? null : await loadStoredAppCoords();
    const noLocationReason = position || cachedCoords
      ? null
      : await resolveNoLocationReason(source, permissionGranted);

    if (!windowOpen()) return;
    if (captureGeneration !== diagnosticsStateGeneration || !(await getLocationDiagnosticsConsent())) return;

    const userId = await getInstallationId();
    const nowIso = new Date().toISOString();
    const payload = {
      installation_id: userId,
      tester_code: userId.replace(/-/g, '').slice(0, 8).toUpperCase(),
      device_name: clampText(Device.deviceName, 200),
      device_model: clampText(Device.modelName, 200),
      operating_system: clampText(Device.osName ?? Platform.OS, 200),
      operating_system_version: clampText(Device.osVersion, 100),
      app_version: clampText(Application.nativeApplicationVersion, 60),
      app_build_version: clampText(Application.nativeBuildVersion, 60),
      // Kayıtlı koordinatla gönderilen kayıtlar analizde ayırt edilebilsin.
      notification_id: cachedCoords ? `beacon-cached:${bucketIso}` : eventId,
      notification_kind: 'prayer',
      prayer_key: null,
      notification_sent_at: nowIso,
      notification_scheduled_at: bucketIso,
      captured_at: nowIso,
      // capture_mode DB'de CHECK constraint'li; sadece izinli iki değer kullanılabilir.
      // Önplan/arka plan ayrımını buradan koruyoruz.
      capture_mode: source === 'background' ? 'android_alarm_cold_start' : 'foreground_received',
      latitude: position ? position.coords.latitude : cachedCoords ? cachedCoords.latitude : null,
      longitude: position ? position.coords.longitude : cachedCoords ? cachedCoords.longitude : null,
      // accuracy_m === null && latitude !== null  ->  kayıtlı (canlı olmayan) koordinat
      accuracy_m: position ? position.coords.accuracy : null,
      altitude_m: position ? position.coords.altitude : null,
      location_timestamp: position ? new Date(position.timestamp).toISOString() : cachedCoords ? nowIso : null,
      no_location_reason: noLocationReason,
      beacon_source:
        options?.beaconSource ??
        // Etiket verilmediyse kaba türetme. Çağrı yerlerinin hepsi açıkça etiket
        // geçiyor; bu yalnız ileride eklenecek bir çağrı için güvenli varsayılan.
        ((source === 'background' ? 'workmanager' : 'foreground_timer') satisfies BeaconSource),
    };

    if (captureGeneration !== diagnosticsStateGeneration || !(await getLocationDiagnosticsConsent())) return;

    // Yalnız "hiç bağlantı yok" durumunda denemeden kuyruğa al; `isInternetReachable`
    // VPN altında yanlışlıkla false döndüğü için tek başına ölçüt alınamaz.
    const network = await NetInfo.fetch();
    if (network.isConnected === false) {
      await enqueueDiagnosticsPayload(eventId, payload);
      await markBeaconBucketSent(bucketIso);
      return;
    }

    const result = await postDiagnosticsPayload(payload);
    if (result === 'sent') {
      await markBeaconBucketSent(bucketIso);
    } else if (result === 'retryable') {
      await enqueueDiagnosticsPayload(eventId, payload);
      await markBeaconBucketSent(bucketIso);
    }
    // 'permanent' → postDiagnosticsPayload zaten permanentlyDisable() çağırdı; saati işaretlemeyiz.
  } catch (error) {
    console.warn('[location-diagnostics] beacon skipped', error);
  } finally {
    beaconInFlightBucket = null;
  }
}
