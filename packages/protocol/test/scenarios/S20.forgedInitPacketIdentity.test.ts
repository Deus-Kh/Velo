/**
 * S20 — Forged initPacket identity.
 * Checklist: none (malicious server).
 * Defect covered: P0-9 — the responder never authenticates the initiator.
 * A server (or anyone who can speak to it as "A") bootstraps a session with
 * B using its own identity key; B has A's identity pinned and still accepts.
 * Expected before fixes: FAIL — the forged message decrypts as if from A.
 * After T2.13: pass with IDENTITY_MISMATCH. (Flipped green by T2.13.)
 */
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../harness';

describe('S20 forged initPacket identity', () => {
  it('B rejects a bootstrap whose initiator identity key is not the pinned key for A', () => {
    const { server, network, clients } = makeWorld(['A', 'B', 'M']);
    const { B, M } = clients;

    // B has verified A out of band (VerifyContactScreen pins both keys).
    B!.pinIdentity('A', server.getIdentity('B', 'A'));

    // The malicious server relabels M's traffic as coming from A.
    server.malicious.relabelSender = (from) => (from === 'M' ? 'A' : from);
    network.hold('B');
    M!.send('B', 'I am A, trust me');
    const [r] = network.release('B');

    expect(r!.ok, 'B accepted a session for "A" bootstrapped with an identity key that is not A\'s pinned key (P0-9)').toBe(false);
    expect(r!.ok ? null : r!.code).toBe('IDENTITY_MISMATCH');
    expect(B!.hasSession('A')).toBe(false);
  });
});
