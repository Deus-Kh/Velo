import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { initInitiatorSession, initResponderSession } from '../src/ratchet/session';
import { pruneSkippedKeys, ratchetDecrypt, ratchetEncrypt, skippedKeyId, type MessageEnvelope } from '../src/ratchet/message';
import { MAX_MESSAGE_NUMBER, MAX_SKIP_EPOCHS, MAX_SKIP_PER_STEP, MAX_SKIP_TOTAL, REPLAY_WINDOW } from '../src/ratchet/limits';
import { decryptWithMessageKey, MAC_LENGTH, type AssociatedData } from '../src/ratchet/envelope';
import type { RatchetSessionV2 } from '../src/types/session';
import { protocolErrorCode } from '../src/errors';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const pairB64 = (byte: number) => {
  const kp = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(byte));
  return { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
};
const sharedSecret = encodeBase64(new Uint8Array(32).fill(0xaa));
const spkB = pairB64(0x44);
const dhsA0 = pairB64(0x66);
const IK_A = encodeBase64(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0x0a)).publicKey);
const IK_B = encodeBase64(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0x0b)).publicKey);
/** AD for a message from A to B, and from B to A. */
const AB: AssociatedData = { senderIdentityKey: IK_A, receiverIdentityKey: IK_B };
const BA: AssociatedData = { senderIdentityKey: IK_B, receiverIdentityKey: IK_A };

/** Fresh A (initiator) and B (responder) sessions sharing SK and SPK_B. */
function pair() {
  return {
    a: initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: spkB.publicKey, dhs: dhsA0 }),
    b: initResponderSession({ peerUserId: 'a', sharedSecret, signedPreKey: spkB }),
  };
}

const snapshot = (s: RatchetSessionV2) => JSON.parse(JSON.stringify(s));

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return protocolErrorCode(e);
  }
}

