/**
 * S09 — Delayed history load.
 * Checklist: §6.3, §8.1.
 * Defect covered: none (history path bootstraps from the stored initPacket).
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S09 delayed history load', () => {
  it('B never saw the messages live and decrypts them from history, including the bootstrap', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;

    network.partition('B');
    A!.send('B', 'h1');
    A!.send('B', 'h2');
    A!.send('B', 'h3');
    expect(B!.hasSession('A')).toBe(false);

    const history = B!.loadHistory('A');
    expect(history.map((m) => m.text)).toEqual(['h1', 'h2', 'h3']);
    expect(B!.hasSession('A')).toBe(true);
    expect(B!.sessionState('A')!.Nr).toBe(3);

    // Sender side renders its own messages from archived keys.
    expect(A!.loadHistory('B').map((m) => m.text)).toEqual(['h1', 'h2', 'h3']);

    // The queued live copies would now be duplicates; the client dedupes by id.
    network.discard('B');
  });
});
