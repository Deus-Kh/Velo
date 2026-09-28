/**
 * S18 — Message from an unknown epoch.
 * Checklist: none (adversarial / desync).
 * Defect covered: none — the receiver must fail with a typed error and keep
 * its session (T2.2/T2.3). After T2.5 the code becomes HEADER_TAMPERED when
 * the header is what was modified; a genuinely unknown epoch stays
 * DECRYPT_FAILED.
 * Expected before fixes: pass (typed error). After: pass.
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S18 message from an unknown epoch', () => {
  it('is rejected with a ProtocolError and the session is unchanged', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'a1');
    B!.send('A', 'b1');
    A!.send('B', 'a2');

    const before = B!.sessionState('A');
    const genuine = network.log.at(-1)!.dto; // T3.1: delivered ciphertext is gone from the server; the wire log has it
    const alien = { ...genuine, v3: { ...genuine.v3, header: { dhPub: encodeBase64(nacl.box.keyPair().publicKey), n: 0, pn: 0 } } };

    const r = network.deliverNow('B', alien);
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.code).toBe('DECRYPT_FAILED');
    expect(B!.sessionState('A')).toEqual(before);

    // The genuine stream continues.
    A!.send('B', 'a3');
    expect(B!.inbox.map((m) => m.text)).toEqual(['a1', 'a2', 'a3']);
  });
});
