import { contrastRatio } from '../contrast';
import { darkTheme, lightTheme } from '../theme';

describe.each([
  ['light', lightTheme],
  ['dark', darkTheme],
] as const)('%s navigation tab tokens', (_name, theme) => {
  it('separates the selected tab from the navigation surface', () => {
    expect(contrastRatio(theme['--color-tab-active'], theme['--color-background-alt'])).toBeGreaterThanOrEqual(1.1);
  });

  it('keeps the selected icon readable on its selected tab', () => {
    expect(contrastRatio(theme['--color-tab-active-icon'], theme['--color-tab-active'])).toBeGreaterThanOrEqual(3);
  });
});
