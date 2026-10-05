import { compactDensity, comfortableDensity, densityTokens } from '../density';

describe('interface density tokens', () => {
  it('makes compact layout measurably denser', () => {
    expect(compactDensity.rowVerticalPadding).toBeLessThan(comfortableDensity.rowVerticalPadding);
    expect(compactDensity.bubbleHorizontalPadding).toBeLessThan(comfortableDensity.bubbleHorizontalPadding);
    expect(compactDensity.bubbleVerticalPadding).toBeLessThan(comfortableDensity.bubbleVerticalPadding);
    expect(compactDensity.messageFontSize).toBeLessThan(comfortableDensity.messageFontSize);
  });

  it('resolves the selected density', () => {
    expect(densityTokens('compact')).toBe(compactDensity);
    expect(densityTokens('comfortable')).toBe(comfortableDensity);
  });
});
