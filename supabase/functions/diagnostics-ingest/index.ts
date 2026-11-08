/**
 * diagnostics-ingest — TASLAK / HAZIRLIK. ETKİN DEĞİLDİR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  DURUM: deploy EDİLMEDİ. Hiçbir istemci kodu bu uç noktayı çağırmıyor.
 *  Uygulama hâlâ doğrudan `POST /rest/v1/notification_location_diagnostics`
 *  kullanıyor. Bu dosya tek başına HİÇBİR güvenlik kazancı sağlamaz; yalnız
 *  ileride yapılacak geçiş için hazırlanmış bir taslaktır.
 *  Geçiş sırası ve şartları:
 *    supabase/manual/20260804040000_revoke_anon_insert_after_edge_cutover.sql
 * ══════════════════════════════════════════════════════════════════════════
 *
 * NEDEN (geçiş yapılırsa kazanılacaklar): Bugün istemci, APK içine gömülü
 * anon/publishable anahtarla tabloya doğrudan yazıyor. Anahtar APK'dan
 * çıkarılabilir; yani tabloya INSERT yetkisi pratikte herkese açıktır (2000
 * satır kapasitesi + kurulum başına saatlik 16 kayıt trigger'ı ile sınırlı).
 * Geçiş sonrası: tablo REST üzerinden hiç açılmaz, doğrulama sunucuda alan
 * beyaz listesiyle yapılır, hız/kapasite reddi 429 (yeniden denenebilir) döner.
 *
 * ── KİMLİK DOĞRULAMA GERÇEĞİ (JWT konusu) ─────────────────────────────────
 * Bu akışta kullanıcı oturumu ve Supabase Auth YOKTUR: kayıt/giriş yok, kullanıcı
 * kimliği yok, yalnız cihazda üretilmiş rastgele bir `installation_id` (UUID) var.
 * Dolayısıyla:
 *   • Anlamlı bir kullanıcı JWT'si üretilemez. "JWT doğrulaması var" demek bu
 *     akışta yanıltıcı olur — doğrulanan şey yalnızca herkese açık anon
 *     anahtarın kendisi olurdu.
 *   • DIAGNOSTICS_INGEST_TOKEN da APK içine gömülecektir; GİZLİ TUTULAMAZ.
 *     Kimlik doğrulama DEĞİLDİR; tek değeri, uygulama güncellemesi olmadan
 *     sunucudan kapatılabilen/döndürülebilen bir "musluk" olmasıdır.
 *   • Bu yüzden kötüye kullanım savunması kimlik doğrulamaya değil şunlara
 *     dayanır: RLS (anon'a hiç yol bırakmama) + veritabanı trigger'ı (toplam
 *     satır kapasitesi ve installation_id başına saatlik sınır; ikisi de artık
 *     app_remote_config'ten okunur) + burada yapılan alan beyaz listesi/tip/
 *     enum/boyut doğrulaması + test penceresi ve ana şalter.
 *
 *     PENCERE ARTIK SABİT DEĞİL: kesim anını RLS policy'si, pg_cron temizlik
 *     job'ı ve bu fonksiyon (loadRemoteGate) AYNI satırdan —
 *     app_remote_config.diagnostics_cutoff — okur. Aynı satırdaki
 *     diagnostics_enabled ise süre dolmadan da her şeyi durdurur.
 *
 * ── DEPLOY UYARISI: verify_jwt ────────────────────────────────────────────
 * Supabase Edge Functions varsayılan olarak Authorization başlığındaki JWT'yi
 * doğrular. İstemcinin `buildSupabasePublicHeaders()` fonksiyonu, anahtar
 * `sb_publishable_` ile başlıyorsa Authorization başlığını GÖNDERMEZ (yalnız
 * apikey). Bu durumda fonksiyon 401 döner; istemci 401'i KALICI hata sayar ve
 * üç doğrulanmış sinyalden sonra kill-switch devreye girer. Bu yüzden geçiş
 * yapılacaksa ya `--no-verify-jwt` ile deploy edilmeli ya da istemci her iki
 * başlığı da göndermelidir. Aynı tuzak DIAGNOSTICS_INGEST_TOKEN için de geçerli:
 * token sunucuda değiştirilirse eski istemciler 401 alır → kill-switch. Token
 * yalnız test bittiğinde (özelliği bilerek kapatmak için) döndürülmelidir.
 *
 * ── SECRETS ───────────────────────────────────────────────────────────────
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → yalnızca Edge Function ortamında
 *     bulunur (platform sağlar). service_role anahtarı ASLA istemciye, .env.local
 *     dosyasına veya EXPO_PUBLIC_* değişkenlerine konulmamalıdır; konulursa
 *     RLS'i baypas eden tam yetki APK'ya gömülmüş olur.
 *   DIAGNOSTICS_INGEST_TOKEN → opsiyonel; ayarlanırsa zorunlu olur (yukarıdaki
 *     uyarıyı okumadan ayarlama).
 */

