import assert from 'node:assert/strict';
import { buildTrackingReminderSpecs } from './trackingSchedule.ts';
import type { CachedPrayerDay } from '../services/prayerTimes.ts';

const prayer = (key: string, time: string) => ({
  key, name: key, time, notification: true, vibration: true, alarm: true,
});
const days: CachedPrayerDay[] = ['2026-08-01', '2026-08-02'].map((date) => ({
  date,
  prayers: [prayer('fajr', '05:00'), prayer('dhuhr', '13:00'), prayer('asr', '17:00'), prayer('maghrib', '20:00'), prayer('isha', '21:00')],
}));

const now = new Date(2026, 7, 1, 10, 0, 0);
assert.equal(buildTrackingReminderSpecs(days, true, 'always', [], now).length, 2);
assert.equal(buildTrackingReminderSpecs(days, false, 'always', [], now).length, 0);
assert.equal(buildTrackingReminderSpecs(days, true, 'ifIncomplete', [{ date: '2026-08-01', statuses: {
  fajr: 'onTime', dhuhr: 'onTime', asr: 'late', maghrib: 'onTime', isha: 'onTime',
} }], now).length, 1);

console.log('tracking schedule tests: 3/3 passed');
