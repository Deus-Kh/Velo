/**
 * S10 — Wipe one client, reset, recover.
 * Checklist: §7.1, §7.2.
 * Defects covered: P1-11 (stale one-time prekeys after a reinstall: the
 * server now purges a user's prekeys when their identity changes, T2.13)
 * and P0-9 (the reinstalled peer has a new identity: the other side must
 * see IDENTITY_MISMATCH and accept the new identity before continuing).
 * Expected before fixes: FAIL. After T2.13: pass. (Flipped green by T2.13.)
 */
import { describe, expect, it } from 'vitest';
import { codeOf, makeWorld } from '../harness';

function wipeAndFailOnce(opts: { oneTimePreKeys: number }) {
  const w = makeWorld(['A', 'B'], opts);
  const { network, clients } = w;
  const { A, B } = clients;

  A!.send('B', 'before wipe');
  B!.send('A', 'ack');

  B!.wipe();
  B!.register(); // reinstall: fresh identity, signed prekey and one-time prekeys
  expect(B!.hasSession('A')).toBe(false);
  // The server told A that B's identity changed (they share a conversation).
  expect(A!.identityChanges).toEqual(['B']);

  // A still has its session and sends without an initPacket; B has no
  // session and (since T2.13) the server attaches nothing.
  network.hold('B');
  A!.send('B', 'lost');
  const [lost] = network.release('B');
  expect(lost!.ok).toBe(false);
  expect(lost!.ok ? null : lost!.code, 'a message without a session must fail loudly, not silently').toBe('MISSING_BOOTSTRAP');

  A!.resetSession('B');
  B!.resetSession('A');
  return w;
}

describe('S10 wipe one client, reset, recover', () => {
  it('after a reinstall, A is blocked by the changed identity until it accepts, then recovers on fresh prekeys', () => {
    const { server, clients } = wipeAndFailOnce({ oneTimePreKeys: 10 });
    const { A, B } = clients;

    // B's pre-reinstall prekeys are gone from the server (P1-11).
    expect(server.unusedOneTimePreKeyCount('B')).toBe(10);

    // A's pin still names B's old identity: the new bundle is refused.
    expect(codeOf(() => A!.send('B', 'recovered')), 'the reinstalled peer’s new identity must not be accepted silently').toBe('IDENTITY_MISMATCH');
    expect(A!.hasSession('B')).toBe(false);

    // The user compares safety numbers and accepts the new identity.
    A!.acceptNewIdentity('B');
    const recovered = A!.send('B', 'recovered');
    expect(recovered.initPacket).not.toBeNull();
    expect(B!.inbox.map((m) => m.text)).toEqual(['recovered']);
    B!.send('A', 'welcome back');
    expect(A!.inbox.map((m) => m.text)).toEqual(['ack', 'welcome back']);
  });

  it('recovery also works when the pool was exhausted before the reinstall', () => {
    const { clients } = wipeAndFailOnce({ oneTimePreKeys: 1 });
    const { A, B } = clients;

    expect(codeOf(() => A!.send('B', 'recovered'))).toBe('IDENTITY_MISMATCH');
    A!.acceptNewIdentity('B');
    expect(A!.send('B', 'recovered').initPacket).not.toBeNull();
    expect(B!.inbox.map((m) => m.text)).toEqual(['recovered']);
  });
});
