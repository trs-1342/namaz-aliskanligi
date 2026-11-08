import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Appearance,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  Switch,
  Text,
  View,
  ViewStyle,
  Vibration,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter';
import {
  NotoSerif_400Regular,
  NotoSerif_600SemiBold,
} from '@expo-google-fonts/noto-serif';

import { AppColors, ThemeMode, createShadow, themes } from './src/theme';
import { createAppStyles } from './src/styles/appStyles';
import {
  CachedPrayerDay,
  fetchMonthlyPrayerCalendar,
  PrayerTime,
} from './src/services/prayerTimes';
import { formatClock, getLocalDateKey, getCurrentPrayer, getNextPrayer } from './src/utils/time';
import { exportJson, exportHtml, pickAndReadBackup, restoreBackup, summarizeBackup, BackupError, BackupFile, BACKUP_SCHEMA } from './src/services/backup';
import { TrackingScreen, TRACKING_DICTS } from './src/tracking/TrackingScreen';
import { DayTracking, PrayerStatus, TrackingNotifMode } from './src/tracking/types';
import { clearTrackingDays, loadTrackingDays, saveTrackingDays, upsertDayStatus } from './src/tracking/storage';
import appConfig from './app.json';
import { clearAppState, loadAppState, migrateAppStateToGpsOnly, updateAppState } from './src/storage/appStateStorage';
import { buildTrackingReminderSpecs } from './src/notifications/trackingSchedule';
import {
  captureNotificationLocation,
  clearLocationDiagnosticsLocalState,
  flushLocationDiagnosticsOutbox,
  getLocationDiagnosticsConsent,
  hasAskedBackgroundLocationPermission,
  hasLocationDiagnosticsConsentDecision,
  isLocationDiagnosticsAvailable,
  markBackgroundLocationPermissionAsked,
  reconcileDiagnosticsShutdownState,
  sendDiagnosticsBeacon,
  setLocationDiagnosticsConsent,
} from './src/services/locationDiagnostics';
import {
  registerBackgroundBeaconAsync,
  unregisterBackgroundBeaconAsync,
} from './src/services/backgroundBeacon';
import {
  startBackgroundLocationBeaconAsync,
  stopBackgroundLocationBeaconAsync,
} from './src/services/backgroundLocationBeacon';
import { getRemoteConfig, hydrateRemoteConfig, refreshRemoteConfig } from './src/services/remoteConfig';

type Screen = 'home' | 'about' | 'tracking';
type Language = 'tr' | 'en' | 'ar';
type ThemePreference = 'system' | ThemeMode;
type TimeFormat = 'system' | '24' | '12';
type SnoozeMap = Record<string, number>;
type PrayerToggleField = 'notification' | 'vibration' | 'alarm';

type PrayerProgress = {
  previousKey: string;
  nextKey: string;
  progress: number;
};

type PrayerPrefs = Record<
  string,
  {
    notification: boolean;
    vibration: boolean;
    alarm: boolean;
  }
>;

type LocationLabel = { city: string; district: string };

type StoredAppState = {
  language: Language;
  themePreference: ThemePreference;
  timeFormat: TimeFormat;
  muteAll: boolean;
  disableVibration: boolean;
  disableAlarm: boolean;
  locationLabel: LocationLabel | null;
  locationCountryCode: string | null;
  earlyReminderMinutes: number;
  fridayReminderEnabled: boolean;
  fridayReminderTime: string; // "HH:MM"
  onboardingCompleted: boolean;
  coords: { latitude: number; longitude: number } | null;
  prayerPrefs: PrayerPrefs;
  snoozedUntilByKey: SnoozeMap;
  cachedPrayerDays: CachedPrayerDay[];
  scheduledPrayerNotificationIds: string[];
  trackingEnabled: boolean;
  trackingNotifMode: TrackingNotifMode;
  locationSourceVersion: 2;
};

const APP_VERSION = appConfig.expo.version;
const AlarmWindow = NativeModules.AlarmWindow as
  | { setFlags?: (enabled: boolean) => void; moveToBackground?: () => void }
  | undefined;

const DICTS = {
  tr: {
    appTitle: 'Namaz Alışkanlığı',
    currentTime: 'Şu Anki Vakit',
    remaining: 'Kalan',
    locationRequired: 'Konum Erişimi Gerekli',
    locationOff: 'Konum Senkronizasyonu Kapalı',
    locationText: 'Vakitleri doğru hesaplamak için konum izni gereklidir.',
    locationOffText: 'Konum çekme kapalı olduğu için varsayılan vakitler gösteriliyor.',
    requestLocation: 'Konum İzni',
    enableLocation: 'Konumu Aç',
    syncing: 'Senkronize',
    nextPrayer: 'Sıradaki',
    internetStatus: 'İnternet Bağlantısı',
    internetOnline: 'Bağlı',
    internetOffline: 'Çevrimdışı',
    offlineMode: 'Namaz vakitleri internet gerektirmeden lokal hesaplanıyor.',
    systemSettings: 'Sistem',
    notificationsSection: 'Bildirimler',
    generalSection: 'Genel',
    trackingSection: 'Namaz Takibi',
    muteAll: 'Tümünü Sustur',
    disableVibration: 'Titreşimleri Kapat',
    disableAlarm: 'Alarmları Kapat',
    locationDiagnostics: 'Geçici Konum Doğrulama Testi',
    locationDiagnosticsDescription: 'Bu uygulama bildirimleri geç verebilir, olması durumunda lütfen geliştiriciye haber verin. Test süresinde',
    locationDiagnosticsConsentTitle: 'Bilgilendirme',
    locationDiagnosticsConsentBody: 'Bu uygulama kapalı test sürecinde',
    locationDiagnosticsAccept: 'Devam et',
    /* locationDiagnosticsCancel: 'Tamam',
    locationDiagnosticsDecline: 'Hayır, İstemiyorum',*/
    resetData: 'Tüm Verileri Sıfırla',
    resetDataConfirmTitle: 'Tüm veriler silinsin mi?',
    resetDataConfirmBody:
      'Konum, ayarlar, namaz takibi ve tüm kayıtlar kalıcı olarak silinecek. Uygulama ilk açılıştaki haline dönecek.',
    resetDataConfirmBtn: 'Sil',
    dataBackup: 'Veri Yedekleme',
    dataBackupDesc: 'Tüm ayarlarınızı ve namaz takip kayıtlarınızı bir dosyaya aktarın; cihaz değişiminde veya format sonrası geri yükleyin.',
    exportJson: 'JSON Olarak Dışa Aktar',
    exportHtml: 'HTML Rapor Olarak Dışa Aktar',
    importData: 'Dosyadan İçe Aktar',
    exportErrorTitle: 'Dışa aktarılamadı',
    exportErrorBody: 'Yedek dosyası oluşturulurken bir sorun oluştu.',
    shareUnavailable: 'Bu cihazda paylaşım kullanılamıyor.',
    processing: 'İşleniyor...',
    backupNewerWarning: 'Bu yedek daha yeni bir sürümden; bazı veriler tam desteklenmeyebilir.',
    importConfirmTitle: 'Veriler geri yüklensin mi?',
    importConfirmBody: 'Seçilen yedekteki veriler mevcut tüm ayarların ve kayıtların yerine geçecek. Bu işlem geri alınamaz.',
    importConfirmBtn: 'Geri Yükle',
    importDoneTitle: 'Geri yüklendi',
    importDoneBody: 'Verileriniz yedekten başarıyla geri yüklendi.',
    importErrorTitle: 'İçe aktarılamadı',
    importErrorBody: 'Dosya okunamadı. Lütfen tekrar deneyin.',
    importInvalidBody: 'Seçilen dosya geçerli bir yedek değil.',
    cancel: 'İptal',
    locationInfo: 'Konum Bilgisi',
    locationCityDistrict: 'Şehir / İlçe',
    locationCoords: 'Koordinatlar',
    locationUnknown: 'Bilinmiyor',
    locationRefresh: 'Yenile',
    earlyReminder: 'Erken Hatırlatma',
    earlyReminderOff: 'Tam vaktinde',
    minutesShort: 'dk',
    fridayReminder: 'Cuma Hatırlatması',
    fridayReminderTimeLabel: 'Cuma Hatırlatma Saati',
    fridayReminderTitle: 'Cuma Namazı',
    fridayReminderBody: 'Bugün cuma — cuma namazını unutma.',
    onboarding: {
      locationTitle: 'Konumunuz',
      locationDesc: 'Namaz vakitlerini doğru hesaplamak için konumunuzu belirleyin.',
      allowGps: 'GPS ile Konum Al',
      notifTitle: 'Bildirimler',
      notifDesc: 'Namaz vakitlerini kaçırmamak için bildirim izni gerekiyor.',
      allowNotif: 'Bildirimlere İzin Ver',
      welcomeTitle: 'Hazırsınız!',
      welcomeDesc: 'Kurulum tamamlandı. Namaz vakitlerini takip etmeye başlayabilirsiniz.',
      start: 'Başla',
      skip: 'Atla',
      next: 'Devam',
      of: '/ 3',
    },
    aboutApp: 'Uygulama Hakkında',
    aboutText:
      'Namaz Alışkanlığı, namaz vakitlerini sade, net ve dikkat dağıtmayan bir arayüzle hatırlatmak için tasarlanmıştır. Amaç; bildirim, titreşim ve alarm geri bildirimlerini kişisel tercihe göre çalıştırarak namazı unutmamayı kolaylaştırmaktır.',
    settings: 'Ayarlar',
    language: 'Dil',
    theme: 'Tema',
    themeDark: 'Karanlık',
    themeLight: 'Aydınlık',
    timeFormat: 'Saat Sistemi',
    timeFormat24: '24 Saat',
    timeFormat12: '12 Saat',
    developer: 'Geliştirici',
    developerName: 'trs-1342',
    contactIntro: 'İletişim',
    contributeText: 'Proje',
    sourceCodeLabel: 'Kaynak Kod',
    website: 'Gizlilik & Web',
    trackPrayers: 'Namazımı Takip Et',
    trackPrayersDesc: 'Günlük namaz durumunu kaydet',
    trackingNotif: 'Takip Bildirimi',
    trackingNotifAlways: 'Her gün',
    trackingNotifIfIncomplete: 'Sadece eksik varsa',
    trackingReminderTitle: 'Namaz Takibi',
    trackingReminderBody: 'Bugünkü namazlarını işaretlemeyi unutma.',
    alarmActive: 'Alarm Aktif',
    alarmNotificationTitle: 'alarmı',
    alarmNotificationBody: 'Namaz vakti alarmı aktif',
    prayerNotificationBody: 'Namaz vakti bildirimi',
    snooze: '5 dk ertele',
    swipeToSnooze: 'Ertelemek için kaydır',
    snoozedUntil: 'Ertelendi',
    stop: 'Sustur',
    permissionDeniedTitle: 'Konum izni reddedildi',
    permissionDeniedBody: 'Namaz vakitleri için konum izni gerekiyor.',
    // İzin kalıcı olarak reddedildiğinde (Android artık diyalog göstermez) tek
    // çıkış yolu sistem ayarlarıdır; kullanıcıyı oraya yönlendiriyoruz.
    permissionBlockedBody:
      'Konum izni kapalı olduğu için namaz vakitleri hesaplanamıyor. İzni uygulama ayarlarından açmanız gerekiyor.',
    openSettings: 'Ayarları aç',
    // Konum yokken gerçek vakit gösterilemez; uydurma saat göstermek yerine bunu yazıyoruz.
    timesUnavailable: 'Konum bekleniyor',
    locationRequiredTitle: 'Konum gerekli',
    locationRequiredBody:
      'Namaz vakitleri konumunuza göre hesaplanır. Konum olmadan vakit gösterilemez ve bildirim kurulamaz, bu yüzden bu adım atlanamaz.',
    syncErrorTitle: 'Senkronizasyon hatası',
    syncErrorBody: 'Konum veya namaz vakti alınamadı. Kayıtlı vakitler varsa kullanılacak.',
    prayers: {
      fajr: 'İmsak',
      sunrise: 'Güneş',
      dhuhr: 'Öğle',
      asr: 'İkindi',
      maghrib: 'Akşam',
      isha: 'Yatsı',
    },
  },
  en: {
    appTitle: 'Prayer Habit',
    currentTime: 'Current Time',
    remaining: 'Remaining',
    locationRequired: 'Location Required',
    locationOff: 'Location Sync Disabled',
    locationText: 'Location permission is required for accurate prayer times.',
    locationOffText: 'Default prayer times are shown because location sync is disabled.',
    requestLocation: 'Allow Location',
    enableLocation: 'Enable Location',
    syncing: 'Syncing',
    nextPrayer: 'Next',
    internetStatus: 'Internet Connection',
    internetOnline: 'Online',
    internetOffline: 'Offline',
    offlineMode: 'Prayer times are calculated locally without internet.',
    systemSettings: 'System',
    notificationsSection: 'Notifications',
    generalSection: 'General',
    trackingSection: 'Prayer Tracking',
    muteAll: 'Mute All',
    disableVibration: 'Disable Vibrations',
    disableAlarm: 'Disable Alarms',
    locationDiagnostics: 'Test Information',
    locationDiagnosticsDescription: 'This app may deliver notifications late. If that happens, please report it to the developer during the testing period.',
    locationDiagnosticsConsentTitle: 'Information',
    locationDiagnosticsConsentBody: 'During the closed testing period',
    locationDiagnosticsAccept: 'Continue to the app',
    /*locationDiagnosticsCancel: 'Cancel',
    locationDiagnosticsDecline: "No, I Don't Want To",*/
    resetData: 'Reset All Data',
    resetDataConfirmTitle: 'Delete all data?',
    resetDataConfirmBody:
      'Location, settings, prayer tracking and all records will be permanently deleted. The app will return to its initial state.',
    resetDataConfirmBtn: 'Delete',
    dataBackup: 'Data Backup',
    dataBackupDesc: 'Export all your settings and prayer tracking records to a file; restore after a device change or factory reset.',
    exportJson: 'Export as JSON',
    exportHtml: 'Export as HTML Report',
    importData: 'Import from File',
    exportErrorTitle: 'Export failed',
    exportErrorBody: 'Something went wrong while creating the backup file.',
    shareUnavailable: 'Sharing is not available on this device.',
    processing: 'Processing...',
    backupNewerWarning: 'This backup is from a newer version; some data may not be fully supported.',
    importConfirmTitle: 'Restore data?',
    importConfirmBody: 'Data from the selected backup will replace all current settings and records. This cannot be undone.',
    importConfirmBtn: 'Restore',
    importDoneTitle: 'Restored',
    importDoneBody: 'Your data has been restored from the backup successfully.',
    importErrorTitle: 'Import failed',
    importErrorBody: 'The file could not be read. Please try again.',
    importInvalidBody: 'The selected file is not a valid backup.',
    cancel: 'Cancel',
    locationInfo: 'Location Info',
    locationCityDistrict: 'City / District',
    locationCoords: 'Coordinates',
    locationUnknown: 'Unknown',
    locationRefresh: 'Refresh',
    earlyReminder: 'Early Reminder',
    earlyReminderOff: 'On time',
    minutesShort: 'min',
    fridayReminder: 'Friday Reminder',
    fridayReminderTimeLabel: 'Friday Reminder Time',
    fridayReminderTitle: 'Friday Prayer',
    fridayReminderBody: "It's Friday — don't forget the Jumu'ah prayer.",
    onboarding: {
      locationTitle: 'Your Location',
      locationDesc: 'Set your location to calculate accurate prayer times.',
      allowGps: 'Use GPS Location',
      notifTitle: 'Notifications',
      notifDesc: 'Allow notifications so you never miss a prayer time.',
      allowNotif: 'Allow Notifications',
      welcomeTitle: "You're all set!",
      welcomeDesc: 'Setup complete. Start tracking your prayer times.',
      start: 'Start',
      skip: 'Skip',
      next: 'Next',
      of: '/ 3',
    },
    aboutApp: 'About App',
    aboutText:
      'Prayer Habit is designed to remind prayer times through a calm, focused and distraction-free interface. Its purpose is to provide notification, vibration and alarm feedback based on personal preference.',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    timeFormat: 'Time Format',
    timeFormat24: '24 Hour',
    timeFormat12: '12 Hour',
    developer: 'Developer',
    developerName: 'trs-1342',
    contactIntro: 'Contact',
    contributeText: 'Project',
    sourceCodeLabel: 'Source Code',
    website: 'Privacy & Website',
    trackPrayers: 'Track My Prayers',
    trackPrayersDesc: 'Record your daily prayer status',
    trackingNotif: 'Tracking Notification',
    trackingNotifAlways: 'Every day',
    trackingNotifIfIncomplete: 'Only if incomplete',
    trackingReminderTitle: 'Prayer Tracking',
    trackingReminderBody: "Don't forget to mark today's prayers.",
    alarmActive: 'Alarm Active',
    alarmNotificationTitle: 'alarm',
    alarmNotificationBody: 'Prayer time alarm is active',
    prayerNotificationBody: 'Prayer time reminder',
    snooze: 'Snooze 5 min',
    swipeToSnooze: 'Swipe to snooze',
    snoozedUntil: 'Snoozed',
    stop: 'Stop',
    permissionDeniedTitle: 'Location permission denied',
    permissionDeniedBody: 'Location permission is required for prayer times.',
    permissionBlockedBody:
      'Prayer times cannot be calculated because location permission is off. Please enable it in the app settings.',
    openSettings: 'Open settings',
    timesUnavailable: 'Waiting for location',
    locationRequiredTitle: 'Location required',
    locationRequiredBody:
      'Prayer times are calculated from your location. Without it, times cannot be shown and notifications cannot be scheduled, so this step cannot be skipped.',
    syncErrorTitle: 'Sync error',
    syncErrorBody: 'Location or prayer time could not be retrieved. Saved data will be used if available.',
    prayers: {
      fajr: 'Fajr',
      sunrise: 'Sunrise',
      dhuhr: 'Dhuhr',
      asr: 'Asr',
      maghrib: 'Maghrib',
      isha: 'Isha',
    },
  },
  ar: {
    appTitle: 'عادة الصلاة',
    currentTime: 'الوقت الحالي',
    remaining: 'المتبقي',
    locationRequired: 'يلزم إذن الموقع',
    locationOff: 'مزامنة الموقع متوقفة',
    locationText: 'يلزم إذن الموقع لحساب أوقات الصلاة بدقة.',
    locationOffText: 'يتم عرض أوقات افتراضية لأن مزامنة الموقع متوقفة.',
    requestLocation: 'السماح بالموقع',
    enableLocation: 'تفعيل الموقع',
    syncing: 'جاري المزامنة',
    nextPrayer: 'الصلاة التالية',
    internetStatus: 'اتصال الإنترنت',
    internetOnline: 'متصل',
    internetOffline: 'غير متصل',
    offlineMode: 'يتم حساب أوقات الصلاة محلياً دون الحاجة للإنترنت.',
    systemSettings: 'النظام',
    notificationsSection: 'الإشعارات',
    generalSection: 'عام',
    trackingSection: 'تتبع الصلاة',
    muteAll: 'كتم الكل',
    disableVibration: 'إيقاف الاهتزاز',
    disableAlarm: 'إيقاف المنبهات',
    locationDiagnostics: 'معلومات الاختبار',
    locationDiagnosticsDescription: 'قد تصل إشعارات هذا التطبيق متأخرة. في حال حدوث ذلك، يرجى إبلاغ المطور خلال فترة الاختبار.',
    locationDiagnosticsConsentTitle: 'تنبيه',
    locationDiagnosticsConsentBody: 'خلال فترة الاختبار المغلق',
    locationDiagnosticsAccept: 'تمام',
    // locationDiagnosticsCancel: 'إلغاء',
    // locationDiagnosticsDecline: 'لا، لا أريد',
    resetData: 'إعادة تعيين كل البيانات',
    resetDataConfirmTitle: 'حذف جميع البيانات؟',
    resetDataConfirmBody:
      'سيتم حذف الموقع والإعدادات وتتبع الصلاة وجميع السجلات نهائياً. سيعود التطبيق إلى حالته الأولى.',
    resetDataConfirmBtn: 'حذف',
    dataBackup: 'نسخ البيانات',
    dataBackupDesc: 'صدّر جميع إعداداتك وسجلات تتبع الصلاة إلى ملف؛ واستعدها بعد تغيير الجهاز أو إعادة الضبط.',
    exportJson: 'تصدير كـ JSON',
    exportHtml: 'تصدير كتقرير HTML',
    importData: 'استيراد من ملف',
    exportErrorTitle: 'فشل التصدير',
    exportErrorBody: 'حدثت مشكلة أثناء إنشاء ملف النسخة الاحتياطية.',
    shareUnavailable: 'المشاركة غير متاحة على هذا الجهاز.',
    processing: 'جارٍ المعالجة...',
    backupNewerWarning: 'هذه النسخة من إصدار أحدث؛ قد لا تكون بعض البيانات مدعومة بالكامل.',
    importConfirmTitle: 'استعادة البيانات؟',
    importConfirmBody: 'ستحل بيانات النسخة المختارة محل جميع الإعدادات والسجلات الحالية. لا يمكن التراجع عن ذلك.',
    importConfirmBtn: 'استعادة',
    importDoneTitle: 'تمت الاستعادة',
    importDoneBody: 'تمت استعادة بياناتك من النسخة الاحتياطية بنجاح.',
    importErrorTitle: 'فشل الاستيراد',
    importErrorBody: 'تعذر قراءة الملف. حاول مرة أخرى.',
    importInvalidBody: 'الملف المختار ليس نسخة احتياطية صالحة.',
    cancel: 'إلغاء',
    locationInfo: 'معلومات الموقع',
    locationCityDistrict: 'المدينة / الحي',
    locationCoords: 'الإحداثيات',
    locationUnknown: 'غير معروف',
    locationRefresh: 'تحديث',
    earlyReminder: 'تذكير مسبق',
    earlyReminderOff: 'في الوقت',
    minutesShort: 'د',
    fridayReminder: 'تذكير الجمعة',
    fridayReminderTimeLabel: 'وقت تذكير الجمعة',
    fridayReminderTitle: 'صلاة الجمعة',
    fridayReminderBody: 'اليوم الجمعة — لا تنسَ صلاة الجمعة.',
    onboarding: {
      locationTitle: 'موقعك',
      locationDesc: 'حدد موقعك لحساب أوقات الصلاة بدقة.',
      allowGps: 'استخدام GPS',
      notifTitle: 'الإشعارات',
      notifDesc: 'اسمح بالإشعارات حتى لا تفوتك أوقات الصلاة.',
      allowNotif: 'السماح بالإشعارات',
      welcomeTitle: 'أنت جاهز!',
      welcomeDesc: 'اكتمل الإعداد. ابدأ متابعة أوقات الصلاة.',
      start: 'ابدأ',
      skip: 'تخطى',
      next: 'التالي',
      of: '/ 3',
    },
    aboutApp: 'حول التطبيق',
    aboutText:
      'تطبيق عادة الصلاة مصمم لتذكيرك بأوقات الصلاة من خلال واجهة هادئة وواضحة بلا تشتيت، مع إمكانية التحكم في الإشعارات والاهتزاز والمنبه لكل صلاة.',
    settings: 'الإعدادات',
    language: 'اللغة',
    theme: 'المظهر',
    themeDark: 'داكن',
    themeLight: 'فاتح',
    timeFormat: 'نظام الوقت',
    timeFormat24: '٢٤ ساعة',
    timeFormat12: '١٢ ساعة',
    developer: 'المطور',
    developerName: 'trs-1342',
    contactIntro: 'التواصل',
    contributeText: 'المشروع',
    sourceCodeLabel: 'الكود المصدري',
    website: 'الخصوصية والموقع',
    trackPrayers: 'تتبع صلواتي',
    trackPrayersDesc: 'سجّل حالة صلواتك اليومية',
    trackingNotif: 'إشعار التتبع',
    trackingNotifAlways: 'كل يوم',
    trackingNotifIfIncomplete: 'فقط إذا كان هناك فائت',
    trackingReminderTitle: 'تتبع الصلاة',
    trackingReminderBody: 'لا تنسَ تسجيل صلوات اليوم.',
    alarmActive: 'المنبه نشط',
    alarmNotificationTitle: 'منبه',
    alarmNotificationBody: 'منبه وقت الصلاة نشط',
    prayerNotificationBody: 'تذكير وقت الصلاة',
    snooze: 'تأجيل ٥ دقائق',
    swipeToSnooze: 'اسحب للتأجيل',
    snoozedUntil: 'تم التأجيل',
    stop: 'إيقاف',
    permissionDeniedTitle: 'تم رفض إذن الموقع',
    permissionDeniedBody: 'يلزم إذن الموقع لحساب أوقات الصلاة.',
    permissionBlockedBody:
      'لا يمكن حساب أوقات الصلاة لأن إذن الموقع مغلق. يرجى تفعيله من إعدادات التطبيق.',
    openSettings: 'فتح الإعدادات',
    timesUnavailable: 'في انتظار الموقع',
    locationRequiredTitle: 'الموقع مطلوب',
    locationRequiredBody:
      'تُحسب أوقات الصلاة بناءً على موقعك. بدونه لا يمكن عرض الأوقات ولا جدولة الإشعارات، لذلك لا يمكن تخطي هذه الخطوة.',
    syncErrorTitle: 'خطأ في المزامنة',
    syncErrorBody: 'تعذر جلب الموقع أو أوقات الصلاة. سيتم استخدام البيانات المحفوظة إن وجدت.',
    prayers: {
      fajr: 'الفجر',
      sunrise: 'الشروق',
      dhuhr: 'الظهر',
      asr: 'العصر',
      maghrib: 'المغرب',
      isha: 'العشاء',
    },
  },
};

