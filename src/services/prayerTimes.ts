export type PrayerTime = {
  key: string;
  name: string;
  time: string;
  notification: boolean;
  vibration: boolean;
  alarm: boolean;
};

export type CachedPrayerDay = {
  date: string; // YYYY-MM-DD
  prayers: PrayerTime[];
};

function cleanTime(value: string) {
  return value.split(' ')[0].slice(0, 5);
}

function toIsoDateFromAladhan(value: string) {
  // AlAdhan: DD-MM-YYYY
  const [day, month, year] = value.split('-');
  return `${year}-${month}-${day}`;
}

function buildPrayers(timings: Record<string, string>): PrayerTime[] {
  return [
    {
      key: 'fajr',
      name: 'İmsak',
      time: cleanTime(timings.Fajr),
      notification: true,
      vibration: true,
      alarm: true,
    },
    {
      key: 'sunrise',
      name: 'Güneş',
      time: cleanTime(timings.Sunrise),
      notification: false,
      vibration: false,
      alarm: false,
    },
    {
      key: 'dhuhr',
      name: 'Öğle',
      time: cleanTime(timings.Dhuhr),
      notification: true,
      vibration: true,
      alarm: true,
    },
    {
      key: 'asr',
      name: 'İkindi',
      time: cleanTime(timings.Asr),
      notification: true,
      vibration: true,
      alarm: true,
    },
    {
      key: 'maghrib',
      name: 'Akşam',
      time: cleanTime(timings.Maghrib),
      notification: true,
      vibration: true,
      alarm: true,
    },
    {
      key: 'isha',
      name: 'Yatsı',
      time: cleanTime(timings.Isha),
      notification: true,
      vibration: true,
      alarm: true,
    },
  ];
}

export async function fetchPrayerTimes(latitude: number, longitude: number): Promise<PrayerTime[]> {
  const url = `https://api.aladhan.com/v1/timings?latitude=${latitude}&longitude=${longitude}&method=13`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error('Prayer API request failed');
  }

  const json = await res.json();
  const timings = json.data.timings;

  return buildPrayers(timings);
}

async function fetchCalendarMonth(
  latitude: number,
  longitude: number,
  year: number,
  month: number
): Promise<CachedPrayerDay[]> {
  const url = `https://api.aladhan.com/v1/calendar/${year}/${month}?latitude=${latitude}&longitude=${longitude}&method=13`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error('Prayer calendar API request failed');
  }

  const json = await res.json();

  return json.data.map((day: any) => ({
    date: toIsoDateFromAladhan(day.date.gregorian.date),
    prayers: buildPrayers(day.timings),
  }));
}

function addMonths(date: Date, count: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + count);
  return next;
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export async function fetchMonthlyPrayerCalendar(
  latitude: number,
  longitude: number,
  startDate = new Date()
): Promise<CachedPrayerDay[]> {
  const currentYear = startDate.getFullYear();
  const currentMonth = startDate.getMonth() + 1;

  const nextDate = addMonths(startDate, 1);
  const nextYear = nextDate.getFullYear();
  const nextMonth = nextDate.getMonth() + 1;

  const currentMonthData = await fetchCalendarMonth(latitude, longitude, currentYear, currentMonth);
  const nextMonthData = await fetchCalendarMonth(latitude, longitude, nextYear, nextMonth);

  const today = getLocalDateKey(startDate);

  return [...currentMonthData, ...nextMonthData]
    .filter((item) => item.date >= today)
    .slice(0, 32);
}