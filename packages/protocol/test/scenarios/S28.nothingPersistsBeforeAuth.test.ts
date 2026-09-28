/**
 * S28 — Nothing persists before authentication (T3.4 audit, R7).
 * Checklist: §6 (integrity), §7 (initPacket policy).
 * For every refusal class a device can meet on the wire, its persisted
 * state (session, secondary session, bootstrap cache, one-time prekey
 * secrets, message store) is byte-identical before and after, and the
 * server still holds the message (no delivered ack was sent).
 * Expected: green from the start (written with T3.4).
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { MAX_SKIP_PER_STEP } from '../../src/ratchet/limits';
import { alienHeader, flipEncHeader, makeWorld, resealHeader } from '../harness';
import type { NewMessageDTO, VirtualClient } from '../harness';

type Case = { name: string; code: string; tamper: (dto: NewMessageDTO, sender: VirtualClient) => NewMessageDTO };

describe('S28 nothing persists before authentication', () => {
  const cases: Case[] = [
    { name: 'ciphertext modified', code: 'DECRYPT_FAILED', tamper: (d) => ({ ...d, v4: { ...d.v4, ciphertext: encodeBase64(new Uint8Array(40).fill(1)) } }) },
    { name: 'mac modified (payload intact)', code: 'HEADER_TAMPERED', tamper: (d) => ({ ...d, v4: { ...d.v4, mac: encodeBase64(new Uint8Array(16)) } }) },
    { name: 'encrypted header byte flipped', code: 'DECRYPT_FAILED', tamper: (d) => flipEncHeader(d) },
    { name: 'pn modified under the real header key', code: 'HEADER_TAMPERED', tamper: (d, A) => resealHeader(A, d, { pn: A.sentHeader(d.clientMessageId).pn + 1 }) },
    { name: 'counter gap too large (real header key)', code: 'TOO_MANY_SKIPPED', tamper: (d, A) => resealHeader(A, d, { n: A.sentHeader(d.clientMessageId).n + MAX_SKIP_PER_STEP + 1 }) },
    { name: 'header under an unknown key', code: 'DECRYPT_FAILED', tamper: (d) => alienHeader(d) },
  ];

  for (const c of cases) {
    it(`${c.name}: ${c.code}, state and server untouched`, () => {
      const { server, network, clients } = makeWorld();
      const { A, B } = clients;
      A!.send('B', 'establish');
      B!.send('A', 'both ways');
      const before = B!.serialize();
      const heldBefore = server.heldCiphertextCount('A:B');

      const stop = network.tamper((d) => c.tamper(d, A!));
      A!.send('B', 'attacked');
      stop();

      const r = network.log.at(-1)!;
      expect(r.ok).toBe(false);
      expect(r.ok ? null : r.code).toBe(c.code);
      expect(B!.serialize()).toBe(before);
      expect(server.heldCiphertextCount('A:B')).toBe(heldBefore + 1); // no ack: the genuine copy waits for a retry
    });
  }

  it('a replayed message: REPLAY_DETECTED, state untouched', () => {
    const { network, clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'establish');
    network.hold('B');
    A!.send('B', 'once');
    network.duplicate('B', 0);
    const [first, second] = network.release('B');
    expect(first!.ok).toBe(true);
    const after = B!.serialize();
    expect(second!.ok ? null : second!.code).toBe('REPLAY_DETECTED');
    expect(B!.serialize()).toBe(after);
  });

  it('a bogus bootstrap packet on first contact: no session, no bootstrap record, prekey secret kept', () => {
    const { server, network, clients } = makeWorld();
    const { A, B } = clients;
    // The trust-on-first-use pin is server-sourced state (the binding-verified identity record),
    // not something derived from the message; it is the one entry allowed to appear.
    const withoutPin = (serialized: string) => (JSON.parse(serialized) as Array<[string, string]>).filter(([k]) => !k.startsWith('trust:'));
    const before = withoutPin(B!.serialize());
    const stop = network.tamper((d) => (d.initPacket ? { ...d, initPacket: { ...d.initPacket, ephPublicKey: encodeBase64(nacl.box.keyPair().publicKey) } } : d));
    A!.send('B', 'hello?');
    stop();
    const r = network.log.at(-1)!;
    expect(r.ok ? null : r.code).toBe('DECRYPT_FAILED');
    expect(withoutPin(B!.serialize())).toEqual(before);
    expect(B!.trustedIdentity('A')).toEqual(server.getIdentity('B', 'A')); // the pin is exactly the server's record for A
    expect(B!.hasSession('A')).toBe(false);
    expect(server.undelivered('B', 'A')).toHaveLength(1);
  });
});