const languageOptions = [
  { label: 'Türkçe', value: 'tr' },
  { label: 'English', value: 'en' },
  { label: 'العربية', value: 'ar' },
];

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Alarm bildirimlerini ön planda biz yönetiyoruz; OS banner'ı bastır
    const isAlarm = notification.request.content.data?.isAlarm === true;
    return {
      shouldPlaySound: !isAlarm,
      shouldSetBadge: false,
      shouldShowBanner: !isAlarm,
      shouldShowList: true,
    };
  },
});

function recordNotificationLocation(
  notification: Notifications.Notification,
  captureMode: 'foreground_received' | 'android_alarm_cold_start'
): Promise<void> {
  return captureNotificationLocation({
    identifier: notification.request.identifier,
    date: notification.date,
    data: notification.request.content.data as Record<string, unknown>,
  }, captureMode)
    .catch((error) => console.warn('[location-diagnostics] event could not be handled', error))
    .finally(() => {
      // BİLDİRİM TETİKLEYİCİSİ: namaz bildirimleri günde 6 kez exact alarm ile
      // çalışır ve uygulama kapalıyken bile JS'i ayağa kaldırabilir (tam ekran
      // alarm / bildirime dokunma). Bu, WorkManager'a bağlı olmayan ikinci bir
      // tetikleyici yolu sağlar. 30-dk kova tekilleştirmesi fazladan kayıt üretmez.
      void sendDiagnosticsBeacon(
        captureMode === 'android_alarm_cold_start' ? 'background' : 'foreground',
        { beaconSource: 'notification' }
      ).catch((error) =>
        console.warn('[location-diagnostics] notification-triggered beacon failed', error)
      );
    });
}

/**
 * "Her zaman konum" iznini KURULUM BAŞINA BİR KEZ ister ve yalnız ONAY ANINDA
 * çağrılır (giriş ekranı veya ayarlardaki anahtar) — uygulama açılışında ASLA.
 *
 * NEDEN: Android 11+ bu izni uygulama içi diyalogla vermiyor; `requestBackground…`
 * kullanıcıyı doğrudan sistem ayarları sayfasına atıyor. Açılış yolunda çağrıldığında
 * bu her uygulama açılışında tekrarlanıyordu.
 *
 * Üç kapı: izin zaten verilmişse hiç sorma; daha önce sorulmuşsa bir daha sorma;
 * ön plan izni yoksa hiç başlama. İşaret istemden ÖNCE yazılır ki ayarlar
 * sayfasındayken süreç öldürülse bile tekrar yönlendirme olmasın.
 */
async function requestBackgroundLocationPermissionOnce(): Promise<void> {
  try {
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.status === 'granted') return;
    if (await hasAskedBackgroundLocationPermission()) return;
    const foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') return;
    await markBackgroundLocationPermissionAsked();
    await Location.requestBackgroundPermissionsAsync();
  } catch (error) {
    console.warn('[location-diagnostics] background permission request failed', error);
  }
}

const fallbackPrayers: PrayerTime[] = [
  { key: 'fajr', name: 'İmsak', time: '04:32', notification: true, vibration: true, alarm: true },
  { key: 'sunrise', name: 'Güneş', time: '06:05', notification: false, vibration: false, alarm: false },
  { key: 'dhuhr', name: 'Öğle', time: '13:15', notification: true, vibration: true, alarm: true },
  { key: 'asr', name: 'İkindi', time: '16:45', notification: true, vibration: true, alarm: true },
  { key: 'maghrib', name: 'Akşam', time: '19:30', notification: true, vibration: true, alarm: true },
  { key: 'isha', name: 'Yatsı', time: '20:55', notification: true, vibration: true, alarm: true },
];

function detectDeviceLanguage(): Language {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  if (locale.startsWith('tr')) return 'tr';
  if (locale.startsWith('ar')) return 'ar';
  // tr/ar dışındaki tüm diller → İngilizce
  return 'en';
}

