import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppColors, createShadow } from '../theme';
import { createAppStyles } from '../styles/appStyles';
import { CachedPrayerDay, PrayerTime } from '../services/prayerTimes';
import { getLocalDateKey } from '../utils/time';
import { DayTracking, PrayerStatus, STATUS_COLOR } from './types';

type TrackingView = 'daily' | 'weekly' | 'monthly';
type Language = 'tr' | 'en' | 'ar';

type TrackingDict = {
  trackingTitle: string;
  daily: string;
  weekly: string;
  monthly: string;
  onTime: string;
  onTimeShort: string;
  late: string;
  lateShort: string;
  missed: string;
  missedShort: string;
  clearStatus: string;
  confirmTitle: string;
  confirmBody: (prayer: string, status: string) => string;
  confirmYes: string;
  confirmNo: string;
  today: string;
  yesterday: string;
  weekdays: string[];
  monthNames: string[];
  infoTitle: string;
  infoSteps: string[];
  infoClose: string;
  hint: string;
};

export const TRACKING_DICTS: Record<Language, TrackingDict> = {
  tr: {
    trackingTitle: 'Namaz Takibi',
    daily: 'Günlük',
    weekly: 'Haftalık',
    monthly: 'Aylık',
    onTime: 'Vaktinde kıldım',
    onTimeShort: 'Vaktinde',
    late: 'Geç kıldım',
    lateShort: 'Geç',
    missed: 'Kılmadım',
    missedShort: 'Kılmadım',
    clearStatus: 'Temizle',
    confirmTitle: 'Emin misin?',
    confirmBody: (prayer, status) => `${prayer} namazını "${status}" olarak güncelliyorsun.`,
    confirmYes: 'Evet vallaha eminim',
    confirmNo: 'Hayır',
    today: 'Bugün',
    yesterday: 'Dün',
    weekdays: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'],
    monthNames: ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'],
    infoTitle: 'Nasıl Kullanılır?',
    infoSteps: [
      'Vakti geçmiş bir namazın satırına uzun bas, durum menüsü açılır.',
      'Üç seçenekten birini seç: Vaktinde · Geç · Kılmadım.',
      'Dün için değişiklik yaparsan onay istenir.',
      'Haftalık ve aylık görünümlerde her gün vakitlerine göre orantılı renkli şeritler gösterir.',
      'Yatsıdan sonra hatırlatma bildirimi gelirse eksik girişleri tamamlamak için kullan.',
    ],
    infoClose: 'Anladım',
    hint: 'Uzun bas → durum seç',
  },
  en: {
    trackingTitle: 'Prayer Tracking',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    onTime: 'Prayed on time',
    onTimeShort: 'On time',
    late: 'Prayed late',
    lateShort: 'Late',
    missed: 'Missed',
    missedShort: 'Missed',
    clearStatus: 'Clear',
    confirmTitle: 'Are you sure?',
    confirmBody: (prayer, status) => `You are updating ${prayer} as "${status}".`,
    confirmYes: 'Yes, I am sure',
    confirmNo: 'No',
    today: 'Today',
    yesterday: 'Yesterday',
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    monthNames: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    infoTitle: 'How to Use',
    infoSteps: [
      'Long press a past prayer row to open the status menu.',
      'Choose one: On time · Late · Missed.',
      "Editing yesterday's prayers requires confirmation.",
      'Weekly and monthly views show proportional color strips per prayer slot.',
      'Use the post-Isha reminder to fill in any missing entries.',
    ],
    infoClose: 'Got it',
    hint: 'Long press → set status',
  },
  ar: {
    trackingTitle: 'تتبع الصلاة',
    daily: 'يومي',
    weekly: 'أسبوعي',
    monthly: 'شهري',
    onTime: 'صليت في وقتها',
    onTimeShort: 'في الوقت',
    late: 'صليت متأخراً',
    lateShort: 'متأخر',
    missed: 'لم أصلِّ',
    missedShort: 'فائتة',
    clearStatus: 'مسح',
    confirmTitle: 'هل أنت متأكد؟',
    confirmBody: (prayer, status) => `ستحدّث ${prayer} إلى "${status}".`,
    confirmYes: 'نعم، أنا متأكد',
    confirmNo: 'لا',
    today: 'اليوم',
    yesterday: 'أمس',
    weekdays: ['الإث', 'الثل', 'الأر', 'الخم', 'الجم', 'السب', 'الأح'],
    monthNames: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
    infoTitle: 'كيفية الاستخدام',
    infoSteps: [
      'اضغط مطولاً على صلاة منتهية لفتح قائمة الحالة.',
      'اختر: في الوقت · متأخر · فائتة.',
      'تعديل صلوات أمس يستلزم تأكيداً.',
      'تعرض الأسبوعية والشهرية أشرطة ملونة بنسبة كل وقت صلاة.',
      'استخدم تذكير ما بعد العشاء لتسجيل ما فاتك.',
    ],
    infoClose: 'فهمت',
    hint: 'اضغط مطولاً لتغيير الحالة',
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function toMinutes(time: string) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function isPrayerPast(prayerTime: string, date: string): boolean {
  const today = getLocalDateKey();
  if (date < today) return true;
  if (date > today) return false;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= toMinutes(prayerTime);
}

function isYesterday(date: string): boolean {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return date === getLocalDateKey(y);
}

function isToday(date: string): boolean {
  return date === getLocalDateKey();
}

function getPrayerSlotFlex(prayers: PrayerTime[]): number[] {
  const minutes = prayers.map((p) => toMinutes(p.time));
  return minutes.map((min, i) => {
    const next = i < minutes.length - 1 ? minutes[i + 1] : minutes[0] + 1440;
    return Math.max(1, next - min);
  });
}

function getStatusColor(status: PrayerStatus, empty: string): string {
  if (status === 'onTime') return STATUS_COLOR.onTime;
  if (status === 'late') return STATUS_COLOR.late;
  if (status === 'missed') return STATUS_COLOR.missed;
  return empty;
}

function getStatusIcon(status: PrayerStatus): keyof typeof MaterialCommunityIcons.glyphMap {
  if (status === 'onTime') return 'check-circle-outline';
  if (status === 'late') return 'clock-alert-outline';
  if (status === 'missed') return 'close-circle-outline';
  return 'circle-edit-outline';
}

function getPrayerLabel(key: string, language: Language): string {
  const map: Record<string, Record<Language, string>> = {
    fajr:    { tr: 'İmsak',  en: 'Fajr',    ar: 'الفجر'  },
    dhuhr:   { tr: 'Öğle',   en: 'Dhuhr',   ar: 'الظهر'  },
    asr:     { tr: 'İkindi', en: 'Asr',      ar: 'العصر'  },
    maghrib: { tr: 'Akşam',  en: 'Maghrib',  ar: 'المغرب' },
    isha:    { tr: 'Yatsı',  en: 'Isha',     ar: 'العشاء' },
  };
  return map[key]?.[language] ?? key;
}

function formatDateDisplay(date: string, language: Language, td: TrackingDict): string {
  if (isToday(date)) return td.today;
  if (isYesterday(date)) return td.yesterday;
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const wdIndex = dow === 0 ? 6 : dow - 1;
  return `${td.weekdays[wdIndex]}, ${d} ${td.monthNames[m - 1]}`;
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return getLocalDateKey(d);
}

function getWeekStart(date: string): string {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return getLocalDateKey(d);
}

// ─── TrackingScreen ───────────────────────────────────────────────────────────

export function TrackingScreen({
  language,
  prayers,
  cachedPrayerDays,
  trackingDays,
  colors,
  styles,
  shadow,
  onBack,
  onUpdateStatus,
}: {
  language: Language;
  prayers: PrayerTime[];
  cachedPrayerDays: CachedPrayerDay[];
  trackingDays: DayTracking[];
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  shadow: ReturnType<typeof createShadow>;
  onBack: () => void;
  onUpdateStatus: (date: string, key: string, status: PrayerStatus) => void;
}) {
  const td = TRACKING_DICTS[language];
  const today = useMemo(() => getLocalDateKey(), []);

  const [view, setView] = useState<TrackingView>('daily');
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);

  type PendingAction = { date: string; key: string; status: PrayerStatus; prayerLabel: string; statusLabel: string };
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  // Bottom sheet animation
  const [actionTarget, setActionTarget] = useState<{ date: string; key: string } | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const sheetAnim = useRef(new Animated.Value(400)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (actionTarget) {
      setSheetVisible(true);
      Animated.parallel([
        Animated.spring(sheetAnim, { toValue: 0, tension: 60, friction: 11, useNativeDriver: true }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [actionTarget]);

  function dismissSheet() {
    Animated.parallel([
      Animated.timing(sheetAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setSheetVisible(false);
      setActionTarget(null);
      sheetAnim.setValue(400);
      backdropAnim.setValue(0);
    });
  }

  const getDayStatuses = useCallback(
    (date: string): Record<string, PrayerStatus> =>
      trackingDays.find((d) => d.date === date)?.statuses ?? {},
    [trackingDays]
  );

  const getPrayersForDate = useCallback(
    (date: string): PrayerTime[] => {
      const all = cachedPrayerDays.find((d) => d.date === date)?.prayers ?? prayers;
      return all.filter((p) => p.key !== 'sunrise');
    },
    [cachedPrayerDays, prayers]
  );

  function requestUpdate(date: string, key: string, status: PrayerStatus) {
    const prayerLabel = getPrayerLabel(key, language);
    const statusLabel =
      status === 'onTime' ? td.onTime
      : status === 'late'   ? td.late
      : status === 'missed' ? td.missed
      : td.clearStatus;

    dismissSheet();

    if (isYesterday(date)) {
      setTimeout(() => setPending({ date, key, status, prayerLabel, statusLabel }), 220);
    } else {
      onUpdateStatus(date, key, status);
    }
  }

  const statusOptions: { status: PrayerStatus; label: string; color: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
    { status: 'onTime', label: td.onTime, color: STATUS_COLOR.onTime,        icon: 'check-circle-outline'  },
    { status: 'late',   label: td.late,   color: STATUS_COLOR.late,           icon: 'clock-alert-outline'   },
    { status: 'missed', label: td.missed, color: STATUS_COLOR.missed,         icon: 'close-circle-outline'  },
    { status: null,     label: td.clearStatus, color: colors.onSurfaceVariant, icon: 'trash-can-outline'    },
  ];

  const currentStatuses = actionTarget ? getDayStatuses(actionTarget.date) : {};
  const currentActionStatus = actionTarget ? (currentStatuses[actionTarget.key] ?? null) : null;

  return (
    <View style={styles.screen}>
      {/* TopBar */}
      <View style={styles.topBar}>
        <Pressable onPress={onBack} style={styles.topIcon}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.topTitle}>{td.trackingTitle}</Text>
        <Pressable onPress={() => setShowInfo(true)} style={styles.topIcon}>
          <MaterialCommunityIcons name="information-outline" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* Tab bar */}
      <View style={[tS.tabRow, { borderBottomColor: colors.outlineVariant + '44' }]}>
        {(['daily', 'weekly', 'monthly'] as TrackingView[]).map((v) => {
          const active = view === v;
          return (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              style={({ pressed }) => [tS.tab, pressed && { opacity: 0.7 }]}
            >
              <Text style={[tS.tabText, { color: active ? colors.primary : colors.onSurfaceVariant }]}>
                {v === 'daily' ? td.daily : v === 'weekly' ? td.weekly : td.monthly}
              </Text>
              <View style={[tS.tabUnderline, { backgroundColor: active ? colors.primary : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>

      {view === 'daily' && (
        <DailyView
          date={selectedDate}
          today={today}
          td={td}
          language={language}
          colors={colors}
          styles={styles}
          prayers={getPrayersForDate(selectedDate)}
          statuses={getDayStatuses(selectedDate)}
          onDateChange={(d) => {
            if (d <= today && d >= offsetDate(today, -1)) setSelectedDate(d);
          }}
          onLongPress={(date, key) => setActionTarget({ date, key })}
          formatDate={(d) => formatDateDisplay(d, language, td)}
        />
      )}

      {view === 'weekly' && (
        <WeeklyView
          weekOffset={weekOffset}
          today={today}
          td={td}
          colors={colors}
          styles={styles}
          getDayStatuses={getDayStatuses}
          getPrayersForDate={getPrayersForDate}
          onWeekOffsetChange={setWeekOffset}
          onSelectDay={(d) => { setSelectedDate(d); setView('daily'); }}
        />
      )}

      {view === 'monthly' && (
        <MonthlyView
          monthOffset={monthOffset}
          today={today}
          td={td}
          colors={colors}
          styles={styles}
          getDayStatuses={getDayStatuses}
          getPrayersForDate={getPrayersForDate}
          onMonthOffsetChange={setMonthOffset}
          onSelectDay={(d) => { setSelectedDate(d); setView('daily'); }}
        />
      )}

      {/* ── Action sheet (bottom sheet, animated) ── */}
      <Modal visible={sheetVisible} transparent animationType="none" onRequestClose={dismissSheet}>
        <View style={{ flex: 1 }}>
          {/* Backdrop */}
          <Animated.View
            style={[tS.backdrop, { opacity: backdropAnim }]}
          >
            <Pressable style={{ flex: 1 }} onPress={dismissSheet} />
          </Animated.View>

          {/* Sheet */}
          <Animated.View
            style={[
              tS.actionSheet,
              { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '88' },
              { transform: [{ translateY: sheetAnim }] },
            ]}
          >
            {/* Handle */}
            <View style={[tS.sheetHandle, { backgroundColor: colors.outlineVariant }]} />

            {actionTarget && statusOptions.map(({ status, label, color, icon }) => {
              const isActive = status === currentActionStatus;
              return (
                <Pressable
                  key={String(status)}
                  style={({ pressed }) => [
                    tS.actionOption,
                    pressed && { backgroundColor: colors.surfaceContainerHigh },
                    isActive && { backgroundColor: color + '18' },
                  ]}
                  onPress={() => requestUpdate(actionTarget.date, actionTarget.key, status)}
                >
                  <MaterialCommunityIcons name={icon} size={22} color={color} />
                  <Text style={[tS.actionLabel, { color: isActive ? color : colors.onSurface }]}>{label}</Text>
                  {isActive && (
                    <MaterialCommunityIcons name="check" size={18} color={color} style={{ marginLeft: 'auto' }} />
                  )}
                </Pressable>
              );
            })}
          </Animated.View>
        </View>
      </Modal>

      {/* ── Confirm modal (yesterday edits) ── */}
      <Modal visible={!!pending} transparent animationType="fade" onRequestClose={() => setPending(null)}>
        <View style={tS.centeredOverlay}>
          <View style={[tS.confirmBox, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.primaryContainer }]}>
            <Text style={[tS.confirmTitle, { color: colors.primary }]}>{td.confirmTitle}</Text>
            {pending && (
              <Text style={[tS.confirmBody, { color: colors.onSurface }]}>
                {td.confirmBody(pending.prayerLabel, pending.statusLabel)}
              </Text>
            )}
            <View style={tS.confirmButtons}>
              <Pressable
                style={({ pressed }) => [
                  tS.confirmBtn,
                  { borderColor: colors.primaryContainer, backgroundColor: pressed ? colors.primaryContainer + 'cc' : colors.primaryContainer },
                ]}
                onPress={() => { if (pending) onUpdateStatus(pending.date, pending.key, pending.status); setPending(null); }}
              >
                <Text style={[tS.confirmBtnText, { color: colors.onPrimary }]}>{td.confirmYes}</Text>
              </Pressable>
              <Pressable
                style={[tS.confirmBtn, { borderColor: colors.outlineVariant, backgroundColor: 'transparent' }]}
                onPress={() => setPending(null)}
              >
                <Text style={[tS.confirmBtnText, { color: colors.onSurface }]}>{td.confirmNo}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Info modal ── */}
      <Modal visible={showInfo} transparent animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={tS.centeredOverlay}>
          <View style={[tS.infoBox, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '88' }]}>
            <Text style={[tS.infoTitle, { color: colors.primary }]}>{td.infoTitle}</Text>

            {/* Color legend */}
            <View style={tS.legendRow}>
              {([['onTime', td.onTimeShort], ['late', td.lateShort], ['missed', td.missedShort]] as [PrayerStatus & string, string][]).map(([s, label]) => (
                <View key={s} style={tS.legendItem}>
                  <View style={[tS.legendDot, { backgroundColor: STATUS_COLOR[s] }]} />
                  <Text style={[tS.legendText, { color: colors.onSurfaceVariant }]}>{label}</Text>
                </View>
              ))}
            </View>

            {td.infoSteps.map((step, i) => (
              <View key={i} style={tS.infoRow}>
                <View style={[tS.infoIndex, { backgroundColor: colors.primaryContainer }]}>
                  <Text style={[tS.infoIndexText, { color: colors.onPrimary }]}>{i + 1}</Text>
                </View>
                <Text style={[tS.infoStep, { color: colors.onSurface }]}>{step}</Text>
              </View>
            ))}

            <Pressable
              style={({ pressed }) => [
                tS.confirmBtn,
                { borderColor: colors.primaryContainer, backgroundColor: pressed ? colors.primaryContainer + 'cc' : colors.primaryContainer, marginTop: 4 },
              ]}
              onPress={() => setShowInfo(false)}
            >
              <Text style={[tS.confirmBtnText, { color: colors.onPrimary }]}>{td.infoClose}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── DailyView ────────────────────────────────────────────────────────────────

function DailyView({
  date,
  today,
  td,
  language,
  colors,
  styles,
  prayers,
  statuses,
  onDateChange,
  onLongPress,
  formatDate,
}: {
  date: string;
  today: string;
  td: TrackingDict;
  language: Language;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  prayers: PrayerTime[];
  statuses: Record<string, PrayerStatus>;
  onDateChange: (d: string) => void;
  onLongPress: (date: string, key: string) => void;
  formatDate: (d: string) => string;
}) {
  const yesterday = offsetDate(today, -1);
  const canGoBack = date === today;
  const canGoForward = date === yesterday;

  // Per-row scale animation on status change
  const rowAnims = useRef<Record<string, Animated.Value>>({});
  function getRowAnim(key: string) {
    if (!rowAnims.current[key]) rowAnims.current[key] = new Animated.Value(1);
    return rowAnims.current[key];
  }
  const prevStatuses = useRef<Record<string, PrayerStatus | null>>({});
  useEffect(() => {
    prayers.forEach((p) => {
      const prev = prevStatuses.current[p.key];
      const curr = statuses[p.key] ?? null;
      if (prev !== undefined && prev !== curr) {
        const anim = getRowAnim(p.key);
        Animated.sequence([
          Animated.timing(anim, { toValue: 1.03, duration: 90, useNativeDriver: true }),
          Animated.spring(anim,  { toValue: 1,    tension: 200, friction: 10, useNativeDriver: true }),
        ]).start();
      }
    });
    prevStatuses.current = Object.fromEntries(prayers.map((p) => [p.key, statuses[p.key] ?? null]));
  }, [statuses]);

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 14 }]} showsVerticalScrollIndicator={false}>
      {/* Date nav */}
      <View style={tS.dateNav}>
        <Pressable
          onPress={() => canGoBack && onDateChange(yesterday)}
          style={({ pressed }) => [tS.navArrow, (!canGoBack || pressed) && { opacity: 0.25 }]}
          disabled={!canGoBack}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.primary} />
        </Pressable>
        <Text style={[tS.dateLabel, { color: colors.onSurface }]}>{formatDate(date)}</Text>
        <Pressable
          onPress={() => canGoForward && onDateChange(today)}
          style={({ pressed }) => [tS.navArrow, (!canGoForward || pressed) && { opacity: 0.25 }]}
          disabled={!canGoForward}
        >
          <MaterialCommunityIcons name="chevron-right" size={28} color={colors.primary} />
        </Pressable>
      </View>

      {/* Prayer rows */}
      <View style={[styles.panel, { overflow: 'hidden' }]}>
        {prayers.map((prayer, index) => {
          const past = isPrayerPast(prayer.time, date);
          const status = statuses[prayer.key] ?? null;
          const statusColor = getStatusColor(status, colors.outlineVariant);
          const label = getPrayerLabel(prayer.key, language);
          const rowAnim = getRowAnim(prayer.key);

          return (
            <Animated.View key={prayer.key} style={{ transform: [{ scale: rowAnim }] }}>
              <TouchableOpacity
                activeOpacity={past ? 0.65 : 1}
                onLongPress={past ? () => onLongPress(date, prayer.key) : undefined}
                delayLongPress={280}
                style={[
                  tS.dailyRow,
                  index < prayers.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + '28' },
                  !past && { opacity: 0.32 },
                  status && { backgroundColor: statusColor + '09' },
                ]}
              >
                {/* Status accent bar */}
                <View style={[tS.accentBar, { backgroundColor: past ? statusColor : 'transparent' }]} />

                <View style={tS.dailyLeft}>
                  <View>
                    <Text style={[tS.dailyName, { color: past ? colors.onSurface : colors.onSurfaceVariant }]}>
                      {label}
                    </Text>
                    <Text style={[tS.dailyTime, { color: colors.onSurfaceVariant }]}>{prayer.time}</Text>
                  </View>
                </View>

                <View style={tS.dailyRight}>
                  {past ? (
                    status ? (
                      <View style={[tS.statusBadge, { backgroundColor: statusColor + '22', borderColor: statusColor + '55' }]}>
                        <MaterialCommunityIcons name={getStatusIcon(status)} size={13} color={statusColor} />
                        <Text style={[tS.statusBadgeText, { color: statusColor }]}>
                          {status === 'onTime' ? td.onTimeShort : status === 'late' ? td.lateShort : td.missedShort}
                        </Text>
                      </View>
                    ) : (
                      <View style={[tS.statusBadge, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + '55' }]}>
                        <MaterialCommunityIcons name="gesture-tap-hold" size={13} color={colors.onSurfaceVariant} />
                      </View>
                    )
                  ) : (
                    <MaterialCommunityIcons name="clock-outline" size={18} color={colors.outlineVariant} />
                  )}
                </View>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>

      <Text style={[tS.hint, { color: colors.onSurfaceVariant }]}>{td.hint}</Text>
    </ScrollView>
  );
}

// ─── WeeklyView ───────────────────────────────────────────────────────────────

function WeeklyView({
  weekOffset,
  today,
  td,
  colors,
  styles,
  getDayStatuses,
  getPrayersForDate,
  onWeekOffsetChange,
  onSelectDay,
}: {
  weekOffset: number;
  today: string;
  td: TrackingDict;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  getDayStatuses: (date: string) => Record<string, PrayerStatus>;
  getPrayersForDate: (date: string) => PrayerTime[];
  onWeekOffsetChange: (n: number) => void;
  onSelectDay: (date: string) => void;
}) {
  const weekStart = useMemo(
    () => offsetDate(getWeekStart(today), weekOffset * 7),
    [weekOffset, today]
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => offsetDate(weekStart, i)),
    [weekStart]
  );

  const weekLabel = useMemo(() => {
    const [, sm, sd] = days[0].split('-').map(Number);
    const [, em, ed] = days[6].split('-').map(Number);
    return `${sd} ${td.monthNames[sm - 1]} – ${ed} ${td.monthNames[em - 1]}`;
  }, [days, td]);

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 14 }]} showsVerticalScrollIndicator={false}>
      <View style={tS.dateNav}>
        <Pressable
          onPress={() => onWeekOffsetChange(weekOffset - 1)}
          style={({ pressed }) => [tS.navArrow, pressed && { opacity: 0.5 }]}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.primary} />
        </Pressable>
        <Text style={[tS.dateLabel, { color: colors.onSurface }]}>{weekLabel}</Text>
        <Pressable
          onPress={() => weekOffset < 0 && onWeekOffsetChange(weekOffset + 1)}
          style={({ pressed }) => [tS.navArrow, (weekOffset >= 0 || pressed) && { opacity: 0.25 }]}
          disabled={weekOffset >= 0}
        >
          <MaterialCommunityIcons name="chevron-right" size={28} color={colors.primary} />
        </Pressable>
      </View>

      <View style={[styles.panel, { overflow: 'hidden' }]}>
        {days.map((date, i) => {
          const [, m, d] = date.split('-').map(Number);
          const dayPrayers = getPrayersForDate(date);
          const statuses = getDayStatuses(date);
          const flexValues = getPrayerSlotFlex(dayPrayers);
          const isFuture = date > today;
          const isCurrentDay = date === today;

          return (
            <TouchableOpacity
              key={date}
              activeOpacity={isFuture ? 1 : 0.7}
              onPress={() => !isFuture && onSelectDay(date)}
              style={[
                tS.weekRow,
                i < 6 && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + '28' },
                isCurrentDay && { backgroundColor: colors.panelActive },
              ]}
            >
              {/* Day label */}
              <View style={tS.weekDayLabel}>
                <Text style={[tS.weekDayName, { color: isCurrentDay ? colors.primary : colors.onSurfaceVariant }]}>
                  {td.weekdays[i]}
                </Text>
                <Text style={[tS.weekDayNum, { color: isCurrentDay ? colors.primary : colors.onSurface }]}>
                  {d}/{m}
                </Text>
              </View>

              {/* Proportional bar */}
              <View style={[tS.weekBar, isFuture && { opacity: 0.28 }]}>
                {dayPrayers.map((prayer, pi) => {
                  const status = statuses[prayer.key] ?? null;
                  const past = isPrayerPast(prayer.time, date);
                  const bgColor = past
                    ? getStatusColor(status, colors.surfaceContainerHighest)
                    : colors.surfaceContainer;
                  return (
                    <View
                      key={prayer.key}
                      style={[
                        tS.weekSegment,
                        { flex: flexValues[pi], backgroundColor: bgColor },
                        pi > 0 && { marginLeft: 2 },
                      ]}
                    />
                  );
                })}
              </View>

              {!isFuture && (
                <MaterialCommunityIcons name="chevron-right" size={16} color={colors.outlineVariant} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─── MonthlyView ──────────────────────────────────────────────────────────────

function MonthlyView({
  monthOffset,
  today,
  td,
  colors,
  styles,
  getDayStatuses,
  getPrayersForDate,
  onMonthOffsetChange,
  onSelectDay,
}: {
  monthOffset: number;
  today: string;
  td: TrackingDict;
  colors: AppColors;
  styles: ReturnType<typeof createAppStyles>;
  getDayStatuses: (date: string) => Record<string, PrayerStatus>;
  getPrayersForDate: (date: string) => PrayerTime[];
  onMonthOffsetChange: (n: number) => void;
  onSelectDay: (date: string) => void;
}) {
  const { year, month } = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    return { year: base.getFullYear(), month: base.getMonth() };
  }, [monthOffset]);

  const { cells, weeks } = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow = new Date(year, month, 1).getDay();
    const offset = firstDow === 0 ? 6 : firstDow - 1;
    const c: (number | null)[] = [
      ...Array(offset).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (c.length % 7 !== 0) c.push(null);
    const w: (number | null)[][] = [];
    for (let i = 0; i < c.length; i += 7) w.push(c.slice(i, i + 7));
    return { cells: c, weeks: w };
  }, [year, month]);

  const monthLabel = `${td.monthNames[month]} ${year}`;

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: 14 }]} showsVerticalScrollIndicator={false}>
      <View style={tS.dateNav}>
        <Pressable
          onPress={() => onMonthOffsetChange(monthOffset - 1)}
          style={({ pressed }) => [tS.navArrow, pressed && { opacity: 0.5 }]}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.primary} />
        </Pressable>
        <Text style={[tS.dateLabel, { color: colors.onSurface }]}>{monthLabel}</Text>
        <Pressable
          onPress={() => monthOffset < 0 && onMonthOffsetChange(monthOffset + 1)}
          style={({ pressed }) => [tS.navArrow, (monthOffset >= 0 || pressed) && { opacity: 0.25 }]}
          disabled={monthOffset >= 0}
        >
          <MaterialCommunityIcons name="chevron-right" size={28} color={colors.primary} />
        </Pressable>
      </View>

      <View style={[styles.panel, { overflow: 'hidden' }]}>
        {/* Weekday header */}
        <View style={[tS.calHeader, { borderBottomColor: colors.outlineVariant + '44' }]}>
          {td.weekdays.map((wd) => (
            <View key={wd} style={tS.calHeaderCell}>
              <Text style={[tS.calHeaderText, { color: colors.onSurfaceVariant }]}>{wd}</Text>
            </View>
          ))}
        </View>

        {weeks.map((week, wi) => (
          <View key={wi} style={[tS.calWeekRow, wi > 0 && { borderTopWidth: 1, borderTopColor: colors.outlineVariant + '1a' }]}>
            {week.map((day, di) => {
              if (!day) return <View key={di} style={tS.calCell} />;

              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isCurrentDay = dateStr === today;
              const isFuture = dateStr > today;
              const dayPrayers = getPrayersForDate(dateStr);
              const statuses = getDayStatuses(dateStr);
              const flexValues = getPrayerSlotFlex(dayPrayers);

              return (
                <Pressable
                  key={di}
                  onPress={() => !isFuture && onSelectDay(dateStr)}
                  style={({ pressed }) => [
                    tS.calCell,
                    isCurrentDay && { backgroundColor: colors.panelActive },
                    di < 6 && { borderRightWidth: 1, borderRightColor: colors.outlineVariant + '1a' },
                    pressed && !isFuture && { opacity: 0.7 },
                    isFuture && { opacity: 0.3 },
                  ]}
                >
                  {isCurrentDay ? (
                    <View style={[tS.calDayDot, { backgroundColor: colors.primaryContainer }]}>
                      <Text style={[tS.calDayNum, { color: colors.onPrimary }]}>{day}</Text>
                    </View>
                  ) : (
                    <Text style={[tS.calDayNum, { color: colors.onSurface }]}>{day}</Text>
                  )}

                  <View style={tS.calStrips}>
                    {dayPrayers.map((prayer, pi) => {
                      const status = statuses[prayer.key] ?? null;
                      const past = isPrayerPast(prayer.time, dateStr);
                      const bgColor = isFuture || !past
                        ? colors.surfaceContainerHigh
                        : getStatusColor(status, colors.surfaceContainerHighest);
                      return (
                        <View
                          key={prayer.key}
                          style={[tS.calStrip, { flex: flexValues[pi], backgroundColor: bgColor }]}
                        />
                      );
                    })}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const tS = {
  // tabs
  tabRow: {
    flexDirection: 'row' as const,
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center' as const,
    paddingVertical: 11,
    gap: 0,
  },
  tabText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.1,
  },
  tabUnderline: {
    height: 2,
    width: 28,
    borderRadius: 1,
    marginTop: 6,
  },

  // nav
  dateNav: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 6,
  },
  navArrow: {
    width: 42,
    height: 42,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  dateLabel: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.4,
    textAlign: 'center' as const,
    flex: 1,
  },

  // daily
  dailyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 16,
    paddingRight: 18,
    minHeight: 64,
  },
  accentBar: {
    width: 3,
    height: 42,
    borderRadius: 2,
    marginRight: 16,
    marginLeft: 4,
  },
  dailyLeft: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  dailyName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    letterSpacing: 0.9,
  },
  dailyTime: {
    fontFamily: 'Inter_300Light',
    fontSize: 22,
    letterSpacing: -0.5,
    marginTop: 1,
  },
  dailyRight: {
    alignItems: 'flex-end' as const,
  },
  statusBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    textAlign: 'center' as const,
    opacity: 0.55,
    marginTop: 6,
  },

  // weekly
  weekRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
    minHeight: 56,
  },
  weekDayLabel: {
    width: 40,
    alignItems: 'center' as const,
  },
  weekDayName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
  },
  weekDayNum: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  weekBar: {
    flex: 1,
    height: 30,
    flexDirection: 'row' as const,
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  weekSegment: {
    height: '100%' as const,
    borderRadius: 1,
  },

  // monthly
  calHeader: {
    flexDirection: 'row' as const,
    borderBottomWidth: 1,
  },
  calHeaderCell: {
    flex: 1,
    alignItems: 'center' as const,
    paddingVertical: 9,
  },
  calHeaderText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.6,
  },
  calWeekRow: {
    flexDirection: 'row' as const,
  },
  calCell: {
    flex: 1,
    minHeight: 58,
    paddingTop: 7,
    paddingHorizontal: 2,
    alignItems: 'center' as const,
    overflow: 'hidden' as const,
    gap: 5,
  },
  calDayDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  calDayNum: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  calStrips: {
    flexDirection: 'row' as const,
    width: '100%' as const,
    height: 10,
    borderRadius: 2,
    overflow: 'hidden' as const,
    gap: 1,
  },
  calStrip: {
    height: '100%' as const,
  },

  // modals
  backdrop: {
    ...{ position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  centeredOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  actionSheet: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingBottom: 32,
    paddingTop: 6,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center' as const,
    marginBottom: 8,
    marginTop: 4,
    opacity: 0.5,
  },
  actionOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 15,
  },
  actionLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    flex: 1,
  },
  confirmBox: {
    width: '88%' as const,
    borderRadius: 10,
    borderWidth: 1,
    padding: 24,
    gap: 12,
    alignSelf: 'center' as const,
  },
  confirmTitle: {
    fontFamily: 'NotoSerif_600SemiBold',
    fontSize: 18,
    letterSpacing: 0.3,
  },
  confirmBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 22,
  },
  confirmButtons: {
    gap: 10,
    marginTop: 6,
  },
  confirmBtn: {
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 13,
    alignItems: 'center' as const,
  },
  confirmBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    letterSpacing: 0.6,
  },
  infoBox: {
    width: '90%' as const,
    borderRadius: 10,
    borderWidth: 1,
    padding: 24,
    gap: 14,
    alignSelf: 'center' as const,
  },
  infoTitle: {
    fontFamily: 'NotoSerif_600SemiBold',
    fontSize: 18,
    letterSpacing: 0.3,
  },
  legendRow: {
    flexDirection: 'row' as const,
    gap: 16,
    marginBottom: 2,
  },
  legendItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  infoRow: {
    flexDirection: 'row' as const,
    gap: 12,
    alignItems: 'flex-start' as const,
  },
  infoIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 1,
    flexShrink: 0,
  },
  infoIndexText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  infoStep: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 22,
  },
};
