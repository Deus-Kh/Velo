/**
 * Known-answer vector generator (spec T2.15).
 *
 * Run: npm run vectors:generate   (run-generate.cjs writes test/vectors/libsignal.json)
 *
 * What comes straight from @signalapp/libsignal-client:
 *  - X25519 agreement (PrivateKey.agree), HKDF-SHA256 with Signal's labels
 *    (hkdf), the numeric safety number (Fingerprint, 5200 iterations,
 *    version 0) and its scannable encoding.
 * What is composed here, step for step as libsignal's rust/protocol
 * ratchet.rs and ratchet/keys.rs do it, over those primitives:
 *  - X3DH: IKM = 0xFF×32 || DH(IK_A,SPK_B) || DH(EK_A,IK_B) || DH(EK_A,SPK_B)
 *    [|| DH(EK_A,OPK_B)], HKDF(salt = none, info "WhisperText", 64 bytes)
 *    → root key ‖ chain key;
 *  - KDF_RK: HKDF(ikm = DH(ratchet_priv, their_ratchet_pub), salt = root key,
 *    info "WhisperRatchet", 64) → new root ‖ new chain;
 *  - KDF_CK: message key seed = HMAC(ck, 0x01), next ck = HMAC(ck, 0x02);
 *    message keys = HKDF(seed, salt = none, info "WhisperMessageKeys", 80)
 *    → cipher key 32 ‖ mac key 32 ‖ iv 16.
 * The Node API of libsignal 0.103 only builds PQXDH sessions (a Kyber
 * prekey is mandatory in PreKeyBundle), so a classical X3DH session cannot
 * be produced end-to-end by libsignal itself; the composition above is the
 * transcription and is what T2.0/T2.9 must match.
 *
 * Every private key is a fixed 32-byte pattern so the file is reproducible.
 */
import { createHmac } from 'crypto';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { Fingerprint, PrivateKey, PublicKey, hkdf } from '@signalapp/libsignal-client';

const LIBSIGNAL_VERSION: string = (require('@signalapp/libsignal-client/package.json') as { version: string }).version;

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const fixed = (byte: number) => new Uint8Array(32).fill(byte);
const label = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
const priv = (byte: number) => PrivateKey.deserialize(fixed(byte));
const raw = (k: PublicKey) => k.getPublicKeyBytes();

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function hmac(key: Uint8Array, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const digest = createHmac('sha256', key).update(data).digest();
  const out = new Uint8Array(new ArrayBuffer(digest.length));
  out.set(digest);
  return out;
}

// ───────── fixed key material ─────────
const IK_A = priv(0x11);
const EK_A = priv(0x22);
const IK_B = priv(0x33);
const SPK_B = priv(0x44);
const OPK_B = priv(0x55);
const RATCHET_A0 = priv(0x66); // Alice's first sending ratchet key
const RATCHET_B0 = priv(0x77); // Bob's first ratchet key after the initial step

export type Vectors = ReturnType<typeof buildVectors>;

