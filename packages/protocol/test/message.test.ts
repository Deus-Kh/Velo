import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { initInitiatorSession, initResponderSession } from '../src/ratchet/session';
import { pruneSkippedKeys, ratchetDecrypt, ratchetEncrypt, skippedKeyId, type MessageEnvelope } from '../src/ratchet/message';
import { chainKdf } from '../src/ratchet/chain';
import { MAX_MESSAGE_NUMBER, MAX_SKIP_EPOCHS, MAX_SKIP_PER_STEP, MAX_SKIP_TOTAL, REPLAY_WINDOW } from '../src/ratchet/limits';
import { MAC_LENGTH, type AssociatedData } from '../src/ratchet/envelope';
import { openHeader, sealHeader, type MessageHeader } from '../src/ratchet/header';
import type { RatchetSessionV2 } from '../src/types/session';
import { protocolErrorCode } from '../src/errors';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const pairB64 = (byte: number) => {
  const kp = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(byte));
  return { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
};
const sharedSecret = encodeBase64(new Uint8Array(32).fill(0xaa));
const HK_A = encodeBase64(new Uint8Array(32).fill(0xa1));
const NHK_B = encodeBase64(new Uint8Array(32).fill(0xb2));
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
    a: initInitiatorSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: spkB.publicKey, dhs: dhsA0 }),
    b: initResponderSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'a', sharedSecret, signedPreKey: spkB }),
  };
}

const snapshot = (s: RatchetSessionV2) => JSON.parse(JSON.stringify(s));

