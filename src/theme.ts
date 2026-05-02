export const themes = {
  dark: {
    surface: '#121414',
    surfaceDim: '#121414',
    surfaceBright: '#38393a',
    surfaceContainerLowest: '#0c0f0f',
    surfaceContainerLow: '#1a1c1c',
    surfaceContainer: '#1e2020',
    surfaceContainerHigh: '#282a2b',
    surfaceContainerHighest: '#333535',
    onSurface: '#e2e2e2',
    onSurfaceVariant: '#d1c5b4',
    outline: '#9a8f80',
    outlineVariant: '#4e4639',
    primary: '#e9c176',
    primaryContainer: '#c5a059',
    onPrimary: '#412d00',
    background: '#121414',
    onBackground: '#e2e2e2',
    topBar: 'rgba(18,20,20,0.98)',
    panel: 'rgba(26,28,28,0.92)',
    panelActive: 'rgba(197,160,89,0.11)',
    scanline: 'rgba(226,226,226,0.055)',
  },
  light: {
    surface: '#f5f1ea',
    surfaceDim: '#ece7dd',
    surfaceBright: '#ffffff',
    surfaceContainerLowest: '#fffaf2',
    surfaceContainerLow: '#f0ebe2',
    surfaceContainer: '#e8e1d6',
    surfaceContainerHigh: '#ded5c6',
    surfaceContainerHighest: '#d4c8b6',
    onSurface: '#1a1c1e',
    onSurfaceVariant: '#4f473d',
    outline: '#87765b',
    outlineVariant: '#c7b99f',
    primary: '#775a19',
    primaryContainer: '#c5a059',
    onPrimary: '#261900',
    background: '#f5f1ea',
    onBackground: '#1a1c1e',
    topBar: 'rgba(245,241,234,0.98)',
    panel: 'rgba(232,225,214,0.92)',
    panelActive: 'rgba(197,160,89,0.18)',
    scanline: 'rgba(18,20,20,0.045)',
  },
};

export type ThemeMode = keyof typeof themes;
export type AppColors = typeof themes.dark;

export const spacing = {
  marginMain: 32,
  gutterMd: 16,
  stackLg: 48,
  stackMd: 24,
  stackSm: 12,
  unit: 4,
};

export const font = {
  serif: 'NotoSerif_400Regular',
  serifSemi: 'NotoSerif_600SemiBold',
  interLight: 'Inter_300Light',
  inter: 'Inter_400Regular',
  interMedium: 'Inter_500Medium',
  interSemi: 'Inter_600SemiBold',
};

export function createShadow(colors: AppColors) {
  return {
    softGlow: {
      shadowColor: colors.primaryContainer,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.18,
      shadowRadius: 18,
      elevation: 6,
    },
    textGlow: {
      textShadowColor: colors.primaryContainer,
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 5,
    },
  };
}