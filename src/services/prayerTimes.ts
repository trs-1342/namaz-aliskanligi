export type PrayerTime = {
  key: string;
  name: string;
  time: string;
  notification: boolean;
  vibration: boolean;
  alarm: boolean;
};

function cleanTime(value: string) {
  return value.split(' ')[0].slice(0, 5);
}

export async function fetchPrayerTimes(latitude: number, longitude: number): Promise<PrayerTime[]> {
  const url = `https://api.aladhan.com/v1/timings?latitude=${latitude}&longitude=${longitude}&method=13`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error('Prayer API request failed');
  }

  const json = await res.json();
  const timings = json.data.timings;

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
      notification: true,
      vibration: true,
      alarm: true,
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