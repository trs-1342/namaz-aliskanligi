import { Platform, StyleSheet } from 'react-native';
import { AppColors, createShadow, font } from '../theme';

export function createAppStyles(
  colors: AppColors,
  shadow: ReturnType<typeof createShadow>
) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },

    loader: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },

    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },

    scanlineWrap: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 1,
      opacity: Platform.OS === 'web' ? 0.08 : 0.055,
    },

    scanline: {
      position: 'absolute',
      width: '100%',
      height: 1,
      backgroundColor: colors.scanline,
    },

    topBar: {
      height: 58,
      backgroundColor: colors.topBar,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(154,143,128,0.18)',
      paddingHorizontal: 22,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      zIndex: 10,
    },

    topIcon: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },

    topTitle: {
      fontFamily: font.serif,
      color: colors.primary,
      fontSize: 21,
      letterSpacing: 2.2,
      textAlign: 'center',
    },

    content: {
      paddingHorizontal: 24,
      paddingTop: 18,
      paddingBottom: 32,
      gap: 14,
      zIndex: 2,
    },

    panel: {
      borderRadius: 4,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: 'rgba(154,143,128,0.18)',
      overflow: 'hidden',
    },

    panelActive: {
      borderColor: colors.primaryContainer,
      backgroundColor: colors.panelActive,
      ...shadow.softGlow,
    },

    locationPanel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
    },

    locationIconBox: {
      width: 40,
      height: 40,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(197,160,89,0.42)',
      backgroundColor: 'rgba(197,160,89,0.08)',
    },

    locationTextWrap: {
      flex: 1,
      gap: 4,
    },

    locationTitle: {
      fontFamily: font.interSemi,
      color: colors.primary,
      fontSize: 14,
      letterSpacing: 0.8,
    },

    locationBody: {
      fontFamily: font.inter,
      color: colors.onSurfaceVariant,
      fontSize: 12,
      lineHeight: 17,
    },

    outlineButton: {
      borderWidth: 1,
      borderColor: colors.primaryContainer,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: 4,
      backgroundColor: 'transparent',
    },

    outlineButtonText: {
      fontFamily: font.interSemi,
      fontSize: 10,
      letterSpacing: 1.2,
      color: colors.primary,
      textAlign: 'center',
    },

    heroCard: {
      alignItems: 'center',
      paddingTop: 28,
      paddingBottom: 26,
      paddingHorizontal: 24,
      gap: 8,
      position: 'relative',
    },

    heroLabel: {
      fontFamily: font.interSemi,
      color: colors.onSurfaceVariant,
      fontSize: 11,
      letterSpacing: 2.4,
      opacity: 0.76,
    },

    clockText: {
      fontFamily: font.interLight,
      color: colors.onSurface,
      fontSize: 58,
      letterSpacing: -2.2,
      lineHeight: 64,
    },

    progressTrack: {
      width: 168,
      height: 3,
      borderRadius: 2,
      backgroundColor: 'rgba(226,226,226,0.15)',
      marginTop: 12,
      marginBottom: 10,
      overflow: 'hidden',
    },

    progressFill: {
      height: '100%',
      backgroundColor: colors.primaryContainer,
    },

    heroCountdown: {
      fontFamily: font.interMedium,
      color: colors.onSurface,
      fontSize: 16,
      lineHeight: 22,
      textAlign: 'center',
      marginBottom: 8,
    },

    heroPrayerName: {
      fontFamily: font.serif,
      color: colors.primary,
      fontSize: 24,
      lineHeight: 31,
      marginTop: 2,
    },

    heroNextText: {
      fontFamily: font.inter,
      color: colors.onSurfaceVariant,
      fontSize: 14,
      lineHeight: 20,
    },

    prayerPanel: {
      paddingVertical: 0,
      paddingHorizontal: 0,
    },

    prayerRow: {
      minHeight: 58,
      paddingHorizontal: 18,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(154,143,128,0.11)',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'relative',
    },

    prayerRowActive: {
      backgroundColor: colors.surfaceContainerHigh,
      borderLeftWidth: 3,
      borderLeftColor: colors.primaryContainer,
      ...shadow.softGlow,
    },

    prayerName: {
      fontFamily: font.interSemi,
      color: colors.onSurfaceVariant,
      fontSize: 11,
      letterSpacing: 2.1,
    },

    activeText: {
      color: colors.primary,
    },

    prayerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
    },

    rowIcons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },

    prayerTime: {
      fontFamily: font.interLight,
      color: colors.onSurface,
      fontSize: 25,
      letterSpacing: -0.6,
      minWidth: 62,
      textAlign: 'left',
    },

    activeTime: {
      color: colors.primary,
      fontFamily: font.inter,
    },

    snoozeText: {
      fontFamily: font.interMedium,
      color: colors.primary,
      fontSize: 11,
      marginTop: 4,
      opacity: 0.85,
    },

    aboutCard: {
      padding: 20,
      gap: 14,
    },

    cardTitle: {
      fontFamily: font.interSemi,
      color: colors.primary,
      fontSize: 12,
      letterSpacing: 1.7,
    },

    bodyText: {
      fontFamily: font.inter,
      color: colors.onSurface,
      fontSize: 15,
      lineHeight: 24,
    },

    sectionTitle: {
      fontFamily: font.interSemi,
      color: colors.primary,
      fontSize: 12,
      letterSpacing: 1.4,
      marginTop: 4,
    },

    statusValue: {
      fontFamily: font.interSemi,
      color: colors.primary,
      fontSize: 12,
      letterSpacing: 0.8,
    },

    offlineText: {
      fontFamily: font.inter,
      color: colors.onSurfaceVariant,
      fontSize: 12,
      lineHeight: 18,
      opacity: 0.9,
    },

    divider: {
      height: 1,
      width: '100%',
      backgroundColor: 'rgba(154,143,128,0.16)',
      marginVertical: 4,
    },

    settingRow: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },

    settingLabelWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },

    settingLabel: {
      fontFamily: font.inter,
      color: colors.onSurface,
      fontSize: 14,
      lineHeight: 20,
    },

    choiceWrap: {
      gap: 10,
    },

    choiceGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },

    choiceButton: {
      borderRadius: 4,
      borderWidth: 1,
      borderColor: 'rgba(154,143,128,0.35)',
      backgroundColor: colors.surfaceContainer,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },

    choiceButtonActive: {
      borderColor: colors.primaryContainer,
      backgroundColor: colors.primaryContainer,
    },

    choiceText: {
      fontFamily: font.interSemi,
      color: colors.onSurfaceVariant,
      fontSize: 12,
      letterSpacing: 0.5,
    },

    choiceTextActive: {
      color: colors.onPrimary,
    },

    techRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },

    devRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },

    devAvatar: {
      width: 62,
      height: 62,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(197,160,89,0.6)',
      backgroundColor: 'rgba(197,160,89,0.08)',
    },

    labelDim: {
      fontFamily: font.interSemi,
      color: colors.onSurfaceVariant,
      fontSize: 11,
      letterSpacing: 1.7,
    },

    devName: {
      fontFamily: font.serif,
      color: colors.onSurface,
      fontSize: 27,
      lineHeight: 34,
    },

    linkRow: {
      gap: 10,
      marginTop: 6,
    },

    linkButton: {
      minHeight: 48,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: 'rgba(197,160,89,0.55)',
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },

    linkText: {
      fontFamily: font.interSemi,
      color: colors.primary,
      fontSize: 12,
      letterSpacing: 1.1,
    },

    alarmOverlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 999,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },

    alarmCard: {
      width: '100%',
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.primaryContainer,
      backgroundColor: colors.panel,
      padding: 28,
      alignItems: 'center',
      gap: 16,
      ...shadow.softGlow,
    },

    alarmTitle: {
      fontFamily: font.serif,
      color: colors.primary,
      fontSize: 32,
      lineHeight: 40,
      textAlign: 'center',
    },

    alarmSubtitle: {
      fontFamily: font.interSemi,
      color: colors.onSurfaceVariant,
      fontSize: 12,
      letterSpacing: 2.8,
    },

    alarmTime: {
      fontFamily: font.interLight,
      color: colors.onSurface,
      fontSize: 62,
      letterSpacing: -2,
    },

    alarmActions: {
      width: '100%',
      gap: 12,
      marginTop: 8,
    },

    snoozeSlider: {
      width: '100%',
      height: 54,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.primaryContainer,
      backgroundColor: 'rgba(197,160,89,0.08)',
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative',
    },

    snoozeSliderText: {
      fontFamily: font.interSemi,
      color: colors.primary,
      fontSize: 12,
      letterSpacing: 1.5,
      textAlign: 'center',
    },

    snoozeThumb: {
      position: 'absolute',
      left: 4,
      width: 46,
      height: 46,
      borderRadius: 4,
      backgroundColor: colors.primaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },

    alarmMainButton: {
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.primaryContainer,
      backgroundColor: colors.primaryContainer,
      paddingVertical: 15,
      alignItems: 'center',
    },

    alarmMainText: {
      fontFamily: font.interSemi,
      color: colors.onPrimary,
      fontSize: 14,
      letterSpacing: 2,
    },

    alarmSecondaryButton: {
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.primaryContainer,
      backgroundColor: 'transparent',
      paddingVertical: 15,
      alignItems: 'center',
    },

    alarmSecondaryText: {
      fontFamily: font.interSemi,
      color: colors.primary,
      fontSize: 13,
      letterSpacing: 1.8,
    },
  });
}