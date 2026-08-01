import type { CachedPrayerDay } from '../services/prayerTimes';
import type { DayTracking, TrackingNotifMode } from '../tracking/types';

const REQUIRED_PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

export type TrackingReminderSpec = {
  trackingDate: string;
  triggerDate: Date;
};

export function buildTrackingReminderSpecs(
  days: CachedPrayerDay[],
  enabled: boolean,
  mode: TrackingNotifMode,
  trackedDays: DayTracking[],
  now = new Date()
): TrackingReminderSpec[] {
  if (!enabled) return [];

  return days.flatMap((day) => {
    const isha = day.prayers.find((prayer) => prayer.key === 'isha');
    if (!isha) return [];

    const [year, month, date] = day.date.split('-').map(Number);
    const [hour, minute] = isha.time.split(':').map(Number);
    if (![year, month, date, hour, minute].every(Number.isFinite)) return [];

    const triggerDate = new Date(year, month - 1, date, hour, minute + 30, 0, 0);
    if (triggerDate <= now) return [];

    if (mode === 'ifIncomplete') {
      const statuses = trackedDays.find((item) => item.date === day.date)?.statuses ?? {};
      if (REQUIRED_PRAYER_KEYS.every((key) => Boolean(statuses[key]))) return [];
    }

    return [{ trackingDate: day.date, triggerDate }];
  });
}
