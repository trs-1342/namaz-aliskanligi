import type { PrayerTime } from '../services/prayerTimes';

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function formatClock(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function secondsFromTime(value: string) {
  const [h, m, s = 0] = value.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

export function getNextPrayer(prayers: PrayerTime[], now = new Date()) {
  if (prayers.length === 0) return null;

  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const next = prayers.find((p) => secondsFromTime(p.time) > nowSeconds) ?? prayers[0];
  const nextSeconds = secondsFromTime(next.time);
  const delta = nextSeconds > nowSeconds
    ? nextSeconds - nowSeconds
    : 24 * 3600 - nowSeconds + nextSeconds;

  return {
    prayer: next,
    remaining: `${pad(Math.floor(delta / 3600))}:${pad(Math.floor((delta % 3600) / 60))}:${pad(delta % 60)}`,
  };
}

export function getCurrentPrayer(prayers: PrayerTime[], now = new Date()) {
  if (prayers.length === 0) return null;

  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  let current = prayers[prayers.length - 1];

  for (const prayer of prayers) {
    if (secondsFromTime(prayer.time) <= nowSeconds) {
      current = prayer;
    }
  }

  return current;
}
