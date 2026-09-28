/**
 * S13 — Tampered header.dhPub.
 * Checklist: none (adversarial).
 * Defect covered: the header is not authenticated (P1-2, T2.5). Today a
 * modified dhPub is treated as a new epoch and only fails when the
 * ciphertext does not open under the garbage chain.
 * Expected before fixes: FAIL — the error is DECRYPT_FAILED, not
 * HEADER_TAMPERED. After T2.5: pass.
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
  it.fails('a modified dhPub is reported as HEADER_TAMPERED', () => {
    const { network } = world();
    const remove = network.tamper((dto) => ({
      ...dto,
      v2: { ...dto.v2, header: { ...dto.v2.header, dhPub: encodeBase64(nacl.box.keyPair().publicKey) } },
    }));
    network.hold('B');
    network.client('A').send('B', 'a2');
    const [r] = network.release('B');
    remove();

    expect(r!.ok).toBe(false);
    expect(r!.ok ? null : r!.code, 'header modification must surface as the security-warning class (T2.5)').toBe('HEADER_TAMPERED');
  });

  it('a modified dhPub never changes the persisted session (R7)', () => {
    const { network, clients } = world();
    const before = clients.B!.sessionState('A');
    const remove = network.tamper((dto) => ({
      ...dto,
      v2: { ...dto.v2, header: { ...dto.v2.header, dhPub: encodeBase64(nacl.box.keyPair().publicKey) } },
    }));
    network.hold('B');
    clients.A!.send('B', 'a2');
    const [r] = network.release('B');
    remove();

    expect(r!.ok).toBe(false);
    expect(clients.B!.sessionState('A')).toEqual(before);
  });
});