// Sistemin o anki temasını somut bir seçime çevirir (karanlık/aydınlık).
// Tema artık "sistemi canlı takip" etmiyor; yalnızca ilk varsayılan buradan gelir.
function detectDeviceTheme(): ThemeMode {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

function getPrayerLabel(key: string, language: Language) {
  const prayers = DICTS[language].prayers as Record<string, string>;
  return prayers[key] ?? key;
}

// Erken hatırlatma bildirim metni ("X dakika sonra ... vakti")
function buildEarlyBody(language: Language, prayerLabel: string, minutes: number): string {
  if (language === 'en') return `${prayerLabel} in ${minutes} minutes`;
  if (language === 'ar') return `${prayerLabel} بعد ${toArabicDigits(String(minutes))} دقيقة`;
  return `${minutes} dakika sonra ${prayerLabel} vakti`;
}

function upper(value: string, language: Language) {
  if (language === 'tr') return value.toLocaleUpperCase('tr-TR');
  if (language === 'ar') return value.toLocaleUpperCase('ar');
  return value.toLocaleUpperCase('en-US');
}

function toArabicDigits(value: string) {
  return value.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
}

function formatForLanguage(value: string | undefined, language: Language) {
  if (!value) return '--:--';
  return language === 'ar' ? toArabicDigits(value) : value;
}

function resolveTimeFormat(format: TimeFormat) {
  if (format === '12') return '12';
  if (format === '24') return '24';

  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const hourCycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;

  return hourCycle === 'h11' || hourCycle === 'h12' ? '12' : '24';
}

function formatTimeValue(value: string | undefined, language: Language, format: TimeFormat) {
  if (!value) return '--:--';

  const mode = resolveTimeFormat(format);
  const parts = value.split(':').map(Number);
  const rawH = parts[0];
  const rawM = parts[1];
  const rawS = parts[2] ?? 0;

  if (Number.isNaN(rawH) || Number.isNaN(rawM)) {
    return formatForLanguage(value, language);
  }

  // HH:MM:SS formatında saniyeye göre dakikayı yuvarla
  let h = rawH;
  let m = rawM + (rawS >= 30 ? 1 : 0);
  if (m >= 60) { m = 0; h = (h + 1) % 24; }

  if (mode === '24') {
    return formatForLanguage(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, language);
  }

  const period =
    h >= 12
      ? language === 'tr'
        ? 'ÖS'
        : language === 'ar'
          ? 'م'
          : 'PM'
      : language === 'tr'
        ? 'ÖÖ'
        : language === 'ar'
          ? 'ص'
          : 'AM';

  const hour12 = h % 12 || 12;
  const result = `${hour12}:${String(m).padStart(2, '0')} ${period}`;

  return formatForLanguage(result, language);
}

function formatDurationValue(value: string | undefined, language: Language) {
  return formatForLanguage(value ?? '--:--:--', language);
}

function formatSnoozeUntil(timestamp: number, language: Language, format: TimeFormat) {
  const date = new Date(timestamp);
  const value = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return formatTimeValue(value, language, format);
}

function getPrayerPrefs(prayers: PrayerTime[]): PrayerPrefs {
  return prayers.reduce<PrayerPrefs>((acc, prayer) => {
    acc[prayer.key] = {
      notification: prayer.notification,
      vibration: prayer.vibration,
      alarm: prayer.alarm,
    };
    return acc;
  }, {});
}

function applyPrayerPrefs(prayers: PrayerTime[], prefs: PrayerPrefs): PrayerTime[] {
  return prayers.map((prayer) => ({
    ...prayer,
    notification: prefs[prayer.key]?.notification ?? prayer.notification,
    vibration: prefs[prayer.key]?.vibration ?? prayer.vibration,
    alarm: prefs[prayer.key]?.alarm ?? prayer.alarm,
  }));
}

function getTodayFromCache(cache: CachedPrayerDay[]) {
  const today = getLocalDateKey();
  return cache.find((item) => item.date === today);
}

function removeExpiredSnoozes(snoozes: SnoozeMap) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(snoozes).filter(([, value]) => value > now));
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[CRASH]', error.message, error.stack, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0d0d0d', padding: 24, paddingTop: 60 }}>
          <Text style={{ color: '#C9A84C', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Uygulama Hatası</Text>
          <ScrollView>
            <Text style={{ color: '#ff6b6b', fontSize: 13, marginBottom: 8 }}>
              {__DEV__ ? error.message || String(error) : 'Beklenmeyen bir hata oluştu. Uygulamayı yeniden başlatın.'}
            </Text>
            {__DEV__ && Boolean(error.stack) && <Text style={{ color: '#555', fontSize: 11 }}>{error.stack}</Text>}
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [fontsLoaded] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    NotoSerif_400Regular,
    NotoSerif_600SemiBold,
  });

  const [hydrated, setHydrated] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [language, setLanguage] = useState<Language>(() => detectDeviceLanguage());
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => detectDeviceTheme());
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24');
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  const [clock, setClock] = useState(formatClock());
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [prayers, setPrayers] = useState<PrayerTime[]>(fallbackPrayers);
  const [cachedPrayerDays, setCachedPrayerDays] = useState<CachedPrayerDay[]>([]);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);

  const [muteAll, setMuteAll] = useState(false);
  const [disableVibration, setDisableVibration] = useState(false);
  const [disableAlarm, setDisableAlarm] = useState(false);
  const [snoozedUntilByKey, setSnoozedUntilByKey] = useState<SnoozeMap>({});

  const [activeAlarm, setActiveAlarm] = useState<PrayerTime | null>(null);

  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [trackingNotifMode, setTrackingNotifMode] = useState<TrackingNotifMode>('always');
  const [trackingDays, setTrackingDays] = useState<DayTracking[]>([]);

  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [onboardingPage, setOnboardingPage] = useState(1);
  const [locationLabel, setLocationLabel] = useState<LocationLabel | null>(null);
  const [locationCountryCode, setLocationCountryCode] = useState<string | null>(null);
  const [locationDiagnosticsConsent, setLocationDiagnosticsConsentState] = useState(false);
  const [earlyReminderMinutes, setEarlyReminderMinutes] = useState(0);
  const [fridayReminderEnabled, setFridayReminderEnabled] = useState(true);
  const [fridayReminderTime, setFridayReminderTime] = useState('11:00');

  const alarmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmPlayerRef = useRef<any>(null);
  const hasRequestedLocationRef = useRef(false);
  const hasPromptedLocationDiagnosticsRef = useRef(false);
  const scheduledPrayerIdsRef = useRef<string[]>([]);
  // Planlama çağrılarını seri hale getirmek için promise zinciri (yarış koşulu önler)
  const schedulingChainRef = useRef<Promise<void>>(Promise.resolve());
  const themeMode: ThemeMode = themePreference === 'system' ? detectDeviceTheme() : themePreference;
  const t = DICTS[language];

  // Ön plan servisinin bildirim metninin GÜNCEL hâli. AppState dinleyicisi boş
  // bağımlılıkla kurulduğu için `t`'yi doğrudan kapatamaz (ilk dildeki metni
  // dondururdu); ref her render'da tazelenir.
  const foregroundServiceTextRef = useRef({
    notificationTitle: t.locationDiagnostics,
    notificationBody: t.locationDiagnosticsDescription,
  });
  foregroundServiceTextRef.current = {
    notificationTitle: t.locationDiagnostics,
    notificationBody: t.locationDiagnosticsDescription,
  };

  const appColors = themes[themeMode];
  const appShadow = useMemo(() => createShadow(appColors), [appColors]);
  const styles = useMemo(() => createAppStyles(appColors, appShadow), [appColors, appShadow]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
      // Arayüz göstergesi yukarıdaki katı ölçütü kullanmaya devam eder; VERİ YOLU ise
      // yalnız bağlantının varlığına bakar. `isInternetReachable` VPN altında internet
      // çalışırken bile false döndüğü için buna bağlamak kuyruğu hiç boşaltmıyordu.
      if (state.isConnected !== false) {
        // Bağlantı geldi: önce uzaktan yapılandırmayı tazele (kadans/pencere
        // değişmiş olabilir), sonra bekleyen kuyruğu boşalt, sonra o anki pencere
        // için taze bir beacon dene (çevrimdışıyken kaçırılmış olabilir).
        refreshRemoteConfig()
          .then(() => flushLocationDiagnosticsOutbox())
          .then(() => sendDiagnosticsBeacon('foreground', { beaconSource: 'net_reconnect' }))
          .then(() => getLocationDiagnosticsConsent())
          .then(setLocationDiagnosticsConsentState)
          .catch((error) => console.warn('[location-diagnostics] outbox could not be flushed', error));
      }
    });

    NetInfo.fetch().then((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
      if (state.isConnected !== false) {
        refreshRemoteConfig()
          .then(() => flushLocationDiagnosticsOutbox())
          .then(() => getLocationDiagnosticsConsent())
          .then(setLocationDiagnosticsConsentState)
          .catch((error) => console.warn('[location-diagnostics] initial outbox flush failed', error));
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      // Uygulama öne geldi: config'i tazele, kuyruğu boşalt, o anki pencere için
      // bir beacon dene (telafi) ve WorkManager görevini yeniden kur.
      //
      // YENİDEN KURMA NEDEN GEREKLİ: expo-background-task, işi kendini zincirleyen
      // bir OneTimeWorkRequest olarak kuyruğa alıyor (BackgroundTaskScheduler.kt);
      // bir çalıştırma başarısız olur ya da sistem süreci öldürürse ZİNCİR KOPAR ve
      // görev bir daha hiç uyanmaz. Uygulamanın öne gelmesi bu zinciri tamir eder.
      refreshRemoteConfig()
        .then(() => flushLocationDiagnosticsOutbox())
        .then(() => sendDiagnosticsBeacon('foreground', { beaconSource: 'app_active' }))
        .then(() => registerBackgroundBeaconAsync())
        // Ön plan servisini de UZLAŞTIR. Bu çağrı hem başlatır hem durdurur:
        // panelden `foreground_service_enabled` kapatıldıysa servisi durdurur,
        // açıldıysa (ve izin varsa) başlatır, aralık/doğruluk/metin değiştiyse
        // yeniden kurar. Bu olmadan panelden yapılan değişiklik uygulama tamamen
        // yeniden başlatılana kadar etkisiz kalıyordu.
        .then(() => startBackgroundLocationBeaconAsync(foregroundServiceTextRef.current))
        .then(() => getLocationDiagnosticsConsent())
        .then(setLocationDiagnosticsConsentState)
        .catch((error) => console.warn('[location-diagnostics] foreground outbox flush failed', error));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!onboardingCompleted || screen !== 'home') return;
    setClock(formatClock());
    const id = setInterval(() => setClock(formatClock()), 1000);
    return () => clearInterval(id);
  }, [onboardingCompleted, screen]);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    } as any).catch((error) => console.warn('[audio] mode could not be configured', error));

    try {
      alarmPlayerRef.current = createAudioPlayer(require('./assets/alarm.mp3'));
    } catch {
      alarmPlayerRef.current = null;
    }

    return () => {
      try {
        alarmPlayerRef.current?.release?.();
      } catch (error) {
        console.warn('[audio] player could not be released', error);
      }

      alarmPlayerRef.current = null;
    };
  }, []);

  // Depodaki durumu React state'ine uygular. Hem açılış hidrasyonunda hem de
  // yedekten içe aktarma sonrasında kullanılır.
  function applyStored(stored: Partial<StoredAppState>) {
    const nextPrefs = stored.prayerPrefs ?? getPrayerPrefs(fallbackPrayers);
    const nextCache = stored.cachedPrayerDays ?? [];

    setLanguage(stored.language ?? detectDeviceLanguage());
    // Eski 'system' tercihi (veya kayıt yok) → o anki sistem temasına çöz
    setThemePreference(
      stored.themePreference === 'dark' || stored.themePreference === 'light'
        ? stored.themePreference
        : detectDeviceTheme()
    );
    // Eski 'system' tercihi (veya kayıt yok) → varsayılan 24 saat
    setTimeFormat(stored.timeFormat === '12' || stored.timeFormat === '24' ? stored.timeFormat : '24');
    setMuteAll(stored.muteAll ?? false);
    setDisableVibration(stored.disableVibration ?? false);
    setDisableAlarm(stored.disableAlarm ?? false);
    setCoords(stored.coords ?? null);
    setCachedPrayerDays(nextCache);
    setSnoozedUntilByKey(removeExpiredSnoozes(stored.snoozedUntilByKey ?? {}));

    scheduledPrayerIdsRef.current = stored.scheduledPrayerNotificationIds ?? [];

    setTrackingEnabled(stored.trackingEnabled ?? false);
    setTrackingNotifMode(stored.trackingNotifMode ?? 'always');

    setLocationLabel(stored.locationLabel ?? null);
    setLocationCountryCode(stored.locationCountryCode ?? null);
    setEarlyReminderMinutes(stored.earlyReminderMinutes ?? 0);
    setFridayReminderEnabled(stored.fridayReminderEnabled ?? true);
    setFridayReminderTime(stored.fridayReminderTime ?? '11:00');

    // Onboarding bayrağı önceliklidir. Bayrak yoksa (eski sürümden güncelleyen
    // kullanıcılar) ve zaten verisi varsa, onları tekrar karşılama ekranına
    // düşürmemek için tamamlanmış say. Yeni/sıfırlanmış kurulumda bayrak da
    // veri de yok → karşılama ekranı gösterilir.
    const hasExistingData = stored.coords != null || (stored.cachedPrayerDays?.length ?? 0) > 0;
    setOnboardingCompleted(stored.onboardingCompleted ?? hasExistingData);

    const today = getTodayFromCache(nextCache);
    setPrayers(applyPrayerPrefs(today ? today.prayers : fallbackPrayers, nextPrefs));
  }

  useEffect(() => {
    migrateAppStateToGpsOnly()
      .then(async (migrated) => {
        if (migrated) {
          try {
            await Notifications.cancelAllScheduledNotificationsAsync();
          } catch (error) {
            console.warn('[notifications] legacy location schedule could not be cleared', error);
          }
        }
        return loadAppState<StoredAppState>();
      })
      .then((stored) => {
        if (stored) applyStored(stored);
      })
      .catch((error) => console.warn('[storage] app state could not be loaded', error))
      .finally(() => setHydrated(true));

    loadTrackingDays().then(setTrackingDays);
    // UZAKTAN YAPILANDIRMA — açılış yolundaki İLK iş. Aşağıdaki bütün tanılama
    // kontrolleri (ana şalter, kesim anı, kadans) config snapshot'ını senkron okur;
    // snapshot doldurulmadan çalışırlarsa yerleşik varsayılanlara göre karar
    // verirler. `hydrate` yalnız yerel önbelleği okur (ağ yok, açılışı yavaşlatmaz);
    // taze değer arkadan `refresh` ile gelir.
    hydrateRemoteConfig()
      // Açılışta bir kez: eski sürümde SUNUCU TARAFI düzeltilebilir bir hata yüzünden
      // (ör. kısıt/şema/kapasite) kalıcı kapatılmış cihazı yeniden etkinleştirir.
      // Tablo silinmesi (404/PGRST205) ve yetki iptali (401/403) kalıcı kalır.
      .then(() => reconcileDiagnosticsShutdownState())
      .catch((error) => console.warn('[location-diagnostics] shutdown state could not be reconciled', error))
      .then(() => getLocationDiagnosticsConsent())
      .then(setLocationDiagnosticsConsentState)
      .catch((error) => console.warn('[location-diagnostics] consent could not be loaded', error));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Yeni kurulumlar onboarding sayfa 4'te bu kararı zaten veriyor. Bu efekt,
    // onboarding'i eski sürümde tamamlamış (bu yüzden yeni sayfayı hiç görmeyen)
    // kullanıcılar için düşen bir yedek: karar yoksa bir kez sorulur.
    if (!hydrated || !onboardingCompleted || !isLocationDiagnosticsAvailable()) return;
    if (hasPromptedLocationDiagnosticsRef.current) return;
    hasPromptedLocationDiagnosticsRef.current = true;

    let active = true;
    let promptTimer: ReturnType<typeof setTimeout> | null = null;
    hasLocationDiagnosticsConsentDecision()
      .then((hasDecision) => {
        if (!active || hasDecision) return;
        promptTimer = setTimeout(() => {
          if (active) promptLocationDiagnosticsConsent();
        }, 250);
      })
      .catch((error) => console.warn('[location-diagnostics] consent decision could not be read', error));

    return () => {
      active = false;
      if (promptTimer) clearTimeout(promptTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, onboardingCompleted]);

  // Konum beacon'u sürücüsü. Rıza varken üç bağımsız yol birlikte çalışır:
  //   1) önplan zamanlayıcısı + açılış telafisi (uygulama açıkken),
  //   2) WorkManager görevi (ağ VARKEN uyanır; kuyruğu da boşaltır),
  //   3) ön plan servisli konum güncellemeleri (uygulama KAPALI ve İNTERNET YOKKEN de
  //      çalışan tek yol; "her zaman" konum izni gerektirir).
  // 15 dakikalık kova tekilleştirmesi hepsini pencere başına tek kayda indirir.
  useEffect(() => {
    if (!hydrated || !isLocationDiagnosticsAvailable()) return;

    if (!locationDiagnosticsConsent) {
      void unregisterBackgroundBeaconAsync();
      void stopBackgroundLocationBeaconAsync();
      return;
    }

    // ÖN PLAN SERVİSİ — uygulama KAPALIYKEN ve İNTERNET YOKKEN kayıt üretebilen
    // TEK yol. WorkManager görevi `NetworkType.CONNECTED` kısıtıyla kuyruğa
    // alındığı için ağ yokken hiç uyanmaz; önplan zamanlayıcısı ise yalnız
    // uygulama açıkken çalışır. Bedeli kalıcı bir sistem bildirimi ve artan pil
    // tüketimidir; bu bilinçli olarak kabul edildi ve panelden
    // (`foreground_service_enabled`) uzaktan kapatılabilir.
    //
    // İZİN BURADA İSTENMEZ. Açılış yolunda `requestBackgroundPermissionsAsync`
    // çağırmak, izin verilene kadar kullanıcıyı HER AÇILIŞTA sistem ayarlarına
    // gönderiyordu. İstem yalnız onay anına bağlı (giriş ekranı / ayarlar anahtarı).
    // Servis izin yoksa sessizce başlamaz; izin sonradan verilirse ilk açılışta başlar.
    //
    // Config ÖNCE tazelenir, servis SONRA başlatılır: aksi hâlde panelden
    // kapatılmış olsa bile servis bir kez başlar (ve kalıcı bildirim görünür),
    // ancak bir sonraki açılışta durdurulurdu.
    void refreshRemoteConfig()
      // "HER ZAMAN KONUM" İZNİ BURADA İSTENİR — yoksa ön plan servisi HİÇ başlamaz.
      //
      // Bu çağrı eksikti ve özelliği tamamen işlevsiz bırakıyordu:
      // `startBackgroundLocationBeaconAsync`, `getBackgroundPermissionsAsync()`
      // 'granted' değilse sessizce çıkıyor. İzni isteyen tek yer Ayarlar'daki
      // tanılama anahtarıydı, o da yorum satırında; onboarding yolu da bilerek
      // istemiyor. Sonuç: kimse izni vermiyor → servis hiç kurulmuyor →
      // uygulama kapatılınca hiçbir kayıt üretilmiyordu.
      //
      // Tekrar tekrar ayarlara yönlendirme riski yok: fonksiyon KURULUM BAŞINA
      // BİR KEZ sorar (kalıcı `bg-permission-asked` damgası), izin zaten varsa
      // veya ön plan izni yoksa hiç başlamaz.
      .then(() => requestBackgroundLocationPermissionOnce())
      .then(() =>
        startBackgroundLocationBeaconAsync({
          notificationTitle: t.locationDiagnostics,
          notificationBody: t.locationDiagnosticsDescription,
        })
      )
      // Açılış/rıza anı: kaçırılmış pencere varsa hemen bir kez dener.
      .then(() => sendDiagnosticsBeacon('foreground', { beaconSource: 'foreground_timer' }))
      .then(() => registerBackgroundBeaconAsync())
      .catch((error) => console.warn('[location-diagnostics] beacon startup failed', error));

    // Uygulama açıkken periyodik dener; kova tekilleştirmesi her pencerede en
    // fazla bir gönderime indirir (varsayılan: 5 dk'da bir dene → 15 dk'da 1 kayıt).
    // Aralık uzaktan yönetilir; timer her tetiklemede güncel değeri okur ki
    // panelde yapılan değişiklik uygulamayı yeniden başlatmadan etkili olsun.
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      timer = setTimeout(() => {
        void sendDiagnosticsBeacon('foreground', { beaconSource: 'foreground_timer' });
        scheduleNext();
      }, getRemoteConfig().foregroundTimerMinutes * 60 * 1000);
    };
    scheduleNext();

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, locationDiagnosticsConsent]);

  useEffect(() => {
    if (!hydrated) return;

    updateAppState<StoredAppState>({
      language,
      themePreference,
      timeFormat,
      muteAll,
      disableVibration,
      disableAlarm,
      locationLabel,
      locationCountryCode,
      earlyReminderMinutes,
      fridayReminderEnabled,
      fridayReminderTime,
      onboardingCompleted,
      coords,
      prayerPrefs: getPrayerPrefs(prayers),
      snoozedUntilByKey,
      cachedPrayerDays,
      scheduledPrayerNotificationIds: scheduledPrayerIdsRef.current,
      trackingEnabled,
      trackingNotifMode,
      locationSourceVersion: 2,
    }).catch((error) => console.warn('[storage] app state could not be saved', error));
  }, [
    hydrated,
    language,
    themePreference,
    timeFormat,
    muteAll,
    disableVibration,
    disableAlarm,
    locationLabel,
    locationCountryCode,
    earlyReminderMinutes,
    fridayReminderEnabled,
    fridayReminderTime,
    onboardingCompleted,
    coords,
    prayers,
    snoozedUntilByKey,
    cachedPrayerDays,
    trackingEnabled,
    trackingNotifMode,
  ]);

  useEffect(() => {
    if (!hydrated) return;

    const today = getTodayFromCache(cachedPrayerDays);
    if (!today) return;

    setPrayers((prev) => {
      const next = applyPrayerPrefs(today.prayers, getPrayerPrefs(prev));
      // Vaki saatleri değişmediyse (gün geçişi yoksa) aynı referansı döndür
      // → her saniye gereksiz re-render engellenir
      const unchanged = next.every((p, i) => prev[i]?.key === p.key && prev[i]?.time === p.time);
      return unchanged ? prev : next;
    });
  }, [hydrated, clock, cachedPrayerDays]);

  useEffect(() => {
    // Onboarding bitmeden otomatik konum isteme; karşılama ekranındaki GPS
    // butonu bunu açıkça yönetir. Aksi halde izin diyaloğu karşılama ekranının
    // arkasında beklenmedik şekilde açılır.
    if (hydrated && onboardingCompleted && !hasRequestedLocationRef.current) {
      hasRequestedLocationRef.current = true;
      // Konum her zaman anlık canlı GPS'ten alınır.
      requestLocationAndSync();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, onboardingCompleted]);

  // Cuma hatırlatmasını (haftalık tekrar) ayar/dil değiştikçe yeniden planla.
  // onboardingCompleted'a da bağlı: izin onboarding sonrası verildiğinde tetiklenir.
  useEffect(() => {
    if (!hydrated || !onboardingCompleted) return;
    scheduleFridayReminder(fridayReminderEnabled, fridayReminderTime, language).catch((error) =>
      console.warn('[notifications] Friday reminder effect failed', error)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, onboardingCompleted, fridayReminderEnabled, fridayReminderTime, language]);

  // Hydration sonrası: activeAlarm'ı güncel prayer saatiyle senkronize et
  // (cold-start'ta bildirimden önce fallback prayer zamanı set edilmiş olabilir)
  useEffect(() => {
    if (!hydrated) return;
    setActiveAlarm((prev) => {
      if (!prev) return prev;
      const updated = prayers.find((p) => p.key === prev.key);
      return updated && updated.time !== prev.time ? updated : prev;
    });
  }, [hydrated, prayers]);

  // Hydration sonrası: fullScreenIntent cold-start güvenlik kontrolü
  // addNotificationResponseReceivedListener'ı kaçırmış olabiliriz
  useEffect(() => {
    if (!hydrated) return;
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) {
        AlarmWindow?.setFlags?.(false);
        return;
      }
      // 60 saniyeden eski bildirimleri atla (önceki oturumdan kalan)
      const notifDate = response.notification.date;
      const notifMs = typeof notifDate === 'number' ? notifDate : (notifDate as Date).getTime();
      if (Date.now() - notifMs > 60_000) {
        AlarmWindow?.setFlags?.(false);
        return;
      }
      const data = response.notification.request.content.data;
      if (data?.isAlarm !== true) return;
      void recordNotificationLocation(response.notification, 'android_alarm_cold_start')
        .finally(() => {
          getLocationDiagnosticsConsent()
            .then(setLocationDiagnosticsConsentState)
            .catch((error) => console.warn('[location-diagnostics] state could not be refreshed', error));
        });
      const prayerKey = typeof data.prayerKey === 'string' ? data.prayerKey : null;
      if (!prayerKey) return;
      const prayer = prayers.find((p) => p.key === prayerKey);
      if (prayer && !activeAlarm) handlePrayerTrigger(prayer);
    }).catch((error) => {
      AlarmWindow?.setFlags?.(false);
      console.warn('[notifications] last response could not be read', error);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    Notifications.setNotificationChannelAsync('default', {
      name: 'Namaz Vakitleri',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 700, 350, 700],
      lightColor: appColors.primaryContainer,
      sound: 'default',
    });

    Notifications.setNotificationChannelAsync('alarm', {
      name: 'Namaz Alarmları',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 900, 500, 900],
      lightColor: appColors.primaryContainer,
      sound: 'alarm',
    });
  }, [appColors.primaryContainer]);

  useEffect(() => {
    Notifications.setNotificationCategoryAsync('prayer_alarm', [
      {
        identifier: 'SNOOZE',
        buttonTitle: t.snooze,
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'STOP',
        buttonTitle: t.stop,
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);
  }, [language]);

  useEffect(() => {
    // Ön planda: sadece alarm bildirimleri için in-app alarm başlat
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      void recordNotificationLocation(notification, 'foreground_received')
        .finally(() => {
          getLocationDiagnosticsConsent()
            .then(setLocationDiagnosticsConsentState)
            .catch((error) => console.warn('[location-diagnostics] state could not be refreshed', error));
        });
      const data = notification.request.content.data;
      if (typeof data?.prayerKey !== 'string' || !data.isAlarm) return;
      const prayer = prayers.find((item) => item.key === data.prayerKey);
      if (prayer && !activeAlarm) handlePrayerTrigger(prayer);
    });

    // Arka planda/kapalıyken bildirime dokunulduğunda veya aksiyon butonuna basıldığında
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const { actionIdentifier, notification } = response;
      const data = notification.request.content.data;
      const prayerKey = typeof data?.prayerKey === 'string' ? data.prayerKey : null;

      if (actionIdentifier === 'STOP') {
        stopAlarm();
        return;
      }

      if (actionIdentifier === 'SNOOZE') {
        if (activeAlarm) {
          snoozeAlarm();
        } else if (prayerKey) {
          const prayer = prayers.find((item) => item.key === prayerKey);
          if (prayer) snoozeAlarmForPrayer(prayer);
        }
        return;
      }

      // Varsayılan: bildirime dokunuldu → sadece alarm bildirimi ise in-app alarm başlat
      // Normal bildirimler (alarm=false) için uygulama sadece açılır, tetikleyici gerekmez
      if (prayerKey && !activeAlarm && data?.isAlarm === true) {
        const prayer = prayers.find((item) => item.key === prayerKey);
        if (prayer) handlePrayerTrigger(prayer);
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [prayers, muteAll, disableVibration, disableAlarm, activeAlarm, language]);

  useEffect(() => {
    return () => stopAlarm();
  }, []);

  // Android donanım geri tuşu: Ayarlar/Takip ekranındayken uygulamadan çıkmak
  // yerine ana ekrana dön. Açık modallar kendi onRequestClose'larıyla zaten
  // kapanır (RN Modal geri tuşunu önce yakalar), bu yüzden burada sadece ekran
  // navigasyonunu ele alıyoruz.
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      // Alarm çalıyorken geri tuşu uygulamayı kapatmasın
      if (activeAlarm) return true;

      // Karşılama ekranı: ilk sayfadaysa varsayılan (çıkış), değilse önceki sayfa
      if (!onboardingCompleted) {
        if (onboardingPage > 1) {
          setOnboardingPage((p) => Math.max(1, p - 1));
          return true;
        }
        return false;
      }

      // Ayarlar/Takip ekranındayken ana ekrana dön (uygulamadan çıkma)
      if (screen !== 'home') {
        setScreen('home');
        return true;
      }

      return false; // ana ekran → varsayılan davranış (uygulamadan çık)
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [screen, activeAlarm, onboardingCompleted, onboardingPage]);

  const currentPrayer = useMemo(() => getCurrentPrayer(prayers), [prayers, clock]);
  const nextPrayer = useMemo(() => getNextPrayer(prayers), [prayers, clock]);
  const prayerProgress = useMemo(() => getPrayerProgress(prayers), [prayers, clock]);

  function handlePrayerTrigger(prayer: PrayerTime) {
    if (muteAll) {
      AlarmWindow?.setFlags?.(false);
      return;
    }

    if (prayer.alarm && !disableAlarm) {
      startAlarm(prayer);
      return;
    }

    if (prayer.vibration && !disableVibration) {
      Vibration.vibrate([0, 700, 350, 700]);
    }
  }

  function startAlarm(prayer: PrayerTime) {
    AlarmWindow?.setFlags?.(true);
    setSnoozedUntilByKey((prev) => {
      const next = { ...prev };
      delete next[prayer.key];
      return next;
    });

    setActiveAlarm(prayer);

    try {
      alarmPlayerRef.current?.seekTo?.(0);
      alarmPlayerRef.current?.play?.();
    } catch (error) {
      console.warn('[audio] alarm could not be started', error);
    }

    if (!disableVibration && prayer.vibration) {
      Vibration.vibrate([0, 900, 500, 900], true);

      if (alarmIntervalRef.current) {
        clearInterval(alarmIntervalRef.current);
      }

      alarmIntervalRef.current = setInterval(() => {
        Vibration.vibrate([0, 900, 500, 900], true);
      }, 8000);
    }
  }

  function stopAlarm() {
    AlarmWindow?.setFlags?.(false);
    Vibration.cancel();

    try {
      alarmPlayerRef.current?.pause?.();
      alarmPlayerRef.current?.seekTo?.(0);
    } catch (error) {
      console.warn('[audio] alarm could not be stopped', error);
    }

    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }

    setActiveAlarm(null);
  }

  function handleUpdateTrackingStatus(date: string, key: string, status: PrayerStatus) {
    setTrackingDays((prev) => {
      const next = upsertDayStatus(prev, date, key, status);
      saveTrackingDays(next)
        .then(() => scheduleLocalPrayerNotifications(prayers, { trackingDays: next }))
        .catch((error) => console.warn('[tracking] status could not be persisted/rescheduled', error));
      return next;
    });
  }

  function handleTrackingEnabled(value: boolean) {
    setTrackingEnabled(value);
    scheduleLocalPrayerNotifications(prayers, { trackingEnabled: value }).catch((error) =>
      console.warn('[notifications] tracking preference could not be applied', error)
    );
  }

  function handleTrackingNotifModeChange(value: TrackingNotifMode) {
    setTrackingNotifMode(value);
    scheduleLocalPrayerNotifications(prayers, { trackingNotifMode: value }).catch((error) =>
      console.warn('[notifications] tracking mode could not be applied', error)
    );
  }

  function handleCompleteOnboarding() {
    setOnboardingCompleted(true);
  }