describe('ratchetEncrypt / ratchetDecrypt', () => {
  it('round-trips in both directions; the responder ratchets on the first message', () => {
    let { a, b } = pair();
    const a0 = snapshot(a);
    const b0 = snapshot(b);

    const e1 = ratchetEncrypt(a, 'hello', AB);
    expect(a).toEqual(a0);
    expect(e1.session.Ns).toBe(1);
    expect(e1.envelope.header).toEqual({ n: 0, pn: 0, dhPub: dhsA0.publicKey });
    expect(decodeBase64(e1.envelope.mac).length).toBe(MAC_LENGTH);
    expect(e1.derivedKeys).toEqual([{ direction: 'out', dhPub: dhsA0.publicKey, n: 0, messageKeyB64: expect.any(String) }]);
    a = e1.session;

    const d1 = ratchetDecrypt(b, e1.envelope, AB);
    expect(b).toEqual(b0);
    expect(d1.plaintext).toBe('hello');
    expect(d1.session.Nr).toBe(1);
    expect(d1.session.DHrPublicKey).toBe(dhsA0.publicKey);
    expect(d1.session.DHsPublicKey, 'responder rotated its ratchet key on the first inbound message (R13)').not.toBe(spkB.publicKey);
    expect(d1.session.chainKeySend, 'responder now has a sending chain').not.toBeNull();
    expect(d1.consumedSkippedKeyId).toBeNull();
    expect(d1.derivedKeys).toEqual([{ direction: 'in', dhPub: dhsA0.publicKey, n: 0, messageKeyB64: e1.derivedKeys[0]!.messageKeyB64 }]);
    b = d1.session;

    const e2 = ratchetEncrypt(b, 'reply', BA);
    expect(e2.envelope.header.dhPub).toBe(b.DHsPublicKey);
    const d2 = ratchetDecrypt(a, e2.envelope, BA);
    expect(d2.plaintext).toBe('reply');
    expect(d2.session.DHsPublicKey, 'initiator ratchets when the reply carries a new key').not.toBe(dhsA0.publicKey);
    expect(d2.session.rootKey).not.toBe(a.rootKey);
  });

  it('a responder cannot send before it has received (no sending chain)', () => {
    const { b } = pair();
    expect(codeOf(() => ratchetEncrypt(b, 'too early', BA))).toBe('SESSION_RESET_REQUIRED');
  });

  it('is byte-for-byte reproducible for fixed keys (frozen vector, R8; nonce is derived)', () => {
    const { a } = pair();
    const e = ratchetEncrypt(a, 'frozen', AB);
    expect(hex(decodeBase64(e.envelope.ciphertext))).toBe('2ad488a2e6636032fbb66ba73aae921c3bb409152f7a');
    expect(hex(decodeBase64(e.envelope.mac))).toBe('c58e798ea0191c43db8494fa87a760de');
    expect(e.derivedKeys[0]!.messageKeyB64).toBe('odK3b3KVPxNIFmsQy11o7+UusV0W5yDf8mw1TzKgtkg=');
    expect(hex(decodeBase64(e.session.chainKeySend!))).toBe('e3d95e3d9b1273732c117e750ded362b4d9c8980cce236ab4fea21c614763558');
    expect(ratchetEncrypt(a, 'frozen', AB).envelope).toEqual(e.envelope);
  });

  it('a stored message key opens the archived envelope (history path) with the right AD only', () => {
    const { a, b } = pair();
    const e = ratchetEncrypt(a, 'archived', AB);
    ratchetDecrypt(b, e.envelope, AB);
    expect(decryptWithMessageKey({ messageKeyB64: e.derivedKeys[0]!.messageKeyB64, envelope: e.envelope, ad: AB })).toBe('archived');
    expect(codeOf(() => decryptWithMessageKey({ messageKeyB64: e.derivedKeys[0]!.messageKeyB64, envelope: e.envelope, ad: BA }))).toBe('HEADER_TAMPERED');
  });

  it('decrypts out-of-order messages within an epoch via skipped keys and reports the consumed id', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0', AB);
    a = e0.session;
    const e1 = ratchetEncrypt(a, 'm1', AB);
    a = e1.session;
    const e2 = ratchetEncrypt(a, 'm2', AB);
    a = e2.session;

    const d2 = ratchetDecrypt(b, e2.envelope, AB);
    expect(d2.plaintext).toBe('m2');
    expect(d2.derivedKeys.map((k) => k.n)).toEqual([0, 1, 2]);
    expect(Object.keys(d2.session.skippedKeys ?? {})).toEqual([skippedKeyId(dhsA0.publicKey, 0), skippedKeyId(dhsA0.publicKey, 1)]);
    b = d2.session;

    const d0 = ratchetDecrypt(b, e0.envelope, AB);
    expect(d0.plaintext).toBe('m0');
    expect(d0.consumedSkippedKeyId).toBe(skippedKeyId(dhsA0.publicKey, 0));
    expect(Object.keys(d0.session.skippedKeys ?? {})).toEqual([skippedKeyId(dhsA0.publicKey, 1)]);
    b = d0.session;

    // Replay of an already-consumed message is refused.
    expect(codeOf(() => ratchetDecrypt(b, e0.envelope, AB))).toBe('REPLAY_DETECTED');
  });

  it('a modified ciphertext is DECRYPT_FAILED and leaves the input session deep-equal to before (R7)', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0', AB);
    a = e0.session;
    const e1 = ratchetEncrypt(a, 'm1', AB);
    a = e1.session;
    const before = snapshot(b);

    const flipped = decodeBase64(e1.envelope.ciphertext).map((x) => x ^ 1);
    const tampered = { ...e1.envelope, ciphertext: encodeBase64(new Uint8Array(flipped)) };
    expect(codeOf(() => ratchetDecrypt(b, tampered, AB))).toBe('DECRYPT_FAILED');
    expect(b).toEqual(before);

    // Nothing was consumed: the genuine messages still decrypt afterwards.
    expect(ratchetDecrypt(b, e1.envelope, AB).plaintext).toBe('m1');
    expect(ratchetDecrypt(b, e0.envelope, AB).plaintext).toBe('m0');
  });

  it('a modified header or identity pair is HEADER_TAMPERED when the payload itself is intact (T2.5)', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0', AB);
    a = e0.session;
    b = ratchetDecrypt(b, e0.envelope, AB).session;
    const e1 = ratchetEncrypt(a, 'm1', AB);
    const before = snapshot(b);

    // pn changed: same key is derived, MAC fails, payload opens → HEADER_TAMPERED.
    const pnTampered: MessageEnvelope = { ...e1.envelope, header: { ...e1.envelope.header, pn: e1.envelope.header.pn + 7 } };
    expect(codeOf(() => ratchetDecrypt(b, pnTampered, AB))).toBe('HEADER_TAMPERED');
    // Re-attributed to a different sender pair: HEADER_TAMPERED (acceptance: "a ciphertext re-attributed fails").
    expect(codeOf(() => ratchetDecrypt(b, e1.envelope, BA))).toBe('HEADER_TAMPERED');
    expect(codeOf(() => ratchetDecrypt(b, e1.envelope, { senderIdentityKey: IK_A, receiverIdentityKey: IK_A }))).toBe('HEADER_TAMPERED');
    // Missing or short MAC.
    expect(codeOf(() => ratchetDecrypt(b, { ...e1.envelope, mac: '' }, AB))).toBe('HEADER_TAMPERED');
    // n changed: a different key is derived, nothing opens → DECRYPT_FAILED.
    const nTampered: MessageEnvelope = { ...e1.envelope, header: { ...e1.envelope.header, n: e1.envelope.header.n + 1 } };
    expect(codeOf(() => ratchetDecrypt(b, nTampered, AB))).toBe('DECRYPT_FAILED');
    expect(b).toEqual(before);
    expect(ratchetDecrypt(b, e1.envelope, AB).plaintext).toBe('m1');
  });

  it('a tampered skipped-key message throws and keeps the skipped key', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0', AB);
    a = e0.session;
    const e1 = ratchetEncrypt(a, 'm1', AB);
    a = e1.session;
    b = ratchetDecrypt(b, e1.envelope, AB).session;
    const before = snapshot(b);

    const tampered = { ...e0.envelope, mac: encodeBase64(new Uint8Array(MAC_LENGTH)) };
    expect(codeOf(() => ratchetDecrypt(b, tampered, AB))).toBe('HEADER_TAMPERED');
    expect(b).toEqual(before);
    expect(ratchetDecrypt(b, e0.envelope, AB).plaintext).toBe('m0');
  });

  it('a gap of MAX_SKIP_PER_STEP - 1 is derived; MAX_SKIP_PER_STEP + 1 is TOO_MANY_SKIPPED before any derivation (T2.6)', () => {
    let { a, b } = pair();
    const envelopes: MessageEnvelope[] = [];
    for (let i = 0; i < MAX_SKIP_PER_STEP + 2; i += 1) {
      const e = ratchetEncrypt(a, 'm' + String(i), AB);
      a = e.session;
      envelopes.push(e.envelope);
    }
    const before = snapshot(b);
    // gap 101: refused, session untouched.
    expect(codeOf(() => ratchetDecrypt(b, envelopes[MAX_SKIP_PER_STEP + 1]!, AB))).toBe('TOO_MANY_SKIPPED');
    expect(b).toEqual(before);
    // gap 99: fine.
    const ok = ratchetDecrypt(b, envelopes[MAX_SKIP_PER_STEP - 1]!, AB);
    expect(ok.plaintext).toBe('m' + String(MAX_SKIP_PER_STEP - 1));
    // The bound also protects the drain of the previous chain via pn.
    b = ok.session;
    const eb = ratchetEncrypt(b, 'b0', BA);
    b = eb.session;
    a = ratchetDecrypt(a, eb.envelope, BA).session; // A ratchets: new epoch
    const next = ratchetEncrypt(a, 'a-next', AB);
    const forgedPn = { ...next.envelope, header: { ...next.envelope.header, pn: next.envelope.header.pn + MAX_SKIP_PER_STEP + 1 } };
    expect(codeOf(() => ratchetDecrypt(b, forgedPn, AB))).toBe('TOO_MANY_SKIPPED');
  });

  it('counters at or beyond MAX_MESSAGE_NUMBER are HEADER_TAMPERED before any derivation', () => {
    const { a, b } = pair();
    const e = ratchetEncrypt(a, 'x', AB);
    for (const bad of [MAX_MESSAGE_NUMBER, 2 ** 32 - 1, -1, 1.5]) {
      expect(codeOf(() => ratchetDecrypt(b, { ...e.envelope, header: { ...e.envelope.header, n: bad } }, AB))).toBe('HEADER_TAMPERED');
      expect(codeOf(() => ratchetDecrypt(b, { ...e.envelope, header: { ...e.envelope.header, pn: bad } }, AB))).toBe('HEADER_TAMPERED');
    }
  });

  it('retains skipped keys for the last MAX_SKIP_EPOCHS epochs only; an evicted epoch is UNKNOWN_OLD_MESSAGE (T2.6)', () => {
    let { a, b } = pair();
    // Epoch 0..k: in each of A's epochs one message is held back (n = 0), the next (n = 1) is delivered.
    const held: MessageEnvelope[] = [];
    const seen: MessageEnvelope[] = [];
    for (let epoch = 0; epoch <= MAX_SKIP_EPOCHS + 1; epoch += 1) {
      const e0 = ratchetEncrypt(a, 'held-' + String(epoch), AB);
      a = e0.session;
      held.push(e0.envelope);
      const e1 = ratchetEncrypt(a, 'seen-' + String(epoch), AB);
      a = e1.session;
      seen.push(e1.envelope);
      b = ratchetDecrypt(b, e1.envelope, AB).session; // skips n = 0 of this epoch
      const reply = ratchetEncrypt(b, 'r' + String(epoch), BA);
      b = reply.session;
      a = ratchetDecrypt(a, reply.envelope, BA).session; // A moves to the next epoch
    }
    const epochs = b.skippedEpochOrder ?? [];
    expect(epochs.length).toBe(MAX_SKIP_EPOCHS);
    expect(Object.keys(b.skippedKeys ?? {}).length).toBe(MAX_SKIP_EPOCHS);

    // 2 epochs back decrypts from its retained key.
    const twoBack = held[held.length - 3]!;
    expect(ratchetDecrypt(b, twoBack, AB).plaintext).toBe('held-' + String(held.length - 3));
    // The oldest epochs were evicted: a known previous epoch without keys is UNKNOWN_OLD_MESSAGE, never a ratchet backwards.
    const before = snapshot(b);
    expect(codeOf(() => ratchetDecrypt(b, held[0]!, AB))).toBe('UNKNOWN_OLD_MESSAGE');
    expect(b).toEqual(before);
    // T3.4: a consumed message from that same evicted epoch is a replay, not an unknown old message.
    expect(codeOf(() => ratchetDecrypt(b, seen[0]!, AB))).toBe('REPLAY_DETECTED');
    expect(b).toEqual(before);
    // A never-seen epoch key is still treated as new (S18): ratchet attempt, then DECRYPT_FAILED.
    const alien = { ...held[0]!, header: { ...held[0]!.header, dhPub: pairB64(0x99).publicKey } };
    expect(codeOf(() => ratchetDecrypt(b, alien, AB))).toBe('DECRYPT_FAILED');
  });

  it('never retains more than MAX_SKIP_TOTAL skipped keys; eviction is oldest-epoch-first and deterministic', () => {
    let { a, b } = pair();
    const perEpoch = MAX_SKIP_PER_STEP - 1; // 99 skipped per epoch
    const epochs = Math.ceil(MAX_SKIP_TOTAL / perEpoch) + 1; // enough to overflow within MAX_SKIP_EPOCHS? no: cap by epochs first
    for (let epoch = 0; epoch < Math.min(epochs, MAX_SKIP_EPOCHS); epoch += 1) {
      for (let i = 0; i < perEpoch; i += 1) a = ratchetEncrypt(a, 'skip', AB).session;
      const last = ratchetEncrypt(a, 'last-' + String(epoch), AB);
      a = last.session;
      b = ratchetDecrypt(b, last.envelope, AB).session;
      const reply = ratchetEncrypt(b, 'r', BA);
      b = reply.session;
      a = ratchetDecrypt(a, reply.envelope, BA).session;
    }
    const total = Object.keys(b.skippedKeys ?? {}).length;
    expect(total).toBeLessThanOrEqual(MAX_SKIP_TOTAL);
    expect(total).toBe(Math.min(MAX_SKIP_TOTAL, perEpoch * Math.min(epochs, MAX_SKIP_EPOCHS)));
    // Oldest epoch lost keys first, lowest n first.
    const order = b.skippedEpochOrder ?? [];
    const oldest = order[0]!;
    const oldestNs = Object.keys(b.skippedKeys ?? {}).filter((id) => id.startsWith(oldest + ':')).map((id) => Number(id.slice(id.lastIndexOf(':') + 1)));
    if (total === MAX_SKIP_TOTAL) {
      expect(Math.min(...oldestNs)).toBeGreaterThan(0);
      expect(oldestNs.length).toBeLessThan(perEpoch);
    }
    expect(pruneSkippedKeys(b)).toEqual(pruneSkippedKeys(b));
    expect(pruneSkippedKeys(pruneSkippedKeys(b))).toEqual(pruneSkippedKeys(b));
  });

  it('a previous-epoch message arriving after the next epoch decrypts from a key drained via pn (T2.7 + T2.8)', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'a0', AB);
    a = e0.session;
    b = ratchetDecrypt(b, e0.envelope, AB).session; // B ratchets (B0)
    const eb0 = ratchetEncrypt(b, 'b0', BA);
    b = eb0.session;
    a = ratchetDecrypt(a, eb0.envelope, BA).session; // A ratchets: epoch A1

    const a1 = ratchetEncrypt(a, 'a1', AB); // A1, n = 0
    a = a1.session;
    const a1b = ratchetEncrypt(a, 'a1b', AB); // A1, n = 1 — delivered last
    a = a1b.session;

    b = ratchetDecrypt(b, a1.envelope, AB).session; // B ratchets (B1)
    const eb1 = ratchetEncrypt(b, 'b1', BA);
    b = eb1.session;
    a = ratchetDecrypt(a, eb1.envelope, BA).session; // A ratchets: epoch A2
    const a2 = ratchetEncrypt(a, 'a2', AB); // A2, n = 0, pn = 2
    expect(a2.envelope.header.pn).toBe(2);
    expect(a2.envelope.header.dhPub).not.toBe(a1.envelope.header.dhPub);

    const d2 = ratchetDecrypt(b, a2.envelope, AB);
    expect(d2.plaintext).toBe('a2');
    expect(Object.keys(d2.session.skippedKeys ?? {})).toEqual([skippedKeyId(a1.envelope.header.dhPub, 1)]);
    b = d2.session;

    const d1b = ratchetDecrypt(b, a1b.envelope, AB);
    expect(d1b.plaintext).toBe('a1b');
    expect(d1b.consumedSkippedKeyId).toBe(skippedKeyId(a1.envelope.header.dhPub, 1));
    expect(Object.keys(d1b.session.skippedKeys ?? {})).toHaveLength(0);
  });

  it('never adopts a peer key without ratcheting: the root key changes on every new peer key (R13)', () => {
    let { a, b } = pair();
    const roots = new Set<string>([a.rootKey, b.rootKey]);
    for (let i = 0; i < 4; i += 1) {
      const ea = ratchetEncrypt(a, 'a' + String(i), AB);
      a = ea.session;
      b = ratchetDecrypt(b, ea.envelope, AB).session;
      roots.add(b.rootKey);
      const eb = ratchetEncrypt(b, 'b' + String(i), BA);
      b = eb.session;
      a = ratchetDecrypt(a, eb.envelope, BA).session;
      roots.add(a.rootKey);
    }
    expect(roots.size).toBe(2 + 8);
  });

  it('rejects a corrupted session without a sending key and identity keys of the wrong length', () => {
    const { a } = pair();
    expect(codeOf(() => ratchetEncrypt({ ...a, DHsPublicKey: null as unknown as string }, 'x', AB))).toBe('STORAGE_CORRUPTION');
    expect(codeOf(() => ratchetEncrypt(a, 'x', { senderIdentityKey: encodeBase64(new Uint8Array(16)), receiverIdentityKey: IK_B }))).toBe('INVALID_KEY_LENGTH');
  });

  describe('replay window (T3.4)', () => {
    it('remembers the last REPLAY_WINDOW consumed ids; beyond it a copy reads as UNKNOWN_OLD_MESSAGE, never derives, never mutates', () => {
      let { a, b } = pair();
      const first = ratchetEncrypt(a, 'first', AB);
      a = first.session;
      b = ratchetDecrypt(b, first.envelope, AB).session;
      expect(b.recentlyReceived).toEqual([skippedKeyId(dhsA0.publicKey, 0)]);
      expect(codeOf(() => ratchetDecrypt(b, first.envelope, AB))).toBe('REPLAY_DETECTED');

      let last = first;
      for (let i = 0; i < REPLAY_WINDOW; i += 1) {
        last = ratchetEncrypt(a, 'm' + String(i), AB);
        a = last.session;
        b = ratchetDecrypt(b, last.envelope, AB).session;
      }
      expect(b.recentlyReceived!.length).toBe(REPLAY_WINDOW);
      expect(b.recentlyReceived![0]).toBe(skippedKeyId(dhsA0.publicKey, 1)); // the first id fell out of the window

      const before = snapshot(b);
      expect(codeOf(() => ratchetDecrypt(b, last.envelope, AB))).toBe('REPLAY_DETECTED');
      expect(codeOf(() => ratchetDecrypt(b, first.envelope, AB))).toBe('UNKNOWN_OLD_MESSAGE');
      expect(b).toEqual(before);
    });

    it('a skipped key consumed out of order enters the window too', () => {
      let { a, b } = pair();
      const e0 = ratchetEncrypt(a, 'm0', AB);
      a = e0.session;
      const e1 = ratchetEncrypt(a, 'm1', AB);
      a = e1.session;
      b = ratchetDecrypt(b, e1.envelope, AB).session;
      b = ratchetDecrypt(b, e0.envelope, AB).session; // skipped-key fast path
      expect(b.recentlyReceived).toEqual([skippedKeyId(dhsA0.publicKey, 1), skippedKeyId(dhsA0.publicKey, 0)]);
      expect(codeOf(() => ratchetDecrypt(b, e0.envelope, AB))).toBe('REPLAY_DETECTED');
    });
  });
});