/** T3.6: re-seal a modified header under the sender's current header key (an attacker holding HKs). */
function reseal(sender: RatchetSessionV2, env: MessageEnvelope, patch: Partial<MessageHeader>): MessageEnvelope {
  const header = openHeader({ headerKey: decodeBase64(sender.headerKeySend!), encHeader: env.encHeader });
  if (!header) throw new Error('reseal: header does not open under the sender key');
  return { ...env, encHeader: sealHeader({ headerKey: decodeBase64(sender.headerKeySend!), header: { ...header, ...patch } }) };
}

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
    expect(e1.header).toEqual({ n: 0, pn: 0, dhPub: dhsA0.publicKey });
    expect(JSON.stringify(e1.envelope), 'the wire carries no plaintext header field (T3.6)').not.toContain(dhsA0.publicKey);
    expect(openHeader({ headerKey: decodeBase64(a.headerKeySend!), encHeader: e1.envelope.encHeader })).toEqual(e1.header);
    expect(decodeBase64(e1.envelope.mac).length).toBe(MAC_LENGTH);
    expect(Object.keys(e1).sort()).toEqual(['envelope', 'header', 'session']); // T3.4: no key material leaves the step
    a = e1.session;

    const d1 = ratchetDecrypt(b, e1.envelope, AB);
    expect(b).toEqual(b0);
    expect(d1.plaintext).toBe('hello');
    expect(d1.session.Nr).toBe(1);
    expect(d1.session.DHrPublicKey).toBe(dhsA0.publicKey);
    expect(d1.session.DHsPublicKey, 'responder rotated its ratchet key on the first inbound message (R13)').not.toBe(spkB.publicKey);
    expect(d1.session.chainKeySend, 'responder now has a sending chain').not.toBeNull();
    expect(d1.consumedSkippedKeyId).toBeNull();
    expect(Object.keys(d1).sort()).toEqual(['consumedSkippedKeyId', 'header', 'plaintext', 'session']);
    expect(d1.header).toEqual(e1.header);
    b = d1.session;

    const e2 = ratchetEncrypt(b, 'reply', BA);
    expect(e2.header.dhPub).toBe(b.DHsPublicKey);
    const d2 = ratchetDecrypt(a, e2.envelope, BA);
    expect(d2.plaintext).toBe('reply');
    expect(d2.session.DHsPublicKey, 'initiator ratchets when the reply carries a new key').not.toBe(dhsA0.publicKey);
    expect(d2.session.rootKey).not.toBe(a.rootKey);
  });

  it('a responder cannot send before it has received (no sending chain)', () => {
    const { b } = pair();
    expect(codeOf(() => ratchetEncrypt(b, 'too early', BA))).toBe('SESSION_RESET_REQUIRED');
  });

  it('is byte-for-byte reproducible for fixed keys (frozen vector, R8; payload nonce derived, header nonce pinned)', () => {
    const { a } = pair();
    const headerNonce = new Uint8Array(24).fill(0x5a); // the header nonce is random on the wire; pinned here
    const e = ratchetEncrypt(a, 'frozen', AB, { headerNonce });
    expect(hex(decodeBase64(e.envelope.ciphertext))).toBe('2ad488a2e6636032fbb66ba73aae921c3bb409152f7a');
    expect(hex(decodeBase64(e.envelope.mac))).toBe('eadbffa40a6900b05b8462e262d6835d');
    expect(hex(decodeBase64(e.envelope.encHeader))).toBe('5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0e7c9e2f8c82787c58a42a6d0e20f4e08d69f0759bc6c5f762887d0f292cc62923b7d3285280246bdb703b023cf69222a441bed5f319d78659fa8b3af1');
    expect(encodeBase64(chainKdf(decodeBase64(a.chainKeySend!)).messageKey)).toBe('odK3b3KVPxNIFmsQy11o7+UusV0W5yDf8mw1TzKgtkg=');
    expect(hex(decodeBase64(e.session.chainKeySend!))).toBe('e3d95e3d9b1273732c117e750ded362b4d9c8980cce236ab4fea21c614763558');
    expect(ratchetEncrypt(a, 'frozen', AB, { headerNonce }).envelope).toEqual(e.envelope);
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

    // pn changed (forged under the real header key): same key is derived, MAC fails, payload opens → HEADER_TAMPERED.
    const pnTampered = reseal(a, e1.envelope, { pn: e1.header.pn + 7 });
    expect(codeOf(() => ratchetDecrypt(b, pnTampered, AB))).toBe('HEADER_TAMPERED');
    // Re-attributed to a different sender pair: HEADER_TAMPERED (acceptance: "a ciphertext re-attributed fails").
    expect(codeOf(() => ratchetDecrypt(b, e1.envelope, BA))).toBe('HEADER_TAMPERED');
    expect(codeOf(() => ratchetDecrypt(b, e1.envelope, { senderIdentityKey: IK_A, receiverIdentityKey: IK_A }))).toBe('HEADER_TAMPERED');
    // Missing or short MAC.
    expect(codeOf(() => ratchetDecrypt(b, { ...e1.envelope, mac: '' }, AB))).toBe('HEADER_TAMPERED');
    // n changed: a different key is derived, nothing opens → DECRYPT_FAILED.
    const nTampered = reseal(a, e1.envelope, { n: e1.header.n + 1 });
    expect(codeOf(() => ratchetDecrypt(b, nTampered, AB))).toBe('DECRYPT_FAILED');
    // A byte of the encrypted header flipped on the wire: opens under no key → DECRYPT_FAILED (T3.6).
    const flipped = decodeBase64(e1.envelope.encHeader);
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;
    expect(codeOf(() => ratchetDecrypt(b, { ...e1.envelope, encHeader: encodeBase64(flipped) }, AB))).toBe('DECRYPT_FAILED');
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
    const forgedPn = reseal(a, next.envelope, { pn: next.header.pn + MAX_SKIP_PER_STEP + 1 });
    expect(codeOf(() => ratchetDecrypt(b, forgedPn, AB))).toBe('TOO_MANY_SKIPPED');
  });

  it('counters at or beyond MAX_MESSAGE_NUMBER are HEADER_TAMPERED before any derivation', () => {
    const { a, b } = pair();
    const e = ratchetEncrypt(a, 'x', AB);
    for (const bad of [MAX_MESSAGE_NUMBER, 2 ** 32 - 1, -1, 1.5]) {
      expect(codeOf(() => ratchetDecrypt(b, reseal(a, e.envelope, { n: bad }), AB))).toBe('HEADER_TAMPERED');
      expect(codeOf(() => ratchetDecrypt(b, reseal(a, e.envelope, { pn: bad }), AB))).toBe('HEADER_TAMPERED');
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
    // The oldest epochs were evicted together with their header keys (T3.6): a message from one of them
    // opens under no key and is DECRYPT_FAILED, never a ratchet backwards; the receiver cannot even tell it
    // from a replay of a consumed message of that epoch. Within the retained epochs the codes stay precise.
    const before = snapshot(b);
    expect(codeOf(() => ratchetDecrypt(b, held[0]!, AB))).toBe('DECRYPT_FAILED');
    expect(codeOf(() => ratchetDecrypt(b, seen[0]!, AB))).toBe('DECRYPT_FAILED');
    expect(b).toEqual(before);
    // A retained previous epoch: its consumed message is a replay; a never-received one beyond its keys is UNKNOWN_OLD_MESSAGE.
    expect(codeOf(() => ratchetDecrypt(b, seen[seen.length - 3]!, AB))).toBe('REPLAY_DETECTED');
    const twoBackDecrypted = ratchetDecrypt(b, twoBack, AB).session; // consumes held-(k-2); its epoch now has no keys left
    expect(codeOf(() => ratchetDecrypt(twoBackDecrypted, twoBack, AB))).toBe('REPLAY_DETECTED');
    expect(b).toEqual(before);
    // A header sealed under a key this session never had (S18): opens under nothing → DECRYPT_FAILED (T3.6).
    const alien = { ...held[0]!, encHeader: sealHeader({ headerKey: nacl.randomBytes(32), header: { n: 0, pn: 0, dhPub: pairB64(0x99).publicKey } }) };
    expect(codeOf(() => ratchetDecrypt(b, alien, AB))).toBe('DECRYPT_FAILED');
    expect(b).toEqual(before);
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
    expect(a2.header.pn).toBe(2);
    expect(a2.header.dhPub).not.toBe(a1.header.dhPub);

    const d2 = ratchetDecrypt(b, a2.envelope, AB);
    expect(d2.plaintext).toBe('a2');
    expect(Object.keys(d2.session.skippedKeys ?? {})).toEqual([skippedKeyId(a1.header.dhPub, 1)]);
    b = d2.session;

    const d1b = ratchetDecrypt(b, a1b.envelope, AB);
    expect(d1b.plaintext).toBe('a1b');
    expect(d1b.consumedSkippedKeyId).toBe(skippedKeyId(a1.header.dhPub, 1));
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
