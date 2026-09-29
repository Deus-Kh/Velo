import { decodeBase64 } from 'tweetnacl-util';
import { buildWaveform, decodeWaveform, encodeWaveform, placeholderWaveform, resampleWaveform, WAVEFORM_BARS, WAVEFORM_MAX } from '../waveform';

/**
 * T8.4 — the voice-note waveform: recorder levels fold into 64 five-bit
 * bars normalised to the loudest one; the bars survive base64; a note
 * without one gets a stable placeholder.
 */
describe('voice-note waveform', () => {
  it('silence is all zeros; a ramp keeps its shape and peaks at 31', () => {
    expect(Array.from(buildWaveform([]))).toEqual(new Array(WAVEFORM_BARS).fill(0));
    expect(Array.from(buildWaveform(new Array(500).fill(0)))).toEqual(new Array(WAVEFORM_BARS).fill(0));
    const ramp = Array.from({ length: 640 }, (_, i) => i / 639);
    const bars = Array.from(buildWaveform(ramp));
    expect(bars).toHaveLength(WAVEFORM_BARS);
    expect(Math.max(...bars)).toBe(WAVEFORM_MAX);
    for (let i = 1; i < bars.length; i += 1) expect(bars[i]).toBeGreaterThanOrEqual(bars[i - 1]!);
  });

  it('a short recording (fewer levels than bars) stretches instead of leaving gaps; out-of-range levels are clamped', () => {
    const bars = Array.from(buildWaveform([0.5, 1, 0.5]));
    expect(bars).toHaveLength(WAVEFORM_BARS);
    expect(bars.every((b) => b > 0)).toBe(true);
    expect(Math.max(...Array.from(buildWaveform([5, -3, Number.NaN, 0.5])))).toBe(WAVEFORM_MAX);
  });

  it('round-trips through base64 as 0..1 heights, resampled to the requested bar count', () => {
    const bars = buildWaveform(Array.from({ length: 200 }, (_, i) => (i % 10) / 9));
    const encoded = encodeWaveform(bars);
    expect(decodeBase64(encoded)).toHaveLength(WAVEFORM_BARS);
    const heights = decodeWaveform(encoded)!;
    expect(heights).toHaveLength(WAVEFORM_BARS);
    expect(Math.max(...heights)).toBe(1);
    expect(heights.every((h) => h >= 0 && h <= 1)).toBe(true);
    expect(decodeWaveform(encoded, 20)).toHaveLength(20);
    expect(decodeWaveform(undefined)).toBeNull();
    expect(decodeWaveform('')).toBeNull();
    expect(decodeWaveform('not base64!!')).toBeNull();
  });

  it('resampling handles empty, single and longer series', () => {
    expect(resampleWaveform([], 4)).toEqual([0, 0, 0, 0]);
    expect(resampleWaveform([0.4], 3)).toEqual([0.4, 0.4, 0.4]);
    expect(resampleWaveform([0, 1], 3)).toEqual([0, 0.5, 1]);
    expect(resampleWaveform([0, 0.5, 1, 0.5, 0], 5)).toEqual([0, 0.5, 1, 0.5, 0]);
  });

  it('the placeholder is deterministic per blob id, inside 0..1, and differs between ids', () => {
    const a = placeholderWaveform('a'.repeat(32));
    expect(a).toEqual(placeholderWaveform('a'.repeat(32)));
    expect(a).toHaveLength(WAVEFORM_BARS);
    expect(a.every((h) => h > 0 && h <= 1)).toBe(true);
    expect(a).not.toEqual(placeholderWaveform('b'.repeat(32)));
  });
});
