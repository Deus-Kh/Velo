/**
 * S14 — Tampered header.n / header.pn.
 * Checklist: none (adversarial).
 * Defect covered: the header is not authenticated (P1-2, T2.5).
 *  - n+1: a different key is derived, nothing opens → DECRYPT_FAILED;
 *    the message is refused (before T2.5 it was refused for the same
 *    reason, by accident of the wrong key).
 *  - pn+7: before T2.5 the message was ACCEPTED with a modified header
 *    (pn unauthenticated); now the MAC fails while the payload is intact
 *    → HEADER_TAMPERED, the security-warning class.
 * Expected before fixes: FAIL. After T2.5: pass. (Flipped green by T2.5.)
 */
import { describe, expect, it } from 'vitest';
import { makeWorld, type NewMessageDTO } from '../harness';

function deliverTampered(mutate: (dto: NewMessageDTO) => NewMessageDTO) {
  const { network, clients } = makeWorld();
  clients.A!.send('B', 'a1');
  const remove = network.tamper(mutate);
  network.hold('B');
  clients.A!.send('B', 'a2');
  const [r] = network.release('B');
  remove();
  return { result: r!, B: clients.B! };
}

describe('S14 tampered n / pn', () => {
  it('n incremented on the wire is refused (DECRYPT_FAILED: a different key is derived)', () => {
    const { result, B } = deliverTampered((dto) => ({ ...dto, v3: { ...dto.v3, header: { ...dto.v3.header, n: dto.v3.header.n + 1 } } }));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.code).toBe('DECRYPT_FAILED');
    expect(B.inbox.map((m) => m.text)).toEqual(['a1']);
  });

  it('pn modified on the wire is HEADER_TAMPERED, never accepted', () => {
    const { result, B } = deliverTampered((dto) => ({ ...dto, v3: { ...dto.v3, header: { ...dto.v3.header, pn: dto.v3.header.pn + 7 } } }));
    expect(result.ok, 'a message with a modified pn must not be accepted (P1-2)').toBe(false);
    expect(result.ok ? null : result.code).toBe('HEADER_TAMPERED');
    expect(B.inbox.map((m) => m.text)).toEqual(['a1']);
  });

  it('a message checked under a different identity pair is HEADER_TAMPERED (identities are in the MAC)', () => {
    const { network, clients } = makeWorld(['A', 'B', 'C']);
    clients.A!.send('B', 'a1');
    // B's pin for A is swapped for C's identity (a tampered trust store):
    // the same session and key, but the MAC was computed over A's identity.
    clients.B!.pinIdentity('A', clients.C!.identityKeys());
    const before = clients.B!.sessionState('A');
    network.hold('B');
    clients.A!.send('B', 'a2');
    const [r] = network.release('B');
    expect(r!.ok).toBe(false);
    expect(r!.ok ? null : r!.code).toBe('HEADER_TAMPERED');
    expect(clients.B!.sessionState('A')).toEqual(before);
    expect(clients.B!.inbox.map((m) => m.text)).toEqual(['a1']);
  });
});
