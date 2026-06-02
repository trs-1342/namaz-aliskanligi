import { Coordinates, CalculationMethod, PrayerTimes, Rounding } from 'adhan';

export type PrayerTime = {
  key: string;
  name: string;
  time: string; // HH:MM:SS — display rounds to nearest minute, scheduling uses exact seconds
  notification: boolean;
  vibration: boolean;
  alarm: boolean;
};

export type CachedPrayerDay = {
  date: string; // YYYY-MM-DD
  prayers: PrayerTime[];
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatExact(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function buildPrayers(pt: PrayerTimes): PrayerTime[] {
  return [
    { key: 'fajr',    name: 'İmsak',  time: formatExact(pt.fajr),    notification: true,  vibration: true,  alarm: true  },
    { key: 'sunrise', name: 'Güneş',  time: formatExact(pt.sunrise), notification: false, vibration: false, alarm: false },
    { key: 'dhuhr',   name: 'Öğle',   time: formatExact(pt.dhuhr),   notification: true,  vibration: true,  alarm: true  },
    { key: 'asr',     name: 'İkindi', time: formatExact(pt.asr),     notification: true,  vibration: true,  alarm: true  },
    { key: 'maghrib', name: 'Akşam',  time: formatExact(pt.maghrib), notification: true,  vibration: true,  alarm: true  },
    { key: 'isha',    name: 'Yatsı',  time: formatExact(pt.isha),    notification: true,  vibration: true,  alarm: true  },
  ];
}

function calculate(latitude: number, longitude: number, date: Date): PrayerTime[] {
  const coords = new Coordinates(latitude, longitude);
  const params = CalculationMethod.Turkey();
  params.rounding = Rounding.None;
  return buildPrayers(new PrayerTimes(coords, date, params));
}

function getLocalDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function fetchPrayerTimes(latitude: number, longitude: number): Promise<PrayerTime[]> {
  return Promise.resolve(calculate(latitude, longitude, new Date()));
}

export function fetchMonthlyPrayerCalendar(
  latitude: number,
  longitude: number,
  startDate = new Date()
): Promise<CachedPrayerDay[]> {
  const today = getLocalDateKey(startDate);
  const result: CachedPrayerDay[] = [];

  for (let i = 0; i < 35; i++) {
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const dateKey = getLocalDateKey(date);
    if (dateKey < today) continue;
    result.push({ date: dateKey, prayers: calculate(latitude, longitude, date) });
    if (result.length >= 32) break;
  }

  return Promise.resolve(result);
}
