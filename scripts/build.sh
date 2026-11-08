#!/usr/bin/env bash
#
# Yerel derleme — çıktı dosyası KİMLİKLİ adlandırılır.
#
# Eskiden çıktı `BU.apk` idi; ard arda alınan derlemeler birbirinin üzerine
# yazıyor ve hangi APK'nın hangi koda ait olduğu anlaşılmıyordu. Artık ad şu
# biçimdedir:
#
#   namaz-<sürüm>-<profil>-<git-sha>-<tarih-saat>.apk
#   ör. namaz-1.4.0-apk-5976fbd-20260805-1530.apk
#
# `git-sha` çalışma ağacında commit edilmemiş değişiklik varsa `-dirty` eki alır.
#
# KULLANIM
#   ./scripts/build.sh              # APK (varsayılan) — gerçek paket adı, gerçek uygulama adı
#   ./scripts/build.sh aab          # Play Store için AAB
#   ./scripts/build.sh production   # AAB + versionCode otomatik artar (EAS remote)
#
# NOT: Yan yana kurulan ".test" paketi KALDIRILDI — uygulama adına "Test" ekleyen
# profil ve build.gradle'daki blok dahil.
#
# NOT: `production` profili versionCode'u UZAKTAN artırır (eas.json:
# appVersionSource=remote, autoIncrement). Sadece gerçekten yayınlanacak
# derlemede kullanın; sıradan test için `apk` yeterlidir.

set -euo pipefail

cd "$(dirname "$0")/.."

PROFILE="${1:-apk}"

case "$PROFILE" in
  apk|preview)    EXT="apk" ;;
  aab|production) EXT="aab" ;;
  *) echo "Bilinmeyen profil: $PROFILE (apk | aab | production)" >&2; exit 1 ;;
esac

VERSION=$(node -p "require('./app.json').expo.version")
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  SHA="${SHA}-dirty"
fi
STAMP=$(date +%Y%m%d-%H%M)
OUT="./builds/namaz-${VERSION}-${PROFILE}-${SHA}-${STAMP}.${EXT}"

mkdir -p ./builds

echo "[build] profil : $PROFILE"
echo "[build] sürüm  : $VERSION"
echo "[build] commit : $SHA"
echo "[build] çıktı  : $OUT"
echo

JAVA_HOME="${JAVA_HOME:-/home/trs/.local/jdk/jdk-21.0.6+7}" \
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}" \
eas build --platform android --profile "$PROFILE" --local --output "$OUT" --non-interactive

echo
echo "[build] tamam: $OUT"
ls -la "$OUT"
