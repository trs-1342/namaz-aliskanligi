/**
 * Expo SDK 54 varsayılan Babel yapılandırması + üretim paketlemesinde hedefli
 * log kaldırma.
 *
 * NOT: Bu dosya daha önce projede YOKTU; @expo/metro-config zaten varsayılan
 * olarak `babel-preset-expo` uyguluyordu. Buradaki `presets` girdisi o
 * varsayılanı birebir tekrarlar (Expo şablonunun ürettiği yapılandırmanın
 * aynısı), davranışı değiştirmez.
 *
 * Üretim tespiti (@expo/metro-config/build/babel-transformer.js ile doğrulandı):
 *   • caller.isDev  -> transformer `isDev: options.dev` olarak geçiriyor (satır 54)
 *   • BABEL_ENV     -> dev'de 'development', aksi hâlde 'production' (satır 97)
 * Yalnız üretim olduğu KESİN olduğunda eklenti devreye girer; sinyal
 * okunamazsa loglar OLDUĞU GİBİ KALIR (güvenli taraf: derleme bozulmaz).
 *
 * Bu dosyayı ekledikten sonra Metro önbelleği tazelenmelidir: `npm start`
 * (zaten `--clear` içeriyor). Release derlemeleri temiz paketlediği için
 * ek işlem gerekmez.
 */
module.exports = function babelConfig(api) {
  const callerIsDev = api.caller((caller) => (caller ? caller.isDev : undefined));
  const env = process.env.BABEL_ENV || process.env.NODE_ENV;

  const isProductionBundle = callerIsDev === false || (callerIsDev === undefined && env === 'production');

  api.cache.using(() => `${String(callerIsDev)}|${String(env)}`);

  return {
    presets: ['babel-preset-expo'],
    plugins: isProductionBundle ? [require.resolve('./scripts/babel-plugin-strip-diagnostics-logs.cjs')] : [],
  };
};
