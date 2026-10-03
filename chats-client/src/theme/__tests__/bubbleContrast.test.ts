import { contrastRatio } from '../contrast';
import { darkTheme, lightTheme, type ThemeColors } from '../theme';

/**
 * Roadmap §8.1 B3 — bubble tokens per theme: text and timestamps on both
 * bubbles read at ≥ 4.5:1 (WCAG AA for body and small text); the accent
 * used for the waveform, the play button and the quote bar on an outgoing
 * bubble reads at ≥ 3:1 (AA for graphics).
 */
const TEXT = 4.5;
const GRAPHIC = 3;

describe.each<[string, ThemeColors]>([
  ['dark', darkTheme],
  ['light', lightTheme],
])('%s theme bubbles', (_name, t) => {
  it('outgoing text and timestamps read on the outgoing bubble', () => {
    expect(contrastRatio(t['--color-bubble-out-text'], t['--color-bubble-out'])).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(t['--color-bubble-out-muted'], t['--color-bubble-out'])).toBeGreaterThanOrEqual(TEXT);
  });

  it('incoming text and timestamps read on the incoming bubble', () => {
    expect(contrastRatio(t['--color-text-primary'], t['--color-bubble-in'])).toBeGreaterThanOrEqual(TEXT);
    expect(contrastRatio(t['--color-text-secondary'], t['--color-bubble-in'])).toBeGreaterThanOrEqual(TEXT);
  });

  it('the accent stands out on both bubbles', () => {
    expect(contrastRatio(t['--color-primary'], t['--color-bubble-out'])).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrastRatio(t['--color-primary'], t['--color-bubble-in'])).toBeGreaterThanOrEqual(GRAPHIC);
  });

  it('both bubbles are distinguishable from the page: by tone, or by a hairline for the incoming one', () => {
    expect(contrastRatio(t['--color-bubble-out'], t['--color-background'])).toBeGreaterThan(1.15);
    const incomingByTone = contrastRatio(t['--color-bubble-in'], t['--color-background']) > 1.1;
    const incomingByLine = contrastRatio(t['--color-bubble-in-border'], t['--color-bubble-in']) > 1.1;
    expect(incomingByTone || incomingByLine).toBe(true);
  });
});

it('contrastRatio is symmetric and spans 1..21', () => {
  expect(contrastRatio('0 0 0', '255 255 255')).toBeCloseTo(21, 5);
  expect(contrastRatio('255 255 255', '0 0 0')).toBeCloseTo(21, 5);
  expect(contrastRatio('120 120 120', '120 120 120')).toBe(1);
});
