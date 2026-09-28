import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { chainKdf } from '../src/ratchet/chain';
import { kdfRootKey } from '../src/ratchet/root';
import { dhRatchet } from '../src/ratchet/dh';
import { initInitiatorSession, initResponderSession } from '../src/ratchet/session';
import { isProtocolError, protocolErrorCode } from '../src/errors';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const pairB64 = (byte: number) => {
  const kp = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(byte));
  return { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
};
const sharedSecret = encodeBase64(new Uint8Array(32).fill(0xaa));
const spkB = pairB64(0x44);
const dhsA0 = pairB64(0x66);
const dhsB0 = pairB64(0x77);

describe('chainKdf', () => {
  it('derives MK = HMAC(CK, 0x01) and CK\' = HMAC(CK, 0x02), deterministically', () => {
    const ck = new Uint8Array(32).fill(0x42);
    const a = chainKdf(ck);
    const b = chainKdf(ck);
    expect(hex(a.messageKey)).toBe(hex(b.messageKey));
    expect(hex(a.nextChainKey)).toBe(hex(b.nextChainKey));
    expect(a.messageKey).not.toEqual(a.nextChainKey);
    expect(a.messageKey.length).toBe(32);
    expect(a.nextChainKey.length).toBe(32);
    // Frozen vectors (CK = 0x42*32): any change to the chain KDF is a wire-format change (R8).
    expect(hex(a.messageKey)).toBe('0b175bca3524cc7301c33946d7e00d3f008cb14632b72855b3442a7365403893');
    expect(hex(a.nextChainKey)).toBe('4fa923f5d122080142716bf80fec4930203815c6b10199d1a871e09fe0a3c720');
  });

  it('chains forward without repeating keys', () => {
    let ck: Uint8Array = new Uint8Array(32).fill(1);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const step = chainKdf(ck);
      const mk = hex(step.messageKey);
      expect(seen.has(mk)).toBe(false);
      seen.add(mk);
      ck = step.nextChainKey;
    }
  });
});

describe('kdfRootKey', () => {
  it('is deterministic and binds both inputs', () => {
    const rootKey = new Uint8Array(32).fill(7);
    const dhOut = new Uint8Array(32).fill(9);
    const a = kdfRootKey({ rootKey, dhOut });
    expect(a).toEqual(kdfRootKey({ rootKey, dhOut }));
    expect(a.newRootKey).not.toEqual(a.newChainKey);
    expect(kdfRootKey({ rootKey: new Uint8Array(32).fill(8), dhOut }).newRootKey).not.toEqual(a.newRootKey);
    expect(kdfRootKey({ rootKey, dhOut: new Uint8Array(32).fill(10) }).newRootKey).not.toEqual(a.newRootKey);
  });
});