// ÖNYÜKLEME kesim anı — otorite DEĞİL. Pencerenin tek otoritesi
// `public.app_remote_config.diagnostics_cutoff`'tur (bkz. loadRemoteGate).
// Bu sabit yalnız config satırı okunamadığında güvenli tarafa düşmek içindir.
const FALLBACK_CUTOFF_MS = Date.parse('2026-08-11T00:00:00+03:00');
// Config, istek başına değil kısa süreli önbellekle okunur: her insert için
// ek bir sorgu atmak gereksiz yük olurdu.
const GATE_CACHE_MS = 60_000;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const INGEST_TOKEN = Deno.env.get('DIAGNOSTICS_INGEST_TOKEN') ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TESTER_CODE_RE = /^[A-F0-9]{8}$/;

const NOTIFICATION_KINDS = new Set(['prayer', 'early']);
const PRAYER_KEYS = new Set(['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']);
const CAPTURE_MODES = new Set(['foreground_received', 'android_alarm_cold_start']);
const NO_LOCATION_REASONS = new Set([
  'permission_denied',
  'services_disabled',
  'position_unavailable',
  'background_no_fix',
  // collect_location=false iken üretilir (20260805030000).
  'location_disabled_remotely',
]);
// Kaydı hangi tetikleyicinin ürettiği (20260805020000). Nullable: bu sütunu
// göndermeyen eski istemciler reddedilmemeli.
const BEACON_SOURCES = new Set([
  'location_service',
  'workmanager',
  'foreground_timer',
  'app_active',
  'net_reconnect',
  'notification',
  'gps_sync',
  'manual',
  'outbox_flush',
]);

type Json = Record<string, unknown>;

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function text(value: unknown, maxBytes: number): string | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return 'invalid';
  if (new TextEncoder().encode(value).length > maxBytes) return 'invalid';
  return value;
}

function timestamp(value: unknown, required: boolean): string | null | 'invalid' {
  if (value === null || value === undefined) return required ? 'invalid' : null;
  if (typeof value !== 'string') return 'invalid';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? value : 'invalid';
}

function coordinate(value: unknown, min: number, max: number): number | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'invalid';
  return value >= min && value <= max ? value : 'invalid';
}