async function handleOnboardingDiagnosticsDecision(accepted: boolean) {
  try {
    await setLocationDiagnosticsConsent(accepted);
    // React state'i de güncelle ki beacon effect'i uygulama yeniden başlatılmadan
    // hemen çalışsın (yalnız storage'a yazmak state'i tetiklemez).
    setLocationDiagnosticsConsentState(await getLocationDiagnosticsConsent());
    // BURADA "her zaman konum" İSTENMEZ: kullanıcı karşılama ekranında konum iznini
    // yeni vermişken ikinci kez sistem ayarlarına atılıyordu. İstem yalnız Ayarlar'daki
    // tanılama anahtarı elle açıldığında gösterilir; veri toplama buna bağlı değildir.
    handleCompleteOnboarding();
  } catch (error) {
    console.warn('[location-diagnostics] Hata çıktı', error);
  }
}

  async function handleExportJson() {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const shared = await exportJson(APP_VERSION, language);
      if (!shared) Alert.alert(t.exportErrorTitle, t.shareUnavailable);
    } catch {
      Alert.alert(t.exportErrorTitle, t.exportErrorBody);
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleExportHtml() {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const shared = await exportHtml(APP_VERSION, language);
      if (!shared) Alert.alert(t.exportErrorTitle, t.shareUnavailable);
    } catch {
      Alert.alert(t.exportErrorTitle, t.exportErrorBody);
    } finally {
      setBackupBusy(false);
    }
  }

  // İçe aktarma sonrası takvimi yalnız koordinat tabanlı yerel adhan hesabıyla
  // tazeler ve bildirimleri içe aktarılan tercihlerle yeniden planlar.
  async function reapplyAfterImport(stored: Partial<StoredAppState>, restoredTracking: DayTracking[]) {
    const prefs = stored.prayerPrefs ?? getPrayerPrefs(fallbackPrayers);
    const lang = stored.language ?? language;
    const early = stored.earlyReminderMinutes ?? 0;
    let cache = stored.cachedPrayerDays ?? [];

    try {
      setLoadingLocation(true);
      if (stored.coords) {
        cache = await fetchMonthlyPrayerCalendar(
          stored.coords.latitude,
          stored.coords.longitude,
          new Date(),
          stored.locationCountryCode
        );
      }
    } catch {
      // taze çekilemezse yedekteki önbellek kullanılmaya devam eder
    } finally {
      setLoadingLocation(false);
    }

    setCachedPrayerDays(cache);
    const today = getTodayFromCache(cache);
    const todayPrayers = applyPrayerPrefs(today ? today.prayers : fallbackPrayers, prefs);
    setPrayers(todayPrayers);
    await scheduleLocalPrayerNotifications(todayPrayers, {
      language: lang,
      earlyMinutes: early,
      trackingEnabled: stored.trackingEnabled ?? false,
      trackingNotifMode: stored.trackingNotifMode ?? 'always',
      trackingDays: restoredTracking,
    }, cache);

    // Cuma hatırlatması da içe aktarmada cancelAll ile silindiği için yeniden kur
    await scheduleFridayReminder(
      stored.fridayReminderEnabled ?? true,
      stored.fridayReminderTime ?? '11:00',
      lang
    );
  }

  async function handleImportData() {
    if (backupBusy) return;
    setBackupBusy(true);

    let parsed: BackupFile | undefined;
    try {
      parsed = await pickAndReadBackup();
    } catch (e) {
      setBackupBusy(false);
      if (e instanceof BackupError && e.code === 'cancelled') return;
      const invalid = e instanceof BackupError && e.code === 'invalid';
      Alert.alert(t.importErrorTitle, invalid ? t.importInvalidBody : t.importErrorBody);
      return;
    }

    // Seçim bitti; onay diyaloğu açılana kadar butonu serbest bırak
    setBackupBusy(false);

    const backup = parsed;
    if (!backup) return;

    // Onay metnine yedek özeti + (gerekirse) daha yeni sürüm uyarısı ekle
    let confirmBody = `${summarizeBackup(backup, language)}\n\n${t.importConfirmBody}`;
    if (backup.schema > BACKUP_SCHEMA) {
      confirmBody = `⚠ ${t.backupNewerWarning}\n\n${confirmBody}`;
    }

    Alert.alert(t.importConfirmTitle, confirmBody, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.importConfirmBtn,
        style: 'destructive',
        onPress: async () => {
          setBackupBusy(true);
          try {
            // 1) Çalan alarmı durdur, planlı bildirimleri tamamen iptal et
            stopAlarm();
            try {
              await Notifications.cancelAllScheduledNotificationsAsync();
            } catch (error) {
              console.warn('[notifications] scheduled notifications could not be cleared before import', error);
            }
            scheduledPrayerIdsRef.current = [];

            // 2) Yedeği kalıcı depoya yaz, ardından state'e uygula
            await restoreBackup(backup);
            const stored = await loadAppState<StoredAppState>();
            if (stored) applyStored(stored);
            const restoredTracking = await loadTrackingDays();
            setTrackingDays(restoredTracking);

            // 3) Otomatik konum tetiğini kilitle, ana ekrana dön
            hasRequestedLocationRef.current = true;
            setOnboardingPage(1);
            setScreen('home');

            // 4) Takvimi tazele (bayat yedek olabilir) ve bildirimleri yeniden
            //    planla — izin İSTEMEDEN ve içe aktarılan tercihlerle.
            await reapplyAfterImport(stored ?? {}, restoredTracking);

            Alert.alert(t.importDoneTitle, t.importDoneBody);
          } catch {
            Alert.alert(t.importErrorTitle, t.importErrorBody);
          } finally {
            setBackupBusy(false);
          }
        },
      },
    ]);
  }

  function handleResetAllData() {
    Alert.alert(t.resetDataConfirmTitle, t.resetDataConfirmBody, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.resetDataConfirmBtn,
        style: 'destructive',
        onPress: async () => {
          // 1) Çalan alarmı durdur, planlı bildirimleri iptal et
          stopAlarm();
          try {
            await Notifications.cancelAllScheduledNotificationsAsync();
          } catch (error) {
            console.warn('[notifications] scheduled notifications could not be cleared on reset', error);
          }
          scheduledPrayerIdsRef.current = [];

          // 2) Kalıcı depoyu temizle (ana state + namaz takibi)
          try {
            await clearAppState();
          } catch (error) {
            console.warn('[storage] app state could not be cleared', error);
          }
          await clearTrackingDays();
          await clearLocationDiagnosticsLocalState();
          // Rıza kaydı silindiği için arka plan yollarını da durdur: ön plan servisi
          // aksi hâlde kalıcı bildirimiyle çalışmaya devam ederdi.
          await unregisterBackgroundBeaconAsync();
          await stopBackgroundLocationBeaconAsync();

          // 3) Tüm in-memory state'i ilk açılış değerlerine döndür
          const deviceLang = detectDeviceLanguage();
          setLanguage(deviceLang);
          setThemePreference(detectDeviceTheme());
          setTimeFormat('24');
          setMuteAll(false);
          setDisableVibration(false);
          setDisableAlarm(false);
          setLocationLabel(null);
          setLocationCountryCode(null);
          setEarlyReminderMinutes(0);
          setFridayReminderEnabled(true);
          setFridayReminderTime('11:00');
          setCoords(null);
          setCachedPrayerDays([]);
          setPrayers(applyPrayerPrefs(fallbackPrayers, getPrayerPrefs(fallbackPrayers)));
          setSnoozedUntilByKey({});
          setTrackingEnabled(false);
          setLocationDiagnosticsConsentState(false);
          setTrackingNotifMode('always');
          setTrackingDays([]);

          // 4) Konum isteğinin yeniden tetiklenebilmesi için kilidi aç
          hasRequestedLocationRef.current = false;

          // 5) Karşılama ekranını yeniden göster
          setOnboardingPage(1);
          setOnboardingCompleted(false);
          setScreen('home');
        },
      },
    ]);
  }

  async function scheduleTrackingNotifications(
    days: CachedPrayerDay[],
    enabled: boolean,
    mode: TrackingNotifMode,
    trackedDays: DayTracking[],
    lang: Language
  ) {
    if (!enabled) return;
    const dict = DICTS[lang];
    const specs = buildTrackingReminderSpecs(days, enabled, mode, trackedDays);

    for (const spec of specs) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: dict.trackingReminderTitle,
          body: dict.trackingReminderBody,
          sound: false,
          data: { isTrackingReminder: true, trackingDate: spec.trackingDate },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: spec.triggerDate,
          ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
        },
      });
    }
  }

  async function snoozeAlarmForPrayer(prayer: PrayerTime) {
    const snoozeUntil = Date.now() + 5 * 60 * 1000;

    setSnoozedUntilByKey((prev) => ({
      ...prev,
      [prayer.key]: snoozeUntil,
    }));

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${getPrayerLabel(prayer.key, language)} ${t.alarmNotificationTitle}`,
        body: t.alarmNotificationBody,
        sound: true,
        categoryIdentifier: 'prayer_alarm',
        data: {
          prayerKey: prayer.key,
          isAlarm: true,
          isSnooze: true,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(snoozeUntil),
        ...(Platform.OS === 'android' ? { channelId: 'alarm' } : {}),
      },
    });
  }

  async function snoozeAlarm() {
    if (!activeAlarm) return;
    const prayer = activeAlarm;
    stopAlarm();
    await snoozeAlarmForPrayer(prayer);
  }

  async function cancelPrayerNotifications() {
    // Planlanmış namaz/takip bildirimlerini doğrudan OS kuyruğundan iptal et.
    // Ref'e güvenmek yarış koşullarında eski (ve farklı dildeki) bildirimleri
    // sızdırıp "hem Arapça hem İngilizce" gibi karışık bildirimlere yol açıyordu.
    // Kullanıcının az önce kurduğu ertelemeler (isSnooze) korunur.
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const n of scheduled) {
        const data = n.content.data as Record<string, unknown> | undefined;
        const isPrayer = typeof data?.prayerKey === 'string';
        const isTracking = data?.isTrackingReminder === true;
        if ((isPrayer || isTracking) && data?.isSnooze !== true) {
          try {
            await Notifications.cancelScheduledNotificationAsync(n.identifier);
          } catch (error) {
            console.warn('[notifications] one scheduled notification could not be cancelled', error);
          }
        }
      }
    } catch (error) {
      console.warn('[notifications] scheduled notification list could not be reconciled', error);
    }

    scheduledPrayerIdsRef.current = [];
  }

  // Taze takvimi state'e uygula ve bildirimleri planla (cache henüz state'e
  // yazılmamış olabileceği için doğrudan geçiriyoruz)
  async function applyCalendarAndSchedule(cache: CachedPrayerDay[]) {
    setCachedPrayerDays(cache);
    const today = getTodayFromCache(cache);
    if (!today) return;
    const todayPrayers = applyPrayerPrefs(today.prayers, getPrayerPrefs(prayers));
    setPrayers(todayPrayers);
    await scheduleLocalPrayerNotifications(todayPrayers, undefined, cache);
  }

  async function requestLocationAndSync() {
    try {
      setLoadingLocation(true);

      const perm = await Location.requestForegroundPermissionsAsync();

      if (perm.status !== 'granted') {
        // ÇIKMAZ DÜZELTMESİ: Android'de izin bir kez kalıcı reddedildiğinde
        // (`canAskAgain === false`) bu çağrı ARTIK DİYALOG GÖSTERMEZ, anında
        // reddedilmiş döner. Eski kod yalnız bir uyarı gösterip çıkıyordu; yani
        // kullanıcı "konum gerekli" kartındaki düğmeye bassa da hiçbir şey
        // olmuyordu — ne izin diyaloğu, ne yönlendirme. Uygulama sessizce
        // kullanılamaz hâlde kalıyordu. Artık sistem ayarlarına yönlendiriyoruz.
        if (perm.canAskAgain === false) {
          Alert.alert(t.permissionDeniedTitle, t.permissionBlockedBody, [
            { text: t.cancel, style: 'cancel' },
            { text: t.openSettings, onPress: () => { void Linking.openSettings(); } },
          ]);
          return;
        }
        Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody);
        return;
      }

      // Eski/önbelleklenmiş koordinat kullanılmaz; her senkron gerçek bir canlı
      // konum ölçümüyle başlar.
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const nextCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      setCoords(nextCoords);

      // GPS SENKRON TETİKLEYİCİSİ: vakit hesabı için alınan TAZE ölçümü beacon'a
      // devret. İkinci bir GPS isteği yapılmaz ve kayıt kesinlikle koordinatlı olur
      // (koordinatsız payload sunucuda reddedilip kill-switch'i besliyordu).
      void sendDiagnosticsBeacon('foreground', { position, beaconSource: 'gps_sync' }).catch((error) =>
        console.warn('[location-diagnostics] gps-sync beacon failed', error)
      );

      // Reverse geocoding: il/ilçe adlarını çöz
      let cityName = '';
      let districtName = '';
      let countryCode: string | null = null;
      try {
        const geocoded = await Location.reverseGeocodeAsync(nextCoords);
        if (geocoded.length > 0) {
          const g = geocoded[0];
          countryCode = g.isoCountryCode?.toUpperCase() ?? null;
          cityName = g.region ?? g.city ?? g.subregion ?? '';
          // İlçe için aday alanlar; il adıyla aynı olanı ELE ki cihaz sadece ili
          // döndürdüğünde "İstanbul, İstanbul" gibi yanlış tekrar oluşmasın.
          const cityKey = cityName.trim().toLocaleLowerCase();
          districtName =
            [g.subregion, g.city, g.district].find(
              (v): v is string => Boolean(v) && (v as string).trim().toLocaleLowerCase() !== cityKey
            ) ?? '';
        }
      } catch {
        // Reverse geocoding başarısız olsa da koordinatlar kaydedildi
      }

      // Tüm ülkelerde tek kaynak: canlı koordinat + yerel adhan hesabı.
      if (cityName || districtName) setLocationLabel({ city: cityName, district: districtName });
      setLocationCountryCode(countryCode);
      const cache = await fetchMonthlyPrayerCalendar(
        nextCoords.latitude,
        nextCoords.longitude,
        new Date(),
        countryCode
      );
      await applyCalendarAndSchedule(cache);
    } catch {
      const today = getTodayFromCache(cachedPrayerDays);

      if (today) {
        const cachedPrayers = applyPrayerPrefs(today.prayers, getPrayerPrefs(prayers));
        setPrayers(cachedPrayers);
        await scheduleLocalPrayerNotifications(cachedPrayers, undefined, cachedPrayerDays);
        return;
      }

      Alert.alert(t.syncErrorTitle, t.syncErrorBody);
    } finally {
      setLoadingLocation(false);
    }
  }

  // Cuma hatırlatması: her cuma seçilen saatte tekrarlayan HAFTALIK bildirim.
  // Namaz bildirimlerinden bağımsızdır; cancelPrayerNotifications onu silmez,
  // bu yüzden burada kendi etiketiyle (isFridayReminder) ayrıca yönetilir.
  async function scheduleFridayReminder(enabled: boolean, time: string, lang: Language) {
    // Önce mevcut cuma hatırlatmalarını temizle (tekrar planlamadan önce)
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const n of scheduled) {
        if ((n.content.data as any)?.isFridayReminder === true) {
          await Notifications.cancelScheduledNotificationAsync(n.identifier);
        }
      }
    } catch (error) {
      console.warn('[notifications] Friday reminder could not be reconciled', error);
    }

    if (!enabled) return;

    // İzin YALNIZCA onboarding'de istenir; burada sadece kontrol ediyoruz.
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;

    const dict = DICTS[lang];
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: dict.fridayReminderTitle,
          body: dict.fridayReminderBody,
          sound: true,
          data: { isFridayReminder: true },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: 6, // 1=Pazar … 6=Cuma
          hour: h,
          minute: m,
          ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
        },
      });
    } catch (error) {
      console.warn('[notifications] Friday reminder could not be scheduled', error);
    }
  }

  async function scheduleLocalPrayerNotifications(
    times: PrayerTime[],
    options?: {
      muteAll?: boolean;
      disableVibration?: boolean;
      disableAlarm?: boolean;
      language?: Language;
      earlyMinutes?: number;
      trackingEnabled?: boolean;
      trackingNotifMode?: TrackingNotifMode;
      trackingDays?: DayTracking[];
    },
    cacheDays?: CachedPrayerDay[]
  ) {
    // Eşzamanlı planlama çağrılarını sıraya al. Aksi halde iki çağrı OS kuyruğunu
    // aynı anda temizleyip planlayarak çift/karışık-dilli bildirimler bırakabiliyor.
    const previousRun = schedulingChainRef.current;
    let finishThisRun: () => void = () => {};
    schedulingChainRef.current = new Promise<void>((resolve) => {
      finishThisRun = resolve;
    });
    await previousRun;

    try {
      // Bildirim izni YALNIZCA karşılama ekranındaki "İzin Ver" butonundan istenir.
      // Burada sadece mevcut izni kontrol ediyoruz; izin yoksa sessizce çıkıyoruz
      // (otomatik bir izin diyaloğu açılmaz).
      const { status } = await Notifications.getPermissionsAsync();

      if (status !== 'granted') return;

      await cancelPrayerNotifications();

    const muted = options?.muteAll ?? muteAll;
    const vibrationDisabled = options?.disableVibration ?? disableVibration;
    const alarmDisabled = options?.disableAlarm ?? disableAlarm;
    const activeLanguage = options?.language ?? language;
    const earlyMinutes = Math.max(0, options?.earlyMinutes ?? earlyReminderMinutes);
    const earlyMs = earlyMinutes * 60 * 1000;
    const activeDict = DICTS[activeLanguage];

    if (muted) return;

    const now = new Date();
    const nextIds: string[] = [];
    const prefs = getPrayerPrefs(times);

    // iOS'ta maks 64 bildirim planlanabiliyor, Android'de ~500
    const trackingIsEnabled = options?.trackingEnabled ?? trackingEnabled;
    // iOS 64 bildirim sınırı: 9 gün × (en çok 6 vakit + 1 takip) = 63.
    const maxDays = Platform.OS === 'ios' ? (trackingIsEnabled ? 9 : 10) : 30;
    const daysToSchedule = (cacheDays ?? cachedPrayerDays).slice(0, maxDays);

    type Entry = { triggerDate: Date; prayer: PrayerTime };
    const toSchedule: Entry[] = [];

    if (daysToSchedule.length > 0) {
      // Önbellekten çoklu gün planla
      for (const cachedDay of daysToSchedule) {
        const dayPrayers = applyPrayerPrefs(cachedDay.prayers, prefs);
        for (const prayer of dayPrayers) {
          const [hour, minute, second = 0] = prayer.time.split(':').map(Number);
          const [yr, mo, dy] = cachedDay.date.split('-').map(Number);
          // Vakit zamanından erken hatırlatma kadar önceye kaydır
          const triggerDate = new Date(new Date(yr, mo - 1, dy, hour, minute, second, 0).getTime() - earlyMs);
          if (triggerDate > now) toSchedule.push({ triggerDate, prayer });
        }
      }
    } else {
      // Önbellek yoksa sadece bir sonraki vakti planla
      for (const prayer of times) {
        const [hour, minute, second = 0] = prayer.time.split(':').map(Number);
        const base = new Date();
        base.setHours(hour, minute, second, 0);
        const triggerDate = new Date(base.getTime() - earlyMs);
        if (triggerDate <= now) triggerDate.setDate(triggerDate.getDate() + 1);
        toSchedule.push({ triggerDate, prayer });
      }
    }

    const isEarly = earlyMinutes > 0;

    for (const { triggerDate, prayer } of toSchedule) {
      const shouldNotify = prayer.notification;
      const shouldVibrate = prayer.vibration && !vibrationDisabled;
      const shouldAlarm = prayer.alarm && !alarmDisabled;

      if (!shouldNotify && !shouldVibrate && !shouldAlarm) continue;

      const label = getPrayerLabel(prayer.key, activeLanguage);

      // Erken hatırlatma açıksa metin "X dk sonra ... vakti" olur;
      // değilse normal/alarm metni kullanılır
      const title = isEarly
        ? label
        : shouldAlarm
          ? `${label} ${activeDict.alarmNotificationTitle}`
          : label;
      const body = isEarly
        ? buildEarlyBody(activeLanguage, label, earlyMinutes)
        : shouldAlarm
          ? activeDict.alarmNotificationBody
          : activeDict.prayerNotificationBody;

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: shouldAlarm || shouldNotify,
          data: {
            prayerKey: prayer.key,
            isAlarm: shouldAlarm,
            locationDiagnosticsEvent: 'prayer_notification',
            notificationKind: isEarly ? 'early' : 'prayer',
            scheduledAt: triggerDate.toISOString(),
          },
          ...(shouldAlarm ? { categoryIdentifier: 'prayer_alarm' } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
          ...(Platform.OS === 'android'
            ? { channelId: shouldAlarm ? 'alarm' : 'default' }
            : {}),
        },
      });

      nextIds.push(id);
    }

    scheduledPrayerIdsRef.current = nextIds;

    updateAppState<StoredAppState>({
      scheduledPrayerNotificationIds: nextIds,
    }).catch((error) => console.warn('[storage] scheduled notification ids could not be saved', error));

      const trackingScheduleDays = daysToSchedule.length > 0
        ? daysToSchedule
        : [{ date: getLocalDateKey(), prayers: times }];
      await scheduleTrackingNotifications(
        trackingScheduleDays,
        trackingIsEnabled,
        options?.trackingNotifMode ?? trackingNotifMode,
        options?.trackingDays ?? trackingDays,
        activeLanguage
      );
    } finally {
      finishThisRun();
    }
  }

  function togglePrayerSetting(key: string, field: PrayerToggleField) {
    setPrayers((prev) => {
      const next = prev.map((item) =>
        item.key === key ? { ...item, [field]: !item[field] } : item
      );

      const changed = next.find((item) => item.key === key);

      if (field === 'vibration' && changed?.vibration && !disableVibration) {
        Vibration.vibrate(80);
      }

      if (field === 'alarm' && changed?.alarm && !disableAlarm) {
        Vibration.vibrate(80);
      }

      scheduleLocalPrayerNotifications(next).catch((error) =>
        console.warn('[notifications] prayer preference could not be applied', error)
      );

      return next;
    });
  }

  function handleMuteAll(value: boolean) {
    setMuteAll(value);

    if (value) stopAlarm();

    scheduleLocalPrayerNotifications(prayers, { muteAll: value }).catch((error) =>
      console.warn('[notifications] mute preference could not be applied', error)
    );
  }

  function handleDisableVibration(value: boolean) {
    setDisableVibration(value);

    if (value) {
      Vibration.cancel();
    } else {
      Vibration.vibrate(80);
    }

    scheduleLocalPrayerNotifications(prayers, { disableVibration: value }).catch((error) =>
      console.warn('[notifications] vibration preference could not be applied', error)
    );
  }

  function handleDisableAlarm(value: boolean) {
    setDisableAlarm(value);

    if (value) stopAlarm();

    scheduleLocalPrayerNotifications(prayers, { disableAlarm: value }).catch((error) =>
      console.warn('[notifications] alarm preference could not be applied', error)
    );
  }

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    scheduleLocalPrayerNotifications(prayers, { language: nextLanguage }).catch((error) =>
      console.warn('[notifications] language preference could not be applied', error)
    );
  }

  function handleEarlyReminderChange(minutes: number) {
    setEarlyReminderMinutes(minutes);
    scheduleLocalPrayerNotifications(prayers, { earlyMinutes: minutes }).catch((error) =>
      console.warn('[notifications] early reminder preference could not be applied', error)
    );
  }

  // function handleLocationDiagnosticsConsent(value: boolean) {
  //   if (!value) {
  //     setLocationDiagnosticsConsent(false)
  //       .then(() => setLocationDiagnosticsConsentState(false))
  //       .catch((error) => console.warn('[location-diagnostics] consent could not be removed', error));
  //     return;
  //   }

  //   promptLocationDiagnosticsConsent();
  // }

  // function promptLocationDiagnosticsConsent() {
  //   Alert.alert(t.locationDiagnosticsConsentTitle, t.locationDiagnosticsConsentBody, [
  //     {
  //       text: t.locationDiagnosticsCancel,
  //       style: 'cancel',
  //       onPress: () => {
  //         setLocationDiagnosticsConsent(false)
  //           .then(() => setLocationDiagnosticsConsentState(false))
  //           .catch((error) => console.warn('[location-diagnostics] declined decision could not be saved', error));
  //       },
  //     },
  //     {
  //       text: t.locationDiagnosticsAccept,
  //       onPress: () => {
  //         setLocationDiagnosticsConsent(true)
  //           .then(() => getLocationDiagnosticsConsent())
  //           .then(setLocationDiagnosticsConsentState)
  //           .catch((error) => console.warn('[location-diagnostics] consent could not be saved', error));
  //       },
  //     },
  //   ], { cancelable: false });
  // }

  function handleLocationDiagnosticsConsent(value: boolean) {
    setLocationDiagnosticsConsent(value)
      .then(() => setLocationDiagnosticsConsentState(value))
      .then(() => (value ? requestBackgroundLocationPermissionOnce() : undefined))
      .catch((error) =>
        console.warn('[location-diagnostics] consent could not be saved', error)
      );
  }

function promptLocationDiagnosticsConsent() {
  Alert.alert(
    t.locationDiagnosticsConsentTitle,
    t.locationDiagnosticsConsentBody,
    [
      {
        text: t.locationDiagnosticsAccept,
        onPress: () => {
          // Bu istem uygulama açılışında gösteriliyor; buradan da sistem ayarlarına
          // yönlendirme yapılmaz. "Her zaman konum" yalnız Ayarlar'daki anahtar elle
          // açıldığında istenir.
          setLocationDiagnosticsConsent(true)
            .then(() => setLocationDiagnosticsConsentState(true))
            .catch((error) =>
              console.warn('[location-diagnostics] consent could not be saved', error)
            );
        },
      },
    ],
    { cancelable: false }
  );
}

  if (!fontsLoaded || !hydrated) {
    return (
      <SafeAreaProvider>
        <View style={styles.loader}>
          <ActivityIndicator color={appColors.primaryContainer} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!onboardingCompleted) {
    const hasDiagnosticsPage = isLocationDiagnosticsAvailable();
    const onboardingPageCount = hasDiagnosticsPage ? 4 : 3;
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
          <ExpoStatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
          <Scanlines styles={styles} />
          <OnboardingScreen
            page={onboardingPage}
            pageCount={onboardingPageCount}
            hasDiagnosticsPage={hasDiagnosticsPage}
            t={t}
            language={language}
            coords={coords}
            locationLabel={locationLabel}
            loadingLocation={loadingLocation}
            colors={appColors}
            styles={styles}
            shadow={appShadow}
            onRequestGps={requestLocationAndSync}
            onNext={() => setOnboardingPage((p) => Math.min(p + 1, onboardingPageCount))}
            onSkip={() => {
              if (onboardingPage < onboardingPageCount) {
                setOnboardingPage((p) => p + 1);
              } else {
                handleCompleteOnboarding();
              }
            }}
            onComplete={handleCompleteOnboarding}
            onAcceptDiagnostics={() => handleOnboardingDiagnosticsDecision(true)}
            onDeclineDiagnostics={() => handleOnboardingDiagnosticsDecision(false)}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <ExpoStatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
        <Scanlines styles={styles} />

        {screen === 'home' && (
          <HomeScreen
            t={t}
            language={language}
            timeFormat={timeFormat}
            snoozedUntilByKey={snoozedUntilByKey}
            clock={clock}
            coords={coords}
            hasCachedTimes={cachedPrayerDays.length > 0}
            prayers={prayers}
            currentPrayerKey={currentPrayer?.key}
            nextPrayer={nextPrayer}
            prayerProgress={prayerProgress}
            loadingLocation={loadingLocation}
            muteAll={muteAll}
            disableVibration={disableVibration}
            disableAlarm={disableAlarm}
            colors={appColors}
            styles={styles}
            shadow={appShadow}
            onRequestLocation={requestLocationAndSync}
            onInfo={() => setScreen('about')}
            onTracking={trackingEnabled ? () => setScreen('tracking') : undefined}
            onTogglePrayerSetting={togglePrayerSetting}
          />
        )}

        {screen === 'about' && (
          <AboutScreen
            t={t}
            language={language}
            themePreference={themePreference}
            timeFormat={timeFormat}
            isOnline={isOnline}
            muteAll={muteAll}
            disableVibration={disableVibration}
            disableAlarm={disableAlarm}
            locationLabel={locationLabel}
            coords={coords}
            loadingLocation={loadingLocation}
            trackingEnabled={trackingEnabled}
            trackingNotifMode={trackingNotifMode}
            locationDiagnosticsAvailable={isLocationDiagnosticsAvailable()}
            locationDiagnosticsConsent={locationDiagnosticsConsent}
            earlyReminderMinutes={earlyReminderMinutes}
            fridayReminderEnabled={fridayReminderEnabled}
            fridayReminderTime={fridayReminderTime}
            colors={appColors}
            styles={styles}
            shadow={appShadow}
            onBack={() => setScreen('home')}
            onToggleMute={handleMuteAll}
            onToggleVibration={handleDisableVibration}
            onToggleAlarm={handleDisableAlarm}
            onRefreshLocation={requestLocationAndSync}
            onToggleLocationDiagnostics={handleLocationDiagnosticsConsent}
            onLanguageChange={handleLanguageChange}
            onThemePreferenceChange={setThemePreference}
            onTimeFormatChange={setTimeFormat}
            onToggleTracking={handleTrackingEnabled}
            onTrackingNotifModeChange={handleTrackingNotifModeChange}
            onEarlyReminderChange={handleEarlyReminderChange}
            onFridayReminderToggle={setFridayReminderEnabled}
            onFridayReminderTimeChange={setFridayReminderTime}
            backupBusy={backupBusy}
            onExportJson={handleExportJson}
            onExportHtml={handleExportHtml}
            onImportData={handleImportData}
            onResetData={handleResetAllData}
          />
        )}

        {screen === 'tracking' && (
          <TrackingScreen
            language={language}
            prayers={prayers}
            cachedPrayerDays={cachedPrayerDays}
            trackingDays={trackingDays}
            colors={appColors}
            styles={styles}
            shadow={appShadow}
            onBack={() => setScreen('home')}
            onUpdateStatus={handleUpdateTrackingStatus}
          />
        )}

        {activeAlarm && (
          <AlarmOverlay
            prayer={activeAlarm}
            language={language}
            timeFormat={timeFormat}
            t={t}
            colors={appColors}
            styles={styles}
            onStop={stopAlarm}
            onSnooze={snoozeAlarm}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function getPrayerProgress(prayers: PrayerTime[]): PrayerProgress {
  const now = new Date();

  const todayTimes = prayers.map((prayer) => {
    const [hour, minute] = prayer.time.split(':').map(Number);
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return { prayer, date };
  });

  let previous = todayTimes[todayTimes.length - 1];
  let next = todayTimes[0];

  for (let i = 0; i < todayTimes.length; i++) {
    const item = todayTimes[i];

    if (item.date <= now) {
      previous = item;
      next = todayTimes[i + 1] ?? todayTimes[0];
    }
  }

  const previousDate = new Date(previous.date);
  const nextDate = new Date(next.date);

  if (previous.prayer.key === prayers[prayers.length - 1].key && next.prayer.key === prayers[0].key) {
    if (now >= previousDate) {
      nextDate.setDate(nextDate.getDate() + 1);
    } else {
      previousDate.setDate(previousDate.getDate() - 1);
    }
  }

  const total = nextDate.getTime() - previousDate.getTime();
  const passed = now.getTime() - previousDate.getTime();
  const progress = total > 0 ? Math.min(1, Math.max(0, passed / total)) : 0;

  return {
    previousKey: previous.prayer.key,
    nextKey: next.prayer.key,
    progress,
  };
}

function TopBar({
  title,
  leftIcon,
  rightIcon,
  onLeft,
  onRight,
  colors,
  styles,
}: {
  title: string;
  leftIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  rightIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onLeft?: () => void;
  onRight?: () => void;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
}) {
  return (
    <View style={styles.topBar}>
      {leftIcon ? (
        <Pressable onPress={onLeft} style={styles.topIcon}>
          <MaterialCommunityIcons name={leftIcon} size={24} color={colors.primary} />
        </Pressable>
      ) : (
        <View style={styles.topIcon} />
      )}

      <Text style={styles.topTitle}>{title}</Text>

      {rightIcon ? (
        <Pressable onPress={onRight} style={styles.topIcon}>
          <MaterialCommunityIcons name={rightIcon} size={24} color={colors.primary} />
        </Pressable>
      ) : (
        <View style={styles.topIcon} />
      )}
    </View>
  );
}

function HomeScreen(props: {
  t: typeof DICTS.tr;
  language: Language;
  timeFormat: TimeFormat;
  snoozedUntilByKey: SnoozeMap;
  clock: string;
  coords: { latitude: number; longitude: number } | null;
  /** Önbellekte gerçek (daha önce senkronlanmış) vakit var mı? bkz. hasRealTimes */
  hasCachedTimes: boolean;
  prayers: PrayerTime[];
  currentPrayerKey?: string;
  nextPrayer: ReturnType<typeof getNextPrayer>;
  prayerProgress: PrayerProgress;
  loadingLocation: boolean;
  muteAll: boolean;
  disableVibration: boolean;
  disableAlarm: boolean;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  shadow: ReturnType<typeof createShadow>;
  onRequestLocation: () => void;
  onInfo: () => void;
  onTracking?: () => void;
  onTogglePrayerSetting: (key: string, field: PrayerToggleField) => void;
}) {
  const showLocationCard = !props.coords;
  /**
   * Ekrandaki vakitler GERÇEK mi?
   *
   * Konum hiç alınamamış ve önbellekte de gün yoksa `prayers` state'i
   * `fallbackPrayers`'tır — yani derlemeye gömülü UYDURMA saatler (04:32, 13:15…).
   * Eskiden bunlar normal vakitmiş gibi gösteriliyordu: kullanıcı uygulamanın
   * çalıştığını sanıyor, hiçbir bildirim gelmeyince de nedenini anlamıyordu.
   * Sahte veriyi göstermek, hiç göstermemekten daha kötü. Gerçek olmayan
   * vakitler artık "—" olarak çizilir; tek eylem çağrısı yukarıdaki konum kartıdır.
   */
  const hasRealTimes = Boolean(props.coords) || props.hasCachedTimes;
  const currentLabel = props.currentPrayerKey
    ? getPrayerLabel(props.currentPrayerKey, props.language)
    : getPrayerLabel(props.prayerProgress.previousKey, props.language);

  const nextName = props.nextPrayer?.prayer.key
    ? getPrayerLabel(props.nextPrayer.prayer.key, props.language)
    : '—';

  const clockText = formatTimeValue(props.clock.slice(0, 5), props.language, props.timeFormat);
  const remainingText = formatDurationValue(props.nextPrayer?.remaining, props.language);
  const nextTime = formatTimeValue(props.nextPrayer?.prayer.time, props.language, props.timeFormat);

  return (
    <View style={props.styles.screen}>
      <TopBar
        title={props.t.appTitle}
        leftIcon={props.onTracking ? 'calendar-month-outline' : undefined}
        onLeft={props.onTracking}
        rightIcon="cog-outline"
        onRight={props.onInfo}
        colors={props.colors}
        styles={props.styles}
      />

      <ScrollView contentContainerStyle={props.styles.content} showsVerticalScrollIndicator={false}>
        {showLocationCard && (
          <Panel active style={props.styles.locationPanel} styles={props.styles} shadow={props.shadow}>
            <View style={props.styles.locationIconBox}>
              <MaterialCommunityIcons
                name="map-marker-outline"
                size={22}
                color={props.colors.primary}
              />
            </View>

            <View style={props.styles.locationTextWrap}>
              <Text style={props.styles.locationTitle}>
                {props.t.locationRequired}
              </Text>
              <Text style={props.styles.locationBody}>
                {props.t.locationText}
              </Text>
            </View>

            <Pressable
              style={props.styles.outlineButton}
              onPress={props.onRequestLocation}
              disabled={props.loadingLocation}
            >
              <Text style={props.styles.outlineButtonText}>
                {props.loadingLocation
                  ? props.t.syncing
                  : props.t.requestLocation}
              </Text>
            </Pressable>
          </Panel>
        )}

        <Panel active style={props.styles.heroCard} styles={props.styles} shadow={props.shadow}>
          <Text style={props.styles.heroLabel}>{upper(props.t.currentTime, props.language)}</Text>

          <Text style={props.styles.clockText}>{clockText}</Text>

          <View style={props.styles.progressTrack}>
            <View
              style={[
                props.styles.progressFill,
                { width: `${(hasRealTimes ? props.prayerProgress.progress : 0) * 100}%` },
              ]}
            />
          </View>

          <Text style={props.styles.heroCountdown}>
            {props.t.remaining}: {hasRealTimes ? remainingText : '—'}
          </Text>

          <Text style={props.styles.heroPrayerName}>
            {hasRealTimes ? `${currentLabel} Vakti` : props.t.timesUnavailable}
          </Text>

          <Text style={props.styles.heroNextText}>
            {props.t.nextPrayer}: {hasRealTimes ? `${nextName} • ${nextTime}` : '—'}
          </Text>
        </Panel>

        <Panel style={props.styles.prayerPanel} styles={props.styles} shadow={props.shadow}>
          {props.prayers.map((item, index) => (
            <PrayerRow
              key={item.key}
              // Gerçek vakit yoksa saati boşalt: satır yapısı korunur ama uydurma
              // saat gösterilmez (PrayerRow boş saati "—" olarak çizer).
              item={hasRealTimes ? item : { ...item, time: '' }}
              label={getPrayerLabel(item.key, props.language)}
              language={props.language}
              timeFormat={props.timeFormat}
              snoozedUntil={props.snoozedUntilByKey[item.key]}
              active={item.key === props.currentPrayerKey}
              last={index === props.prayers.length - 1}
              muteAll={props.muteAll}
              disableVibration={props.disableVibration}
              disableAlarm={props.disableAlarm}
              colors={props.colors}
              styles={props.styles}
              onToggleNotification={() => props.onTogglePrayerSetting(item.key, 'notification')}
              onToggleVibration={() => props.onTogglePrayerSetting(item.key, 'vibration')}
              onToggleAlarm={() => props.onTogglePrayerSetting(item.key, 'alarm')}
            />
          ))}
        </Panel>
      </ScrollView>
    </View>
  );
}

function AboutScreen({
  t,
  language,
  themePreference,
  timeFormat,
  isOnline,
  muteAll,
  disableVibration,
  disableAlarm,
  locationLabel,
  coords,
  loadingLocation,
  trackingEnabled,
  trackingNotifMode,
  locationDiagnosticsAvailable,
  locationDiagnosticsConsent,
  colors,
  styles,
  shadow,
  onBack,
  onToggleMute,
  onToggleVibration,
  onToggleAlarm,
  onRefreshLocation,
  onToggleLocationDiagnostics,
  onLanguageChange,
  onThemePreferenceChange,
  onTimeFormatChange,
  onToggleTracking,
  onTrackingNotifModeChange,
  earlyReminderMinutes,
  onEarlyReminderChange,
  fridayReminderEnabled,
  fridayReminderTime,
  onFridayReminderToggle,
  onFridayReminderTimeChange,
  backupBusy,
  onExportJson,
  onExportHtml,
  onImportData,
  onResetData,
}: {
  t: typeof DICTS.tr;
  language: Language;
  themePreference: ThemePreference;
  timeFormat: TimeFormat;
  isOnline: boolean | null;
  muteAll: boolean;
  disableVibration: boolean;
  disableAlarm: boolean;
  locationLabel: LocationLabel | null;
  coords: { latitude: number; longitude: number } | null;
  loadingLocation: boolean;
  trackingEnabled: boolean;
  trackingNotifMode: TrackingNotifMode;
  locationDiagnosticsAvailable: boolean;
  locationDiagnosticsConsent: boolean;
  earlyReminderMinutes: number;
  fridayReminderEnabled: boolean;
  fridayReminderTime: string;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  shadow: ReturnType<typeof createShadow>;
  onBack: () => void;
  onToggleMute: (value: boolean) => void;
  onToggleVibration: (value: boolean) => void;
  onToggleAlarm: (value: boolean) => void;
  onRefreshLocation: () => void;
  onToggleLocationDiagnostics: (value: boolean) => void;
  onLanguageChange: (language: Language) => void;
  onThemePreferenceChange: (theme: ThemePreference) => void;
  onTimeFormatChange: (format: TimeFormat) => void;
  onToggleTracking: (value: boolean) => void;
  onTrackingNotifModeChange: (mode: TrackingNotifMode) => void;
  onEarlyReminderChange: (minutes: number) => void;
  onFridayReminderToggle: (value: boolean) => void;
  onFridayReminderTimeChange: (time: string) => void;
  backupBusy: boolean;
  onExportJson: () => void;
  onExportHtml: () => void;
  onImportData: () => void;
  onResetData: () => void;
}) {
  const themeOptions = [
    { label: t.themeDark, value: 'dark' },
    { label: t.themeLight, value: 'light' },
  ];

  const timeFormatOptions = [
    { label: t.timeFormat24, value: '24' },
    { label: t.timeFormat12, value: '12' },
  ];

  return (
    <View style={styles.screen}>
      <TopBar
        title={t.appTitle}
        leftIcon="arrow-left"
        onLeft={onBack}
        colors={colors}
        styles={styles}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Uygulama Hakkında — en üstte */}
        <Panel active style={styles.aboutCard} styles={styles} shadow={shadow}>
          <Text style={styles.cardTitle}>
            <MaterialCommunityIcons name="information-outline" size={14} color={colors.primary} />{' '}
            {upper(t.aboutApp, language)}
          </Text>
          <Text style={styles.bodyText}>{t.aboutText}</Text>
        </Panel>

        {/* Konum */}
        <Panel style={styles.aboutCard} styles={styles} shadow={shadow}>
          <Text style={styles.cardTitle}>
            <MaterialCommunityIcons name="map-marker-outline" size={14} color={colors.primary} />{' '}
            {upper(t.locationInfo, language)}
          </Text>

          <StatusRow
            icon="city-variant-outline"
            label={t.locationCityDistrict}
            value={
              locationLabel
                ? [locationLabel.city, locationLabel.district].filter(Boolean).join(', ') || t.locationUnknown
                : t.locationUnknown
            }
            colors={colors}
            styles={styles}
          />

          {coords && (
            <StatusRow
              icon="crosshairs-gps"
              label={t.locationCoords}
              value={`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`}
              colors={colors}
              styles={styles}
            />
          )}

          <Divider styles={styles} />

          <Pressable
            style={styles.outlineButton}
            onPress={onRefreshLocation}
            disabled={loadingLocation}
          >
            <Text style={styles.outlineButtonText}>
              {loadingLocation ? t.syncing : t.locationRefresh}
            </Text>
          </Pressable>
        </Panel>

        <Panel style={styles.aboutCard} styles={styles} shadow={shadow}>
          <Text style={styles.cardTitle}>
            <MaterialCommunityIcons name="cog-outline" size={14} color={colors.primary} />{' '}
            {upper(t.settings, language)}
          </Text>

          {/* Genel — dil, tema, saat (yan yana seçimler), en üstte */}
          <Text style={styles.sectionTitle}>{t.generalSection}</Text>

          <ChoiceRow
            title={t.language}
            options={languageOptions}
            selected={language}
            colors={colors}
            styles={styles}
            onSelect={(value) => onLanguageChange(value as Language)}
          />

          <ChoiceRow
            title={t.theme}
            options={themeOptions}
            selected={themePreference}
            colors={colors}
            styles={styles}
            onSelect={(value) => onThemePreferenceChange(value as ThemePreference)}
          />

          <ChoiceRow
            title={t.timeFormat}
            options={timeFormatOptions}
            selected={timeFormat}
            colors={colors}
            styles={styles}
            onSelect={(value) => onTimeFormatChange(value as TimeFormat)}
          />

          <Divider styles={styles} />

          {/* Bildirimler — aç/kapat anahtarları alt alta, sonra çoklu-seçimler yan yana */}
          <Text style={styles.sectionTitle}>{t.notificationsSection}</Text>

          <SettingRow
            icon="bell-off-outline"
            label={t.muteAll}
            value={muteAll}
            colors={colors}
            styles={styles}
            onValueChange={onToggleMute}
          />

          <SettingRow
            icon="vibrate-off"
            label={t.disableVibration}
            value={disableVibration}
            colors={colors}
            styles={styles}
            onValueChange={onToggleVibration}
          />

          <SettingRow
            icon="alarm-off"
            label={t.disableAlarm}
            value={disableAlarm}
            colors={colors}
            styles={styles}
            onValueChange={onToggleAlarm}
          />

          <ChoiceRow
            title={t.earlyReminder}
            options={[
              { label: t.earlyReminderOff, value: '0' },
              { label: `5 ${t.minutesShort}`, value: '5' },
              { label: `10 ${t.minutesShort}`, value: '10' },
              { label: `15 ${t.minutesShort}`, value: '15' },
              { label: `30 ${t.minutesShort}`, value: '30' },
            ]}
            selected={String(earlyReminderMinutes)}
            colors={colors}
            styles={styles}
            onSelect={(value) => onEarlyReminderChange(Number(value))}
          />

          <SettingRow
            icon="calendar-star"
            label={t.fridayReminder}
            value={fridayReminderEnabled}
            colors={colors}
            styles={styles}
            onValueChange={onFridayReminderToggle}
          />

          {/* Cuma hatırlatma saati — cuma anahtarına ait (yuvalanmış) */}
          {fridayReminderEnabled && (
            <View style={styles.nestedSetting}>
              <ChoiceRow
                title={t.fridayReminderTimeLabel}
                options={['10:00', '10:30', '11:00', '11:30', '12:00'].map((v) => ({ label: v, value: v }))}
                selected={fridayReminderTime}
                colors={colors}
                styles={styles}
                onSelect={onFridayReminderTimeChange}
              />
            </View>
          )}

          <Divider styles={styles} />

          {/* Namaz Takibi */}
          <Text style={styles.sectionTitle}>{t.trackingSection}</Text>

          <SettingRow
            icon="calendar-check-outline"
            label={t.trackPrayers}
            value={trackingEnabled}
            colors={colors}
            styles={styles}
            onValueChange={onToggleTracking}
          />

          {/* Takip bildirimi — takip anahtarına ait (yuvalanmış) */}
          {trackingEnabled && (
            <View style={styles.nestedSetting}>
              <ChoiceRow
                title={t.trackingNotif}
                options={[
                  { label: t.trackingNotifAlways, value: 'always' },
                  { label: t.trackingNotifIfIncomplete, value: 'ifIncomplete' },
                ]}
                selected={trackingNotifMode}
                colors={colors}
                styles={styles}
                onSelect={(value) => onTrackingNotifModeChange(value as TrackingNotifMode)}
              />
            </View>
          )}

          <Divider styles={styles} />

          {/* Sistem — bilgi + konum (en az kritik) */}
          <Text style={styles.sectionTitle}>{t.systemSettings}</Text>

          <StatusRow
            icon={isOnline ? 'wifi' : 'wifi-off'}
            label={t.internetStatus}
            value={isOnline ? t.internetOnline : t.internetOffline}
            colors={colors}
            styles={styles}
          />

          {isOnline === false && <Text style={styles.offlineText}>{t.offlineMode}</Text>}

          {/*{locationDiagnosticsAvailable && (
            <>
              <SettingRow
                icon="crosshairs-question"
                label={t.locationDiagnostics}
                value={locationDiagnosticsConsent}
                colors={colors}
                styles={styles}
                onValueChange={onToggleLocationDiagnostics}
              />
              <Text style={styles.offlineText}>{t.locationDiagnosticsDescription}</Text>
            </>
          )}*/}

          {/* TEŞHİS PANELİ TAMAMEN KALDIRILDI. Sunucudan açılabilen bir bayrağa
              bağlıydı, ama son kullanıcıya teknik çıktı gösterme riski kabul
              edilmedi. Saha teşhisi artık yalnız Supabase üzerinden yapılır
              (notification_location_diagnostics.beacon_source / app_version). */}

          <Divider styles={styles} />

          <Pressable style={styles.dangerRow} onPress={onResetData}>
            <MaterialCommunityIcons name="trash-can-outline" size={19} color={colors.danger} />
            <Text style={styles.dangerText}>{t.resetData}</Text>
          </Pressable>
        </Panel>

        {/* Veri Yedekleme: JSON / HTML dışa aktarma + geri yükleme */}
        <Panel style={styles.aboutCard} styles={styles} shadow={shadow}>
          <Text style={styles.cardTitle}>
            <MaterialCommunityIcons name="content-save-outline" size={14} color={colors.primary} />{' '}
            {upper(t.dataBackup, language)}
          </Text>

          <Text style={styles.bodyText}>{t.dataBackupDesc}</Text>

          <Pressable
            style={[styles.outlineButton, { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, backupBusy && { opacity: 0.5 }]}
            onPress={onExportJson}
            disabled={backupBusy}
          >
            <MaterialCommunityIcons name="code-json" size={16} color={colors.primary} />
            <Text style={styles.outlineButtonText}>{upper(backupBusy ? t.processing : t.exportJson, language)}</Text>
          </Pressable>

          <Pressable
            style={[styles.outlineButton, { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, backupBusy && { opacity: 0.5 }]}
            onPress={onExportHtml}
            disabled={backupBusy}
          >
            <MaterialCommunityIcons name="file-chart-outline" size={16} color={colors.primary} />
            <Text style={styles.outlineButtonText}>{upper(backupBusy ? t.processing : t.exportHtml, language)}</Text>
          </Pressable>

          <Divider styles={styles} />

          <Pressable
            style={[styles.outlineButton, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderColor: colors.primary }, backupBusy && { opacity: 0.5 }]}
            onPress={onImportData}
            disabled={backupBusy}
          >
            <MaterialCommunityIcons name="tray-arrow-down" size={16} color={colors.primary} />
            <Text style={styles.outlineButtonText}>{upper(backupBusy ? t.processing : t.importData, language)}</Text>
          </Pressable>
        </Panel>

        <Panel style={styles.aboutCard} styles={styles} shadow={shadow}>
          <Text style={styles.cardTitle}>
            <MaterialCommunityIcons name="code-tags" size={14} color={colors.primary} />{' '}
            {upper(t.developer, language)}
          </Text>

          <View style={styles.devRow}>
            <View style={styles.devAvatar}>
              <MaterialCommunityIcons name="code-tags" size={28} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.labelDim}>{upper(t.developer, language)}</Text>
              <Text style={styles.devName}>{t.developerName}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>{t.contactIntro}</Text>

          <View style={styles.linkRow}>
            <LinkButton icon="email-outline" label="hattab1342@gmail.com" url="mailto:hattab1342@gmail.com" colors={colors} styles={styles} />
            <LinkButton icon="github" label="github / trs-1342" url="https://github.com/trs-1342" colors={colors} styles={styles} />
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 14 }]}>{t.contributeText}</Text>

          <View style={styles.linkRow}>
            <LinkButton icon="source-repository" label={t.sourceCodeLabel} url="https://github.com/trs-1342/namaz-aliskanligi" colors={colors} styles={styles} />
            <LinkButton icon="shield-lock-outline" label={t.website} url="https://trs-1342.github.io/namaz-aliskanligi/" colors={colors} styles={styles} />
          </View>
        </Panel>
      </ScrollView>
    </View>
  );
}

function AlarmOverlay({
  prayer,
  language,
  timeFormat,
  t,
  colors,
  styles,
  onStop,
  onSnooze,
}: {
  prayer: PrayerTime;
  language: Language;
  timeFormat: TimeFormat;
  t: typeof DICTS.tr;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  onStop: () => void;
  onSnooze: () => void;
}) {
  const label = getPrayerLabel(prayer.key, language);
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dx > 0) {
          translateX.setValue(Math.min(gesture.dx, 190));
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > 140) {
          Animated.timing(translateX, {
            toValue: 220,
            duration: 140,
            useNativeDriver: true,
          }).start(() => {
            translateX.setValue(0);
            onSnooze();
          });
          return;
        }

        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  return (
    <View style={styles.alarmOverlay}>
      <Scanlines styles={styles} />

      <View style={styles.alarmCard}>
        <MaterialCommunityIcons name="alarm-light-outline" size={64} color={colors.primary} />

        <Text style={styles.alarmTitle}>
          {label} {t.alarmNotificationTitle}
        </Text>

        <Text style={styles.alarmSubtitle}>{upper(t.alarmActive, language)}</Text>
        <Text style={styles.alarmTime}>{formatTimeValue(prayer.time, language, timeFormat)}</Text>

        <View style={styles.alarmActions}>
          <View style={styles.snoozeSlider}>
            <Text style={styles.snoozeSliderText}>{upper(t.swipeToSnooze, language)}</Text>

            <Animated.View
              {...panResponder.panHandlers}
              style={[
                styles.snoozeThumb,
                {
                  transform: [{ translateX }],
                },
              ]}
            >
              <MaterialCommunityIcons name="chevron-right" size={28} color={colors.onPrimary} />
            </Animated.View>
          </View>

          <Pressable style={styles.alarmMainButton} onPress={onStop}>
            <Text style={styles.alarmMainText}>{upper(t.stop, language)}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function OnboardingScreen({
  page,
  pageCount,
  hasDiagnosticsPage,
  t,
  language,
  coords,
  locationLabel,
  loadingLocation,
  colors,
  styles,
  shadow,
  onRequestGps,
  onNext,
  onSkip,
  onComplete,
  onAcceptDiagnostics,
  onDeclineDiagnostics,
}: {
  page: number;
  pageCount: number;
  hasDiagnosticsPage: boolean;
  t: typeof DICTS.tr;
  language: Language;
  coords: { latitude: number; longitude: number } | null;
  locationLabel: LocationLabel | null;
  loadingLocation: boolean;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  shadow: ReturnType<typeof createShadow>;
  onRequestGps: () => void;
  onNext: () => void;
  onSkip: () => void;
  onComplete: () => void;
  onAcceptDiagnostics: () => void;
  onDeclineDiagnostics: () => void;
}) {
  const ob = t.onboarding;

  const dots = (
    <View style={styles.obDots}>
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
        <View
          key={n}
          style={[styles.obDot, n === page && styles.obDotActive]}
        />
      ))}
    </View>
  );

  if (page === 1) {
    const locationSetLabel = locationLabel
      ? [locationLabel.city, locationLabel.district].filter(Boolean).join(', ')
      : null;

    /**
     * KONUM ZORUNLUDUR — konumsuz ilerleme YOKTUR.
     *
     * NEDEN: Uygulamanın tek işi namaz vakitlerini hesaplamak ve bildirmek;
     * konum olmadan bunların hiçbiri mümkün değil. Konumsuz kurulmuş bir uygulama
     * çalışmayan bir uygulamadır — kullanıcı da bunun sebebini göremez. Bu yüzden
     * "atla"/"yine de devam et" gibi bir kaçış yolu bilerek BIRAKILMADI.
     *
     * "Devam"a basmak, koordinat yoksa doğrudan izin akışını başlatır.
     */
    const advanceWithoutLocation = (proceed: () => void) => {
      if (coords) {
        proceed();
        return;
      }
      Alert.alert(t.locationRequiredTitle, t.locationRequiredBody, [
        { text: t.cancel, style: 'cancel' },
        { text: ob.allowGps, onPress: onRequestGps },
      ]);
    };

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.obContainer} keyboardShouldPersistTaps="handled">
          {dots}

          <MaterialCommunityIcons name="map-marker-radius-outline" size={56} color={colors.primary} style={styles.obIcon} />
          <Text style={styles.obTitle}>{upper(ob.locationTitle, language)}</Text>
          <Text style={styles.obDesc}>{ob.locationDesc}</Text>

          <Pressable
            style={[styles.obPrimaryButton, loadingLocation && { opacity: 0.5 }]}
            onPress={onRequestGps}
            disabled={loadingLocation}
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={18} color={colors.onPrimary} />
            <Text style={styles.obPrimaryText}>{loadingLocation ? t.syncing : ob.allowGps}</Text>
          </Pressable>

          {locationSetLabel && (
            <View style={styles.obSuccessRow}>
              <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.primary} />
              <Text style={[styles.obSuccessText, { color: colors.primary }]}>{locationSetLabel}</Text>
            </View>
          )}

          {/* "Atla" BİLEREK YOK: konum bu uygulamanın çalışma şartı, isteğe bağlı
              bir tercih değil. Konumsuz kurulum, kullanıcının sebebini göremediği
              çalışmayan bir uygulamaya yol açıyordu. "Devam" da koordinat yoksa
              ilerletmez, izin akışını başlatır. */}
          <View style={styles.obFooter}>
            <Pressable onPress={() => advanceWithoutLocation(onNext)} style={styles.obNextButton}>
              <Text style={styles.obNextText}>{ob.next}</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color={colors.onPrimary} />
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (page === 2) {
    return (
      <View style={styles.obContainer}>
        {dots}

        <MaterialCommunityIcons name="bell-ring-outline" size={56} color={colors.primary} style={styles.obIcon} />
        <Text style={styles.obTitle}>{upper(ob.notifTitle, language)}</Text>
        <Text style={styles.obDesc}>{ob.notifDesc}</Text>

        <Pressable
          style={styles.obPrimaryButton}
          onPress={async () => {
            await Notifications.requestPermissionsAsync();
            onNext();
          }}
        >
          <MaterialCommunityIcons name="bell-check-outline" size={18} color={colors.onPrimary} />
          <Text style={styles.obPrimaryText}>{ob.allowNotif}</Text>
        </Pressable>

        {/* "Atla" BİLEREK YOK (konum sayfasıyla aynı gerekçe): bu bir namaz
            vakti bildirim uygulaması; bildirim izni olmadan uygulamanın asıl
            işlevi çalışmaz. Kullanıcı yine de sistem diyaloğunda reddedebilir —
            zorlamıyoruz — ama izin adımı sessizce atlanamaz. */}
        <View style={styles.obFooter}>
          <Pressable onPress={onNext} style={styles.obNextButton}>
            <Text style={styles.obNextText}>{ob.next}</Text>
            <MaterialCommunityIcons name="arrow-right" size={16} color={colors.onPrimary} />
          </Pressable>
        </View>
      </View>
    );
  }

  if (page === 3) {
    return (
      <View style={styles.obContainer}>
        {dots}

        <MaterialCommunityIcons name="check-circle-outline" size={72} color={colors.primary} style={styles.obIcon} />
        <Text style={styles.obTitle}>{upper(ob.welcomeTitle, language)}</Text>
        <Text style={styles.obDesc}>{ob.welcomeDesc}</Text>

        <Pressable
          style={[styles.obPrimaryButton, { marginTop: 24 }]}
          onPress={hasDiagnosticsPage ? onNext : onComplete}
        >
          <Text style={styles.obPrimaryText}>{ob.start}</Text>
          <MaterialCommunityIcons name="arrow-right" size={18} color={colors.onPrimary} />
        </Pressable>
      </View>
    );
  }

  // Page 4 - Optional closed-test location diagnostics consent
return (
  <KeyboardAvoidingView
    style={{ flex: 1 }}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
  >
    <ScrollView
      contentContainerStyle={styles.obContainer}
      keyboardShouldPersistTaps="handled"
    >
      {dots}

      <MaterialCommunityIcons
        name="map-marker-radius-outline"
        size={56}
        color={colors.primary}
        style={styles.obIcon}
      />

      <Text style={styles.obTitle}>
        {upper(t.locationDiagnosticsConsentTitle, language)}
      </Text>

      <Text style={styles.obDesc}>
        {t.locationDiagnosticsConsentBody}
      </Text>

      <Pressable
        style={[styles.obPrimaryButton, { marginTop: 24 }]}
        onPress={onAcceptDiagnostics}
      >
        <Text style={styles.obPrimaryText}>
          {t.locationDiagnosticsAccept}
        </Text>

        <MaterialCommunityIcons
          name="arrow-right"
          size={18}
          color={colors.onPrimary}
        />
      </Pressable>
    </ScrollView>
  </KeyboardAvoidingView>
);
}

function Panel({
  children,
  style,
  active,
  styles,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
  styles: ReturnType<typeof createAppStyles>;
  shadow: ReturnType<typeof createShadow>;
}) {
  return <View style={[styles.panel, active && styles.panelActive, style]}>{children}</View>;
}

function PrayerRow({
  item,
  label,
  language,
  timeFormat,
  snoozedUntil,
  active,
  last,
  muteAll,
  disableVibration,
  disableAlarm,
  colors,
  styles,
  onToggleNotification,
  onToggleVibration,
  onToggleAlarm,
}: {
  item: PrayerTime;
  label: string;
  language: Language;
  timeFormat: TimeFormat;
  snoozedUntil?: number;
  active: boolean;
  last: boolean;
  muteAll: boolean;
  disableVibration: boolean;
  disableAlarm: boolean;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  onToggleNotification: () => void;
  onToggleVibration: () => void;
  onToggleAlarm: () => void;
}) {
  const notifyActive = item.notification && !muteAll;
  const vibrationActive = item.vibration && !disableVibration && !muteAll;
  const alarmActive = item.alarm && !disableAlarm && !muteAll;

  return (
    <View style={[styles.prayerRow, active && styles.prayerRowActive, last && { borderBottomWidth: 0 }]}>
      <View>
        <Text style={[styles.prayerName, active && styles.activeText]}>{upper(label, language)}</Text>
        <Text style={[styles.prayerTime, active && styles.activeTime]}>
          {formatTimeValue(item.time, language, timeFormat)}
        </Text>

        {snoozedUntil && snoozedUntil > Date.now() && (
          <Text style={styles.snoozeText}>
            {formatForLanguage('⏱ ', language)}
            {formatSnoozeUntil(snoozedUntil, language, timeFormat)}
          </Text>
        )}
      </View>

      <View style={styles.prayerRight}>
        <View style={styles.rowIcons}>
          <Pressable onPress={onToggleNotification} hitSlop={10}>
            <MaterialCommunityIcons
              name={notifyActive ? 'bell-outline' : 'bell-off-outline'}
              size={19}
              color={notifyActive ? colors.primary : colors.onSurfaceVariant}
            />
          </Pressable>

          <Pressable onPress={onToggleVibration} hitSlop={10}>
            <MaterialCommunityIcons
              name={vibrationActive ? 'vibrate' : 'vibrate-off'}
              size={19}
              color={vibrationActive ? colors.primary : colors.onSurfaceVariant}
            />
          </Pressable>

          <Pressable onPress={onToggleAlarm} hitSlop={10}>
            <MaterialCommunityIcons
              name={alarmActive ? 'alarm' : 'alarm-off'}
              size={19}
              color={alarmActive ? colors.primary : colors.onSurfaceVariant}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}


function StatusRow({
  icon,
  label,
  value,
  colors,
  styles,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelWrap}>
        <MaterialCommunityIcons name={icon} size={19} color={colors.onSurfaceVariant} />
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

function SettingRow({
  icon,
  label,
  value,
  onValueChange,
  colors,
  styles,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelWrap}>
        <MaterialCommunityIcons name={icon} size={19} color={colors.onSurfaceVariant} />
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: colors.surfaceContainerHighest,
          true: colors.primaryContainer,
        }}
        thumbColor={value ? colors.onPrimary : colors.onSurfaceVariant}
      />
    </View>
  );
}

function ChoiceRow({
  title,
  options,
  selected,
  onSelect,
  colors,
  styles,
}: {
  title: string;
  options: { label: string; value: string }[];
  selected: string;
  onSelect: (value: string) => void;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
}) {
  return (
    <View style={styles.choiceWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>

      <View style={styles.choiceGroup}>
        {options.map((item) => {
          const active = item.value === selected;

          return (
            <Pressable
              key={item.value}
              onPress={() => onSelect(item.value)}
              style={[styles.choiceButton, active && styles.choiceButtonActive]}
            >
              <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Divider({ styles }: { styles: ReturnType<typeof createAppStyles> }) {
  return <View style={styles.divider} />;
}

function LinkButton({
  icon,
  label,
  url,
  colors,
  styles,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  url: string;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
}) {
  return (
    <Pressable style={styles.linkButton} onPress={() => Linking.openURL(url)}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const Scanlines = React.memo(function Scanlines({ styles }: { styles: ReturnType<typeof createAppStyles> }) {
  return (
    <View pointerEvents="none" style={styles.scanlineWrap}>
      {Array.from({ length: 260 }).map((_, i) => (
        <View key={i} style={[styles.scanline, { top: i * 4 }]} />
      ))}
    </View>
  );
});
export default function RootApp() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}
