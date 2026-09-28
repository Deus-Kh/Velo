/**
 * Registry of scenarios that are expected to fail against the current code.
 * They are written with `it.fails`, so the suite is green while the defects
 * are open; when a fix lands the `it.fails` starts failing and must be
 * flipped to `it` in the same commit. This test pins the set so a silent
 * flip in either direction is caught.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const KNOWN_RED: Record<string, string> = {
  S12: 'header.n = 10_000_000 hangs — T2.6',
  S13: 'tampered dhPub not HEADER_TAMPERED — T2.5',
  S14: 'tampered n / pn not HEADER_TAMPERED (pn accepted) — T2.5',
  S16: 'message-key archive unbounded — T2.14 (finding added by T2.4)',
};

describe('known-red registry', () => {
  it('exactly the registered scenarios use it.fails', () => {
    const files = readdirSync(__dirname).filter((f) => /^S\d\d\./.test(f));
    expect(files).toHaveLength(21);
    const red = files
      .filter((f) => /\bit\.fails\(/.test(readFileSync(join(__dirname, f), 'utf8')))
      .map((f) => f.slice(0, 3))
      .sort();
    expect(red).toEqual(Object.keys(KNOWN_RED).sort());
  });
});