/** İstemci payload'ını beyaz listeyle doğrular; DB kısıtlarının aynısını uygular. */
function buildRow(input: Json): { row: Json } | { error: string } {
  const out: Json = {};
  const fail = (field: string) => ({ error: `invalid field: ${field}` });

  if (typeof input.installation_id !== 'string' || !UUID_RE.test(input.installation_id)) {
    return fail('installation_id');
  }
  out.installation_id = input.installation_id;

  if (typeof input.tester_code !== 'string' || !TESTER_CODE_RE.test(input.tester_code)) {
    return fail('tester_code');
  }
  out.tester_code = input.tester_code;

  const textFields: Array<[string, number]> = [
    ['device_name', 256],
    ['device_model', 128],
    ['operating_system', 64],
    ['operating_system_version', 64],
    ['app_version', 64],
    ['app_build_version', 64],
  ];
  for (const [field, maxBytes] of textFields) {
    const value = text(input[field], maxBytes);
    if (value === 'invalid') return fail(field);
    out[field] = value;
  }

  const notificationId = text(input.notification_id, 256);
  if (notificationId === 'invalid' || notificationId === null) return fail('notification_id');
  out.notification_id = notificationId;

  if (typeof input.notification_kind !== 'string' || !NOTIFICATION_KINDS.has(input.notification_kind)) {
    return fail('notification_kind');
  }
  out.notification_kind = input.notification_kind;

  if (input.prayer_key === null || input.prayer_key === undefined) {
    out.prayer_key = null;
  } else if (typeof input.prayer_key === 'string' && PRAYER_KEYS.has(input.prayer_key)) {
    out.prayer_key = input.prayer_key;
  } else {
    return fail('prayer_key');
  }

  if (typeof input.capture_mode !== 'string' || !CAPTURE_MODES.has(input.capture_mode)) {
    return fail('capture_mode');
  }
  out.capture_mode = input.capture_mode;

  const sentAt = timestamp(input.notification_sent_at, true);
  if (sentAt === 'invalid') return fail('notification_sent_at');
  out.notification_sent_at = sentAt;

  const scheduledAt = timestamp(input.notification_scheduled_at, false);
  if (scheduledAt === 'invalid') return fail('notification_scheduled_at');
  out.notification_scheduled_at = scheduledAt;

  const capturedAt = timestamp(input.captured_at, true);
  if (capturedAt === 'invalid') return fail('captured_at');
  out.captured_at = capturedAt;

  const latitude = coordinate(input.latitude, -90, 90);
  if (latitude === 'invalid') return fail('latitude');
  const longitude = coordinate(input.longitude, -180, 180);
  if (longitude === 'invalid') return fail('longitude');
  const locationTimestamp = timestamp(input.location_timestamp, false);
  if (locationTimestamp === 'invalid') return fail('location_timestamp');

  const accuracy = coordinate(input.accuracy_m, 0, Number.MAX_SAFE_INTEGER);
  if (accuracy === 'invalid') return fail('accuracy_m');
  const altitude = coordinate(input.altitude_m, -100000, 100000);
  if (altitude === 'invalid') return fail('altitude_m');

  let noLocationReason: string | null = null;
  if (input.no_location_reason !== null && input.no_location_reason !== undefined) {
    if (typeof input.no_location_reason !== 'string' || !NO_LOCATION_REASONS.has(input.no_location_reason)) {
      return fail('no_location_reason');
    }
    noLocationReason = input.no_location_reason;
  }

  const hasCoordinates = latitude !== null && longitude !== null;
  // DB kısıtlarının aynısı: ya tam konum (koordinat + zaman damgası) ya da bir neden.
  if (hasCoordinates && locationTimestamp === null) return fail('location_timestamp');
  if (!hasCoordinates && (latitude !== null || longitude !== null)) return fail('latitude/longitude');
  if (!hasCoordinates && locationTimestamp !== null) return fail('location_timestamp');
  if (!hasCoordinates && noLocationReason === null) return fail('no_location_reason');

  out.latitude = latitude;
  out.longitude = longitude;
  out.location_timestamp = locationTimestamp;
  out.accuracy_m = accuracy;
  out.altitude_m = altitude;
  out.no_location_reason = noLocationReason;

  // beacon_source nullable: alanı hiç göndermeyen eski istemciler geçerlidir.
  // Gönderilmişse beyaz listede olmalı (DB CHECK'inin aynısı).
  if (input.beacon_source === null || input.beacon_source === undefined) {
    out.beacon_source = null;
  } else if (typeof input.beacon_source === 'string' && BEACON_SOURCES.has(input.beacon_source)) {
    out.beacon_source = input.beacon_source;
  } else {
    return fail('beacon_source');
  }

  return { row: out };
}

