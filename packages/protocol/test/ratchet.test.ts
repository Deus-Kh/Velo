import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { chainKdf } from '../src/ratchet/chain';
import { kdfRootKey } from '../src/ratchet/root';
import { applyDhRatchet } from '../src/ratchet/dh';
import { createSessionFromX3DH } from '../src/ratchet/session';
import type { RatchetSessionV2 } from '../src/types/session';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

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

describe('applyDhRatchet (current behaviour, pinned before T2.0/T2.7 change it)', () => {
  function session(): RatchetSessionV2 {
    const dhs = nacl.box.keyPair();
    return {
      v: 1,
      protoVersion: 2,
      peerUserId: 'peer',
      rootKey: encodeBase64(new Uint8Array(32).fill(3)),
      chainKeySend: encodeBase64(new Uint8Array(32).fill(4)),
      chainKeyRecv: encodeBase64(new Uint8Array(32).fill(5)),
      Ns: 4,
      Nr: 2,
      PN: 0,
      skippedKeys: { 'old:1': 'k' },
      DHsPublicKey: encodeBase64(dhs.publicKey),
      DHsPrivateKey: encodeBase64(dhs.secretKey),
      DHrPublicKey: null,
    };
  }

  it('derives fresh root and chain keys, rotates DHs, resets counters and records PN', () => {
    const before = session();
    const peer = nacl.box.keyPair();
    const after = applyDhRatchet(before, encodeBase64(peer.publicKey));

    expect(after.rootKey).not.toBe(before.rootKey);
    expect(after.chainKeySend).not.toBe(before.chainKeySend);
    expect(after.chainKeyRecv).not.toBe(before.chainKeyRecv);
    expect(after.DHsPublicKey).not.toBe(before.DHsPublicKey);
    expect(after.DHrPublicKey).toBe(encodeBase64(peer.publicKey));
    expect(after.PN).toBe(4);
    expect(after.Ns).toBe(0);
    expect(after.Nr).toBe(0);
    expect(decodeBase64(after.DHsPrivateKey!).length).toBe(32);
    // Documented defect P1-3: the skipped-key map is wiped on a ratchet step.
    expect(after.skippedKeys).toEqual({});
    // Input is not mutated.
    expect(before.Ns).toBe(4);
  });

  it('rejects keys of the wrong length and a session without a DH private key', () => {
    const s = session();
    expect(() => applyDhRatchet(s, encodeBase64(new Uint8Array(31)))).toThrow(/length/);
    expect(() => applyDhRatchet({ ...s, DHsPrivateKey: null }, encodeBase64(new Uint8Array(32)))).toThrow(/private key/);
  });
});

describe('createSessionFromX3DH (current HKDF directional split, pinned before T2.0 replaces it)', () => {
  const rootKey = encodeBase64(new Uint8Array(32).fill(0xaa));
  const chainKey = encodeBase64(new Uint8Array(32).fill(0xbb));
  const dhs = { publicKey: encodeBase64(new Uint8Array(32).fill(1)), privateKey: encodeBase64(new Uint8Array(32).fill(2)) };

  it('mirrors send/recv between initiator and responder', () => {
    const a = createSessionFromX3DH({ peerUserId: 'b', rootKey, chainKey, isInitiator: true, dhs });
    const b = createSessionFromX3DH({ peerUserId: 'a', rootKey, chainKey, isInitiator: false, dhs });
    expect(a.chainKeySend).toBe(b.chainKeyRecv);
    expect(a.chainKeyRecv).toBe(b.chainKeySend);
    expect(a.chainKeySend).not.toBe(a.chainKeyRecv);
    expect(a.rootKey).toBe(rootKey);
    expect(a).toMatchObject({ v: 1, protoVersion: 2, peerUserId: 'b', Ns: 0, Nr: 0, PN: 0, skippedKeys: {}, DHrPublicKey: null });
    expect(a.DHsPublicKey).toBe(dhs.publicKey);
    expect(a.DHsPrivateKey).toBe(dhs.privateKey);
  });

  it('is byte-for-byte what the client produced before the move (frozen vectors, R8)', () => {
    const a = createSessionFromX3DH({ peerUserId: 'b', rootKey, chainKey, isInitiator: true, dhs });
    expect(hex(decodeBase64(a.chainKeySend))).toBe('5c3b36a39fe1de43f8850bb581eb11ae46dbd56638ce160c0a5029ab1df6fa02');
    expect(hex(decodeBase64(a.chainKeyRecv))).toBe('02cd35496f9e43a1fffb530481cb3aa5a72dd7341c61f003acf34a295b3419e5');
  });

  it('generates a fresh 32-byte DH pair when none is injected, and rejects a bad chain key', () => {
    const s = createSessionFromX3DH({ peerUserId: 'b', rootKey, chainKey, isInitiator: true });
    expect(decodeBase64(s.DHsPublicKey!).length).toBe(32);
    expect(decodeBase64(s.DHsPrivateKey!).length).toBe(32);
    expect(() => createSessionFromX3DH({ peerUserId: 'b', rootKey, chainKey: encodeBase64(new Uint8Array(16)), isInitiator: true })).toThrow(/32 bytes/);
  });
});
