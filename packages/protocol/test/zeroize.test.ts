/**
 * T3.4 — zeroization. Best effort in JavaScript (DEVIATION-8), but the
 * contracts below are exact: seal/open consume the message key they are
 * given, the HKDF-derived blocks are copied out and zeroed, and a ratchet
 * step returns no key material.
 */
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { wipe } from '../src/primitives/zeroize';
import { chainKdf } from '../src/ratchet/chain';
import { openMessage, sealMessage, type AssociatedData } from '../src/ratchet/envelope';
import { expandMessageKey } from '../src/ratchet/messageKeys';
import { ratchetDecrypt, ratchetEncrypt } from '../src/ratchet/message';
import { kdfRootKey } from '../src/ratchet/root';
import { initInitiatorSession, initResponderSession } from '../src/ratchet/session';

const HK_A = encodeBase64(new Uint8Array(32).fill(0xa1));
const NHK_B = encodeBase64(new Uint8Array(32).fill(0xb2));
const zeros = (n: number) => new Uint8Array(n);
const isZero = (b: Uint8Array) => b.every((x) => x === 0);

const AD: AssociatedData = {
  senderIdentityKey: encodeBase64(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1)).publicKey),
  receiverIdentityKey: encodeBase64(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(2)).publicKey),
};

function pair() {
  const spk = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(7));
  const sk = encodeBase64(new Uint8Array(32).fill(9));
  const spkB64 = { publicKey: encodeBase64(spk.publicKey), privateKey: encodeBase64(spk.secretKey) };
  const a = initInitiatorSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'B', sharedSecret: sk, theirSignedPreKeyPublicKey: spkB64.publicKey });
  const b = initResponderSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'A', sharedSecret: sk, signedPreKey: spkB64 });
  return { a, b };
}

describe('T3.4 zeroization', () => {
  it('wipe zeroes every buffer it is given and tolerates null', () => {
    const x = new Uint8Array([1, 2, 3]);
    const y = new Uint8Array([4, 5]);
    wipe(x, null, y, undefined);
    expect(Array.from(x)).toEqual([0, 0, 0]);
    expect(Array.from(y)).toEqual([0, 0]);
  });

  it('KDF outputs are independent copies: the derivation stays correct after the block is zeroed', () => {
    const mk = new Uint8Array(32).fill(3);
    const once = expandMessageKey(mk);
    const twice = expandMessageKey(mk);
    expect(once).toEqual(twice); // deterministic, and untouched by the wipe of the internal block
    expect(once.cipherKey.buffer).not.toBe(once.macKey.buffer); // slices, not views into one block

    const rk = kdfRootKey({ rootKey: new Uint8Array(32).fill(1), dhOut: new Uint8Array(32).fill(2) });
    const rk2 = kdfRootKey({ rootKey: new Uint8Array(32).fill(1), dhOut: new Uint8Array(32).fill(2) });
    expect(rk).toEqual(rk2);
    expect(isZero(rk.newRootKey)).toBe(false);
  });

  it('sealMessage and openMessage consume the message key: the caller buffer is zero on return', () => {
    const { messageKey } = chainKdf(new Uint8Array(32).fill(5));
    const copy = new Uint8Array(messageKey);
    const header = { n: 0, pn: 0, dhPub: encodeBase64(new Uint8Array(32).fill(8)) };
    const envelope = sealMessage({ messageKey, header, plaintext: 'secret', ad: AD });
    expect(isZero(messageKey)).toBe(true);

    const mkForOpen = new Uint8Array(copy);
    expect(openMessage({ messageKey: mkForOpen, envelope, ad: AD })).toBe('secret');
    expect(isZero(mkForOpen)).toBe(true);

    // On the failure path too.
    const mkForBad = new Uint8Array(copy);
    expect(() => openMessage({ messageKey: mkForBad, envelope: { ...envelope, mac: encodeBase64(zeros(16)) }, ad: AD })).toThrow();
    expect(isZero(mkForBad)).toBe(true);
  });

  it('a ratchet step returns no key material and keeps working after its internals were wiped', () => {
    let { a, b } = pair();
    const e = ratchetEncrypt(a, 'one', AD);
    expect(Object.keys(e).sort()).toEqual(['envelope', 'session']);
    a = e.session;
    const d = ratchetDecrypt(b, e.envelope, AD);
    expect(Object.keys(d).sort()).toEqual(['consumedSkippedKeyId', 'plaintext', 'session']);
    expect(d.plaintext).toBe('one');
    b = d.session;

    // Nothing that was wiped was still needed: the conversation continues in both directions.
    const r = ratchetEncrypt(b, 'two', AD);
    expect(ratchetDecrypt(a, r.envelope, AD).plaintext).toBe('two');
    const s = JSON.stringify([e, d, r]);
    expect(s).not.toContain(encodeBase64(chainKdf(decodeBase64(pair().a.chainKeySend!)).messageKey));
  });
});
