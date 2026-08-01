import assert from 'node:assert/strict';
import { getCurrentPrayer, getNextPrayer } from './time.ts';
import type { PrayerTime } from '../services/prayerTimes.ts';

const prayers: PrayerTime[] = [
  { key: 'fajr', name: 'Fajr', time: '05:00:00', notification: true, vibration: true, alarm: true },
  { key: 'isha', name: 'Isha', time: '20:00:00', notification: true, vibration: true, alarm: true },
];

assert.equal(getNextPrayer(prayers, new Date(2026, 0, 1, 4, 0, 30))?.remaining, '00:59:30');
assert.equal(getNextPrayer(prayers, new Date(2026, 0, 1, 20, 0, 1))?.remaining, '08:59:59');
assert.equal(getCurrentPrayer(prayers, new Date(2026, 0, 1, 4, 0, 0))?.key, 'isha');
assert.equal(getCurrentPrayer(prayers, new Date(2026, 0, 1, 5, 0, 0))?.key, 'fajr');

console.log('time tests: 4/4 passed');
