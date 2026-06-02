#!/usr/bin/env bash
# Namaz Alışkanlığı — Android test yardımcısı
# Kullanım: ./scripts/test-android.sh [komut]
# Komutlar: install, log, crash, alarm, notif, info, apk, screen, clean

ADB=/home/trs/Android/Sdk/platform-tools/adb
PKG=com.trs1342.namazaliskanligi
ACTIVITY=$PKG/.MainActivity
APK_LOCAL="./releases/app.apk"  # preview build indirince buraya koy

cmd=${1:-help}

_check_device() {
  if ! $ADB devices | grep -q "device$"; then
    echo "HATA: Bağlı cihaz/emülatör yok. 'adb devices' ile kontrol et."
    exit 1
  fi
}

case $cmd in

  install)
    _check_device
    APK=${2:-$APK_LOCAL}
    echo "Yükleniyor: $APK"
    $ADB install -r "$APK"
    echo "Başlatılıyor..."
    $ADB shell am start -n $ACTIVITY
    ;;

  log)
    # Tüm uygulama logları — Ctrl+C ile durdur
    _check_device
    $ADB logcat --pid=$($ADB shell pidof $PKG 2>/dev/null) 2>/dev/null \
      | grep -v "^--$"
    ;;

  crash)
    # Sadece crash ve hata logları
    _check_device
    echo "Uygulama yeniden başlatılıyor..."
    $ADB logcat -c
    $ADB shell am force-stop $PKG
    sleep 1
    $ADB shell am start -n $ACTIVITY
    echo "Loglar bekleniyor (10s)..."
    sleep 10
    echo ""
    echo "=== CRASH / HATA LOGLARI ==="
    $ADB logcat -d 2>&1 \
      | grep -E "(FATAL|AndroidRuntime|ReactNativeJS|BridgelessReact|handleHostException|Error|Exception|crash)" \
      | grep -v "^--$"
    ;;

  js-log)
    # Sadece JavaScript tarafı logları
    _check_device
    $ADB logcat ReactNativeJS:V ReactNative:V *:S
    ;;

  alarm)
    # Planlanmış alarm var mı?
    _check_device
    echo "=== Planlanmış alarmlar ==="
    $ADB shell dumpsys alarm | grep -A3 "$PKG" | head -40
    ;;

  notif)
    # Bildirim kanalları
    _check_device
    echo "=== Bildirim kanalları ==="
    $ADB shell dumpsys notification | grep -A5 "$PKG" | head -30
    ;;

  info)
    # Uygulama genel bilgisi
    _check_device
    echo "=== Paket bilgisi ==="
    $ADB shell pm dump $PKG | grep -E "versionCode|versionName|firstInstall|lastUpdateTime|userId"
    echo ""
    echo "=== CPU mimarisi ==="
    $ADB shell getprop ro.product.cpu.abilist
    echo ""
    echo "=== Android sürümü ==="
    $ADB shell getprop ro.build.version.release
    echo ""
    echo "=== Pil optimizasyonu (whitelist) ==="
    $ADB shell dumpsys deviceidle whitelist | grep $PKG || echo "Whitelistte değil"
    ;;

  battery-exempt)
    # Pil optimizasyonundan muaf tut (alarm gecikmelerini önler)
    _check_device
    echo "Pil optimizasyonundan muaf tutuluyor..."
    $ADB shell dumpsys deviceidle whitelist +$PKG
    echo "Tamamlandı."
    ;;

  lock)
    # Kilit ekranını simüle et
    _check_device
    $ADB shell input keyevent 26
    echo "Ekran kilitlendi."
    ;;

  unlock)
    _check_device
    $ADB shell input keyevent 82
    echo "Kilit açıldı."
    ;;

  screen)
    # Ekran görüntüsü al
    _check_device
    TS=$(date +%Y%m%d_%H%M%S)
    $ADB shell screencap -p /sdcard/screen_$TS.png
    $ADB pull /sdcard/screen_$TS.png /tmp/screen_$TS.png
    echo "Kaydedildi: /tmp/screen_$TS.png"
    ;;

  record)
    # Ekran kaydı al (Ctrl+C ile durdur, otomatik çeker)
    _check_device
    TS=$(date +%Y%m%d_%H%M%S)
    echo "Kayıt başlıyor... Ctrl+C ile durdur."
    $ADB shell screenrecord /sdcard/video_$TS.mp4 &
    REC_PID=$!
    trap "$ADB shell am force-stop screenrecord; wait $REC_PID; $ADB pull /sdcard/video_$TS.mp4 /tmp/video_$TS.mp4; echo 'Kaydedildi: /tmp/video_$TS.mp4'" INT
    wait $REC_PID
    ;;

  apk)
    # APK'yı cihazdan çek ve analiz et
    _check_device
    REMOTE=$($ADB shell pm path $PKG | cut -d: -f2 | tr -d '\r')
    echo "APK yolu: $REMOTE"
    $ADB pull "$REMOTE" /tmp/namaz_app.apk
    echo ""
    echo "=== Boyut ==="
    ls -lh /tmp/namaz_app.apk
    echo ""
    echo "=== Manifest (versiyon, izinler) ==="
    /home/trs/Android/Sdk/build-tools/37.0.0/aapt2 dump xmltree \
      --file AndroidManifest.xml /tmp/namaz_app.apk 2>&1 \
      | grep -E "versionCode|versionName|showWhenLocked|turnScreenOn|uses-permission|newArch" \
      | head -30
    echo ""
    echo "=== Native kütüphaneler (x86_64) ==="
    unzip -l /tmp/namaz_app.apk "lib/x86_64/*" | grep ".so" | awk '{print $4}'
    echo ""
    echo "=== JS bundle boyutu ==="
    unzip -l /tmp/namaz_app.apk "assets/index.android.bundle" | grep bundle
    ;;

  decompile)
    # APK'yı jadx ile kaynak koda çevir (jadx kurulu olmalı)
    _check_device
    if ! command -v jadx &> /dev/null; then
      echo "jadx kurulu değil. Kur: sudo dnf install jadx (veya snap install jadx)"
      exit 1
    fi
    REMOTE=$($ADB shell pm path $PKG | cut -d: -f2 | tr -d '\r')
    $ADB pull "$REMOTE" /tmp/namaz_app.apk
    mkdir -p /tmp/namaz_decompiled
    jadx -d /tmp/namaz_decompiled /tmp/namaz_app.apk
    echo "Kaynak kod: /tmp/namaz_decompiled/"
    echo "AlarmWindowModule: $(find /tmp/namaz_decompiled -name 'AlarmWindowModule*' 2>/dev/null)"
    ;;

  clean)
    _check_device
    echo "Uygulama verisi temizleniyor..."
    $ADB shell pm clear $PKG
    echo "Tamamlandı."
    ;;

  help|*)
    cat << 'HELP'
Kullanım: ./scripts/test-android.sh <komut>

Kurulum & Başlatma:
  install [apk]    APK yükle ve başlat
  clean            Uygulama verilerini sıfırla

Log & Debug:
  log              Tüm uygulama logları (Ctrl+C ile dur)
  crash            Uygulamayı yeniden başlat ve crash loglarını göster
  js-log           Sadece JavaScript logları

Alarm & Bildirim:
  alarm            Planlanmış alarm listesi
  notif            Bildirim kanalları
  battery-exempt   Pil optimizasyonundan muaf tut (önemli!)

Cihaz Kontrolü:
  info             Versiyon, CPU, Android bilgisi
  lock / unlock    Ekranı kilitle / aç
  screen           Ekran görüntüsü al
  record           Ekran kaydı (Ctrl+C ile dur)

APK İnceleme:
  apk              APK'yı cihazdan çek ve analiz et
  decompile        APK'yı jadx ile kaynak koda çevir (jadx kurulu olmalı)

HELP
    ;;
esac
