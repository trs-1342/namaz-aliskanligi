import assert from 'node:assert/strict';
import {
  DEFAULT_REMOTE_CONFIG,
  LOCATION_DIAGNOSTICS_CUTOFF_MS,
  LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES,
  buildDiagnosticsEventId,
  clampRemoteConfig,
  parseRemoteConfigRow,
  readRemoteConfigExtra,
  buildSupabasePublicHeaders,
  isDuplicateDiagnosticsResponse,
  isLocationDiagnosticsWindowOpen,
  isPermanentDiagnosticsFailure,
  isRecoverableDiagnosticsFailure,
  isRecoverableDisableReason,
  isRetryableDiagnosticsFailure,
  normalizeDiagnosticsOutboxEntries,
  shouldDisableAfterRemoteFailures,
} from './locationDiagnosticsPolicy.ts';

assert.equal(isLocationDiagnosticsWindowOpen(LOCATION_DIAGNOSTICS_CUTOFF_MS - 1), true);
assert.equal(isLocationDiagnosticsWindowOpen(LOCATION_DIAGNOSTICS_CUTOFF_MS), false);
assert.equal(isPermanentDiagnosticsFailure(404), true);
assert.equal(isPermanentDiagnosticsFailure(410), true);
assert.equal(isPermanentDiagnosticsFailure(401), true);
assert.equal(isPermanentDiagnosticsFailure(403), true);
assert.equal(isPermanentDiagnosticsFailure(400, 'PGRST205'), true);
assert.equal(isPermanentDiagnosticsFailure(400), true);
assert.equal(isPermanentDiagnosticsFailure(422), true);
assert.equal(isPermanentDiagnosticsFailure(429), false);
assert.equal(isPermanentDiagnosticsFailure(500), false);
assert.equal(isRetryableDiagnosticsFailure(429), true);
assert.equal(isRetryableDiagnosticsFailure(503), true);
assert.equal(isRetryableDiagnosticsFailure(400), false);
assert.equal(shouldDisableAfterRemoteFailures(2), false);
assert.equal(shouldDisableAfterRemoteFailures(3), true);
assert.equal(isDuplicateDiagnosticsResponse(409, '23505'), true);
assert.equal(isDuplicateDiagnosticsResponse(409, 'PGRST116'), false);
assert.deepEqual(buildSupabasePublicHeaders('sb_publishable_example'), {
  apikey: 'sb_publishable_example',
});
assert.deepEqual(buildSupabasePublicHeaders('legacy-jwt'), {
  apikey: 'legacy-jwt',
  Authorization: 'Bearer legacy-jwt',
});
assert.equal(buildDiagnosticsEventId('notification-1', '2026-08-01T10:00:00.000Z'), 'notification-1:2026-08-01T10:00:00.000Z');

const outboxEntries = Array.from({ length: 10 }, (_, index) => ({
  eventId: `event-${index}`,
  queuedAt: LOCATION_DIAGNOSTICS_CUTOFF_MS - 10_000 + index,
}));
assert.equal(LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES, 48);
// Varsayılan kapasite 10 girişi kırpmaz; kırpma davranışı açık sınırla doğrulanır.
assert.deepEqual(
  normalizeDiagnosticsOutboxEntries(outboxEntries).map((entry) => entry.eventId),
  outboxEntries.map((entry) => entry.eventId)
);
assert.deepEqual(
  normalizeDiagnosticsOutboxEntries(outboxEntries, 8).map((entry) => entry.eventId),
  outboxEntries.slice(2).map((entry) => entry.eventId)
);
assert.deepEqual(
  normalizeDiagnosticsOutboxEntries([
    { eventId: 'duplicate', queuedAt: 1 },
    { eventId: 'other', queuedAt: 2 },
    { eventId: 'duplicate', queuedAt: 3 },
  ]),
  [
    { eventId: 'other', queuedAt: 2 },
    { eventId: 'duplicate', queuedAt: 3 },
  ]
);
assert.deepEqual(
  normalizeDiagnosticsOutboxEntries([{ eventId: 'expired', queuedAt: LOCATION_DIAGNOSTICS_CUTOFF_MS }]),
  []
);

