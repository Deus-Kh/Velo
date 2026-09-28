import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { protocolErrorCode } from '../src/errors';
import { MAX_SKIP_PER_STEP, REPLAY_WINDOW } from '../src/ratchet/limits';
import { groupDecrypt, groupEncrypt, groupMessageSignedBytes, type GroupAssociatedData } from '../src/senderkey/message';
import { createSenderKeyState, senderKeyDistributionMessage, senderKeyStateFromDistribution, SENDER_KEY_DEVICE_ID } from '../src/senderkey/state';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const AD: GroupAssociatedData = { groupId: 'g-1', senderUserId: 'alice' };

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return protocolErrorCode(e);
  }
}

function fixedSender() {
  return createSenderKeyState({
    keyId: 7,
    chainKey: new Uint8Array(32).fill(0x33),
    signing: nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0x44)),
  });
}

describe('T6.1 sender keys', () => {
  it('distribution carries the chain position and deviceId 0; receivers rebuild a state without the signing secret', () => {
    let alice = fixedSender();
    alice = groupEncrypt(alice, 'first', AD).state; // late joiners start at iteration 1
    const skdm = senderKeyDistributionMessage(alice);
    expect(skdm).toMatchObject({ v: 1, keyId: 7, iteration: 1, deviceId: SENDER_KEY_DEVICE_ID });
    expect(decodeBase64(skdm.chainKey).length).toBe(32);
    const bob = senderKeyStateFromDistribution(skdm);
    expect(bob.signingPrivateKey).toBeUndefined();
    expect(bob.iteration).toBe(1);
    expect(codeOf(() => groupEncrypt(bob, 'x', AD))).toBe('STORAGE_CORRUPTION'); // a receiver cannot send as the sender
  });

  it('round-trips to several members, in order and out of order, with bounded skipped keys', () => {
    let alice = fixedSender();
    let bob = senderKeyStateFromDistribution(senderKeyDistributionMessage(alice));
    let carol = senderKeyStateFromDistribution(senderKeyDistributionMessage(alice));
    const msgs = [];
    for (let i = 0; i < 5; i += 1) {
      const r = groupEncrypt(alice, 'm' + String(i), AD);
      alice = r.state;
      msgs.push(r.message);
    }
    expect(msgs.map((m) => m.iteration)).toEqual([0, 1, 2, 3, 4]);

    for (const m of msgs) {
      const d = groupDecrypt(bob, m, AD);
      bob = d.state;
      expect(d.plaintext).toBe('m' + String(m.iteration));
    }
    // Carol gets 4 first, then 1, 0, 3, 2.
    const order = [4, 1, 0, 3, 2];
    for (const i of order) {
      const d = groupDecrypt(carol, msgs[i]!, AD);
      carol = d.state;
      expect(d.plaintext).toBe('m' + String(i));
    }
    expect(Object.keys(carol.skippedKeys ?? {})).toEqual([]);
    expect(carol.iteration).toBe(5);
  });

  it('a member cannot forge another member: a message signed with a different key is refused before any derivation', () => {
    const alice = fixedSender();
    let bob = senderKeyStateFromDistribution(senderKeyDistributionMessage(alice));
    const genuine = groupEncrypt(alice, 'hi', AD).message;
    const mallory = createSenderKeyState({ keyId: alice.keyId, chainKey: new Uint8Array(32).fill(0x33), signing: nacl.sign.keyPair() });
    const forged = groupEncrypt(mallory, 'not alice', AD).message; // same chain, wrong signing key
    const before = JSON.stringify(bob);
    expect(codeOf(() => groupDecrypt(bob, forged, AD))).toBe('SENDER_KEY_SIGNATURE_INVALID');
    expect(codeOf(() => groupDecrypt(bob, { ...genuine, signature: encodeBase64(new Uint8Array(64)) }, AD))).toBe('SENDER_KEY_SIGNATURE_INVALID');
    // Re-attributed to another group or sender: the signature covers both.
    expect(codeOf(() => groupDecrypt(bob, genuine, { groupId: 'g-2', senderUserId: 'alice' }))).toBe('SENDER_KEY_SIGNATURE_INVALID');
    expect(codeOf(() => groupDecrypt(bob, genuine, { groupId: 'g-1', senderUserId: 'mallory' }))).toBe('SENDER_KEY_SIGNATURE_INVALID');
    expect(JSON.stringify(bob)).toBe(before);
    bob = groupDecrypt(bob, genuine, AD).state;
    expect(bob.iteration).toBe(1);
  });

  it('replay, stale key id, old counters and large gaps are typed refusals that leave the state untouched', () => {
    let alice = fixedSender();
    let bob = senderKeyStateFromDistribution(senderKeyDistributionMessage(alice));
    const m0 = groupEncrypt(alice, 'm0', AD);
    alice = m0.state;
    bob = groupDecrypt(bob, m0.message, AD).state;
    const before = JSON.stringify(bob);
    expect(codeOf(() => groupDecrypt(bob, m0.message, AD))).toBe('REPLAY_DETECTED');
    expect(codeOf(() => groupDecrypt(bob, { ...m0.message, keyId: 8 }, AD))).toBe('SENDER_KEY_STALE');
    // Beyond the replay window an old counter reads as unknown-old.
    const forgetful = { ...bob, recentlyReceived: [] };
    expect(codeOf(() => groupDecrypt(forgetful, m0.message, AD))).toBe('UNKNOWN_OLD_MESSAGE');
    // A gap too large is refused before deriving.
    let far = alice;
    for (let i = 0; i < MAX_SKIP_PER_STEP + 1; i += 1) far = groupEncrypt(far, 'skip', AD).state;
    const tooFar = groupEncrypt(far, 'far', AD).message;
    expect(codeOf(() => groupDecrypt(bob, tooFar, AD))).toBe('TOO_MANY_SKIPPED');
    expect(JSON.stringify(bob)).toBe(before);
    expect(REPLAY_WINDOW).toBeGreaterThan(0);
  });

  it('is byte-for-byte reproducible for fixed keys (frozen vector, R8)', () => {
    const alice = fixedSender();
    const r = groupEncrypt(alice, 'frozen', AD);
    expect(hex(decodeBase64(r.message.ciphertext))).toBe('c8dcb62e6322298b56013193af7780dcc7d6c03f263b');
    expect(hex(decodeBase64(r.message.signature)).slice(0, 32)).toBe('c9b42cb7713aa422a74a6747d993155c');
    expect(hex(groupMessageSignedBytes(r.message, AD)).slice(0, 26)).toBe('01000000070000000000000003');
    expect(groupEncrypt(alice, 'frozen', AD).message).toEqual(r.message);
  });
});
