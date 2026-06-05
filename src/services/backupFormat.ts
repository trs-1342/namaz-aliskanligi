// Saf yedek format mantığı — hiçbir native/Expo bağımlılığı içermez, bu yüzden
// Node altında birim testi yapılabilir. IO (dosya/paylaşım/seçici) backup.ts'tedir.

export const BACKUP_MAGIC = 'namaz-aliskanligi-backup';
export const BACKUP_SCHEMA = 1;

export type BackupFile = {
  magic: string;
  schema: number;
  app: string;
  appVersion: string;
  exportedAt: string; // ISO 8601
  appState: Record<string, any> | null;
  tracking: any[];
};

export type BackupLanguage = 'tr' | 'en' | 'ar';

// İçe aktarma hatalarını ayırt etmek için tipli hata.
export class BackupError extends Error {
  code: 'cancelled' | 'invalid' | 'read';
  constructor(code: 'cancelled' | 'invalid' | 'read', message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'BackupError';
  }
}

/** Verilen veriyi standart bir yedek nesnesine sarar. */
export function buildBackup(
  appVersion: string,
  appState: Record<string, any> | null,
  tracking: any[]
): BackupFile {
  return {
    magic: BACKUP_MAGIC,
    schema: BACKUP_SCHEMA,
    app: 'Namaz Alışkanlığı',
    appVersion,
    exportedAt: new Date().toISOString(),
    appState,
    tracking: Array.isArray(tracking) ? tracking : [],
  };
}

