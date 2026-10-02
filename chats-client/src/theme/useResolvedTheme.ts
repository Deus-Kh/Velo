import { useColorScheme, type ColorSchemeName } from 'react-native';
import { useAppearanceStore, type ThemePreference } from '../store/appearance.store';

/**
 * The theme the app actually shows: the appearance preference, or the
 * system scheme when the preference is "system". One resolver for the
 * ThemeProvider, the colour hook and the status bar, so they can never
 * disagree (roadmap §8.1 A9: the status bar followed the system scheme
 * while the app showed the Light theme).
 */
export type ResolvedTheme = 'light' | 'dark';

/** `systemScheme` may be null/undefined on platforms that do not report one: that counts as light. */
export function resolveTheme(preference: ThemePreference, systemScheme: ColorSchemeName | null | undefined): ResolvedTheme {
  if (preference === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
  return preference;
}

export function useResolvedTheme(): ResolvedTheme {
  const system = useColorScheme();
  const preference = useAppearanceStore((s) => s.themePreference);
  return resolveTheme(preference, system);
}
