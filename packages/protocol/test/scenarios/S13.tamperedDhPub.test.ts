/**
 * S13 — Tampered header (encrypted since T3.6).
 * Checklist: none (adversarial).
 * Defect covered: the header is not authenticated (P1-2, T2.5) and, since
 * T3.6, not even readable on the wire (P1-8). An on-path attacker can only
 * flip bytes of the encrypted header: it then opens under no known header
 * key and the message is DECRYPT_FAILED. An attacker who also holds the
 * sender's header key can forge a plaintext dhPub, but a header sealed
 * under the current header key must name the current epoch's ratchet key,
 * so it is refused as well. Either way the session is untouched.
 * Expected before fixes: FAIL (a tampered header could be accepted).
 * After T2.5: pass. (Flipped green by T2.5; re-cut for T3.6.)
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { flipEncHeader, makeWorld, resealHeader } from '../harness';

function world() {
  const w = makeWorld();
  w.clients.A!.send('B', 'a1');
  w.clients.B!.send('A', 'b1');
  return w;
}

describe('S13 tampered header', () => {
  it('a flipped byte of the encrypted header is refused (DECRYPT_FAILED: the header opens under no key) and never decrypts', () => {
    const { network } = world();
    const remove = network.tamper(flipEncHeader);
    network.hold('B');
    network.client('A').send('B', 'a2');
    const [r] = network.release('B');
    remove();

    expect(r!.ok).toBe(false);
    expect(r!.ok ? null : r!.code).toBe('DECRYPT_FAILED');
    expect(network.client('B').inbox.map((m) => m.text)).toEqual(['a1']);
  });

  it('a forged dhPub under the real header key is refused and never changes the persisted session (R7)', () => {
    const { network, clients } = world();
    const before = clients.B!.sessionState('A');
    const remove = network.tamper((dto) => resealHeader(clients.A!, dto, { dhPub: encodeBase64(nacl.box.keyPair().publicKey) }));
    network.hold('B');
    clients.A!.send('B', 'a2');
    const [r] = network.release('B');
    remove();

    expect(r!.ok).toBe(false);
    expect(r!.ok ? null : r!.code).toBe('DECRYPT_FAILED');
    expect(clients.B!.sessionState('A')).toEqual(before);
  });
});
