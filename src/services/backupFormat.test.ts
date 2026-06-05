// Saf yedek format mantığı için birim testleri.
// Çalıştır: node --experimental-strip-types src/services/backupFormat.test.ts
import {
  BACKUP_MAGIC,
  BackupError,
  buildBackup,
  parseBackup,
  renderHtml,
} from './backupFormat.ts';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

// Örnek veri
const sampleState = {
  language: 'tr',
  themePreference: 'dark',
  timeFormat: '24',
  earlyReminderMinutes: 15,
  trackingEnabled: true,
  locationLabel: { city: 'İstanbul', district: 'Kadıköy <test> & "x"' },
  diyanetDistrictId: '9541',
  coords: { latitude: 41.0, longitude: 29.0 },
  cachedPrayerDays: [],
  prayerPrefs: {},
};
const sampleTracking = [
  { date: '2026-06-04', statuses: { fajr: 'onTime', dhuhr: 'late', asr: 'missed', maghrib: 'onTime', isha: null } },
  { date: '2026-06-03', statuses: { fajr: 'onTime', dhuhr: 'onTime', asr: 'onTime', maghrib: 'onTime', isha: 'onTime' } },
  { date: '2026-06-02', statuses: {} }, // boş gün → HTML'de listelenmemeli
];

const backup = buildBackup('1.3.6', sampleState, sampleTracking);

// 1) buildBackup şekli
check('buildBackup magic/schema doğru', backup.magic === BACKUP_MAGIC && backup.schema === 1);
check('buildBackup tracking korunur', backup.tracking.length === 3);

// 2) JSON round-trip
const json = JSON.stringify(backup, null, 2);
const fromJson = parseBackup(json);
check('JSON round-trip appVersion', fromJson.appVersion === '1.3.6');
check('JSON round-trip tracking eşit', JSON.stringify(fromJson.tracking) === JSON.stringify(backup.tracking));
check('JSON round-trip appState eşit', JSON.stringify(fromJson.appState) === JSON.stringify(backup.appState));

// 3) HTML round-trip (her dil) — gömülü JSON geri okunabilmeli
for (const lang of ['tr', 'en', 'ar'] as const) {
  const html = renderHtml(backup, lang);
  let recovered;
  try {
    recovered = parseBackup(html);
  } catch (e) {
    check(`HTML (${lang}) parse edilebildi`, false, String(e));
    continue;
  }
  check(`HTML (${lang}) round-trip appState eşit`, JSON.stringify(recovered.appState) === JSON.stringify(backup.appState));
  check(`HTML (${lang}) round-trip tracking eşit`, JSON.stringify(recovered.tracking) === JSON.stringify(backup.tracking));
  // RTL sadece Arapça
  check(`HTML (${lang}) dir doğru`, lang === 'ar' ? html.includes('dir="rtl"') : !html.includes('dir="rtl"'));
}

// 4) XSS/escape — kullanıcı verisi (ilçe adı '<test> & "x"') ham olarak görünür kısımda kaçırılmalı
const htmlTr = renderHtml(backup, 'tr');
check('Görünür HTML ham <test> içermez', !htmlTr.includes('Kadıköy <test>'));
check('Escape edilmiş &lt;test&gt; mevcut', htmlTr.includes('&lt;test&gt;'));
// ...ama gömülü JSON payload veriyi (escape kodlu < ile) korur → recover doğrulanmış durumda

// 5) İstatistik doğruluğu:
//    06-04: fajr onTime, dhuhr late, asr missed, maghrib onTime, isha null → onTime 2, late 1, missed 1
//    06-03: 5 × onTime → onTime 5
//    Toplam: onTime 7, late 1, missed 1, takip edilen gün 2 (boş 06-02 hariç)
check('HTML onTime sayısı 7', /<div class="n">7<\/div>/.test(htmlTr));
check('HTML takip edilen gün 2', /<div class="n">2<\/div>/.test(htmlTr));

// 6) Geçersiz girişler
function expectInvalid(name: string, input: string) {
  try {
    parseBackup(input);
    check(name, false, 'hata fırlatmadı');
  } catch (e) {
    check(name, e instanceof BackupError && (e as BackupError).code === 'invalid');
  }
}
expectInvalid('boş metin geçersiz', '');
expectInvalid('rastgele JSON geçersiz', '{"foo":1}');
expectInvalid('yanlış magic geçersiz', JSON.stringify({ magic: 'x', schema: 1 }));
expectInvalid('bozuk HTML (script yok) geçersiz', '<html><body>merhaba</body></html>');
expectInvalid('düz metin geçersiz', 'merhaba dünya');

// 7) Bozuk tracking normalize edilir (dizi değilse boş)
const weird = parseBackup(JSON.stringify({ magic: BACKUP_MAGIC, schema: 1, tracking: 'oops' }));
check('bozuk tracking boş diziye normalize', Array.isArray(weird.tracking) && weird.tracking.length === 0);

// 8) Boş tracking → "kayıt yok" notu, çökme yok
const emptyBackup = buildBackup('1.3.6', {}, []);
const emptyHtml = renderHtml(emptyBackup, 'tr');
check('boş yedek HTML üretir', emptyHtml.includes('Henüz namaz takip kaydı yok'));
check('boş yedek round-trip', JSON.stringify(parseBackup(emptyHtml).tracking) === '[]');

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
