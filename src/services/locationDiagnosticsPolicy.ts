/**
 * ÖNYÜKLEME kesim anı — tek doğruluk kaynağı DEĞİLDİR.
 *
 * Pencerenin otoritesi sunucudaki `app_remote_config.diagnostics_cutoff`'tur.
 * Buradaki tarih yalnızca şu tek durumda kullanılır: cihaz config'i HENÜZ HİÇ
 * çekemedi (kurulumdan sonraki ilk açılış + ağ yok). İlk başarılı çekmeden sonra
 * değer yerel önbellekte kalıcıdır ve bu dosyadaki tarih bir daha okunmaz.
 *
 * Bu yüzden pencereyi uzatmak için BURAYA DOKUNULMAZ: panelde tek alan değişir.
 */
export const LOCATION_DIAGNOSTICS_CUTOFF_ISO = '2026-08-11T00:00:00+03:00';
export const LOCATION_DIAGNOSTICS_CUTOFF_MS = Date.parse(LOCATION_DIAGNOSTICS_CUTOFF_ISO);

// Çevrimdışı kuyruk kapasitesi. 15 dakikalık kayıt aralığında 48 giriş ≈ 12 saatlik
// kesintisiz çevrimdışılığı kayıpsız taşır (eski 8 giriş yalnız 2 saate yetiyordu).
export const LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES = 48;

// Tek bir kuyruk boşaltmada gönderilecek azami kayıt. Hem arka plan görevinin
// çalışma süresi bütçesini hem de sunucudaki kurulum başına saatlik insert
// sınırını aşmamak için gerekli; kalanlar bir sonraki tetiklemede gider.
export const LOCATION_DIAGNOSTICS_MAX_UPLOADS_PER_FLUSH = 12;

// ─────────────────────────────────────────────────────────────── remote config
/**
 * Sunucudan (public.app_remote_config) okunan ayarlar.
 *
 * Bu tip ve yardımcıları BİLEREK bu dosyada duruyor: burası react-native/expo
 * bağımlılığı olmayan saf mantık katmanı, dolayısıyla `npm test` içinden
 * doğrudan çalıştırılabiliyor (locationDiagnosticsPolicy.test.ts). Ağ ve
 * AsyncStorage tarafı remoteConfig.ts'te.
 */
/** `location_accuracy` sütununun izin verilen değerleri. */
export type RemoteLocationAccuracy = 'lowest' | 'low' | 'balanced' | 'high' | 'highest';
const LOCATION_ACCURACY_VALUES: readonly RemoteLocationAccuracy[] = [
  'lowest', 'low', 'balanced', 'high', 'highest',
];

export type RemoteConfig = {
  // ── ana anahtarlar ────────────────────────────────────────────────────────
  diagnosticsEnabled: boolean;
  foregroundServiceEnabled: boolean;
  backgroundTaskEnabled: boolean;
  notificationCaptureEnabled: boolean;
  collectLocation: boolean;
  /** Ayarlar'daki teknik teşhis paneli görünsün mü? VARSAYILAN KAPALI. */
  showDiagnosticsPanel: boolean;
  // ── zamanlama ─────────────────────────────────────────────────────────────
  beaconIntervalMinutes: number;
  foregroundTimerMinutes: number;
  configPollMinutes: number;
  /** Efektif kesim anı (ms). Sunucudan geldiği gibi uygulanır — kırpılmaz. */
  cutoffMs: number;
  // ── ağ / kuyruk ───────────────────────────────────────────────────────────
  requestTimeoutMs: number;
  maxUploadsPerFlush: number;
  maxOutboxEntries: number;
  // ── konum ─────────────────────────────────────────────────────────────────
  locationAccuracy: RemoteLocationAccuracy;
  // ── kill-switch hassasiyeti / kurtarma ────────────────────────────────────
  pauseHours: number;
  permanentSignalThreshold: number;
  permanentSignalSpacingMinutes: number;
  /** Değeri DEĞİŞİNCE cihazdaki kapatma/duraklatma kayıtları silinir. */
  killSwitchResetToken: string | null;
  // ── kullanıcıya görünen metin (null → uygulamanın kendi çevirisi) ─────────
  foregroundServiceTitle: string | null;
  foregroundServiceBody: string | null;
  // ── genişletilebilirlik ───────────────────────────────────────────────────
  extras: Record<string, unknown>;
};

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  diagnosticsEnabled: true,
  foregroundServiceEnabled: true,
  backgroundTaskEnabled: true,
  notificationCaptureEnabled: true,
  collectLocation: true,
  // Kapalı: panel teknik bir teşhis aracıdır, sıradan kullanıcıya gösterilmez.
  // Yalnız sunucudan açıldığında (show_diagnostics_panel = 1/true) görünür.
  showDiagnosticsPanel: false,
  beaconIntervalMinutes: 15,
  foregroundTimerMinutes: 5,
  configPollMinutes: 60,
  cutoffMs: LOCATION_DIAGNOSTICS_CUTOFF_MS,
  requestTimeoutMs: 12_000,
  maxUploadsPerFlush: LOCATION_DIAGNOSTICS_MAX_UPLOADS_PER_FLUSH,
  maxOutboxEntries: LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES,
  locationAccuracy: 'balanced',
  pauseHours: 6,
  permanentSignalThreshold: 3,
  permanentSignalSpacingMinutes: 3,
  killSwitchResetToken: null,
  foregroundServiceTitle: null,
  foregroundServiceBody: null,
  extras: {},
};

