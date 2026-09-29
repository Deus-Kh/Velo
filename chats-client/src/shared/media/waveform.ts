/* eslint-disable no-bitwise */
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

/**
 * Voice-note waveforms (T8.4, Telegram-style bubble). While recording, the
 * audio module reports a loudness level (0..1) ten times a second; at the
 * end the levels are folded into `WAVEFORM_BARS` buckets, RMS per bucket,
 * normalised to the loudest one and quantised to 5 bits, and travel inside
 * the encrypted attachment content as base64 (`waveform`, ≤ 64 bytes). A
 * receiver that lacks a waveform (older sender) draws a deterministic
 * pattern from the blob id so every voice bubble looks the same kind.
 */
export const WAVEFORM_BARS = 64;
export const WAVEFORM_MAX = 31;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Recorder levels (0..1, one per tick) → `bars` values 0..WAVEFORM_MAX. */
export function buildWaveform(samples: readonly number[], bars = WAVEFORM_BARS): Uint8Array {
  const out = new Uint8Array(bars);
  if (samples.length === 0 || bars <= 0) return out;
  const per = samples.length / bars;
  const rms = new Float64Array(bars);
  let peak = 0;
  for (let i = 0; i < bars; i += 1) {
    const from = Math.floor(i * per);
    const to = Math.min(samples.length, Math.max(from + 1, Math.floor((i + 1) * per)));
    let acc = 0;
    let n = 0;
    for (let j = from; j < to; j += 1) {
      const v = clamp01(samples[j]!);
      acc += v * v;
      n += 1;
    }
    rms[i] = n > 0 ? Math.sqrt(acc / n) : 0;
    if (rms[i]! > peak) peak = rms[i]!;
  }
  for (let i = 0; i < bars; i += 1) out[i] = peak > 0 ? Math.round((rms[i]! / peak) * WAVEFORM_MAX) : 0;
  return out;
}

export function encodeWaveform(waveform: Uint8Array): string {
  return encodeBase64(waveform);
}

/** Linear resampling of a 0..1 series to `bars` points. */
export function resampleWaveform(values: readonly number[], bars: number): number[] {
  if (bars <= 0) return [];
  if (values.length === 0) return new Array<number>(bars).fill(0);
  if (values.length === 1) return new Array<number>(bars).fill(clamp01(values[0]!));
  const out = new Array<number>(bars);
  const step = (values.length - 1) / Math.max(1, bars - 1);
  for (let i = 0; i < bars; i += 1) {
    const pos = i * step;
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const t = pos - lo;
    out[i] = clamp01(values[lo]! * (1 - t) + values[hi]! * t);
  }
  return out;
}

/** The stored waveform as 0..1 heights, `bars` of them; null when absent or malformed. */
export function decodeWaveform(encoded: string | null | undefined, bars = WAVEFORM_BARS): number[] | null {
  if (!encoded) return null;
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(encoded);
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  return resampleWaveform(Array.from(bytes, (v) => Math.min(WAVEFORM_MAX, v) / WAVEFORM_MAX), bars);
}

/** A deterministic, natural-looking pattern for notes that carry no waveform (older senders). */
export function placeholderWaveform(seed: string, bars = WAVEFORM_BARS): number[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  const raw = new Array<number>(bars);
  let x = h || 1;
  for (let i = 0; i < bars; i += 1) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    raw[i] = 0.2 + 0.7 * ((x >>> 8) / 0x00ff_ffff);
  }
  // a touch of smoothing so neighbouring bars relate, like speech does
  return raw.map((v, i) => clamp01(0.5 * v + 0.25 * (raw[i - 1] ?? v) + 0.25 * (raw[i + 1] ?? v)));
}
