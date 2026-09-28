/**
 * S18 — Message from an unknown epoch.
 * Checklist: none (adversarial / desync).
 * Defect covered: none — the receiver must fail with a typed error and keep
 * its session (T2.2/T2.3). Since T3.6 an unknown epoch means a header that
 * opens under none of the receiver's header keys: DECRYPT_FAILED, session
 * unchanged, and the genuine stream continues.
 * Expected before fixes: pass (typed error). After: pass.
 */
import { describe, expect, it } from 'vitest';
import { alienHeader, makeWorld, type NewMessageDTO } from '../harness';

describe('S18 message from an unknown epoch', () => {
  it('is rejected with a ProtocolError and the session is unchanged', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'a1');
    B!.send('A', 'b1');
    A!.send('B', 'a2');

    const before = B!.sessionState('A');
    const genuine = network.log.at(-1)!.dto as NewMessageDTO; // T3.1: delivered ciphertext is gone from the server; the wire log has it
    const alien = alienHeader(genuine); // T3.6: a header sealed under a key this session does not know

    const r = network.deliverNow('B', alien);
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.code).toBe('DECRYPT_FAILED');
    expect(B!.sessionState('A')).toEqual(before);

    // The genuine stream continues.
    A!.send('B', 'a3');
    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2', 'a3']);
  });
});
