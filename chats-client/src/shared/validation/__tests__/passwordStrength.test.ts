import { estimatePasswordStrength, PASSWORD_MIN_LENGTH } from '../password';

describe('estimatePasswordStrength', () => {
  it('is empty for an empty value', () => {
    expect(estimatePasswordStrength('')).toEqual({ score: 0, label: '' });
  });

  it('scores below the minimum length as 0', () => {
    expect(estimatePasswordStrength('a'.repeat(PASSWORD_MIN_LENGTH - 1)).score).toBe(0);
  });

  it('caps common and repetitive passwords at weak', () => {
    expect(estimatePasswordStrength('password12345').score).toBeLessThanOrEqual(1);
    expect(estimatePasswordStrength('aaaaaaaaaaaaaaaa').score).toBeLessThanOrEqual(1);
    expect(estimatePasswordStrength('abababababababab').score).toBeLessThanOrEqual(1);
  });

  it('rewards length and character variety', () => {
    expect(estimatePasswordStrength('tenletters').score).toBe(1);
    expect(estimatePasswordStrength('Tq9!vLm#2rXp@8w').score).toBeGreaterThanOrEqual(3);
    const strong = estimatePasswordStrength('correct horse battery staple 42');
    expect(strong.score).toBe(4);
    expect(strong.label).toBe('Strong');
  });
});