// Kalıcı sınıf içinde "sunucuda düzeltilebilir" ayrımı.
assert.equal(isRecoverableDiagnosticsFailure(404), false);
assert.equal(isRecoverableDiagnosticsFailure(404, 'PGRST205'), false);
assert.equal(isRecoverableDiagnosticsFailure(200, 'PGRST205'), false);
// Geçersiz/iptal anahtar cihazı kalıcı öldürmemeli (2026-08-04 saha vakası).
assert.equal(isRecoverableDiagnosticsFailure(401), true);
assert.equal(isRecoverableDiagnosticsFailure(403), true);
assert.equal(isRecoverableDiagnosticsFailure(400, '23502'), true);
assert.equal(isRecoverableDiagnosticsFailure(400, 'PGRST204'), true);
assert.equal(isRecoverableDiagnosticsFailure(400, 'P0001'), true);
assert.equal(isRecoverableDiagnosticsFailure(422), true);

// Eski sürümde yazılmış kapatma kayıtlarının güncellemede sınıflandırılması.
assert.equal(isRecoverableDisableReason('remote-permanent-confirmed:400:23502'), true);
assert.equal(isRecoverableDisableReason('remote-permanent-confirmed:400:unknown'), true);
assert.equal(isRecoverableDisableReason('remote-permanent-confirmed:404:PGRST205'), false);
// Eski sürümde 401 ile kalıcı kapanmış cihazlar güncellemede yeniden açılmalı.
assert.equal(isRecoverableDisableReason('remote-permanent-confirmed:401:unknown'), true);
assert.equal(isRecoverableDisableReason('bilinmeyen-gerekce'), true);
assert.equal(isRecoverableDisableReason(undefined), true);
assert.equal(isRecoverableDisableReason(null), true);

// ── P0001: hız/kapasite sınırı KALICI DEĞİLDİR ──────────────────────────────
// PostgREST bunu HTTP 400 ile döndürüyor; 4xx kuralına takılıp kalıcı sinyal
// sayılınca üç doğrulanmış sinyalden sonra cihaz 6 saat duraklıyordu. Oysa hata
// tanımı gereği geçici: saatlik pencere kayınca kendiliğinden geçer. 15 dakikalık
// kadansta karşılaşılması en olası hata bu.
assert.equal(isPermanentDiagnosticsFailure(400, 'P0001'), false);
assert.equal(isPermanentDiagnosticsFailure(429, 'P0001'), false);
// Diğer kalıcı sınıflar etkilenmemeli.
assert.equal(isPermanentDiagnosticsFailure(400, 'PGRST204'), true);

// ── Uzaktan yapılandırma: ayrıştırma ────────────────────────────────────────
// Sunucu biçimi (snake_case).
const parsedServerRow = parseRemoteConfigRow({
  diagnostics_enabled: false,
  beacon_interval_minutes: 30,
  foreground_service_enabled: false,
  diagnostics_cutoff: '2026-09-01T00:00:00+03:00',
  max_uploads_per_flush: 6,
  max_outbox_entries: 100,
  config_poll_minutes: 15,
});
assert.equal(parsedServerRow.diagnosticsEnabled, false);
assert.equal(parsedServerRow.beaconIntervalMinutes, 30);
assert.equal(parsedServerRow.foregroundServiceEnabled, false);
assert.equal(parsedServerRow.cutoffMs, Date.parse('2026-09-01T00:00:00+03:00'));
assert.equal(parsedServerRow.maxUploadsPerFlush, 6);
assert.equal(parsedServerRow.configPollMinutes, 15);

// Yerel önbellek biçimi (camelCase) da okunabilmeli — önbelleğe RemoteConfig yazılıyor.
const parsedCachedRow = parseRemoteConfigRow({ beaconIntervalMinutes: 45, cutoffMs: 1234567890 });
assert.equal(parsedCachedRow.beaconIntervalMinutes, 45);
assert.equal(parsedCachedRow.cutoffMs, 1234567890);