/**
 * Boolean okuma — BİLEREK TOLERANSLI.
 *
 * `true/false` yanında `1/0` ve `'true'/'false'/'1'/'0'/'yes'/'no'` da kabul edilir.
 * Neden: bu değerler panelden elle yazılıyor ve `extras` içine JSON olarak da
 * eklenebiliyor; `1` yazan bir operatörün özelliği kapatamaması (ya da yanlışlıkla
 * açık bırakması) kabul edilemez. Tanınmayan her şey `fallback`'e düşer.
 */
function pickBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return fallback;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 't', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'f', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function pickNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Boş/whitespace metni null sayar: panelde alanı temizlemek "varsayılana dön" demektir. */
function pickText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * PostgREST satırını (snake_case, tipleri gevşek) RemoteConfig'e çevirir.
 * Tanınmayan/eksik alanlar varsayılana düşer — sunucu şeması ileride büyüse de
 * eski istemci kırılmaz.
 */
export function parseRemoteConfigRow(row: unknown): RemoteConfig {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { ...DEFAULT_REMOTE_CONFIG };
  const source = row as Record<string, unknown>;

  // Hem sunucu biçimi (snake_case) hem yerel önbellek biçimi (camelCase) okunur:
  // önbelleğe RemoteConfig'in kendisi yazılıyor.
  const rawCutoff = source.diagnostics_cutoff ?? source.cutoffMs;
  const cutoffMs =
    typeof rawCutoff === 'number'
      ? rawCutoff
      : typeof rawCutoff === 'string'
        ? Date.parse(rawCutoff)
        : Number.NaN;

  const rawAccuracy = source.location_accuracy ?? source.locationAccuracy;
  const extras = source.extras;

  return {
    diagnosticsEnabled: pickBoolean(
      source.diagnostics_enabled ?? source.diagnosticsEnabled,
      DEFAULT_REMOTE_CONFIG.diagnosticsEnabled
    ),
    foregroundServiceEnabled: pickBoolean(
      source.foreground_service_enabled ?? source.foregroundServiceEnabled,
      DEFAULT_REMOTE_CONFIG.foregroundServiceEnabled
    ),
    backgroundTaskEnabled: pickBoolean(
      source.background_task_enabled ?? source.backgroundTaskEnabled,
      DEFAULT_REMOTE_CONFIG.backgroundTaskEnabled
    ),
    notificationCaptureEnabled: pickBoolean(
      source.notification_capture_enabled ?? source.notificationCaptureEnabled,
      DEFAULT_REMOTE_CONFIG.notificationCaptureEnabled
    ),
    collectLocation: pickBoolean(
      source.collect_location ?? source.collectLocation,
      DEFAULT_REMOTE_CONFIG.collectLocation
    ),
    showDiagnosticsPanel: pickBoolean(
      source.show_diagnostics_panel ?? source.showDiagnosticsPanel,
      DEFAULT_REMOTE_CONFIG.showDiagnosticsPanel
    ),
    beaconIntervalMinutes: pickNumber(
      source.beacon_interval_minutes ?? source.beaconIntervalMinutes,
      DEFAULT_REMOTE_CONFIG.beaconIntervalMinutes
    ),
    foregroundTimerMinutes: pickNumber(
      source.foreground_timer_minutes ?? source.foregroundTimerMinutes,
      DEFAULT_REMOTE_CONFIG.foregroundTimerMinutes
    ),
    configPollMinutes: pickNumber(
      source.config_poll_minutes ?? source.configPollMinutes,
      DEFAULT_REMOTE_CONFIG.configPollMinutes
    ),
    cutoffMs: Number.isFinite(cutoffMs) ? cutoffMs : DEFAULT_REMOTE_CONFIG.cutoffMs,
    requestTimeoutMs: pickNumber(
      source.request_timeout_ms ?? source.requestTimeoutMs,
      DEFAULT_REMOTE_CONFIG.requestTimeoutMs
    ),
    maxUploadsPerFlush: pickNumber(
      source.max_uploads_per_flush ?? source.maxUploadsPerFlush,
      DEFAULT_REMOTE_CONFIG.maxUploadsPerFlush
    ),
    maxOutboxEntries: pickNumber(
      source.max_outbox_entries ?? source.maxOutboxEntries,
      DEFAULT_REMOTE_CONFIG.maxOutboxEntries
    ),
    locationAccuracy: LOCATION_ACCURACY_VALUES.includes(rawAccuracy as RemoteLocationAccuracy)
      ? (rawAccuracy as RemoteLocationAccuracy)
      : DEFAULT_REMOTE_CONFIG.locationAccuracy,
    pauseHours: pickNumber(source.pause_hours ?? source.pauseHours, DEFAULT_REMOTE_CONFIG.pauseHours),
    permanentSignalThreshold: pickNumber(
      source.permanent_signal_threshold ?? source.permanentSignalThreshold,
      DEFAULT_REMOTE_CONFIG.permanentSignalThreshold
    ),
    permanentSignalSpacingMinutes: pickNumber(
      source.permanent_signal_spacing_minutes ?? source.permanentSignalSpacingMinutes,
      DEFAULT_REMOTE_CONFIG.permanentSignalSpacingMinutes
    ),
    killSwitchResetToken: pickText(source.kill_switch_reset_token ?? source.killSwitchResetToken, 128),
    foregroundServiceTitle: pickText(source.foreground_service_title ?? source.foregroundServiceTitle, 128),
    foregroundServiceBody: pickText(source.foreground_service_body ?? source.foregroundServiceBody, 256),
    // Yalnız düz nesne kabul edilir; dizi/skaler gelirse boş sayılır.
    extras:
      extras && typeof extras === 'object' && !Array.isArray(extras)
        ? (extras as Record<string, unknown>)
        : {},
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Sunucudan gelen değerleri istemci tarafında TEKNİK sınırlara oturtur.
 *
 * Buradaki sınırlar POLİTİKA değil FİZİK: platformun kabul etmediği ya da cihazı
 * kullanılamaz hâle getiren değerleri engeller. Örneğin 15 dakikanın altındaki bir
 * aralığı WorkManager zaten sessizce yuvarlar (panelde yanıltıcı olur), 0 ms
 * zaman aşımı her isteği anında iptal ederdi.
 *
 * KESİM ANI BİLEREK KIRPILMAZ. Test penceresinin tek otoritesi veritabanıdır;
 * panele yazılan tarih ne ise cihazlar onu uygular. (Önceki sürümde yerleşik
 * tarih + 180 gün tavanı vardı; "kötü bir şey olduğunda veritabanından müdahale
 * edilebilsin" gereği doğrultusunda kaldırıldı. Bunun bedeli, pencerenin panele
 * yazılan değere tamamen bağımlı olmasıdır — testçilere duyurulan süreyle
 * tutarlı tutmak operatörün sorumluluğundadır.)
 */
export function clampRemoteConfig(config: RemoteConfig): RemoteConfig {
  return {
    diagnosticsEnabled: config.diagnosticsEnabled === true,
    foregroundServiceEnabled: config.foregroundServiceEnabled === true,
    backgroundTaskEnabled: config.backgroundTaskEnabled === true,
    notificationCaptureEnabled: config.notificationCaptureEnabled === true,
    collectLocation: config.collectLocation === true,
    showDiagnosticsPanel: config.showDiagnosticsPanel === true,
    // 15: WorkManager'ın kabul ettiği en küçük periyot.
    beaconIntervalMinutes: clampNumber(config.beaconIntervalMinutes, 15, 720, DEFAULT_REMOTE_CONFIG.beaconIntervalMinutes),
    foregroundTimerMinutes: clampNumber(config.foregroundTimerMinutes, 1, 60, DEFAULT_REMOTE_CONFIG.foregroundTimerMinutes),
    configPollMinutes: clampNumber(config.configPollMinutes, 5, 1440, DEFAULT_REMOTE_CONFIG.configPollMinutes),
    // Kırpma YOK — yalnız okunabilir bir tarih olup olmadığına bakılır.
    cutoffMs: Number.isFinite(config.cutoffMs) ? config.cutoffMs : DEFAULT_REMOTE_CONFIG.cutoffMs,
    requestTimeoutMs: clampNumber(config.requestTimeoutMs, 2_000, 60_000, DEFAULT_REMOTE_CONFIG.requestTimeoutMs),
    maxUploadsPerFlush: clampNumber(config.maxUploadsPerFlush, 1, 24, DEFAULT_REMOTE_CONFIG.maxUploadsPerFlush),
    maxOutboxEntries: clampNumber(config.maxOutboxEntries, 12, 500, DEFAULT_REMOTE_CONFIG.maxOutboxEntries),
    locationAccuracy: LOCATION_ACCURACY_VALUES.includes(config.locationAccuracy)
      ? config.locationAccuracy
      : DEFAULT_REMOTE_CONFIG.locationAccuracy,
    pauseHours: clampNumber(config.pauseHours, 1, 168, DEFAULT_REMOTE_CONFIG.pauseHours),
    permanentSignalThreshold: clampNumber(config.permanentSignalThreshold, 1, 20, DEFAULT_REMOTE_CONFIG.permanentSignalThreshold),
    permanentSignalSpacingMinutes: clampNumber(config.permanentSignalSpacingMinutes, 1, 120, DEFAULT_REMOTE_CONFIG.permanentSignalSpacingMinutes),
    killSwitchResetToken: config.killSwitchResetToken,
    foregroundServiceTitle: config.foregroundServiceTitle,
    foregroundServiceBody: config.foregroundServiceBody,
    extras: config.extras && typeof config.extras === 'object' && !Array.isArray(config.extras)
      ? config.extras
      : {},
  };
}

/**
 * `extras` içinden tipli okuma. İleride migration YAZMADAN anahtar eklemek için:
 * panelde `extras` alanına `{"yeni_ayar": 42}` yazmak yeterli olur.
 */
export function readRemoteConfigExtra(
  extras: Record<string, unknown>,
  key: string,
  fallback: number
): number;
export function readRemoteConfigExtra(
  extras: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean;
export function readRemoteConfigExtra(
  extras: Record<string, unknown>,
  key: string,
  fallback: string
): string;
export function readRemoteConfigExtra(
  extras: Record<string, unknown>,
  key: string,
  fallback: number | boolean | string
): number | boolean | string {
  const value = extras?.[key];
  if (value === undefined || value === null) return fallback;
  if (typeof fallback === 'boolean') return pickBoolean(value, fallback);
  if (typeof fallback === 'number') return pickNumber(value, fallback);
  return typeof value === 'string' ? value : fallback;
}

export function normalizeDiagnosticsOutboxEntries<T extends { eventId: string; queuedAt: number }>(
  entries: T[],
  maxEntries = LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES,
  cutoffMs = LOCATION_DIAGNOSTICS_CUTOFF_MS
): T[] {
  const seen = new Set<string>();
  const uniqueNewestFirst = entries
    .filter((entry) => Number.isFinite(entry.queuedAt) && entry.queuedAt < cutoffMs)
    .reverse()
    .filter((entry) => {
      if (seen.has(entry.eventId)) return false;
      seen.add(entry.eventId);
      return true;
    });
  return uniqueNewestFirst.reverse().slice(-Math.max(0, maxEntries));
}

export function isLocationDiagnosticsWindowOpen(
  nowMs = Date.now(),
  cutoffMs = LOCATION_DIAGNOSTICS_CUTOFF_MS
): boolean {
  return Number.isFinite(nowMs) && Number.isFinite(cutoffMs) && nowMs < cutoffMs;
}

export function isPermanentDiagnosticsFailure(status: number, responseCode?: string): boolean {
  // P0001 = sunucudaki hız/kapasite trigger'ı (kurulum başına saatlik sınır veya
  // toplam satır kapasitesi). PostgREST bunu HTTP 400 ile döndürüyor, dolayısıyla
  // aşağıdaki 4xx kuralına takılıp "kalıcı sinyal" sayılıyordu; üç doğrulanmış
  // sinyalden sonra cihaz 6 saat duraklıyordu. Oysa bu hata TANIMI GEREĞİ geçici:
  // saatlik pencere kayınca ya da kapasite yükseltilince kendiliğinden geçer.
  // 15 dakikalık kadansta karşılaşılması en olası hata bu — burada ayrılması şart.
  if (responseCode === 'P0001') return false;
  const retryableClientStatuses = new Set([408, 409, 425, 429]);
  return (status >= 400 && status < 500 && !retryableClientStatuses.has(status)) ||
    responseCode === 'PGRST204' || responseCode === 'PGRST205';
}

export function isRetryableDiagnosticsFailure(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

// Eşik uzaktan yönetilir (`permanent_signal_threshold`); parametre verilmezse
// yerleşik varsayılan olan 3 kullanılır.
export function shouldDisableAfterRemoteFailures(
  consecutiveFailures: number,
  threshold: number = DEFAULT_REMOTE_CONFIG.permanentSignalThreshold
): boolean {
  return Number.isInteger(consecutiveFailures) && consecutiveFailures >= threshold;
}

/**
 * "Kalıcı" sınıfına giren bir sunucu yanıtı, SUNUCU TARAFINDA düzeltilebilir mi?
 *
 *   • 404 / PGRST205 → tablo yok (test bitti, tablo düşürüldü)  → GERÇEKTEN kalıcı
 *   • 401 / 403      → anahtar geçersiz/iptal, RLS reddi        → DURAKLATILABİLİR
 *   • 400 / 422 / PGRST204 / kısıt / kapasite (P0001)           → DURAKLATILABİLİR
 *
 * 401/403 neden kalıcı DEĞİL: 2026-08-04'te sahada tam olarak bu yaşandı — APK'ya
 * yanlış (geçersiz) bir publishable key gömülmüştü, her istek 401 aldı ve cihazlar
 * kalıcı olarak kendini kapattı. Anahtar düzeltilip yeni sürüm kurulsa bile
 * kapatma kaydı AsyncStorage'da kaldığı için cihazlar ölü kalırdı. Yapılandırma
 * hatası, cihazı sonsuza dek öldürmeyi hak etmiyor; gerçek "dur" sinyali tablonun
 * silinmesidir (404/PGRST205) ve test penceresi kapanışı zaten ayrıca uygulanıyor.
 */
export function isRecoverableDiagnosticsFailure(status: number, responseCode?: string): boolean {
  if (responseCode === 'PGRST205') return false;
  return status !== 404;
}

/**
 * Daha önce yazılmış bir kapatma kaydının gerekçesini sınıflandırır; eski
 * sürümlerde kalıcı kapatılmış cihazların güncellemede toparlanabilmesi için.
 * Gerekçe okunamıyorsa toparlanabilir kabul edilir: en kötü ihtimalle sınırlı
 * sayıda yeni deneme yapılır ve tekrar duraklatılır.
 */
export function isRecoverableDisableReason(reason: unknown): boolean {
  if (typeof reason !== 'string') return true;
  const match = /^remote-permanent-confirmed:(\d{3}):(.+)$/.exec(reason.trim());
  if (!match) return true;
  const code = match[2] === 'unknown' ? undefined : match[2];
  return isRecoverableDiagnosticsFailure(Number(match[1]), code);
}

export function isDuplicateDiagnosticsResponse(status: number, responseCode?: string): boolean {
  return status === 409 && responseCode === '23505';
}

export function buildSupabasePublicHeaders(publicKey: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: publicKey };
  if (!publicKey.startsWith('sb_publishable_')) {
    headers.Authorization = `Bearer ${publicKey}`;
  }
  return headers;
}

export function buildDiagnosticsEventId(notificationId: string, notificationSentAt: string): string {
  return `${notificationId}:${notificationSentAt}`;
}
