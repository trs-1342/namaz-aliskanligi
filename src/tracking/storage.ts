import AsyncStorage from '@react-native-async-storage/async-storage';
import { DayTracking, PrayerStatus } from './types';

const KEY = 'namaz-aliskanligi:tracking:v1';

export async function loadTrackingDays(): Promise<DayTracking[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveTrackingDays(days: DayTracking[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(days));
  } catch {}
}

export async function clearTrackingDays(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

export function upsertDayStatus(
  days: DayTracking[],
  date: string,
  prayerKey: string,
  status: PrayerStatus
): DayTracking[] {
  const exists = days.find((d) => d.date === date);
  if (exists) {
    return days.map((d) =>
      d.date === date ? { ...d, statuses: { ...d.statuses, [prayerKey]: status } } : d
    );
  }
  return [...days, { date, statuses: { [prayerKey]: status } }];
}
