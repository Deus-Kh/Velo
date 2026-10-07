import { contrastRatio } from '../contrast';
import { darkTheme, lightTheme } from '../theme';

const THEMES = [lightTheme, darkTheme];

describe('settings switch theme tokens', () => {
  it.each(THEMES)('keeps the off thumb distinct from the off track and panel', (theme) => {
    expect(contrastRatio(theme['--color-toggle-thumb-off'], theme['--color-toggle-track-off'])).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(theme['--color-toggle-thumb-off'], theme['--color-surface'])).toBeGreaterThanOrEqual(1.1);
  });

  it.each(THEMES)('uses an accent track and light thumb when enabled', (theme) => {
    expect(theme['--color-toggle-track-on']).toBe(theme['--color-primary']);
    expect(theme['--color-toggle-thumb-on']).toBe('255 255 255');
  });
});