// Eksik/bozuk girdiler varsayılana düşmeli, ASLA NaN/undefined üretmemeli.
assert.deepEqual(parseRemoteConfigRow(null), DEFAULT_REMOTE_CONFIG);
assert.deepEqual(parseRemoteConfigRow('bozuk'), DEFAULT_REMOTE_CONFIG);
assert.deepEqual(parseRemoteConfigRow([]), DEFAULT_REMOTE_CONFIG);
assert.equal(parseRemoteConfigRow({}).beaconIntervalMinutes, DEFAULT_REMOTE_CONFIG.beaconIntervalMinutes);
assert.equal(
  parseRemoteConfigRow({ diagnostics_cutoff: 'tarih değil' }).cutoffMs,
  DEFAULT_REMOTE_CONFIG.cutoffMs
);

// ── Uzaktan yapılandırma: sınırlandırma ─────────────────────────────────────
// WorkManager 15 dk altını sessizce yuvarlar; panelde yanıltıcı olmasın diye clamp.
assert.equal(clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, beaconIntervalMinutes: 1 }).beaconIntervalMinutes, 15);
assert.equal(clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, beaconIntervalMinutes: 5000 }).beaconIntervalMinutes, 720);
assert.equal(clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, maxUploadsPerFlush: 0 }).maxUploadsPerFlush, 1);
assert.equal(clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, maxUploadsPerFlush: 999 }).maxUploadsPerFlush, 24);
assert.equal(clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, maxOutboxEntries: 1 }).maxOutboxEntries, 12);
assert.equal(clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, configPollMinutes: 1 }).configPollMinutes, 5);
// NaN girerse varsayılana düşer (sonsuz döngü / bölme hatası üretmemeli).
assert.equal(
  clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, beaconIntervalMinutes: Number.NaN }).beaconIntervalMinutes,
  DEFAULT_REMOTE_CONFIG.beaconIntervalMinutes
);

// KESİM ANI KIRPILMAZ — veritabanı tek otoritedir. Erkene alma da, çok uzağa
// uzatma da olduğu gibi uygulanır; "kötü bir şey olduğunda müdahale edilebilsin"
// gereği bunu şart koşuyor.
const earlyCutoff = LOCATION_DIAGNOSTICS_CUTOFF_MS - 86_400_000;
assert.equal(clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, cutoffMs: earlyCutoff }).cutoffMs, earlyCutoff);
const farFuture = LOCATION_DIAGNOSTICS_CUTOFF_MS + 10 * 365 * 24 * 60 * 60 * 1000;
assert.equal(clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, cutoffMs: farFuture }).cutoffMs, farFuture);
// Yalnız okunamayan tarih varsayılana düşer.
assert.equal(
  clampRemoteConfig({ ...DEFAULT_REMOTE_CONFIG, cutoffMs: Number.NaN }).cutoffMs,
  DEFAULT_REMOTE_CONFIG.cutoffMs
);

// ── Kapatma anahtarları 1/0 ve metin biçimlerini de kabul etmeli ────────────
// Panele elle `1`/`0` yazan bir operatörün özelliği kapatamaması kabul edilemez.
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: 0 }).diagnosticsEnabled, false);
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: 1 }).diagnosticsEnabled, true);
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: '0' }).diagnosticsEnabled, false);
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: 'false' }).diagnosticsEnabled, false);
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: 'FALSE' }).diagnosticsEnabled, false);
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: 'off' }).diagnosticsEnabled, false);
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: 'true' }).diagnosticsEnabled, true);
// Anlamsız değer varsayılanı korur — yanlışlıkla kapanmaz.
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: 'belki' }).diagnosticsEnabled, true);
assert.equal(parseRemoteConfigRow({ diagnostics_enabled: 7 }).diagnosticsEnabled, true);

