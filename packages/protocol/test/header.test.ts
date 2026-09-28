import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { protocolErrorCode } from '../src/errors';
import { associatedDataBytes } from '../src/ratchet/envelope';
import { canonicalHeaderBytes, decodeCanonicalHeader, WIRE_VERSION } from '../src/ratchet/header';
import { expandMessageKey } from '../src/ratchet/messageKeys';
import { rng } from './harness';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('canonicalHeaderBytes (R4)', () => {
  it('is u8 version | u32be dhPubLen | dhPub | u32be n | u32be pn', () => {
    const dhPub = new Uint8Array(32).fill(0xab);
    const bytes = canonicalHeaderBytes({ n: 7, pn: 258, dhPub: encodeBase64(dhPub) });
    expect(bytes.length).toBe(1 + 4 + 32 + 4 + 4);
    expect(bytes[0]).toBe(WIRE_VERSION);
    expect(hex(bytes.slice(1, 5))).toBe('00000020');
    expect(hex(bytes.slice(5, 37))).toBe(hex(dhPub));
    expect(hex(bytes.slice(37, 41))).toBe('00000007');
    expect(hex(bytes.slice(41, 45))).toBe('00000102');
  });

  it('round-trips byte-identically over 1000 randomised headers, regardless of base64 padding or field order', () => {
    const rand = rng(7);
    for (let i = 0; i < 1000; i += 1) {
      const kp = nacl.box.keyPair();
      const n = Math.floor(rand() * 0xffffffff);
      const pn = Math.floor(rand() * 0xffffffff);
      const dhPub = encodeBase64(kp.publicKey);
      const bytes = canonicalHeaderBytes({ n, pn, dhPub });
      // Different JSON shapes of the same header: reordered fields, stripped padding.
      const reordered = { pn, dhPub: dhPub.replace(/=+$/, ''), n };
      expect(hex(canonicalHeaderBytes(reordered))).toBe(hex(bytes));
      const decoded = decodeCanonicalHeader(bytes);
      expect(decoded.version).toBe(WIRE_VERSION);
      expect(decoded.header).toEqual({ n, pn, dhPub });
    }
  });

  it('rejects a wrong-length key, out-of-range counters and a bad version', () => {
    const ok = encodeBase64(new Uint8Array(32));
    expect(protocolErrorCode((() => { try { canonicalHeaderBytes({ n: 0, pn: 0, dhPub: encodeBase64(new Uint8Array(31)) }); } catch (e) { return e; } return null; })())).toBe('INVALID_KEY_LENGTH');
    expect(protocolErrorCode((() => { try { canonicalHeaderBytes({ n: -1, pn: 0, dhPub: ok }); } catch (e) { return e; } return null; })())).toBe('HEADER_TAMPERED');
    expect(protocolErrorCode((() => { try { canonicalHeaderBytes({ n: 0, pn: 2 ** 32, dhPub: ok }); } catch (e) { return e; } return null; })())).toBe('HEADER_TAMPERED');
    expect(protocolErrorCode((() => { try { canonicalHeaderBytes({ n: 0, pn: 0, dhPub: ok }, 300); } catch (e) { return e; } return null; })())).toBe('HEADER_TAMPERED');
  });
});

describe('associatedDataBytes', () => {
  it('is IK_sign_sender ‖ IK_sign_receiver ‖ canonical header', () => {
    const a = nacl.sign.keyPair().publicKey;
    const b = nacl.sign.keyPair().publicKey;
    const header = { n: 1, pn: 2, dhPub: encodeBase64(new Uint8Array(32).fill(3)) };
    const ad = associatedDataBytes({ senderIdentityKey: encodeBase64(a), receiverIdentityKey: encodeBase64(b) }, header);
    expect(hex(ad)).toBe(hex(a) + hex(b) + hex(canonicalHeaderBytes(header)));
    // Direction matters: swapping sender and receiver changes the AD.
    const swapped = associatedDataBytes({ senderIdentityKey: encodeBase64(b), receiverIdentityKey: encodeBase64(a) }, header);
    expect(hex(swapped)).not.toBe(hex(ad));
  });
});

describe('expandMessageKey', () => {
  it('derives cipher key, MAC key and nonce deterministically, all distinct', () => {
    const mk = new Uint8Array(32).fill(0x42);
    const a = expandMessageKey(mk);
    const b = expandMessageKey(mk);
    expect(a).toEqual(b);
    expect(a.cipherKey.length).toBe(32);
    expect(a.macKey.length).toBe(32);
    expect(a.nonce.length).toBe(24);
    expect(hex(a.cipherKey)).not.toBe(hex(a.macKey));
    expect(hex(expandMessageKey(new Uint8Array(32).fill(0x43)).cipherKey)).not.toBe(hex(a.cipherKey));
  });
});
