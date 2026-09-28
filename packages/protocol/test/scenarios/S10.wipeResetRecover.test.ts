/**
 * S10 — Wipe one client, reset, recover.
 * Checklist: §7.1, §7.2.
 * Defects covered: P1-11 (stale one-time prekeys after a reinstall: the
 * server now purges a user's prekeys when their identity changes, T2.13)
 * and P0-9 (the reinstalled peer has a new identity: the other side must
 * see IDENTITY_MISMATCH and accept the new identity before continuing).
 * Expected before fixes: FAIL. After T2.13: pass. (Flipped green by T2.13.)
 * Since T2.11 no manual session reset is needed on either side: accepting
 * the new identity drops A's stale session, and B has none.
 */
import { describe, expect, it } from 'vitest';
import { codeOf, makeWorld } from '../harness';

function wipeAndFailOnce(opts: { oneTimePreKeys: number }) {
  const w = makeWorld(['A', 'B'], opts);
  const { network, clients } = w;
  const { A, B } = clients;

  A!.send('B', 'before wipe');
  B!.send('A', 'ack');

  // B reinstalls: local state gone. Before B has registered again, a message from A
  // finds no session on B and (since T2.13) the server attaches nothing.
  B!.wipe();
  network.hold('B');
  A!.send('B', 'lost');
  const [lost] = network.release('B');
  expect(lost!.ok).toBe(false);
  expect(lost!.ok ? null : lost!.code, 'a message without a session must fail loudly, not silently').toBe('MISSING_BOOTSTRAP');

  // B registers again with a fresh identity, signed prekey and one-time prekeys;
  // the server tells A that B's identity changed (they share a conversation).
  B!.register();
  expect(B!.hasSession('A')).toBe(false);
  expect(A!.identityChanges).toEqual(['B']);
  return w;
}

describe('S10 wipe one client, reset, recover', () => {
  it('after a reinstall, A is blocked by the changed identity until it accepts, then recovers on fresh prekeys — no manual reset', () => {
    const { server, clients } = wipeAndFailOnce({ oneTimePreKeys: 10 });
    const { A, B } = clients;

    // B's pre-reinstall prekeys are gone from the server (P1-11).
    expect(server.unusedOneTimePreKeyCount('B')).toBe(10);

    // A was told B's identity changed: sending is blocked until the user accepts (the client's identity_changed state).
    expect(codeOf(() => A!.send('B', 'recovered')), 'the reinstalled peer’s new identity must not be accepted silently').toBe('IDENTITY_MISMATCH');
    expect(A!.hasSession('B'), 'the stale session is dropped only when the user accepts the new identity').toBe(true);

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
