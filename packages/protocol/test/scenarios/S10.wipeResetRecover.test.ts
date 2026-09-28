/**
 * S10 — Wipe one client, reset, recover.
 * Checklist: §7.1, §7.2.
 * Defect covered: P1-11 (extended by this scenario) — after a reinstall the
 * server still holds the user's OLD one-time prekeys and serves the oldest
 * unused one first; the reinstalled client has no secret for it, so every
 * new session to that user fails with SESSION_RESET_REQUIRED until the
 * stale pool drains. POST /keys/identity never purges prekeys and the
 * client's top-up is count based (prekeys.ts), so nothing replaces them.
 * Expected before fixes: FAIL (recovery). After T2.13 (identity change
 * purges the user's prekeys): pass.
 * NOTE for T2.13: the reinstall also changes B's identity, so A must then
 * see IDENTITY_MISMATCH and accept the new identity before "recovered".
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

function wipeAndFailOnce(opts: { oneTimePreKeys: number }) {
  const w = makeWorld(['A', 'B'], opts);
  const { network, clients } = w;
  const { A, B } = clients;

  A!.send('B', 'before wipe');
  B!.send('A', 'ack');

  B!.wipe();
  B!.register(); // reinstall: fresh identity, signed prekey and one-time prekeys
  expect(B!.hasSession('A')).toBe(false);

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
  it.fails('after both resets, a new session to the reinstalled B works (stale one-time prekeys still on the server)', () => {
    const { server, network, clients } = wipeAndFailOnce({ oneTimePreKeys: 10 });
    const { A, B } = clients;

    network.hold('B');
    const recovered = A!.send('B', 'recovered');
    const [r] = network.release('B');
    expect(recovered.initPacket).not.toBeNull();
    expect(
      r!.ok,
      'recovery failed with ' + String(r!.ok ? '' : r!.code) + ': the server served one of B\'s pre-reinstall one-time prekeys (' +
        String(server.unusedOneTimePreKeyCount('B')) + ' unused, most of them stale) — P1-11, T2.13',
    ).toBe(true);
    expect(B!.inbox.map((m) => m.text)).toEqual(['recovered']);
  });

  it('recovery works when no stale one-time prekeys remain on the server', () => {
    // Pool of one, consumed by the first contact: after the reinstall only fresh keys exist.
    const { clients } = wipeAndFailOnce({ oneTimePreKeys: 1 });
    const { A, B } = clients;

    const recovered = A!.send('B', 'recovered');
    expect(recovered.initPacket).not.toBeNull();
    expect(B!.inbox.map((m) => m.text)).toEqual(['recovered']);
    B!.send('A', 'welcome back');
    expect(A!.inbox.map((m) => m.text)).toEqual(['ack', 'welcome back']);
  });
});
