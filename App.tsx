import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Appearance,
  Linking,
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
import { fetchPrayerTimes, PrayerTime } from './src/services/prayerTimes';
import { formatClock, getCurrentPrayer, getNextPrayer } from './src/utils/time';

type Screen = 'home' | 'about';
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
    systemSettings: 'Sistem Ayarları',
    muteAll: 'Tümünü Sustur',
    disableVibration: 'Titreşimleri Kapat',
    disableAlarm: 'Alarmları Kapat',
    disableLocation: 'Konumu Çekmeyi Kapat',
    aboutApp: 'Uygulama Hakkında',
    aboutText:
      'Namaz Alışkanlığı, namaz vakitlerini sade, net ve dikkat dağıtmayan bir arayüzle hatırlatmak için tasarlanmıştır. Amaç; bildirim, titreşim ve alarm geri bildirimlerini kişisel tercihe göre çalıştırarak namazı unutmamayı kolaylaştırmaktır.',
    settings: 'Ayarlar',
    language: 'Dil',
    theme: 'Tema',
    themeSystem: 'Sistem',
    themeDark: 'Karanlık',
    themeLight: 'Aydınlık',
    timeFormat: 'Saat Sistemi',
    timeFormatSystem: 'Sistem',
    timeFormat24: '24 Saat',
    timeFormat12: '12 Saat',
    architecture: 'Sistem Mimarisi',
    developer: 'Geliştirici',
    developerName: 'trs-1342',
    contactIntro: 'İletişim ve geri bildirim için:',
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
    syncErrorTitle: 'Senkronizasyon hatası',
    syncErrorBody: 'Konum veya namaz vakti alınamadı.',
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
    systemSettings: 'System Settings',
    muteAll: 'Mute All',
    disableVibration: 'Disable Vibrations',
    disableAlarm: 'Disable Alarms',
    disableLocation: 'Disable Location Sync',
    aboutApp: 'About App',
    aboutText:
      'Prayer Habit is designed to remind prayer times through a calm, focused and distraction-free interface. Its purpose is to provide notification, vibration and alarm feedback based on personal preference.',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    themeSystem: 'System',
    themeDark: 'Dark',
    themeLight: 'Light',
    timeFormat: 'Time Format',
    timeFormatSystem: 'System',
    timeFormat24: '24 Hour',
    timeFormat12: '12 Hour',
    architecture: 'System Architecture',
    developer: 'Developer',
    developerName: 'trs-1342',
    contactIntro: 'For contact and feedback:',
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
    syncErrorTitle: 'Sync error',
    syncErrorBody: 'Location or prayer time could not be retrieved.',
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
    systemSettings: 'إعدادات النظام',
    muteAll: 'كتم الكل',
    disableVibration: 'إيقاف الاهتزاز',
    disableAlarm: 'إيقاف المنبهات',
    disableLocation: 'إيقاف سحب الموقع',
    aboutApp: 'حول التطبيق',
    aboutText:
      'تطبيق عادة الصلاة مصمم لتذكيرك بأوقات الصلاة من خلال واجهة هادئة وواضحة بلا تشتيت، مع إمكانية التحكم في الإشعارات والاهتزاز والمنبه لكل صلاة.',
    settings: 'الإعدادات',
    language: 'اللغة',
    theme: 'المظهر',
    themeSystem: 'النظام',
    themeDark: 'داكن',
    themeLight: 'فاتح',
    timeFormat: 'نظام الوقت',
    timeFormatSystem: 'النظام',
    timeFormat24: '٢٤ ساعة',
    timeFormat12: '١٢ ساعة',
    architecture: 'بنية النظام',
    developer: 'المطور',
    developerName: 'trs-1342',
    contactIntro: 'للتواصل وإرسال الملاحظات:',
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
    syncErrorTitle: 'خطأ في المزامنة',
    syncErrorBody: 'تعذر جلب الموقع أو أوقات الصلاة.',
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
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
  if (locale.startsWith('en')) return 'en';
  if (locale.startsWith('ar')) return 'ar';

  return 'tr';
}

