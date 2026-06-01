export type PrayerStatus = 'onTime' | 'late' | 'missed' | null;

export type DayTracking = {
  date: string; // YYYY-MM-DD
  statuses: Record<string, PrayerStatus>;
};

export type TrackingNotifMode = 'always' | 'ifIncomplete';

export const STATUS_COLOR = {
  onTime: '#5DAB76',
  late: '#D4A843',
  missed: '#C85555',
} as const;
