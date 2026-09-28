/**
 * S13 — Tampered header.dhPub.
 * Checklist: none (adversarial).
 * Defect covered: the header is not authenticated (P1-2, T2.5). Since T2.5
 * the MAC covers the canonical header and both identities. A modified
 * dhPub changes which key the receiver derives, so nothing opens and the
 * message is refused as DECRYPT_FAILED (indistinguishable from a corrupt
 * message); a modified pn keeps the key and is HEADER_TAMPERED (S14).
 * Either way a tampered header is never accepted and the session is
 * untouched.
 * Expected before fixes: FAIL (a tampered header could be accepted).
 * After T2.5: pass. (Flipped green by T2.5.)
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

function world() {
  const w = makeWorld();
  w.clients.A!.send('B', 'a1');
  w.clients.B!.send('A', 'b1');
  return w;
}

describe('S13 tampered dhPub', () => {
  it('a modified dhPub is refused (DECRYPT_FAILED: the wrong key is derived) and never decrypts', () => {
    const { network } = world();
    const remove = network.tamper((dto) => ({
      ...dto,
      v3: { ...dto.v3, header: { ...dto.v3.header, dhPub: encodeBase64(nacl.box.keyPair().publicKey) } },
    }));
    network.hold('B');
    network.client('A').send('B', 'a2');
    const [r] = network.release('B');
    remove();

    expect(r!.ok).toBe(false);
    expect(r!.ok ? null : r!.code).toBe('DECRYPT_FAILED');
    expect(network.client('B').inbox.map((m) => m.text)).toEqual(['a1']);
  });

  it('a modified dhPub never changes the persisted session (R7)', () => {
    const { network, clients } = world();
    const before = clients.B!.sessionState('A');
    const remove = network.tamper((dto) => ({
      ...dto,
      v3: { ...dto.v3, header: { ...dto.v3.header, dhPub: encodeBase64(nacl.box.keyPair().publicKey) } },
    }));
    network.hold('B');
    clients.A!.send('B', 'a2');
    const [r] = network.release('B');
    remove();

    expect(r!.ok).toBe(false);
    expect(clients.B!.sessionState('A')).toEqual(before);
  });
});