// ── Yeni kaldıraçlar ────────────────────────────────────────────────────────
const expanded = parseRemoteConfigRow({
  background_task_enabled: false,
  notification_capture_enabled: 0,
  collect_location: '0',
  foreground_timer_minutes: 3,
  location_accuracy: 'high',
  request_timeout_ms: 25000,
  pause_hours: 1,
  permanent_signal_threshold: 8,
  permanent_signal_spacing_minutes: 10,
  kill_switch_reset_token: '  reset-1  ',
  foreground_service_title: 'Konum tanılama',
  foreground_service_body: '   ',
  extras: { yeni_ayar: 42, acik: 'true' },
});
assert.equal(expanded.backgroundTaskEnabled, false);
assert.equal(expanded.notificationCaptureEnabled, false);
assert.equal(expanded.collectLocation, false);
assert.equal(expanded.foregroundTimerMinutes, 3);
assert.equal(expanded.locationAccuracy, 'high');
assert.equal(expanded.requestTimeoutMs, 25000);
assert.equal(expanded.pauseHours, 1);
assert.equal(expanded.permanentSignalThreshold, 8);
assert.equal(expanded.permanentSignalSpacingMinutes, 10);
// Jeton kırpılır; boş metin null olur ("varsayılana dön" anlamına gelir).
assert.equal(expanded.killSwitchResetToken, 'reset-1');
assert.equal(expanded.foregroundServiceTitle, 'Konum tanılama');
assert.equal(expanded.foregroundServiceBody, null);
// Geçersiz doğruluk değeri varsayılana düşer.
assert.equal(parseRemoteConfigRow({ location_accuracy: 'ultra' }).locationAccuracy, 'balanced');

// Eşik uzaktan yönetilir.
assert.equal(shouldDisableAfterRemoteFailures(2), false);
assert.equal(shouldDisableAfterRemoteFailures(2, 2), true);
assert.equal(shouldDisableAfterRemoteFailures(7, 8), false);

// ── extras: migration yazmadan anahtar eklenebilmeli ────────────────────────
assert.equal(readRemoteConfigExtra(expanded.extras, 'yeni_ayar', 0), 42);
assert.equal(readRemoteConfigExtra(expanded.extras, 'acik', false), true);
assert.equal(readRemoteConfigExtra(expanded.extras, 'olmayan', 99), 99);
assert.equal(readRemoteConfigExtra(expanded.extras, 'olmayan', 'vars'), 'vars');
// extras düz nesne değilse boş sayılır (dizi/skaler panelden yazılabilir).
assert.deepEqual(parseRemoteConfigRow({ extras: [1, 2] }).extras, {});
assert.deepEqual(parseRemoteConfigRow({ extras: 'metin' }).extras, {});

// ── Pencere kontrolü uzaktan gelen kesim anını kullanabilmeli ───────────────
const extendedCutoff = LOCATION_DIAGNOSTICS_CUTOFF_MS + 86_400_000;
assert.equal(isLocationDiagnosticsWindowOpen(LOCATION_DIAGNOSTICS_CUTOFF_MS + 1, extendedCutoff), true);
assert.equal(isLocationDiagnosticsWindowOpen(extendedCutoff, extendedCutoff), false);
// Kesim anı okunamazsa (NaN) pencere KAPALI sayılır — güvenli yön.
assert.equal(isLocationDiagnosticsWindowOpen(Date.now(), Number.NaN), false);

// Kuyruk kırpması da uzaktan gelen kesim anını kullanmalı; yoksa uzatılmış
// pencerede kuyruğa alınan kayıtlar anında "süresi geçmiş" sayılıp silinirdi.
assert.deepEqual(
  normalizeDiagnosticsOutboxEntries(
    [{ eventId: 'extended', queuedAt: LOCATION_DIAGNOSTICS_CUTOFF_MS + 1000 }],
    48,
    extendedCutoff
  ).map((entry) => entry.eventId),
  ['extended']
);

console.log('location diagnostics policy tests passed (110 assertions)');
