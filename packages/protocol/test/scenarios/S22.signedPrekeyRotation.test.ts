/**
 * S22 — Signed prekey rotation (T2.10, P1-6).
 * Checklist: none (added with T2.10).
 * Defect covered: the signed prekey never rotated and its signature did not
 * cover the key id.
 * Expected: rotation after 7 days on the next key bootstrap; a handshake
 * built from a 20-day-old bundle still completes; 31 days old is a typed
 * error; sessions created before a rotation keep working (they copied the
 * pair); the server serves the newest key.
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

const DAY = 24 * 60 * 60 * 1000;

describe('S22 signed prekey rotation', () => {
  it('rotates after 7 days, keeps existing sessions, and honours retained keys for 30 days', () => {
    const { server, clients, clock } = makeWorld();
    const { A, B } = clients;

    const spk0 = server.getPreKeyBundle('A', 'B').signedPreKey.keyId; // issues a bundle just to read the current key id
    A!.send('B', 'before rotation');
    B!.send('A', 'ack');

    // Day 6: no rotation on bootstrap.
    clock.advance(6 * DAY);
    B!.register();
    expect(server.getPreKeyBundle('A', 'B').signedPreKey.keyId).toBe(spk0);

    // Day 8: rotation on the next key bootstrap; the server now serves the new key.
    clock.advance(2 * DAY);
    B!.register();
    const spk1 = server.getPreKeyBundle('A', 'B').signedPreKey.keyId;
    expect(spk1).not.toBe(spk0);

    // The pre-rotation session keeps working in both directions.
    A!.send('B', 'after rotation');
    B!.send('A', 'still fine');
    expect(B!.inbox.map((m) => m.text)).toEqual(['before rotation', 'after rotation']);
    expect(A!.inbox.map((m) => m.text)).toEqual(['ack', 'still fine']);
  });

  it('a bootstrap against a retained (20-day-old) key completes; against an expired (31-day-old) key it is SESSION_RESET_REQUIRED', () => {
    const { network, clients, clock } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;

    // A and C fetch bundles now (key k0), but hold their first messages.
    network.hold('B');
    A!.send('B', 'from A on k0');
    C!.send('B', 'from C on k0');
    const [toBfromA, toBfromC] = network.pending('B');

    // B rotates on day 8 and again on day 16 (k0 retained, then k1 retained too).
    clock.advance(8 * DAY);
    B!.register();
    clock.advance(8 * DAY);
    B!.register();

    // Day 20: A's message (built on k0) arrives — k0 is retained, the handshake completes.
    clock.advance(4 * DAY);
    const r1 = network.deliverNow('B', toBfromA!);
    expect(r1.ok, 'a 20-day-old signed prekey must still complete the handshake').toBe(true);
    expect(B!.inbox.map((m) => m.text)).toEqual(['from A on k0']);

    // Day 31: C's message (also on k0) arrives — k0 has expired.
    clock.advance(11 * DAY);
    const r2 = network.deliverNow('B', toBfromC!);
    expect(r2.ok).toBe(false);
    expect(r2.ok ? null : r2.code).toBe('SESSION_RESET_REQUIRED');
    expect(B!.hasSession('C')).toBe(false);
    network.discard('B');
    network.release('B'); // stop holding: nothing queued, deliveries are live again

    // C resets and starts over on the current key.
    C!.resetSession('B');
    C!.send('B', 'from C on the current key');
    expect(B!.inbox.map((m) => m.text)).toEqual(['from A on k0', 'from C on the current key']);
  });
});
