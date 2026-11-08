/**
 * Hedefli production log kaldırma — YEREL Babel eklentisi (npm bağımlılığı YOK).
 *
 * KAPSAM: yalnızca ilk argümanı `[location-diagnostics]` ile BAŞLAYAN sabit metin
 * olan `console.log/info/debug/trace/warn` çağrıları. Bu çağrılar release cihazda
 * logcat'e Supabase uç noktası/HTTP durum kodları, PostgREST hata kodları, fetch
 * hata nesneleri (mesajında host geçer) ve konum servisi hata nesneleri yazıyor.
 *
 * KAPSAM DIŞI (bilerek KORUNUR):
 *   • `console.error` (ErrorBoundary `[CRASH]`, ExceptionsManager)
 *   • `[notifications]`, `[storage]`, `[audio]`, `[tracking]` uyarıları
 *   • prefiksi olmayan genel uyarılar (backup.ts, tracking/storage.ts)
 *   • ilk argümanı değişken/şablon-ifade olan çağrılar (statik olarak
 *     sınıflandırılamayana dokunulmaz — güvenli taraf)
 *
 * DÖNÜŞÜM ve YAN ETKİ KORUMASI (argümanlar körlemesine atılmaz):
 *   • Argümanlardan herhangi biri KESİN yan etkili olabilecek bir düğüm
 *     içeriyorsa (CallExpression, OptionalCallExpression, NewExpression,
 *     AwaitExpression, YieldExpression, AssignmentExpression, UpdateExpression,
 *     TaggedTemplateExpression, ImportExpression) çağrıya HİÇ DOKUNULMAZ.
 *     Log kalır; davranış değişikliği ihtimali sıfırdır.
 *   • İspatlanabilir biçimde saf argümanlar (metin/sayı/boolean/null literalleri,
 *     yerel tanımlayıcı okumaları, `this`) atılır.
 *   • Geri kalan (üye okuması gibi, teorik getter ihtimali taşıyan) argümanlar
 *     ORİJİNAL SIRASIYLA korunur: çağrı `(korunan1, korunan2, void 0)` biçiminde
 *     bir SequenceExpression'a dönüşür. Böylece değerlendirme sırası ve olası
 *     getter etkileri aynen kalır, yalnız loglama kaldırılır.
 *   • `void 0` hem ifade hem deyim konumunda geçerlidir (ör.
 *     `.catch((e) => console.warn('[location-diagnostics] ...', e))`), AST bozulmaz.
 *   • Atılan argümanların metin sabitleri bundle'dan düşer.
 *
 * NE ZAMAN ÇALIŞIR: yalnız üretim paketlemesinde — bkz. babel.config.js.
 * Metro/Expo geliştirme sunucusunda hiçbir şey değişmez.
 */

// `[remote-config]` de dahildir: uzaktan yapılandırma isteği aynı Supabase
// host'una gider ve hata nesnelerinin mesajında host/HTTP durumu geçer. Aynı
// gizlilik gerekçesi, aynı muamele.
const SENSITIVE_PREFIXES = ['[location-diagnostics]', '[remote-config]'];
const TARGET_METHODS = new Set(['log', 'info', 'debug', 'trace', 'warn']);

// Bu düğümlerden biri argüman ağacında geçiyorsa çağrı HİÇ kaldırılmaz.
const EFFECTFUL_NODES = new Set([
  'CallExpression',
  'OptionalCallExpression',
  'NewExpression',
  'AwaitExpression',
  'YieldExpression',
  'AssignmentExpression',
  'UpdateExpression',
  'TaggedTemplateExpression',
  'ImportExpression',
]);

// Yalnız bunlar "ispatlanabilir biçimde saf" sayılır ve atılabilir.
const PROVABLY_PURE_NODES = new Set([
  'StringLiteral',
  'NumericLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'BigIntLiteral',
  'RegExpLiteral',
  'Identifier',
  'ThisExpression',
]);

/** Argüman ağacında kesin yan etkili bir düğüm var mı? */
function hasEffectfulNode(node) {
  if (!node || typeof node.type !== 'string') return false;
  if (EFFECTFUL_NODES.has(node.type)) return true;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string' && hasEffectfulNode(child)) return true;
      }
    } else if (value && typeof value.type === 'string' && hasEffectfulNode(value)) {
      return true;
    }
  }
  return false;
}

/** İlk argüman sabit bir metin mi? Değilse null döner (dokunulmaz). */
function staticText(types, node) {
  if (types.isStringLiteral(node)) return node.value;
  if (
    types.isTemplateLiteral(node) &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

module.exports = function stripDiagnosticsLogs({ types }) {
  return {
    name: 'strip-diagnostics-logs',
    visitor: {
      CallExpression(path) {
        const callee = path.node.callee;
        if (!types.isMemberExpression(callee) || callee.computed) return;
        if (!types.isIdentifier(callee.object, { name: 'console' })) return;
        if (!types.isIdentifier(callee.property)) return;
        if (!TARGET_METHODS.has(callee.property.name)) return;

        const args = path.node.arguments;
        const text = staticText(types, args[0]);
        if (text === null) return;
        if (!SENSITIVE_PREFIXES.some((prefix) => text.startsWith(prefix))) return;

        // Yayma (spread) argümanı yineleyici çalıştırır ve SequenceExpression
        // içinde geçerli değildir → çağrıya hiç dokunma.
        if (args.some((argument) => argument.type === 'SpreadElement' || argument.type === 'ArgumentPlaceholder')) return;

        // Kesin yan etkili argüman varsa çağrıya dokunma (log korunur).
        if (args.some((argument) => hasEffectfulNode(argument))) return;

        // Saf olduğu ispatlanamayan argümanları sırasıyla koru (getter ihtimali).
        const preserved = args
          .filter((argument) => !PROVABLY_PURE_NODES.has(argument.type))
          .map((argument) => types.cloneNode(argument, true));

        const voidExpression = types.unaryExpression('void', types.numericLiteral(0));
        path.replaceWith(
          preserved.length > 0
            ? types.sequenceExpression([...preserved, voidExpression])
            : voidExpression
        );
        path.skip();
      },
    },
  };
};
