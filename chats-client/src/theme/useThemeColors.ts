import { useMemo } from 'react';
import { useResolvedTheme } from './useResolvedTheme';
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
  /** B3: the outgoing bubble and its text pair; the incoming bubble and its hairline. */
  bubbleOut: string;
  bubbleOutText: string;
  bubbleOutMuted: string;
  bubbleIn: string;
  bubbleInBorder: string;
  toggleTrackOff: string;
  toggleTrackOn: string;
  toggleThumbOff: string;
  toggleThumbOn: string;
  tabActive: string;
  tabActiveIcon: string;
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
    bubbleOut: rgb(t['--color-bubble-out']),
    bubbleOutText: rgb(t['--color-bubble-out-text']),
    bubbleOutMuted: rgb(t['--color-bubble-out-muted']),
    bubbleIn: rgb(t['--color-bubble-in']),
    bubbleInBorder: rgb(t['--color-bubble-in-border']),
    toggleTrackOff: rgb(t['--color-toggle-track-off']),
    toggleTrackOn: rgb(t['--color-toggle-track-on']),
    toggleThumbOff: rgb(t['--color-toggle-thumb-off']),
    toggleThumbOn: rgb(t['--color-toggle-thumb-on']),
    tabActive: rgb(t['--color-tab-active']),
    tabActiveIcon: rgb(t['--color-tab-active-icon']),
  };
}

export function useThemeColors(): ThemeColorSet {
  const dark = useResolvedTheme() === 'dark';
  return useMemo(() => themeColorSet(dark ? darkTheme : lightTheme), [dark]);
}
