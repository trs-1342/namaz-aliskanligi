export const LOCATION_DIAGNOSTICS_CUTOFF_ISO = '2026-08-04T00:00:00+03:00';
export const LOCATION_DIAGNOSTICS_CUTOFF_MS = Date.parse(LOCATION_DIAGNOSTICS_CUTOFF_ISO);

export function isLocationDiagnosticsWindowOpen(nowMs = Date.now()): boolean {
  return Number.isFinite(nowMs) && nowMs < LOCATION_DIAGNOSTICS_CUTOFF_MS;
}

export function isPermanentDiagnosticsFailure(status: number, responseCode?: string): boolean {
  const retryableClientStatuses = new Set([408, 409, 425, 429]);
  return (status >= 400 && status < 500 && !retryableClientStatuses.has(status)) ||
    responseCode === 'PGRST204' || responseCode === 'PGRST205';
}

export function isRetryableDiagnosticsFailure(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

export function shouldDisableAfterRemoteFailures(consecutiveFailures: number): boolean {
  return Number.isInteger(consecutiveFailures) && consecutiveFailures >= 3;
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
