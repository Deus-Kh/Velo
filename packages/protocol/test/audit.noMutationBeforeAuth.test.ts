/**
 * T3.4 — mutation audit. The pure steps never touch their inputs: the
 * session and the envelope are deep-frozen, so any write would throw a
 * TypeError in strict mode instead of the expected ProtocolError, and the
 * inputs are compared to a snapshot after every failure class and after
 * success. The client and the harness persist only what a step returns
 * (R7); S28 covers that end to end.
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { isProtocolError, type ProtocolErrorCode } from '../src/errors';
import { dhRatchet } from '../src/ratchet/dh';
import { type AssociatedData, type MessageEnvelope } from '../src/ratchet/envelope';
import { MAX_MESSAGE_NUMBER, MAX_SKIP_PER_STEP } from '../src/ratchet/limits';
import { ratchetDecrypt, ratchetEncrypt } from '../src/ratchet/message';
import { initInitiatorSession, initResponderSession } from '../src/ratchet/session';
import type { RatchetSessionV2 } from '../src/types/session';

const AB: AssociatedData = {
  senderIdentityKey: encodeBase64(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1)).publicKey),
  receiverIdentityKey: encodeBase64(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(2)).publicKey),
};
const BA: AssociatedData = { senderIdentityKey: AB.receiverIdentityKey, receiverIdentityKey: AB.senderIdentityKey };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[k]);
  }
  return value;
}
const HK_A = encodeBase64(new Uint8Array(32).fill(0xa1));
const NHK_B = encodeBase64(new Uint8Array(32).fill(0xb2));
const snapshot = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function pair() {
  const spk = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(7));
  const sk = encodeBase64(new Uint8Array(32).fill(9));
  const spkB64 = { publicKey: encodeBase64(spk.publicKey), privateKey: encodeBase64(spk.secretKey) };
  return {
    a: initInitiatorSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'B', sharedSecret: sk, theirSignedPreKeyPublicKey: spkB64.publicKey }),
    b: initResponderSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'A', sharedSecret: sk, signedPreKey: spkB64 }),
  };
}

/** Runs the step on frozen inputs and asserts: a ProtocolError with `code` (never a TypeError), inputs unchanged. */
function expectRefusal(session: RatchetSessionV2, envelope: MessageEnvelope, ad: AssociatedData, code: ProtocolErrorCode): void {
  const frozenSession = deepFreeze(snapshot(session));
  const frozenEnvelope = deepFreeze(snapshot(envelope));
  const before = snapshot(frozenSession);
  let caught: unknown;
  try {
    ratchetDecrypt(frozenSession, frozenEnvelope, ad);
  } catch (e) {
    caught = e;
  }
  expect(caught, 'the step must refuse').toBeDefined();
  expect(caught instanceof TypeError, 'a TypeError here means the step wrote into its input').toBe(false);
  expect(isProtocolError(caught) ? caught.code : caught).toBe(code);
  expect(frozenSession).toEqual(before);
  expect(frozenEnvelope).toEqual(snapshot(envelope));
}

describe('T3.4 audit: the pure steps never mutate their inputs', () => {
  it('every refusal class leaves the frozen session and envelope untouched', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0', AB);
    a = e0.session;
    const e1 = ratchetEncrypt(a, 'm1', AB);
    a = e1.session;
    b = ratchetDecrypt(b, e0.envelope, AB).session;

    // bad ciphertext
    expectRefusal(b, { ...e1.envelope, ciphertext: encodeBase64(new Uint8Array(40).fill(1)) }, AB, 'DECRYPT_FAILED');
    // bad MAC over an intact payload (the envelope classifies it as tampering)
    expectRefusal(b, { ...e1.envelope, mac: encodeBase64(new Uint8Array(16)) }, AB, 'HEADER_TAMPERED');
    // re-attributed sender/receiver (header and payload intact)
    expectRefusal(b, e1.envelope, BA, 'HEADER_TAMPERED');
    // replay of a consumed message
    expectRefusal(b, e0.envelope, AB, 'REPLAY_DETECTED');
    // counters out of range
    expectRefusal(b, { ...e1.envelope, header: { ...e1.envelope.header, n: MAX_MESSAGE_NUMBER } }, AB, 'HEADER_TAMPERED');
    // too large a gap
    expectRefusal(b, { ...e1.envelope, header: { ...e1.envelope.header, n: e1.envelope.header.n + MAX_SKIP_PER_STEP + 1 } }, AB, 'TOO_MANY_SKIPPED');
    // an unknown ratchet key: ratchet attempt, then refusal
    expectRefusal(b, { ...e1.envelope, header: { ...e1.envelope.header, dhPub: encodeBase64(nacl.box.keyPair().publicKey) } }, AB, 'DECRYPT_FAILED');

    // an old counter whose key is gone (consume m1, then forge n = 0 on a session whose window forgot it)
    b = ratchetDecrypt(b, e1.envelope, AB).session;
    const forgetful: RatchetSessionV2 = { ...b, recentlyReceived: [] };
    expectRefusal(forgetful, e0.envelope, AB, 'UNKNOWN_OLD_MESSAGE');
  });

  it('success never mutates the input either, for encrypt, decrypt and the DH ratchet', () => {
    const { a, b } = pair();
    const fa = deepFreeze(snapshot(a));
    const fb = deepFreeze(snapshot(b));
    const e = ratchetEncrypt(fa, 'hello', AB);
    expect(fa).toEqual(snapshot(a));
    const d = ratchetDecrypt(fb, deepFreeze(snapshot(e.envelope)), AB);
    expect(d.plaintext).toBe('hello');
    expect(fb).toEqual(snapshot(b));

    const fr = deepFreeze(snapshot(d.session));
    const stepped = dhRatchet(fr, encodeBase64(nacl.box.keyPair().publicKey));
    expect(fr).toEqual(snapshot(d.session));
    expect(stepped.rootKey).not.toBe(fr.rootKey);
  });

  it('a responder without a sending chain refuses to encrypt without touching the session', () => {
    const { b } = pair();
    const fb = deepFreeze(snapshot(b));
    let caught: unknown;
    try {
      ratchetEncrypt(fb, 'too early', BA);
    } catch (e) {
      caught = e;
    }
    expect(isProtocolError(caught) ? caught.code : caught).toBe('SESSION_RESET_REQUIRED');
    expect(fb).toEqual(snapshot(b));
  });
});