describe('session initialisation (spec §8.1, T2.0)', () => {
  it('initiator: RK from KDF_RK(SK, DH(DHs, SPK_B)), sending chain only, DHr = SPK_B', () => {
    const a = initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: spkB.publicKey, dhs: dhsA0 });
    expect(a).toMatchObject({ v: 2, protoVersion: 3, peerUserId: 'b', Ns: 0, Nr: 0, PN: 0, skippedKeys: {}, chainKeyRecv: null });
    expect(a.DHsPublicKey).toBe(dhsA0.publicKey);
    expect(a.DHrPublicKey).toBe(spkB.publicKey);
    expect(a.rootKey).not.toBe(sharedSecret);
    expect(a.chainKeySend).not.toBeNull();

    const expected = kdfRootKey({
      rootKey: new Uint8Array(32).fill(0xaa),
      dhOut: nacl.scalarMult(decodeBase64(dhsA0.privateKey), decodeBase64(spkB.publicKey)),
    });
    expect(decodeBase64(a.rootKey)).toEqual(expected.newRootKey);
    expect(decodeBase64(a.chainKeySend!)).toEqual(expected.newChainKey);
  });

  it('responder: RK = SK, DHs = copied SPK pair, no chains, DHr null', () => {
    const b = initResponderSession({ peerUserId: 'a', sharedSecret, signedPreKey: spkB });
    expect(b).toMatchObject({ v: 2, protoVersion: 3, peerUserId: 'a', Ns: 0, Nr: 0, PN: 0, skippedKeys: {} });
    expect(b.rootKey).toBe(sharedSecret);
    expect(b.chainKeySend).toBeNull();
    expect(b.chainKeyRecv).toBeNull();
    expect(b.DHsPublicKey).toBe(spkB.publicKey);
    expect(b.DHsPrivateKey).toBe(spkB.privateKey);
    expect(b.DHrPublicKey).toBeNull();
  });

  it('the responder’s first ratchet step reproduces the initiator’s sending chain', () => {
    const a = initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: spkB.publicKey, dhs: dhsA0 });
    const b = dhRatchet(initResponderSession({ peerUserId: 'a', sharedSecret, signedPreKey: spkB }), a.DHsPublicKey, dhsB0);
    expect(b.chainKeyRecv).toBe(a.chainKeySend);
    expect(b.DHrPublicKey).toBe(a.DHsPublicKey);
    expect(b.DHsPublicKey).toBe(dhsB0.publicKey);
    // and the initiator's next step reproduces the responder's sending chain
    const a2 = dhRatchet(a, b.DHsPublicKey);
    expect(a2.chainKeyRecv).toBe(b.chainKeySend);
    expect(a2.rootKey).not.toBe(a.rootKey);
    expect(a2.DHsPublicKey).not.toBe(a.DHsPublicKey);
  });

  it('rejects wrong-length inputs with INVALID_KEY_LENGTH', () => {
    const short = encodeBase64(new Uint8Array(16));
    for (const fn of [
      () => initInitiatorSession({ peerUserId: 'b', sharedSecret: short, theirSignedPreKeyPublicKey: spkB.publicKey }),
      () => initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: short }),
      () => initResponderSession({ peerUserId: 'a', sharedSecret, signedPreKey: { publicKey: spkB.publicKey, privateKey: short } }),
    ]) {
      let code: string | null = null;
      try {
        fn();
      } catch (e) {
        expect(isProtocolError(e)).toBe(true);
        code = protocolErrorCode(e);
      }
      expect(code).toBe('INVALID_KEY_LENGTH');
    }
  });
});

describe('dhRatchet (spec §8.1)', () => {
  it('derives fresh root and both chains, rotates DHs, records PN, resets counters and keeps skipped keys', () => {
    const before = { ...initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: spkB.publicKey, dhs: dhsA0 }), Ns: 4, Nr: 2, skippedKeys: { 'old:1': 'k' } };
    const peer = nacl.box.keyPair();
    const after = dhRatchet(before, encodeBase64(peer.publicKey));

    expect(after.rootKey).not.toBe(before.rootKey);
    expect(after.chainKeySend).not.toBe(before.chainKeySend);
    expect(after.chainKeyRecv).not.toBeNull();
    expect(after.DHsPublicKey).not.toBe(before.DHsPublicKey);
    expect(after.DHrPublicKey).toBe(encodeBase64(peer.publicKey));
    expect(after.PN).toBe(4);
    expect(after.Ns).toBe(0);
    expect(after.Nr).toBe(0);
    expect(decodeBase64(after.DHsPrivateKey).length).toBe(32);
    // Skipped keys from earlier epochs survive the step (T2.7).
    expect(after.skippedKeys).toEqual({ 'old:1': 'k' });
    // Input is not mutated.
    expect(before.Ns).toBe(4);
    expect(before.skippedKeys).toEqual({ 'old:1': 'k' });
  });

  it('is deterministic for an injected next DHs (vector-friendly)', () => {
    const s = initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: spkB.publicKey, dhs: dhsA0 });
    const peer = pairB64(0x88);
    expect(dhRatchet(s, peer.publicKey, dhsB0)).toEqual(dhRatchet(s, peer.publicKey, dhsB0));
  });

  it('rejects keys of the wrong length and a session without a DH private key', () => {
    const s = initInitiatorSession({ peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: spkB.publicKey });
    expect(() => dhRatchet(s, encodeBase64(new Uint8Array(31)))).toThrow(/length/);
    expect(() => dhRatchet({ ...s, DHsPrivateKey: null as unknown as string }, encodeBase64(new Uint8Array(32)))).toThrow(/private key/);
  });
});
