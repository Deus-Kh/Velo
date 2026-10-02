import { resolveTheme } from '../useResolvedTheme';
import { darkTheme, lightTheme } from '../theme';
import { themeColorSet } from '../useThemeColors';

/**
 * Roadmap §8.1 A9 — the status bar and the root background follow the
 * app's resolved theme, not the system scheme.
 */
describe('resolveTheme', () => {
  it('an explicit preference wins over the system scheme', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('dark', null)).toBe('dark');
  });

  it('"system" follows the system scheme and treats an unknown scheme as light', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', null)).toBe('light');
    expect(resolveTheme('system', undefined)).toBe('light');
  });

  it('each theme has a page background the root can paint behind the translucent status bar', () => {
    expect(themeColorSet(lightTheme).background).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(themeColorSet(darkTheme).background).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(themeColorSet(lightTheme).background).not.toBe(themeColorSet(darkTheme).background);
  });
});
