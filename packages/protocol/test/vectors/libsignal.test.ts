/**
 * Known-answer assertions against test/vectors/libsignal.json (T2.15).
 *
 * Passing today: the primitives Velo already shares with Signal (X25519,
 * HKDF-SHA256, the 0x01/0x02 chain KDF).
 * `it.fails` until the named task adopts Signal's constants:
 *  - X3DH            → T2.9 (DH order, 0xFF prefix, "WhisperText", fourth DH)
 *  - KDF_RK          → green since T2.0 adopted "WhisperRatchet"
 *  - message keys    → T2.5 (80-byte "WhisperMessageKeys" expansion, if adopted)
 *  - safety number   → T2.13 (libsignal numeric fingerprint)
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { computeSafetyNumber } from '../../src/identity/fingerprint';
import { hkdfSha256 } from '../../src/primitives/kdf';
import { chainKdf } from '../../src/ratchet/chain';
import { kdfRootKey } from '../../src/ratchet/root';
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
  it.fails('X3DH shared secret matches libsignal (T2.9: DH order, 0xFF prefix, WhisperText, fourth DH)', () => {
    for (const v of vectors.x3dh) {
      const ikSignB = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0x99)); // Velo signs the SPK with Ed25519
      const spkPub = fromHex(v.inputs.signedPreKeyB.pub);
      const bundle: PreKeyBundle = {
        userId: 'B',
        identitySignPublicKey: encodeBase64(ikSignB.publicKey),
        identityDhPublicKey: encodeBase64(fromHex(v.inputs.identityB.pub)),
        signedPreKey: { keyId: 1, publicKey: encodeBase64(spkPub), signature: encodeBase64(nacl.sign.detached(spkPub, ikSignB.secretKey)) },
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
        oneTimePreKeySecretKey: v.inputs.oneTimePreKeyB ? fromHex(v.inputs.oneTimePreKeyB.priv) : null,
      });
      expect(responded).toEqual(sessionKeys);
      expect(hex(Buffer.from(sessionKeys.rootKey, 'base64')), 'root key differs: Velo omits DH(EK_A, IK_B), orders DHs differently, has no 0xFF prefix and uses info "x3dh-v1"').toBe(v.rootKey);
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

  it.fails('message keys are the 80-byte WhisperMessageKeys expansion (T2.5, if adopted)', () => {
    // Velo uses the 32-byte HMAC output directly as the secretbox key.
    for (const step of vectors.ratchet.chain.steps) {
      const r = chainKdf(fromHex(step.chainKey));
      const expanded = hkdfSha256({ ikm: r.messageKey, info: label('WhisperMessageKeys'), length: 80 });
      expect(hex(expanded.subarray(0, 32))).toBe(step.cipherKey);
      expect(hex(expanded.subarray(32, 64))).toBe(step.macKey);
      expect(hex(expanded.subarray(64, 80))).toBe(step.iv);
      // The failing part: nothing in Velo derives or uses these yet.
      expect(r.messageKey.length, 'Velo derives a single 32-byte message key; Signal expands to cipher key, mac key and iv').toBe(80);
    }
  });

  it.fails('safety number matches libsignal’s numeric fingerprint (T2.13)', () => {
    for (const v of vectors.fingerprints) {
      const velo = computeSafetyNumber({
        myIdentitySignPub: encodeBase64(fromHex(v.localKey)),
        theirIdentitySignPub: encodeBase64(fromHex(v.remoteKey)),
      });
      expect(velo.displayCode.replace(/\s/g, ''), 'Velo shows 30 hex characters of one SHA-256; Signal shows 60 decimal digits from 5200 SHA-512 iterations').toBe(v.display);
    }
  });
});