export function buildVectors() {
  // 1. Primitives, straight from libsignal.
  const x25519 = [
    { a: 0x11, b: 0x33 },
    { a: 0x22, b: 0x44 },
    { a: 0x22, b: 0x55 },
  ].map(({ a, b }) => ({
    privA: hex(fixed(a)),
    pubA: hex(raw(priv(a).getPublicKey())),
    privB: hex(fixed(b)),
    pubB: hex(raw(priv(b).getPublicKey())),
    shared: hex(priv(a).agree(priv(b).getPublicKey())),
  }));

  const hkdfVectors = ['WhisperText', 'WhisperRatchet', 'WhisperMessageKeys'].map((info, i) => ({
    ikm: hex(fixed(0xa0 + i)),
    salt: i === 1 ? hex(fixed(0xb0)) : null,
    info,
    length: i === 2 ? 80 : 64,
    okm: hex(hkdf(i === 2 ? 80 : 64, fixed(0xa0 + i), label(info), i === 1 ? fixed(0xb0) : null)),
  }));

  // 2. X3DH per Signal's specification and libsignal's initialize_alice_session.
  function x3dh(withOpk: boolean) {
    const dh1 = IK_A.agree(SPK_B.getPublicKey());
    const dh2 = EK_A.agree(IK_B.getPublicKey());
    const dh3 = EK_A.agree(SPK_B.getPublicKey());
    const parts = [new Uint8Array(32).fill(0xff), dh1, dh2, dh3];
    if (withOpk) parts.push(EK_A.agree(OPK_B.getPublicKey()));
    const ikm = concat(parts);
    const okm = hkdf(64, ikm, label('WhisperText'), null);
    return {
      withOneTimePreKey: withOpk,
      inputs: {
        identityA: { priv: hex(fixed(0x11)), pub: hex(raw(IK_A.getPublicKey())) },
        ephemeralA: { priv: hex(fixed(0x22)), pub: hex(raw(EK_A.getPublicKey())) },
        identityB: { priv: hex(fixed(0x33)), pub: hex(raw(IK_B.getPublicKey())) },
        signedPreKeyB: { priv: hex(fixed(0x44)), pub: hex(raw(SPK_B.getPublicKey())) },
        oneTimePreKeyB: withOpk ? { priv: hex(fixed(0x55)), pub: hex(raw(OPK_B.getPublicKey())) } : null,
      },
      dh: { dh1: hex(dh1), dh2: hex(dh2), dh3: hex(dh3), dh4: withOpk ? hex(EK_A.agree(OPK_B.getPublicKey())) : null },
      ikm: hex(ikm),
      rootKey: hex(okm.subarray(0, 32)),
      chainKey: hex(okm.subarray(32, 64)),
    };
  }

  // 3. Scripted ratchet: Alice's first sending chain, then Bob's reply chain.
  const sk = x3dh(true);
  const rk0 = Buffer.from(sk.rootKey, 'hex');
  const stepA = hkdf(64, RATCHET_A0.agree(SPK_B.getPublicKey()), label('WhisperRatchet'), new Uint8Array(rk0));
  const rk1 = stepA.subarray(0, 32);
  const ckA = stepA.subarray(32, 64);
  const stepB = hkdf(64, RATCHET_B0.agree(RATCHET_A0.getPublicKey()), label('WhisperRatchet'), new Uint8Array(rk1));

  const chainSteps: Array<{ index: number; chainKey: string; messageKeySeed: string; nextChainKey: string; cipherKey: string; macKey: string; iv: string }> = [];
  let ck: Uint8Array = ckA;
  for (let i = 0; i < 3; i += 1) {
    const seed = hmac(ck, new Uint8Array([0x01]));
    const next = hmac(ck, new Uint8Array([0x02]));
    const keys = hkdf(80, seed, label('WhisperMessageKeys'), null);
    chainSteps.push({
      index: i,
      chainKey: hex(ck),
      messageKeySeed: hex(seed),
      nextChainKey: hex(next),
      cipherKey: hex(keys.subarray(0, 32)),
      macKey: hex(keys.subarray(32, 64)),
      iv: hex(keys.subarray(64, 80)),
    });
    ck = next;
  }

  const ratchet = {
    x3dhRootKey: sk.rootKey,
    steps: [
      {
        who: 'alice-initial',
        ourRatchetPriv: hex(fixed(0x66)),
        ourRatchetPub: hex(raw(RATCHET_A0.getPublicKey())),
        theirRatchetPub: hex(raw(SPK_B.getPublicKey())),
        dhOut: hex(RATCHET_A0.agree(SPK_B.getPublicKey())),
        rootKeyIn: sk.rootKey,
        newRootKey: hex(rk1),
        newChainKey: hex(ckA),
      },
      {
        who: 'bob-first-reply',
        ourRatchetPriv: hex(fixed(0x77)),
        ourRatchetPub: hex(raw(RATCHET_B0.getPublicKey())),
        theirRatchetPub: hex(raw(RATCHET_A0.getPublicKey())),
        dhOut: hex(RATCHET_B0.agree(RATCHET_A0.getPublicKey())),
        rootKeyIn: hex(rk1),
        newRootKey: hex(stepB.subarray(0, 32)),
        newChainKey: hex(stepB.subarray(32, 64)),
      },
    ],
    chain: { startChainKey: hex(ckA), steps: chainSteps },
  };

  // 4. Safety numbers, straight from libsignal. The hash input is the
  //    serialized key (0x05 || 32 bytes), as libsignal does it.
  const ids = { alice: 'alice-stable-id', bob: 'bob-stable-id' };
  const fingerprints = [
    { local: 'alice', localKey: IK_A, remote: 'bob', remoteKey: IK_B },
    { local: 'bob', localKey: IK_B, remote: 'alice', remoteKey: IK_A },
  ].map(({ local, localKey, remote, remoteKey }) => {
    const fp = Fingerprint.new(5200, 0, label(ids[local as 'alice' | 'bob']), localKey.getPublicKey(), label(ids[remote as 'alice' | 'bob']), remoteKey.getPublicKey());
    return {
      iterations: 5200,
      version: 0,
      localIdentifier: ids[local as 'alice' | 'bob'],
      localKey: hex(raw(localKey.getPublicKey())),
      localKeySerialized: hex(localKey.getPublicKey().serialize()),
      remoteIdentifier: ids[remote as 'alice' | 'bob'],
      remoteKey: hex(raw(remoteKey.getPublicKey())),
      remoteKeySerialized: hex(remoteKey.getPublicKey().serialize()),
      display: fp.displayableFingerprint().toString(),
      scannable: hex(fp.scannableFingerprint().toBuffer()),
    };
  });

  return {
    generator: 'packages/protocol/test/vectors/generate.ts',
    libsignalVersion: LIBSIGNAL_VERSION,
    notes: [
      'x25519, hkdf and fingerprint values are produced by @signalapp/libsignal-client.',
      'x3dh and ratchet values are composed over those primitives exactly as libsignal rust/protocol ratchet.rs and ratchet/keys.rs do (see generate.ts header).',
      'libsignal 0.103 Node API builds PQXDH sessions only (Kyber prekey mandatory), so no classical end-to-end session vector exists.',
      'Signal identity keys are single X25519 keys serialized as 0x05||32 bytes; Velo’s two-key identity (DEVIATION-5) cannot be fed to libsignal’s Fingerprint, so the fingerprint vectors pin the construction with one 32-byte key.',
    ],
    x25519,
    hkdf: hkdfVectors,
    x3dh: [x3dh(true), x3dh(false)],
    ratchet,
    fingerprints,
  };
}

export function writeVectors(outPath = join(__dirname, 'libsignal.json')): string {
  writeFileSync(outPath, JSON.stringify(buildVectors(), null, 2) + '\n');
  return outPath + ' (libsignal ' + LIBSIGNAL_VERSION + ')';
}
