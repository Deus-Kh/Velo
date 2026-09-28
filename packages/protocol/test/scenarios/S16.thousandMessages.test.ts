/**
 * S16 — 1000-message conversation, storage bounded.
 * Checklist: §8.3 (long conversations).
 * Defects covered: skipped-key bound (MAX_SKIP, holds today) and the
 * message-key archive, which grows by one row per message forever (P1-10,
 * T2.14: delete keys after use).
 * Expected before fixes: skipped keys bounded — pass; archive bounded —
 * FAIL (finding added by T2.4; not in the original nine). After T2.14: pass.
 * (Flipped green by T2.14: message keys are never archived; plaintext is
 * stored locally instead.)
 */
import { describe, expect, it } from 'vitest';
import { MAX_SKIP_TOTAL } from '../../src/ratchet/limits';
import { makeWorld } from '../harness';

describe('S16 1000-message conversation', () => {
  const { clients } = makeWorld();
  const { A, B } = clients;
  for (let i = 0; i < 500; i += 1) {
    A!.send('B', 'a' + String(i));
    B!.send('A', 'b' + String(i));
  }

  it('all 1000 messages decrypt and skipped keys stay within MAX_SKIP_TOTAL', () => {
    expect(B!.inbox).toHaveLength(500);
    expect(A!.inbox).toHaveLength(500);
    expect(B!.inbox[499]!.text).toBe('a499');
    expect(Object.keys(B!.sessionState('A')!.skippedKeys ?? {}).length).toBeLessThanOrEqual(MAX_SKIP_TOTAL);
    expect(Object.keys(A!.sessionState('B')!.skippedKeys ?? {}).length).toBeLessThanOrEqual(MAX_SKIP_TOTAL);
  });

  it('no message key is archived: forward secrecy at rest (T2.14)', () => {
    expect(B!.messageKeyCount('A')).toBe(0);
    expect(A!.messageKeyCount('B')).toBe(0);
    expect(B!.storedMessages('A')).toHaveLength(1000);
    expect(A!.storedMessages('B')).toHaveLength(1000);
  });
});
