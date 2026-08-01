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
  LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES,
  isLocationDiagnosticsWindowOpen,
  isPermanentDiagnosticsFailure,
  isRetryableDiagnosticsFailure,
  normalizeDiagnosticsOutboxEntries,
  shouldDisableAfterRemoteFailures,
} from './locationDiagnosticsPolicy';

const CONSENT_KEY = 'namaz-aliskanligi:location-diagnostics:consent:v1';
const DISABLED_KEY = 'namaz-aliskanligi:location-diagnostics:disabled:v2';
const INSTALLATION_ID_KEY = 'namaz-aliskanligi:location-diagnostics:installation-id:v1';
const ATTEMPT_HISTORY_KEY = 'namaz-aliskanligi:location-diagnostics:attempt-history:v1';
const REMOTE_FAILURE_COUNT_KEY = 'namaz-aliskanligi:location-diagnostics:remote-failures:v1';
const OUTBOX_KEY = 'namaz-aliskanligi:location-diagnostics:outbox:v1';
const REQUEST_TIMEOUT_MS = 12_000;

const FEATURE_ENABLED = process.env.EXPO_PUBLIC_LOCATION_DIAGNOSTICS_ENABLED === 'true';
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

type DiagnosticsOutboxEntry = {
  eventId: string;
  queuedAt: number;
  payload: DiagnosticsPayload;
};

type UploadResult = 'sent' | 'retryable' | 'permanent';

const attemptsInFlight = new Set<string>();
let attemptClaimQueue: Promise<void> = Promise.resolve();
let remoteFailureQueue: Promise<void> = Promise.resolve();
let outboxQueue: Promise<void> = Promise.resolve();
let installationIdPromise: Promise<string> | null = null;
let diagnosticsStateGeneration = 0;

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
}

async function resetRemoteFailures(): Promise<void> {
  const operation = remoteFailureQueue.then(() => AsyncStorage.removeItem(REMOTE_FAILURE_COUNT_KEY));
  remoteFailureQueue = operation.catch(() => undefined);
  await operation;
}

async function recordRemoteFailure(): Promise<boolean> {
  let shouldDisable = false;
  const operation = remoteFailureQueue.then(async () => {
    const raw = await AsyncStorage.getItem(REMOTE_FAILURE_COUNT_KEY);
    const previous = raw == null ? 0 : Number(raw);
    const next = Number.isInteger(previous) && previous >= 0 ? previous + 1 : 1;
    await AsyncStorage.setItem(REMOTE_FAILURE_COUNT_KEY, String(next));
    shouldDisable = shouldDisableAfterRemoteFailures(next);
  });
  remoteFailureQueue = operation.catch(() => undefined);
  await operation;
  return shouldDisable;
}

export function isLocationDiagnosticsAvailable(): boolean {
  return FEATURE_ENABLED && Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY) && isLocationDiagnosticsWindowOpen();
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
    remoteFailureQueue,
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
    OUTBOX_KEY,
  ]);
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
  return normalizeDiagnosticsOutboxEntries(entries, LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES);
}

function runOutboxOperation(operation: () => Promise<void>): Promise<void> {
  const next = outboxQueue.then(operation);
  outboxQueue = next.catch(() => undefined);
  return next;
}