type RemoteGate = { enabled: boolean; cutoffMs: number };
let cachedGate: RemoteGate | null = null;
let cachedGateAt = 0;

/**
 * Ana şalteri ve kesim anını `app_remote_config`'ten okur — tıpkı istemcinin,
 * RLS policy'sinin ve pg_cron job'ının yaptığı gibi. Böylece pencere ve
 * açma/kapama kararı TEK bir satırdan yönetilir; bu fonksiyonun içinde sabit
 * tarih kalmaz.
 *
 * Okunamazsa (tablo yok / ağ hatası) güvenli tarafa düşülür: özellik açık
 * sayılır ama kesim anı yerleşik yedek tarihe iner — yani belirsizlikte
 * pencere UZAMAZ, kısalır.
 */
async function loadRemoteGate(): Promise<RemoteGate> {
  const now = Date.now();
  if (cachedGate && now - cachedGateAt < GATE_CACHE_MS) return cachedGate;

  const fallback: RemoteGate = { enabled: true, cutoffMs: FALLBACK_CUTOFF_MS };
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/app_remote_config?select=diagnostics_enabled,diagnostics_cutoff&id=eq.1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    if (!response.ok) return fallback;
    const rows = await response.json() as Array<{ diagnostics_enabled?: unknown; diagnostics_cutoff?: unknown }>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return fallback;
    const cutoffMs = typeof row.diagnostics_cutoff === 'string' ? Date.parse(row.diagnostics_cutoff) : NaN;
    cachedGate = {
      enabled: row.diagnostics_enabled !== false,
      cutoffMs: Number.isFinite(cutoffMs) ? cutoffMs : FALLBACK_CUTOFF_MS,
    };
    cachedGateAt = now;
    return cachedGate;
  } catch {
    return fallback;
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json(405, { error: 'method not allowed' });
  }

  if (INGEST_TOKEN && request.headers.get('x-diagnostics-token') !== INGEST_TOKEN) {
    return json(401, { error: 'unauthorized' });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: 'server not configured' });
  }

  // Ana şalter ve test penceresi — ikisi de app_remote_config'ten.
  const gate = await loadRemoteGate();
  if (!gate.enabled) {
    return json(403, { error: 'diagnostics disabled' });
  }
  if (!Number.isFinite(gate.cutoffMs) || Date.now() >= gate.cutoffMs) {
    return json(410, { error: 'diagnostics window closed' });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return json(400, { error: 'invalid json' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return json(400, { error: 'invalid payload' });
  }

  const built = buildRow(parsed as Json);
  if ('error' in built) return json(400, built as unknown as Json);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/notification_location_diagnostics`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(built.row),
  });

  if (response.ok) return json(201, { ok: true });

  let code: string | undefined;
  try {
    const body = await response.json() as { code?: unknown };
    if (typeof body.code === 'string') code = body.code;
  } catch {
    // Gövde okunamadıysa durum kodu ile devam.
  }

  // Kopya kayıt: istemci bunu "gönderildi" sayar (isDuplicateDiagnosticsResponse).
  if (code === '23505') return json(409, { code: '23505' });

  // Hız/kapasite sınırı (trigger, P0001): kalıcı DEĞİL — 429 ile yeniden denenebilir yap.
  if (code === 'P0001') return json(429, { code: 'P0001' });

  // Diğer sunucu tarafı hataları istemcide "geçici" sınıfa düşsün; kill-switch'i
  // yalnız gerçekten kalıcı durumlar (tablo yok / yetki yok) tetiklemeli.
  if (response.status >= 500) return json(503, { code: code ?? 'upstream' });
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return json(response.status, { code: code ?? 'permanent' });
  }
  return json(400, { code: code ?? 'rejected' });
});
