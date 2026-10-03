/**
 * WCAG 2 contrast for theme tokens ("R G B" triplets as the themes store
 * them). Used by the tests that keep bubble text and timestamps at ≥ 4.5:1
 * in both themes (roadmap §8.1 B3, B10).
 */
export function parseTriplet(triplet: string): [number, number, number] {
  const parts = triplet.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    throw new Error(`not an "R G B" triplet: ${triplet}`);
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(triplet: string): number {
  const [r, g, b] = parseTriplet(triplet);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio between two "R G B" triplets, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}
