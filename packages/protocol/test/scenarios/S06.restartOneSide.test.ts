/**
 * S06 — Restart one side.
 * Checklist: §5.1, §5.2.
 * Defect covered: none (session persistence).
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S06 restart one side', () => {
  it('B restarts between messages and the conversation continues from the persisted session', () => {
    const w = makeWorld();
    const A = w.clients.A!;

    A.send('B', 'before');
    w.clients.B!.send('A', 'reply');
    const before = w.clients.B!.sessionState('A');

    const B2 = w.restart('B');
    expect(B2.sessionState('A')).toEqual(before);
    expect(B2.inbox, 'a fresh process has no in-memory inbox').toHaveLength(0);

    A.send('B', 'after');
    B2.send('A', 'reply 2');

    expect(B2.inbox.map((m) => m.text)).toEqual(['after']);
    expect(A.inbox.map((m) => m.text)).toEqual(['reply', 'reply 2']);
  });
});
