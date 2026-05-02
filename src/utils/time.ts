import type { PrayerTime } from '../services/prayerTimes';

export function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatClock(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function minutesFromHHMM(value: string) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function getNextPrayer(prayers: PrayerTime[], now = new Date()) {
  if (prayers.length === 0) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const next = prayers.find((p) => minutesFromHHMM(p.time) > nowMin) ?? prayers[0];
  const nextMin = minutesFromHHMM(next.time);
  const delta = nextMin > nowMin ? nextMin - nowMin : 24 * 60 - nowMin + nextMin;

  return {
    prayer: next,
    remaining: `${pad(Math.floor(delta / 60))}:${pad(delta % 60)}:${pad(60 - now.getSeconds()).replace('60', '00')}`,
  };
}

export function getCurrentPrayer(prayers: PrayerTime[], now = new Date()) {
  if (prayers.length === 0) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  let current = prayers[0];

  for (const prayer of prayers) {
    if (minutesFromHHMM(prayer.time) <= nowMin) {
      current = prayer;
    }
  }

  return current;
}
