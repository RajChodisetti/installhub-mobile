export const colors = {
  light: {
    background: '#F7FAF8',
    foreground: '#141C22',
    card: '#FFFFFF',
    cardForeground: '#141C22',
    primary: '#26997A',
    primaryForeground: '#FFFFFF',
    accent: '#2B8FBF',
    accentForeground: '#FFFFFF',
    muted: '#E8EFEC',
    mutedForeground: '#5A6B73',
    border: '#D5E0DB',
    destructive: '#E03535',
    destructiveForeground: '#FFFFFF',
    tbc: '#F59E0B',
    tbcForeground: '#78350F',
    success: '#16A34A',
    reportNavy: '#0E2240',
  },
  dark: {
    background: '#0F1614',
    foreground: '#E8F0EC',
    card: '#1A2420',
    cardForeground: '#E8F0EC',
    primary: '#3DB896',
    primaryForeground: '#0A1512',
    accent: '#4BA3D4',
    accentForeground: '#0A1512',
    muted: '#24302C',
    mutedForeground: '#9BB0A8',
    border: '#2F3F39',
    destructive: '#F05353',
    destructiveForeground: '#FFFFFF',
    tbc: '#FBBF24',
    tbcForeground: '#1C1408',
    success: '#22C55E',
    reportNavy: '#0E2240',
  },
} as const;

export type ThemeMode = 'light' | 'dark' | 'system';
export type ColorTokens = (typeof colors)['light'] | (typeof colors)['dark'];

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '700' as const },
  heading: { fontSize: 20, fontWeight: '700' as const },
  subheading: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.4 },
};
