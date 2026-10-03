/**
 * Known-answer assertions against test/vectors/libsignal.json (T2.15).
 *
 * Passing today: the primitives Velo already shares with Signal (X25519,
 * HKDF-SHA256, the 0x01/0x02 chain KDF).
 * `it.fails` until the named task adopts Signal's constants:
 *  - X3DH            → green since T2.9 (Signal's DH order, 0xFF prefix, "WhisperText", fourth DH)
 *  - KDF_RK          → green since T2.0 adopted "WhisperRatchet"
 *  - message keys    → green since T2.5 (WhisperMessageKeys expansion; Velo takes 88 bytes, the first 80 are Signal's)
 *  - safety number   → green since T2.13 (libsignal numeric fingerprint)
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { displayableFingerprint, fingerprintHalf } from '../../src/identity/fingerprint';
import { signIdentityBinding } from '../../src/identity/binding';
import { signSignedPreKey } from '../../src/handshake/signedPrekey';
import { hkdfSha256 } from '../../src/primitives/kdf';
import { chainKdf } from '../../src/ratchet/chain';
import { kdfRootKey } from '../../src/ratchet/root';
import { expandMessageKey } from '../../src/ratchet/messageKeys';
import { x3dhInitiate, x3dhRespond } from '../../src/handshake/x3dh';
import type { PreKeyBundle } from '../../src/handshake/types';
import vectors from './libsignal.json';

const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const label = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

describe('libsignal vectors: file', () => {
  it('records the libsignal version and covers every category', () => {
    expect(vectors.libsignalVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(vectors.x25519.length).toBeGreaterThan(0);
    expect(vectors.hkdf.length).toBe(3);
    expect(vectors.x3dh.map((v) => v.withOneTimePreKey)).toEqual([true, false]);
    expect(vectors.ratchet.steps.length).toBe(2);
    expect(vectors.ratchet.chain.steps.length).toBe(3);
    expect(vectors.fingerprints.length).toBe(2);
  });
});

describe('libsignal vectors: primitives (pass today)', () => {
  it('X25519 agreement matches libsignal', () => {
    for (const v of vectors.x25519) {
      const kpA = nacl.box.keyPair.fromSecretKey(fromHex(v.privA));
      expect(hex(kpA.publicKey)).toBe(v.pubA);
      expect(hex(nacl.scalarMult(kpA.secretKey, fromHex(v.pubB)))).toBe(v.shared);
    }
  });

  it('HKDF-SHA256 with Signal labels matches libsignal', () => {
    for (const v of vectors.hkdf) {
      const okm = hkdfSha256({ ikm: fromHex(v.ikm), salt: v.salt ? fromHex(v.salt) : undefined, info: label(v.info), length: v.length });
      expect(hex(okm)).toBe(v.okm);
    }
  });

  it('chain KDF (HMAC 0x01 / 0x02) matches libsignal', () => {
    let ck: Uint8Array = fromHex(vectors.ratchet.chain.startChainKey);
    for (const step of vectors.ratchet.chain.steps) {
      expect(hex(ck)).toBe(step.chainKey);
      const r = chainKdf(ck);
      expect(hex(r.messageKey)).toBe(step.messageKeySeed);
      expect(hex(r.nextChainKey)).toBe(step.nextChainKey);
      ck = r.nextChainKey;
    }
  });
});

describe('libsignal vectors: constructions (red until the named task)', () => {
  it('X3DH shared secret matches libsignal (T2.9: DH order, 0xFF prefix, WhisperText, fourth DH)', () => {
    for (const v of vectors.x3dh) {
      const ikSignB = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0x99)); // Velo signs the SPK with Ed25519
      const spkPub = fromHex(v.inputs.signedPreKeyB.pub);
      const bundle: PreKeyBundle = {
        userId: 'B',
        identitySignPublicKey: encodeBase64(ikSignB.publicKey),
        identityDhPublicKey: encodeBase64(fromHex(v.inputs.identityB.pub)),
        identityBindingSignature: signIdentityBinding(ikSignB.secretKey, encodeBase64(fromHex(v.inputs.identityB.pub))),
        signedPreKey: { keyId: 1, publicKey: encodeBase64(spkPub), signature: signSignedPreKey(ikSignB.secretKey, 1, encodeBase64(spkPub)) },
        oneTimePreKey: v.inputs.oneTimePreKeyB ? { keyId: 2, publicKey: encodeBase64(fromHex(v.inputs.oneTimePreKeyB.pub)) } : null,
      };
      const ephemeral = nacl.box.keyPair.fromSecretKey(fromHex(v.inputs.ephemeralA.priv));
      const { sessionKeys, initPacket } = x3dhInitiate({
        bundle,
        peerUserId: 'B',
        identityDhPublicKey: encodeBase64(fromHex(v.inputs.identityA.pub)),
        identityDhSecretKey: fromHex(v.inputs.identityA.priv),
        ephemeral,
      });
      const responded = x3dhRespond({
        initPacket,
        signedPreKeySecretKey: fromHex(v.inputs.signedPreKeyB.priv),
        identityDhSecretKey: fromHex(v.inputs.identityB.priv),
        oneTimePreKeySecretKey: v.inputs.oneTimePreKeyB ? fromHex(v.inputs.oneTimePreKeyB.priv) : null,
      });
      expect(responded).toEqual(sessionKeys);
      expect(hex(Buffer.from(sessionKeys.rootKey, 'base64'))).toBe(v.rootKey);
      expect(hex(Buffer.from(sessionKeys.chainKey, 'base64'))).toBe(v.chainKey);
    }
  });

  it('KDF_RK matches libsignal (T2.0 adopted "WhisperRatchet")', () => {
    for (const s of vectors.ratchet.steps) {
      const r = kdfRootKey({ rootKey: fromHex(s.rootKeyIn), dhOut: fromHex(s.dhOut) });
      expect(hex(r.newRootKey)).toBe(s.newRootKey);
      expect(hex(r.newChainKey)).toBe(s.newChainKey);
    }
  });

  it('message keys are the WhisperMessageKeys expansion (T2.5): cipher key, MAC key and Signal\u2019s iv as the nonce prefix', () => {
    for (const step of vectors.ratchet.chain.steps) {
      const r = chainKdf(fromHex(step.chainKey));
      const keys = expandMessageKey(r.messageKey);
      expect(hex(keys.cipherKey)).toBe(step.cipherKey);
      expect(hex(keys.macKey)).toBe(step.macKey);
      expect(hex(keys.nonce.subarray(0, 16))).toBe(step.iv);
    }
  });

  it('numeric fingerprint matches libsignal (T2.13; libsignal’s 0x05-serialized key as input)', { timeout: 30_000 }, () => {
    const enc = new TextEncoder();
    for (const v of vectors.fingerprints) {
      const local = fingerprintHalf({ identifier: enc.encode(v.localIdentifier), identityKey: fromHex(v.localKeySerialized), iterations: v.iterations, version: v.version });
      const remote = fingerprintHalf({ identifier: enc.encode(v.remoteIdentifier), identityKey: fromHex(v.remoteKeySerialized), iterations: v.iterations, version: v.version });
      expect(displayableFingerprint(local, remote)).toBe(v.display);
    }
  });
});
