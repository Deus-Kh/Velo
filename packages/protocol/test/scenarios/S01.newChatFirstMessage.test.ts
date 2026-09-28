/**
 * S01 — New chat, first message.
 * Checklist: V2_STABILIZATION_CHECKLIST §4.1.
 * Defect covered: none (baseline).
 * Expected before fixes: pass. After: pass.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S01 new chat, first message', () => {
  it('A opens a chat with B and the first message decrypts on B', () => {
    const { server, clients } = makeWorld();
    const A = clients.A!;
    const B = clients.B!;

    const dto = A.send('B', 'hello');

    expect(B.inbox.map((m) => m.text)).toEqual(['hello']);
    expect(dto.initPacket, 'the session-creating send must carry the initPacket').not.toBeNull();
    expect(A.hasSession('B')).toBe(true);
    expect(B.hasSession('A')).toBe(true);

    // One bundle issued, its one-time prekey consumed on the server and deleted on B.
    expect(server.bundleIssues).toHaveLength(1);
    const opkId = dto.initPacket!.oneTimePreKeyId;
    expect(opkId).not.toBeNull();
    expect(server.unusedOneTimePreKeyCount('B')).toBe(9);
    expect(B.store.has('opk:' + String(opkId))).toBe(false);

    // Counters: A sent one, B received one.
    expect(A.sessionState('B')!.Ns).toBe(1);
    expect(B.sessionState('A')!.Nr).toBe(1);
  });
});