/** JSON metnini veya gömülü JSON içeren HTML'i ayrıştırıp doğrular. */
export function parseBackup(text: string): BackupFile {
  let jsonText = text.trim();

  // HTML dosyası: gömülü JSON yükünü <script id="namaz-backup"> içinden çıkar.
  if (jsonText.startsWith('<')) {
    const match = text.match(/<script[^>]*id=["']namaz-backup["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new BackupError('invalid');
    jsonText = match[1].trim();
  }

  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new BackupError('invalid');
  }

  if (!data || data.magic !== BACKUP_MAGIC || typeof data.schema !== 'number') {
    throw new BackupError('invalid');
  }
  if (data.appState != null && typeof data.appState !== 'object') {
    throw new BackupError('invalid');
  }

  // tracking dizisini normalize et (bozuk yedeklere karşı dayanıklılık)
  return {
    magic: data.magic,
    schema: data.schema,
    app: typeof data.app === 'string' ? data.app : 'Namaz Alışkanlığı',
    appVersion: typeof data.appVersion === 'string' ? data.appVersion : '?',
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : new Date().toISOString(),
    appState: data.appState ?? null,
    tracking: Array.isArray(data.tracking) ? data.tracking : [],
  };
}

// ─── HTML rapor üretimi ──────────────────────────────────────────────────────

const PRAYER_ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

type HtmlLabels = {
  shareTitle: string;
  title: string;
  subtitle: string;
  exportedAt: string;
  version: string;
  location: string;
  unknown: string;
  summary: string;
  trackedDays: string;
  completion: string;
  onTime: string;
  late: string;
  missed: string;
  notMarked: string;
  records: string;
  date: string;
  noRecords: string;
  settings: string;
  language: string;
  theme: string;
  timeFormat: string;
  earlyReminder: string;
  tracking: string;
  on: string;
  off: string;
  minutes: string;
  exact: string;
  restoreTitle: string;
  restoreBody: string;
  prayersShort: Record<string, string>;
  themeNames: Record<string, string>;
  timeNames: Record<string, string>;
  langNames: Record<string, string>;
  months: string[];
};

export const HTML_LABELS: Record<BackupLanguage, HtmlLabels> = {
  tr: {
    shareTitle: 'Namaz Alışkanlığı Yedeği',
    title: 'Namaz Alışkanlığı',
    subtitle: 'Veri Yedeği',
    exportedAt: 'Oluşturulma',
    version: 'Sürüm',
    location: 'Konum',
    unknown: 'Bilinmiyor',
    summary: 'Özet',
    trackedDays: 'Takip Edilen Gün',
    completion: 'Kılınma Oranı',
    onTime: 'Vaktinde',
    late: 'Geç',
    missed: 'Kılınmadı',
    notMarked: 'İşaretsiz',
    records: 'Günlük Kayıtlar',
    date: 'Tarih',
    noRecords: 'Henüz namaz takip kaydı yok.',
    settings: 'Ayarlar',
    language: 'Dil',
    theme: 'Tema',
    timeFormat: 'Saat Sistemi',
    earlyReminder: 'Erken Hatırlatma',
    tracking: 'Namaz Takibi',
    on: 'Açık',
    off: 'Kapalı',
    minutes: 'dakika',
    exact: 'Tam vaktinde',
    restoreTitle: 'Bu yedeği geri yüklemek için',
    restoreBody:
      'Uygulamada Ayarlar → Veri Yedekleme → “İçe Aktar” adımını açın ve bu dosyayı seçin. Bu HTML dosyası geri yükleme verisini içinde barındırır; JSON yedeği gibi yeniden içe aktarılabilir.',
    prayersShort: { fajr: 'İmsak', dhuhr: 'Öğle', asr: 'İkindi', maghrib: 'Akşam', isha: 'Yatsı' },
    themeNames: { system: 'Sistem', dark: 'Karanlık', light: 'Aydınlık' },
    timeNames: { system: 'Sistem', '24': '24 Saat', '12': '12 Saat' },
    langNames: { tr: 'Türkçe', en: 'İngilizce', ar: 'Arapça' },
    months: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  },
  en: {
    shareTitle: 'Prayer Habit Backup',
    title: 'Prayer Habit',
    subtitle: 'Data Backup',
    exportedAt: 'Created',
    version: 'Version',
    location: 'Location',
    unknown: 'Unknown',
    summary: 'Summary',
    trackedDays: 'Tracked Days',
    completion: 'Prayed Rate',
    onTime: 'On time',
    late: 'Late',
    missed: 'Missed',
    notMarked: 'Unmarked',
    records: 'Daily Records',
    date: 'Date',
    noRecords: 'No prayer tracking records yet.',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    timeFormat: 'Time Format',
    earlyReminder: 'Early Reminder',
    tracking: 'Prayer Tracking',
    on: 'On',
    off: 'Off',
    minutes: 'minutes',
    exact: 'On time',
    restoreTitle: 'To restore this backup',
    restoreBody:
      'In the app open Settings → Data Backup → “Import” and select this file. This HTML file embeds the restore data, so it can be re-imported just like the JSON backup.',
    prayersShort: { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Magh.', isha: 'Isha' },
    themeNames: { system: 'System', dark: 'Dark', light: 'Light' },
    timeNames: { system: 'System', '24': '24 Hour', '12': '12 Hour' },
    langNames: { tr: 'Turkish', en: 'English', ar: 'Arabic' },
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
  ar: {
    shareTitle: 'نسخة احتياطية لعادة الصلاة',
    title: 'عادة الصلاة',
    subtitle: 'نسخة احتياطية للبيانات',
    exportedAt: 'تاريخ الإنشاء',
    version: 'الإصدار',
    location: 'الموقع',
    unknown: 'غير معروف',
    summary: 'ملخص',
    trackedDays: 'الأيام المتتبَّعة',
    completion: 'نسبة الأداء',
    onTime: 'في الوقت',
    late: 'متأخر',
    missed: 'فائتة',
    notMarked: 'غير مُعلَّم',
    records: 'السجلات اليومية',
    date: 'التاريخ',
    noRecords: 'لا توجد سجلات تتبع للصلاة بعد.',
    settings: 'الإعدادات',
    language: 'اللغة',
    theme: 'المظهر',
    timeFormat: 'نظام الوقت',
    earlyReminder: 'تذكير مسبق',
    tracking: 'تتبع الصلاة',
    on: 'مفعّل',
    off: 'متوقف',
    minutes: 'دقيقة',
    exact: 'في الوقت',
    restoreTitle: 'لاستعادة هذه النسخة',
    restoreBody:
      'في التطبيق افتح الإعدادات ← نسخ البيانات ← «استيراد» واختر هذا الملف. يتضمن ملف HTML هذا بيانات الاستعادة، لذا يمكن استيراده مجدداً مثل نسخة JSON.',
    prayersShort: { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' },
    themeNames: { system: 'النظام', dark: 'داكن', light: 'فاتح' },
    timeNames: { system: 'النظام', '24': '٢٤ ساعة', '12': '١٢ ساعة' },
    langNames: { tr: 'التركية', en: 'الإنجليزية', ar: 'العربية' },
    months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  },
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatExportDate(iso: string, L: HtmlLabels): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${L.months[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}

function formatDayLabel(date: string, L: HtmlLabels): string {
  const [y, m, dd] = String(date).split('-').map(Number);
  if (!y || !m || !dd || m < 1 || m > 12) return escapeHtml(date);
  return `${dd} ${L.months[m - 1]} ${y}`;
}

export function renderHtml(backup: BackupFile, language: BackupLanguage): string {
  const L = HTML_LABELS[language] ?? HTML_LABELS.tr;
  const rtl = language === 'ar';
  const state = backup.appState ?? {};

  // Sadece en az bir kaydı olan günleri al, en yeni en üstte.
  const tracking = (Array.isArray(backup.tracking) ? backup.tracking : [])
    .filter((d) => d && typeof d.date === 'string' && d.statuses && Object.values(d.statuses).some(Boolean))
    .sort((a, b) => b.date.localeCompare(a.date));

  // İstatistikler
  let onTime = 0;
  let late = 0;
  let missed = 0;
  for (const day of tracking) {
    for (const key of PRAYER_ORDER) {
      const s = day.statuses[key];
      if (s === 'onTime') onTime++;
      else if (s === 'late') late++;
      else if (s === 'missed') missed++;
    }
  }
  const marked = onTime + late + missed;
  const prayed = onTime + late;
  const completion = marked ? Math.round((prayed / marked) * 100) : 0;

  const locationLabel = state.locationLabel
    ? [state.locationLabel.city, state.locationLabel.district].filter(Boolean).join(' / ') || L.unknown
    : L.unknown;

  // Ayarlar değerleri
  const themeName = L.themeNames[state.themePreference] ?? state.themePreference ?? '—';
  const timeName = L.timeNames[state.timeFormat] ?? state.timeFormat ?? '—';
  const langName = L.langNames[state.language] ?? state.language ?? '—';
  const early =
    typeof state.earlyReminderMinutes === 'number' && state.earlyReminderMinutes > 0
      ? `${state.earlyReminderMinutes} ${L.minutes}`
      : L.exact;
  const trackingOn = state.trackingEnabled ? L.on : L.off;

  // Günlük kayıt satırları
  const headCells = PRAYER_ORDER.map((k) => `<th class="ph">${escapeHtml(L.prayersShort[k])}</th>`).join('');

  const rows = tracking
    .map((day) => {
      const cells = PRAYER_ORDER.map((k) => {
        const s = day.statuses[k];
        const cls = s === 'onTime' ? 'ok' : s === 'late' ? 'late' : s === 'missed' ? 'miss' : 'empty';
        const dot = s ? '<span class="dot"></span>' : '·';
        return `<td class="c ${cls}">${dot}</td>`;
      }).join('');
      return `<tr><td class="d">${formatDayLabel(day.date, L)}</td>${cells}</tr>`;
    })
    .join('');

  const recordsBlock = tracking.length
    ? `<table class="rec">
        <thead><tr><th class="d">${escapeHtml(L.date)}</th>${headCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    : `<p class="empty-note" style="color:var(--muted);text-align:center;padding:24px 0;">${escapeHtml(L.noRecords)}</p>`;

  // Geri yükleme için gömülü JSON (script kapanışını bozmamak için '<' kaçırılır)
  const payload = JSON.stringify(backup).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="${language}"${rtl ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(L.title)} — ${escapeHtml(L.subtitle)}</title>
<style>
  :root{
    --bg:#0f1110; --card:#181b1a; --card2:#1f2322; --line:#2b302e;
    --text:#e9e4d8; --muted:#9a8f80; --gold:#c9a84c;
    --ok:#5dab76; --late:#d4a843; --miss:#c85555;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    line-height:1.5;padding:24px 16px 56px;}
  .wrap{max-width:760px;margin:0 auto;}
  .head{background:linear-gradient(135deg,#1c1f1e,#15302a);border:1px solid var(--line);
    border-radius:18px;padding:28px 26px;position:relative;overflow:hidden;}
  .head::after{content:'';position:absolute;inset:0;
    background:radial-gradient(120% 120% at 100% 0%,rgba(201,168,76,.18),transparent 55%);}
  .badge{display:inline-block;font-size:11px;letter-spacing:2px;text-transform:uppercase;
    color:var(--gold);border:1px solid rgba(201,168,76,.4);border-radius:999px;
    padding:5px 12px;margin-bottom:14px;position:relative;}
  h1{margin:0 0 4px;font-size:28px;letter-spacing:.3px;}
  .sub{margin:0;color:var(--muted);font-size:14px;}
  .meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:18px;position:relative;}
  .meta div{font-size:13px;}
  .meta b{display:block;color:var(--muted);font-weight:500;font-size:11px;
    text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;}
  h2{font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);
    margin:34px 4px 14px;font-weight:600;}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;}
  .tile .n{font-size:30px;font-weight:700;letter-spacing:-.5px;}
  .tile .t{font-size:12px;color:var(--muted);margin-top:2px;}
  .tile.ok .n{color:var(--ok);} .tile.late .n{color:var(--late);} .tile.miss .n{color:var(--miss);}
  .tile.gold .n{color:var(--gold);}
  .bar{height:9px;border-radius:6px;background:var(--card2);overflow:hidden;margin-top:12px;border:1px solid var(--line);}
  .bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--ok),var(--gold));}
  .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;}
  .row{background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:13px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;}
  .row span{color:var(--muted);font-size:13px;} .row b{font-weight:600;font-size:14px;}
  table.rec{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);
    border:1px solid var(--line);border-radius:14px;overflow:hidden;}
  table.rec th{font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;
    letter-spacing:.6px;padding:12px 6px;background:var(--card2);}
  table.rec th.d, table.rec td.d{text-align:${rtl ? 'right' : 'left'};padding-${rtl ? 'right' : 'left'}:16px;white-space:nowrap;}
  table.rec td{padding:11px 6px;text-align:center;border-top:1px solid var(--line);font-size:13px;}
  table.rec td.d{font-weight:600;}
  .c{color:var(--muted);}
  .c .dot{display:inline-block;width:12px;height:12px;border-radius:50%;}
  .c.ok .dot{background:var(--ok);} .c.late .dot{background:var(--late);} .c.miss .dot{background:var(--miss);}
  .legend{display:flex;gap:18px;flex-wrap:wrap;margin:14px 4px 0;}
  .legend span{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);}
  .legend i{width:11px;height:11px;border-radius:50%;display:inline-block;}
  .restore{background:var(--card);border:1px dashed rgba(201,168,76,.45);border-radius:14px;
    padding:18px 20px;margin-top:30px;}
  .restore b{color:var(--gold);display:block;margin-bottom:6px;font-size:14px;}
  .restore p{margin:0;color:var(--muted);font-size:13px;}
  .foot{text-align:center;color:var(--muted);font-size:11px;margin-top:30px;opacity:.7;}
  @media print{body{background:#fff;color:#111;padding:0;}.head{background:#f4f1e8;}}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <span class="badge">${escapeHtml(L.subtitle)}</span>
    <h1>${escapeHtml(L.title)}</h1>
    <p class="sub">${escapeHtml(backup.app)}</p>
    <div class="meta">
      <div><b>${escapeHtml(L.exportedAt)}</b>${formatExportDate(backup.exportedAt, L)}</div>
      <div><b>${escapeHtml(L.version)}</b>${escapeHtml(backup.appVersion)}</div>
      <div><b>${escapeHtml(L.location)}</b>${escapeHtml(locationLabel)}</div>
    </div>
  </div>

  <h2>${escapeHtml(L.summary)}</h2>
  <div class="stats">
    <div class="tile gold"><div class="n">${tracking.length}</div><div class="t">${escapeHtml(L.trackedDays)}</div></div>
    <div class="tile ok"><div class="n">${onTime}</div><div class="t">${escapeHtml(L.onTime)}</div></div>
    <div class="tile late"><div class="n">${late}</div><div class="t">${escapeHtml(L.late)}</div></div>
    <div class="tile miss"><div class="n">${missed}</div><div class="t">${escapeHtml(L.missed)}</div></div>
  </div>
  <div class="tile" style="margin-top:12px;">
    <div class="t">${escapeHtml(L.completion)} — <b style="color:var(--text)">%${completion}</b></div>
    <div class="bar"><i style="width:${completion}%"></i></div>
  </div>

  <h2>${escapeHtml(L.settings)}</h2>
  <div class="grid2">
    <div class="row"><span>${escapeHtml(L.language)}</span><b>${escapeHtml(langName)}</b></div>
    <div class="row"><span>${escapeHtml(L.theme)}</span><b>${escapeHtml(themeName)}</b></div>
    <div class="row"><span>${escapeHtml(L.timeFormat)}</span><b>${escapeHtml(timeName)}</b></div>
    <div class="row"><span>${escapeHtml(L.earlyReminder)}</span><b>${escapeHtml(early)}</b></div>
    <div class="row"><span>${escapeHtml(L.tracking)}</span><b>${escapeHtml(trackingOn)}</b></div>
  </div>

  <h2>${escapeHtml(L.records)}</h2>
  ${recordsBlock}
  <div class="legend">
    <span><i style="background:var(--ok)"></i>${escapeHtml(L.onTime)}</span>
    <span><i style="background:var(--late)"></i>${escapeHtml(L.late)}</span>
    <span><i style="background:var(--miss)"></i>${escapeHtml(L.missed)}</span>
    <span><i style="background:var(--card2)"></i>${escapeHtml(L.notMarked)}</span>
  </div>

  <div class="restore">
    <b>${escapeHtml(L.restoreTitle)}</b>
    <p>${escapeHtml(L.restoreBody)}</p>
  </div>

  <div class="foot">${escapeHtml(backup.app)} · ${escapeHtml(backup.appVersion)} · ${escapeHtml(BACKUP_MAGIC)}</div>
</div>
<script type="application/json" id="namaz-backup">${payload}</script>
</body>
</html>`;
}
