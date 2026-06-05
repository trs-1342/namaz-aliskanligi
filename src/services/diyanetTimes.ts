import AsyncStorage from '@react-native-async-storage/async-storage';
import { CachedPrayerDay, PrayerTime } from './prayerTimes';

// Diyanet resmi vakitleri (namazvakti.diyanet.gov.tr) — kimlik gerektirmeyen ayna
const BASE = 'https://ezanvakti.emushaf.net';
const TURKEY_COUNTRY_ID = '2';

const CITIES_KEY = 'diyanet:cities:v1';
const DISTRICTS_PREFIX = 'diyanet:districts:v1:';

export type DiyanetPlace = { id: string; name: string };

type RawCity = { SehirAdi: string; SehirID: string };
type RawDistrict = { IlceAdi: string; IlceID: string };
type RawDay = {
  MiladiTarihKisa: string; // "02.06.2026"
  Imsak: string; // "HH:MM"
  Gunes: string;
  Ogle: string;
  Ikindi: string;
  Aksam: string;
  Yatsi: string;
};

async function getJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Türkçe karakterleri sadeleştirip büyük harfe çevirerek eşleştirme anahtarı üretir. */
export function normalizeTr(value: string): string {
  return value
    .replace(/İ/g, 'I')
    .replace(/I/g, 'I')
    .replace(/ı/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'C')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Türkiye'nin 81 ilini getirir (AsyncStorage'da kalıcı önbelleklenir). */
export async function fetchCities(): Promise<DiyanetPlace[]> {
  try {
    const cached = await AsyncStorage.getItem(CITIES_KEY);
    if (cached) return JSON.parse(cached);
  } catch {}

  const raw = await getJson<RawCity[]>(`${BASE}/sehirler/${TURKEY_COUNTRY_ID}`);
  const cities = raw
    .map((c) => ({ id: c.SehirID, name: c.SehirAdi }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  try {
    await AsyncStorage.setItem(CITIES_KEY, JSON.stringify(cities));
  } catch {}

  return cities;
}

/** Bir ile ait Diyanet ilçelerini getirir (AsyncStorage'da kalıcı önbelleklenir). */
export async function fetchDistricts(cityId: string): Promise<DiyanetPlace[]> {
  const key = `${DISTRICTS_PREFIX}${cityId}`;
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) return JSON.parse(cached);
  } catch {}

  const raw = await getJson<RawDistrict[]>(`${BASE}/ilceler/${cityId}`);
  const districts = raw
    .map((d) => ({ id: d.IlceID, name: d.IlceAdi }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  try {
    await AsyncStorage.setItem(key, JSON.stringify(districts));
  } catch {}

  return districts;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// "02.06.2026" → "2026-06-02"
function toIsoDate(miladiKisa: string): string {
  const [dd, mm, yyyy] = miladiKisa.split('.');
  return `${yyyy}-${mm}-${dd}`;
}

function buildPrayersFromDay(day: RawDay): PrayerTime[] {
  // Diyanet HH:MM verir; dahili format HH:MM:SS olduğu için ":00" eklenir
  const t = (v: string) => `${v}:00`;
  return [
    { key: 'fajr',    name: 'İmsak',  time: t(day.Imsak),  notification: true,  vibration: true,  alarm: true  },
    { key: 'sunrise', name: 'Güneş',  time: t(day.Gunes),  notification: false, vibration: false, alarm: false },
    { key: 'dhuhr',   name: 'Öğle',   time: t(day.Ogle),   notification: true,  vibration: true,  alarm: true  },
    { key: 'asr',     name: 'İkindi', time: t(day.Ikindi), notification: true,  vibration: true,  alarm: true  },
    { key: 'maghrib', name: 'Akşam',  time: t(day.Aksam),  notification: true,  vibration: true,  alarm: true  },
    { key: 'isha',    name: 'Yatsı',  time: t(day.Yatsi),  notification: true,  vibration: true,  alarm: true  },
  ];
}

/**
 * Bir ilçe için Diyanet aylık takvimini (≈32 gün) çeker ve uygulama formatına çevirir.
 * Bugünden eski günler elenir.
 */
export async function fetchDiyanetCalendar(districtId: string): Promise<CachedPrayerDay[]> {
  const raw = await getJson<RawDay[]>(`${BASE}/vakitler/${districtId}`);

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const result: CachedPrayerDay[] = [];
  for (const day of raw) {
    if (!day?.MiladiTarihKisa) continue;
    const date = toIsoDate(day.MiladiTarihKisa);
    if (date < todayKey) continue;
    result.push({ date, prayers: buildPrayersFromDay(day) });
  }

  result.sort((a, b) => a.date.localeCompare(b.date));

  if (result.length === 0) {
    throw new Error('Diyanet takvimi boş döndü');
  }

  return result;
}

/**
 * GPS'ten gelen il/ilçe adlarını Diyanet ilçe ID'sine eşler.
 * Şehir bulunamazsa null döner (adhan'a düşülür).
 * İlçe bulunamazsa şehrin merkez kaydına (şehir adıyla aynı isimli ilçe) düşer.
 */
export async function resolveDistrictId(
  cityName: string,
  districtName: string
): Promise<{
  cityId: string;
  cityName: string;
  districtId: string;
  districtName: string;
  // İlçe gerçekten eşleşti mi (true), yoksa varsayılana mı düşüldü (false)?
  // false ise arayüzde ilçe gösterilmemeli ("İstanbul, İstanbul" gibi yanlış
  // tekrarları önlemek için), ancak takvim çekmek için bir ID yine de döner.
  matchedDistrict: boolean;
} | null> {
  const cities = await fetchCities();
  const cityKey = normalizeTr(cityName);

  let city = cities.find((c) => normalizeTr(c.name) === cityKey);
  if (!city) city = cities.find((c) => normalizeTr(c.name).includes(cityKey) || cityKey.includes(normalizeTr(c.name)));
  if (!city) return null;

  const districts = await fetchDistricts(city.id);
  const distKey = normalizeTr(districtName ?? '');
  // İlçe adı il adıyla aynıysa (ör. "İstanbul") bu gerçek bir ilçe değildir.
  const distinctDist = distKey && distKey !== cityKey ? distKey : '';

  let matchedDistrict = false;
  let district = distinctDist ? districts.find((d) => normalizeTr(d.name) === distinctDist) : undefined;
  if (!district && distinctDist) {
    district = districts.find(
      (d) => normalizeTr(d.name).includes(distinctDist) || distinctDist.includes(normalizeTr(d.name))
    );
  }
  if (district) matchedDistrict = true;

  // İlçe eşleşmediyse: şehir adıyla aynı isimli merkez kaydı, yoksa ilk kayıt.
  // Merkez bulunursa mantıklı bir varsayılan olduğu için eşleşmiş sayılır.
  if (!district) {
    const central = districts.find((d) => normalizeTr(d.name) === cityKey);
    if (central) {
      district = central;
      matchedDistrict = true;
    } else {
      district = districts[0];
      matchedDistrict = false;
    }
  }
  if (!district) return null;

  return {
    cityId: city.id,
    cityName: city.name,
    districtId: district.id,
    districtName: district.name,
    matchedDistrict,
  };
}
