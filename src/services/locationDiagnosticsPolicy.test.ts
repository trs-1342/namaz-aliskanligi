import assert from 'node:assert/strict';
import {
  LOCATION_DIAGNOSTICS_CUTOFF_MS,
  LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES,
  buildDiagnosticsEventId,
  buildSupabasePublicHeaders,
  isDuplicateDiagnosticsResponse,
  isLocationDiagnosticsWindowOpen,
  isPermanentDiagnosticsFailure,
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
assert.equal(LOCATION_DIAGNOSTICS_MAX_OUTBOX_ENTRIES, 8);
assert.deepEqual(
  normalizeDiagnosticsOutboxEntries(outboxEntries).map((entry) => entry.eventId),
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

console.log('location diagnostics policy tests passed (25 assertions)');