function getPrayerLabel(key: string, language: Language) {
  const prayers = DICTS[language].prayers as Record<string, string>;
  return prayers[key] ?? key;
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
  const [hourRaw, minuteRaw] = value.split(':').map(Number);

  if (Number.isNaN(hourRaw) || Number.isNaN(minuteRaw)) {
    return formatForLanguage(value, language);
  }

  if (mode === '24') {
    return formatForLanguage(`${String(hourRaw).padStart(2, '0')}:${String(minuteRaw).padStart(2, '0')}`, language);
  }

  const period =
    hourRaw >= 12
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

  const hour12 = hourRaw % 12 || 12;
  const result = `${hour12}:${String(minuteRaw).padStart(2, '0')} ${period}`;

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

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    NotoSerif_400Regular,
    NotoSerif_600SemiBold,
  });

  const [screen, setScreen] = useState<Screen>('home');
  const [language, setLanguage] = useState<Language>(() => detectDeviceLanguage());
  const [deviceScheme, setDeviceScheme] = useState<ThemeMode>(
    Appearance.getColorScheme() === 'light' ? 'light' : 'dark'
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('system');

  const [clock, setClock] = useState(formatClock());
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [prayers, setPrayers] = useState<PrayerTime[]>(fallbackPrayers);
  const [loadingLocation, setLoadingLocation] = useState(false);

  const [muteAll, setMuteAll] = useState(false);
  const [disableVibration, setDisableVibration] = useState(false);
  const [disableAlarm, setDisableAlarm] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [snoozedUntilByKey, setSnoozedUntilByKey] = useState<SnoozeMap>({});

  const [activeAlarm, setActiveAlarm] = useState<PrayerTime | null>(null);

  const alarmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmPlayerRef = useRef<any>(null);
  const hasRequestedLocationRef = useRef(false);

  const themeMode: ThemeMode = themePreference === 'system' ? deviceScheme : themePreference;
  const t = DICTS[language];

  const appColors = themes[themeMode];
  const appShadow = useMemo(() => createShadow(appColors), [appColors]);
  const styles = useMemo(() => createAppStyles(appColors, appShadow), [appColors, appShadow]);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setDeviceScheme(colorScheme === 'light' ? 'light' : 'dark');
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    } as any).catch(console.error);

    alarmPlayerRef.current = createAudioPlayer(require('./assets/alarm.mp3'));

    return () => {
      try {
        alarmPlayerRef.current?.release?.();
      } catch (err) {
        console.error(err);
      }

      alarmPlayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (locationEnabled && !hasRequestedLocationRef.current) {
      hasRequestedLocationRef.current = true;
      requestLocationAndSync(true);
    }
  }, [locationEnabled]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'Namaz Vakitleri',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 700, 350, 700],
        lightColor: appColors.primaryContainer,
        sound: 'default',
      });
    }
  }, [appColors.primaryContainer]);

  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const prayerKey = notification.request.content.data?.prayerKey;

      if (typeof prayerKey !== 'string') return;

      const prayer = prayers.find((item) => item.key === prayerKey);
      if (prayer) handlePrayerTrigger(prayer);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const prayerKey = response.notification.request.content.data?.prayerKey;

      if (typeof prayerKey !== 'string') return;

      const prayer = prayers.find((item) => item.key === prayerKey);
      if (prayer) handlePrayerTrigger(prayer);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [prayers, muteAll, disableVibration, disableAlarm]);

  useEffect(() => {
    return () => stopAlarm();
  }, []);

  const currentPrayer = useMemo(() => getCurrentPrayer(prayers), [prayers, clock]);
  const nextPrayer = useMemo(() => getNextPrayer(prayers), [prayers, clock]);
  const prayerProgress = useMemo(() => getPrayerProgress(prayers), [prayers, clock]);

  function handlePrayerTrigger(prayer: PrayerTime) {
    if (muteAll) return;

    if (prayer.alarm && !disableAlarm) {
      startAlarm(prayer);
      return;
    }

    if (prayer.vibration && !disableVibration) {
      Vibration.vibrate([0, 700, 350, 700]);
    }
  }

  function startAlarm(prayer: PrayerTime) {
    setSnoozedUntilByKey((prev) => {
      const next = { ...prev };
      delete next[prayer.key];
      return next;
    });

    setActiveAlarm(prayer);

    try {
      alarmPlayerRef.current?.seekTo?.(0);
      alarmPlayerRef.current?.play?.();
    } catch (err) {
      console.error(err);
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
    Vibration.cancel();

    try {
      alarmPlayerRef.current?.pause?.();
      alarmPlayerRef.current?.seekTo?.(0);
    } catch (err) {
      console.error(err);
    }

    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }

    setActiveAlarm(null);
  }

  async function snoozeAlarm() {
    if (!activeAlarm) return;

    const prayer = activeAlarm;
    const snoozeUntil = Date.now() + 5 * 60 * 1000;

    setSnoozedUntilByKey((prev) => ({
      ...prev,
      [prayer.key]: snoozeUntil,
    }));

    stopAlarm();

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${getPrayerLabel(prayer.key, language)} ${t.alarmNotificationTitle}`,
        body: t.alarmNotificationBody,
        sound: true,
        data: {
          prayerKey: prayer.key,
          snoozed: true,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(snoozeUntil),
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
    });
  }

  async function requestLocationAndSync(force = false) {
    if (!force && !locationEnabled) return;

    try {
      setLoadingLocation(true);

      const perm = await Location.requestForegroundPermissionsAsync();

      if (perm.status !== 'granted') {
        Alert.alert(t.permissionDeniedTitle, t.permissionDeniedBody);
        return;
      }

      const lastKnown = await Location.getLastKnownPositionAsync();
      const position =
        lastKnown ??
        (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }));

      const nextCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      setCoords(nextCoords);

      const times = await fetchPrayerTimes(nextCoords.latitude, nextCoords.longitude);
      setPrayers(times);

      await scheduleLocalPrayerNotifications(times);
    } catch (err) {
      console.error(err);
      Alert.alert(t.syncErrorTitle, t.syncErrorBody);
    } finally {
      setLoadingLocation(false);
    }
  }

  async function scheduleLocalPrayerNotifications(
    times: PrayerTime[],
    options?: {
      muteAll?: boolean;
      disableVibration?: boolean;
      disableAlarm?: boolean;
      language?: Language;
    }
  ) {
    const { status } = await Notifications.requestPermissionsAsync();

    if (status !== 'granted') return;

    await Notifications.cancelAllScheduledNotificationsAsync();

    const muted = options?.muteAll ?? muteAll;
    const vibrationDisabled = options?.disableVibration ?? disableVibration;
    const alarmDisabled = options?.disableAlarm ?? disableAlarm;
    const activeLanguage = options?.language ?? language;
    const activeDict = DICTS[activeLanguage];

    if (muted) return;

    const now = new Date();

    for (const prayer of times) {
      const shouldNotify = prayer.notification;
      const shouldVibrate = prayer.vibration && !vibrationDisabled;
      const shouldAlarm = prayer.alarm && !alarmDisabled;

      if (!shouldNotify && !shouldVibrate && !shouldAlarm) continue;

      const [hour, minute] = prayer.time.split(':').map(Number);
      const triggerDate = new Date();
      triggerDate.setHours(hour, minute, 0, 0);

      if (triggerDate <= now) {
        triggerDate.setDate(triggerDate.getDate() + 1);
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: shouldAlarm
            ? `${getPrayerLabel(prayer.key, activeLanguage)} ${activeDict.alarmNotificationTitle}`
            : getPrayerLabel(prayer.key, activeLanguage),
          body: shouldAlarm ? activeDict.alarmNotificationBody : activeDict.prayerNotificationBody,
          sound: shouldAlarm || shouldNotify,
          data: {
            prayerKey: prayer.key,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
          ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
        },
      });
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

      scheduleLocalPrayerNotifications(next).catch(console.error);

      return next;
    });
  }

  function handleMuteAll(value: boolean) {
    setMuteAll(value);

    if (value) stopAlarm();

    scheduleLocalPrayerNotifications(prayers, { muteAll: value }).catch(console.error);
  }

  function handleDisableVibration(value: boolean) {
    setDisableVibration(value);

    if (value) {
      Vibration.cancel();
    } else {
      Vibration.vibrate(80);
    }

    scheduleLocalPrayerNotifications(prayers, { disableVibration: value }).catch(console.error);
  }

  function handleDisableAlarm(value: boolean) {
    setDisableAlarm(value);

    if (value) stopAlarm();

    scheduleLocalPrayerNotifications(prayers, { disableAlarm: value }).catch(console.error);
  }

  function handleLocationEnabled(value: boolean) {
    setLocationEnabled(value);

    if (!value) {
      setCoords(null);
      return;
    }

    requestLocationAndSync(true);
  }

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    scheduleLocalPrayerNotifications(prayers, { language: nextLanguage }).catch(console.error);
  }

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View style={styles.loader}>
          <ActivityIndicator color={appColors.primaryContainer} />
        </View>
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
            prayers={prayers}
            currentPrayerKey={currentPrayer?.key}
            nextPrayer={nextPrayer}
            prayerProgress={prayerProgress}
            loadingLocation={loadingLocation}
            locationEnabled={locationEnabled}
            muteAll={muteAll}
            disableVibration={disableVibration}
            disableAlarm={disableAlarm}
            colors={appColors}
            styles={styles}
            shadow={appShadow}
            onRequestLocation={() => requestLocationAndSync(true)}
            onInfo={() => setScreen('about')}
            onTogglePrayerSetting={togglePrayerSetting}
          />
        )}

        {screen === 'about' && (
          <AboutScreen
            t={t}
            language={language}
            deviceScheme={deviceScheme}
            themePreference={themePreference}
            timeFormat={timeFormat}
            muteAll={muteAll}
            disableVibration={disableVibration}
            disableAlarm={disableAlarm}
            locationEnabled={locationEnabled}
            colors={appColors}
            styles={styles}
            shadow={appShadow}
            onBack={() => setScreen('home')}
            onToggleMute={handleMuteAll}
            onToggleVibration={handleDisableVibration}
            onToggleAlarm={handleDisableAlarm}
            onToggleLocation={handleLocationEnabled}
            onLanguageChange={handleLanguageChange}
            onThemePreferenceChange={setThemePreference}
            onTimeFormatChange={setTimeFormat}
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
  prayers: PrayerTime[];
  currentPrayerKey?: string;
  nextPrayer: ReturnType<typeof getNextPrayer>;
  prayerProgress: PrayerProgress;
  loadingLocation: boolean;
  locationEnabled: boolean;
  muteAll: boolean;
  disableVibration: boolean;
  disableAlarm: boolean;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  shadow: ReturnType<typeof createShadow>;
  onRequestLocation: () => void;
  onInfo: () => void;
  onTogglePrayerSetting: (key: string, field: PrayerToggleField) => void;
}) {
  const showLocationCard = !props.coords || !props.locationEnabled;
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
                name={props.locationEnabled ? 'map-marker-outline' : 'map-marker-off-outline'}
                size={22}
                color={props.colors.primary}
              />
            </View>

            <View style={props.styles.locationTextWrap}>
              <Text style={props.styles.locationTitle}>
                {props.locationEnabled ? props.t.locationRequired : props.t.locationOff}
              </Text>
              <Text style={props.styles.locationBody}>
                {props.locationEnabled ? props.t.locationText : props.t.locationOffText}
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
                  : props.locationEnabled
                    ? props.t.requestLocation
                    : props.t.enableLocation}
              </Text>
            </Pressable>
          </Panel>
        )}

        <Panel active style={props.styles.heroCard} styles={props.styles} shadow={props.shadow}>
          <Text style={props.styles.heroLabel}>{upper(props.t.currentTime, props.language)}</Text>

          <Text style={props.styles.clockText}>{clockText}</Text>

          <View style={props.styles.progressTrack}>
            <View style={[props.styles.progressFill, { width: `${props.prayerProgress.progress * 100}%` }]} />
          </View>

          <Text style={props.styles.heroCountdown}>
            {props.t.remaining}: {remainingText}
          </Text>

          <Text style={props.styles.heroPrayerName}>{currentLabel} Vakti</Text>

          <Text style={props.styles.heroNextText}>
            {props.t.nextPrayer}: {nextName} • {nextTime}
          </Text>
        </Panel>

        <Panel style={props.styles.prayerPanel} styles={props.styles} shadow={props.shadow}>
          {props.prayers.map((item, index) => (
            <PrayerRow
              key={item.key}
              item={item}
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
  deviceScheme,
  themePreference,
  timeFormat,
  muteAll,
  disableVibration,
  disableAlarm,
  locationEnabled,
  colors,
  styles,
  shadow,
  onBack,
  onToggleMute,
  onToggleVibration,
  onToggleAlarm,
  onToggleLocation,
  onLanguageChange,
  onThemePreferenceChange,
  onTimeFormatChange,
}: {
  t: typeof DICTS.tr;
  language: Language;
  deviceScheme: ThemeMode;
  themePreference: ThemePreference;
  timeFormat: TimeFormat;
  muteAll: boolean;
  disableVibration: boolean;
  disableAlarm: boolean;
  locationEnabled: boolean;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  shadow: ReturnType<typeof createShadow>;
  onBack: () => void;
  onToggleMute: (value: boolean) => void;
  onToggleVibration: (value: boolean) => void;
  onToggleAlarm: (value: boolean) => void;
  onToggleLocation: (value: boolean) => void;
  onLanguageChange: (language: Language) => void;
  onThemePreferenceChange: (theme: ThemePreference) => void;
  onTimeFormatChange: (format: TimeFormat) => void;
}) {
  const themeOptions = [
    {
      label: `${t.themeSystem} (${deviceScheme === 'dark' ? t.themeDark : t.themeLight})`,
      value: 'system',
    },
    { label: t.themeDark, value: 'dark' },
    { label: t.themeLight, value: 'light' },
  ];

  const timeFormatOptions = [
    { label: t.timeFormatSystem, value: 'system' },
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
        <Panel active style={styles.aboutCard} styles={styles} shadow={shadow}>
          <Text style={styles.cardTitle}>
            <MaterialCommunityIcons name="information-outline" size={14} color={colors.primary} />{' '}
            {upper(t.aboutApp, language)}
          </Text>
          <Text style={styles.bodyText}>{t.aboutText}</Text>
        </Panel>

        <Panel style={styles.aboutCard} styles={styles} shadow={shadow}>
          <Text style={styles.cardTitle}>
            <MaterialCommunityIcons name="cog-outline" size={14} color={colors.primary} />{' '}
            {upper(t.settings, language)}
          </Text>

          <Text style={styles.sectionTitle}>{t.systemSettings}</Text>

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

          <SettingRow
            icon="map-marker-off-outline"
            label={t.disableLocation}
            value={!locationEnabled}
            colors={colors}
            styles={styles}
            onValueChange={(value) => onToggleLocation(!value)}
          />

          <Divider styles={styles} />

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
        </Panel>

        <Panel style={styles.aboutCard} styles={styles} shadow={shadow}>
          <Text style={styles.cardTitle}>
            <MaterialCommunityIcons name="server" size={14} color={colors.primary} />{' '}
            {upper(t.architecture, language)}
          </Text>

          {['React Native', 'Expo', 'Geolocation API', 'Local Notifications', 'Theme / Language Layer'].map((item) => (
            <View key={item} style={styles.techRow}>
              <MaterialCommunityIcons name="check" size={21} color={colors.primary} />
              <Text style={styles.bodyText}>{item}</Text>
            </View>
          ))}
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
            <LinkButton
              icon="email-outline"
              label="hattab1342@gmail.com"
              url="mailto:hattab1342@gmail.com"
              colors={colors}
              styles={styles}
            />
            <LinkButton
              icon="web"
              label="hattab.vercel.app"
              url="https://hattab.vercel.app"
              colors={colors}
              styles={styles}
            />
            <LinkButton
              icon="github"
              label="github / trs-1342"
              url="https://github.com/trs-1342"
              colors={colors}
              styles={styles}
            />
            <LinkButton
              icon="linkedin"
              label="linkedin / halilhattabh"
              url="https://linkedin.com/in/halilhattabh"
              colors={colors}
              styles={styles}
            />
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

        <Text style={styles.alarmTitle}>{label} {t.alarmNotificationTitle}</Text>
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
  return (
    <View style={[styles.panel, active && styles.panelActive, style]}>
      {children}
    </View>
  );
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

function Scanlines({ styles }: { styles: ReturnType<typeof createAppStyles> }) {
  return (
    <View pointerEvents="none" style={styles.scanlineWrap}>
      {Array.from({ length: 260 }).map((_, i) => (
        <View key={i} style={[styles.scanline, { top: i * 4 }]} />
      ))}
    </View>
  );
}