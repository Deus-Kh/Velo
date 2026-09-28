/**
 * The committed vector file must be exactly what the generator produces
 * with the installed libsignal. Catches a stale file after a libsignal
 * bump and a hand-edited vector.
 */
import { describe, expect, it } from 'vitest';
import { buildVectors } from './generate';
import committed from './libsignal.json';

describe('libsignal vectors: regeneration', () => {
  it('regenerating with the installed libsignal reproduces the committed file', () => {
    const fresh = buildVectors();
    expect(fresh).toEqual(committed);
  });
});
