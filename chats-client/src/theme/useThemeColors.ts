import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useAppearanceStore } from '../store/appearance.store';
import { darkTheme, lightTheme, type ThemeColors } from './theme';

/**
 * The active theme's colours as CSS strings, for props that cannot take a
 * NativeWind class (icon colours, Animated styles). Resolves the theme the
 * same way ThemeProvider does: the appearance preference, or the system.
 */
export type ThemeColorSet = {
  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  primarySoft: string;
  success: string;
  warning: string;
  danger: string;
};

const rgb = (triplet: string): string => `rgb(${triplet.trim().split(/\s+/).join(', ')})`;

export function themeColorSet(t: ThemeColors): ThemeColorSet {
  return {
    background: rgb(t['--color-background']),
    backgroundAlt: rgb(t['--color-background-alt']),
    surface: rgb(t['--color-surface']),
    surfaceElevated: rgb(t['--color-surface-elevated']),
    border: rgb(t['--color-border']),
    text: rgb(t['--color-text-primary']),
    muted: rgb(t['--color-text-secondary']),
    primary: rgb(t['--color-primary']),
    primarySoft: rgb(t['--color-primary-soft']),
    success: rgb(t['--color-success']),
    warning: rgb(t['--color-warning']),
    danger: rgb(t['--color-danger']),
  };
}

export function useThemeColors(): ThemeColorSet {
  const system = useColorScheme();
  const preference = useAppearanceStore((s) => s.themePreference);
  const dark = preference === 'system' ? system === 'dark' : preference === 'dark';
  return useMemo(() => themeColorSet(dark ? darkTheme : lightTheme), [dark]);
}