async function enqueueDiagnosticsPayload(eventId: string, payload: DiagnosticsPayload): Promise<void> {
  await runOutboxOperation(async () => {
    if (!(await getLocationDiagnosticsConsent()) || !isLocationDiagnosticsWindowOpen()) return;
    const entries = validOutboxEntries(parseOutbox(await AsyncStorage.getItem(OUTBOX_KEY)));
    const withoutDuplicate = entries.filter((entry) => entry.eventId !== eventId);
    const next = validOutboxEntries([...withoutDuplicate, { eventId, queuedAt: Date.now(), payload }]);
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
  });
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
    }), REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (await recordRemoteFailure()) {
      await permanentlyDisable('remote-unreachable:consecutive-failures');
      return 'permanent';
    }
    console.warn('[location-diagnostics] remote unavailable', error);
    return 'retryable';
  }

  if (response.ok) {
    await resetRemoteFailures();
    return 'sent';
  }

  let responseCode: string | undefined;
  try {
    const body = await response.json() as { code?: unknown };
    if (typeof body.code === 'string') responseCode = body.code;
  } catch {
    // HTTP durum kodu sınıflandırma için yeterlidir.
  }

  if (isDuplicateDiagnosticsResponse(response.status, responseCode)) {
    await resetRemoteFailures();
    return 'sent';
  }
  if (isPermanentDiagnosticsFailure(response.status, responseCode)) {
    await permanentlyDisable(`remote-unavailable:${response.status}:${responseCode ?? 'unknown'}`);
    return 'permanent';
  }
  if (isRetryableDiagnosticsFailure(response.status)) {
    if (await recordRemoteFailure()) {
      await permanentlyDisable(`remote-unavailable:${response.status}:consecutive-failures`);
      return 'permanent';
    }
    return 'retryable';
  }
  console.warn('[location-diagnostics] upload rejected', response.status, responseCode);
  return 'retryable';
}

export async function flushLocationDiagnosticsOutbox(): Promise<void> {
  if (!FEATURE_ENABLED || !SUPABASE_URL || !SUPABASE_PUBLIC_KEY || !isLocationDiagnosticsWindowOpen()) {
    await runOutboxOperation(() => AsyncStorage.removeItem(OUTBOX_KEY));
    return;
  }
  if (!(await getLocationDiagnosticsConsent())) return;
  const network = await NetInfo.fetch();
  if (!network.isConnected || network.isInternetReachable === false) return;

  await runOutboxOperation(async () => {
    const entries = validOutboxEntries(parseOutbox(await AsyncStorage.getItem(OUTBOX_KEY)));
    const remaining: DiagnosticsOutboxEntry[] = [];

    for (let index = 0; index < entries.length; index += 1) {
      if (!(await getLocationDiagnosticsConsent()) || !isLocationDiagnosticsWindowOpen()) break;
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
  if (notification.data.locationDiagnosticsEvent !== 'prayer_notification') return;
  if (!(await getLocationDiagnosticsConsent())) return;
  const captureGeneration = diagnosticsStateGeneration;

  const notificationSentAt = notificationDateToIso(notification.date);
  const eventId = buildDiagnosticsEventId(notification.identifier, notificationSentAt);
  if (attemptsInFlight.has(eventId) || !(await claimEventAttempt(eventId))) return;

  attemptsInFlight.add(eventId);

  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return;

    let position: Location.LocationObject;
    try {
      position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        REQUEST_TIMEOUT_MS
      );
    } catch (error) {
      console.warn('[location-diagnostics] current location unavailable', error);
      return;
    }
    if (!isLocationDiagnosticsWindowOpen()) return;
    if (captureGeneration !== diagnosticsStateGeneration || !(await getLocationDiagnosticsConsent())) return;

    const userId = await getInstallationId();
    const payload = {
      installation_id: userId,
      tester_code: userId.replace(/-/g, '').slice(0, 8).toUpperCase(),
      device_name: Device.deviceName,
      device_model: Device.modelName,
      operating_system: Device.osName ?? Platform.OS,
      operating_system_version: Device.osVersion,
      app_version: Application.nativeApplicationVersion,
      app_build_version: Application.nativeBuildVersion,
      notification_id: notification.identifier,
      notification_kind: notification.data.notificationKind ?? 'prayer',
      prayer_key: notification.data.prayerKey ?? null,
      notification_sent_at: notificationSentAt,
      notification_scheduled_at:
        typeof notification.data.scheduledAt === 'string' ? notification.data.scheduledAt : null,
      captured_at: new Date().toISOString(),
      capture_mode: captureMode,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy_m: position.coords.accuracy,
      altitude_m: position.coords.altitude,
      location_timestamp: new Date(position.timestamp).toISOString(),
    };

    if (captureGeneration !== diagnosticsStateGeneration || !(await getLocationDiagnosticsConsent())) return;
    const network = await NetInfo.fetch();
    if (!network.isConnected || network.isInternetReachable === false) {
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
