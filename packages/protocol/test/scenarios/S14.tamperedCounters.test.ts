/**
 * S14 — Tampered header.n / header.pn.
 * Checklist: none (adversarial).
 * Defect covered: the header is not authenticated (P1-2, T2.5).
 *  - n+1: the receiver derives an extra key and fails with DECRYPT_FAILED
 *    instead of HEADER_TAMPERED.
 *  - pn+7: the message is ACCEPTED with a modified header, because pn is
 *    never read (P1-4) and not authenticated.
 * Expected before fixes: FAIL (both). After T2.5: pass.
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
  it.fails('n incremented on the wire is reported as HEADER_TAMPERED', () => {
    const { result } = deliverTampered((dto) => ({ ...dto, v2: { ...dto.v2, header: { ...dto.v2.header, n: dto.v2.header.n + 1 } } }));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.code, 'counter modification must surface as HEADER_TAMPERED (T2.5)').toBe('HEADER_TAMPERED');
  });

  it.fails('pn modified on the wire is rejected, not silently accepted', () => {
    const { result } = deliverTampered((dto) => ({ ...dto, v2: { ...dto.v2, header: { ...dto.v2.header, pn: dto.v2.header.pn + 7 } } }));
    expect(result.ok, 'a message with a modified pn was accepted: pn is neither authenticated nor used (P1-2, P1-4)').toBe(false);
    expect(result.ok ? null : result.code).toBe('HEADER_TAMPERED');
  });
});
