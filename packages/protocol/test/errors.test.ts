import { chainKdf } from '../src/ratchet/chain';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_ERROR_CODES, ProtocolError, isProtocolError, protocolErrorCode } from '../src/errors';
import { verifySignedPreKeyBundle } from '../src/handshake/bundle';
import { dhRatchet } from '../src/ratchet/dh';
import { ratchetDecrypt, ratchetEncrypt } from '../src/ratchet/message';
import type { AssociatedData } from '../src/ratchet/envelope';
import { initInitiatorSession, initResponderSession } from '../src/ratchet/session';
import { sealHeader } from '../src/ratchet/header';
import type { RatchetSessionV2 } from '../src/types/session';

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    expect(isProtocolError(e)).toBe(true);
    return protocolErrorCode(e);
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sharedSecret = encodeBase64(new Uint8Array(32).fill(0xaa));
const HK_A = encodeBase64(new Uint8Array(32).fill(0xa1));
const NHK_B = encodeBase64(new Uint8Array(32).fill(0xb2));
const spkPair = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(0x44));
const signedPreKey = { publicKey: encodeBase64(spkPair.publicKey), privateKey: encodeBase64(spkPair.secretKey) };

const AD: AssociatedData = {
  senderIdentityKey: encodeBase64(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1)).publicKey),
  receiverIdentityKey: encodeBase64(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(2)).publicKey),
};

function pair(): { a: RatchetSessionV2; b: RatchetSessionV2 } {
  return {
    a: initInitiatorSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'b', sharedSecret, theirSignedPreKeyPublicKey: signedPreKey.publicKey }),
    b: initResponderSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'a', sharedSecret, signedPreKey }),
  };
}

describe('ProtocolError', () => {
  it('carries a code, a name, a message and scalar context; instanceof works', () => {
    const e = new ProtocolError('DECRYPT_FAILED', 'nope', { n: 3 });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ProtocolError);
    expect(e.name).toBe('ProtocolError');
    expect(e.code).toBe('DECRYPT_FAILED');
    expect(e.message).toBe('nope');
    expect(e.context).toEqual({ n: 3 });
    expect(isProtocolError(e)).toBe(true);
    expect(isProtocolError(new Error('x'))).toBe(false);
    expect(protocolErrorCode(new Error('x'))).toBeNull();
  });

  it('lists exactly the twenty-one spec codes', () => {
    expect([...PROTOCOL_ERROR_CODES].sort()).toEqual(
      [
        'MISSING_BOOTSTRAP', 'NO_SESSION', 'STALE_SESSION', 'DECRYPT_FAILED', 'REPLAY_DETECTED',
        'UNKNOWN_OLD_MESSAGE', 'SEND_FAILED', 'STORAGE_CORRUPTION', 'TOO_MANY_SKIPPED', 'HEADER_TAMPERED',
        'INVALID_KEY_LENGTH', 'SESSION_RESET_REQUIRED', 'IDENTITY_MISMATCH', 'IDENTITY_BINDING_INVALID',
        'SENDER_KEY_MISSING', 'SENDER_KEY_STALE', 'SENDER_KEY_SIGNATURE_INVALID',
        'ATTACHMENT_TOO_LARGE', 'ATTACHMENT_DIGEST_MISMATCH', 'ATTACHMENT_MAC_INVALID', 'ATTACHMENT_INVALID',
      ].sort(),
    );
  });

  it('src/ has no bare throw new Error left', () => {
    const offenders = walk(join(__dirname, '..', 'src')).filter((f) => /throw new Error\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no throw site attaches anything that looks like key material to context (R3)', () => {
    const suspicious = /context.*\b(rootKey|chainKey\w*|messageKey\w*|DHsPrivateKey|privateKey|secretKey|mk|mkB64|ck)\b/;
    const offenders: string[] = [];
    for (const f of walk(join(__dirname, '..', 'src'))) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/new ProtocolError\(/.test(line) || /^\s*\{ ?(what|n|nr|length)/.test(line)) {
          if (suspicious.test(line)) offenders.push(f + ':' + String(i + 1));
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('throw sites map to the taxonomy', () => {
  it('ratchet/message.ts', () => {
    let { a, b } = pair();
    const e0 = ratchetEncrypt(a, 'm0', AD);
    a = e0.session;
    b = ratchetDecrypt(b, e0.envelope, AD).session;

    expect(codeOf(() => ratchetDecrypt(b, e0.envelope, AD))).toBe('REPLAY_DETECTED');
    const e1r = ratchetEncrypt(a, 'x', AD);
    const e1 = e1r.envelope;
    const flipped = new Uint8Array(decodeBase64(e1.ciphertext).map((x) => x ^ 1));
    expect(codeOf(() => ratchetDecrypt(b, { ...e1, ciphertext: encodeBase64(flipped) }, AD))).toBe('DECRYPT_FAILED');
    const pnForged = { ...e1, encHeader: sealHeader({ headerKey: decodeBase64(a.headerKeySend!), header: { ...e1r.header, pn: 5 } }) };
    expect(codeOf(() => ratchetDecrypt(b, pnForged, AD))).toBe('HEADER_TAMPERED');
    expect(codeOf(() => ratchetEncrypt({ ...a, DHsPublicKey: null as unknown as string }, 'x', AD))).toBe('STORAGE_CORRUPTION');
    expect(codeOf(() => ratchetEncrypt(pair().b, 'x', AD)), 'responder before first receive').toBe('SESSION_RESET_REQUIRED');
    expect(codeOf(() => ratchetEncrypt(a, 'x', { ...AD, senderIdentityKey: encodeBase64(new Uint8Array(3)) }))).toBe('INVALID_KEY_LENGTH');
  });

  it('ratchet/dh.ts and ratchet/session.ts', () => {
    const { a } = pair();
    const peer = nacl.box.keyPair();
    expect(codeOf(() => dhRatchet({ ...a, DHsPrivateKey: null as unknown as string }, encodeBase64(peer.publicKey)))).toBe('STORAGE_CORRUPTION');
    expect(codeOf(() => dhRatchet(a, encodeBase64(new Uint8Array(31))))).toBe('INVALID_KEY_LENGTH');
    expect(codeOf(() => dhRatchet({ ...a, DHsPrivateKey: encodeBase64(new Uint8Array(16)) }, encodeBase64(peer.publicKey)))).toBe('INVALID_KEY_LENGTH');
    expect(codeOf(() => initInitiatorSession({ headerKeyA: HK_A, nextHeaderKeyB: NHK_B, peerUserId: 'b', sharedSecret: encodeBase64(new Uint8Array(16)), theirSignedPreKeyPublicKey: signedPreKey.publicKey }))).toBe('INVALID_KEY_LENGTH');
  });

  it('handshake/bundle.ts', () => {
    const id = nacl.sign.keyPair();
    const spk = nacl.box.keyPair();
    const other = nacl.sign.keyPair();
    const bundle = {
      userId: 'u',
      identitySignPublicKey: encodeBase64(id.publicKey),
      identityDhPublicKey: encodeBase64(nacl.box.keyPair().publicKey),
      identityBindingSignature: encodeBase64(new Uint8Array(64)),
      signedPreKey: {
        keyId: 1,
        publicKey: encodeBase64(spk.publicKey),
        signature: encodeBase64(nacl.sign.detached(spk.publicKey, other.secretKey)),
      },
      oneTimePreKey: null,
    };
    expect(codeOf(() => verifySignedPreKeyBundle(bundle))).toBe('IDENTITY_BINDING_INVALID');
  });

  it('context never contains the values of keys involved', () => {
    const { a, b } = pair();
    const e = ratchetEncrypt(a, 'x', AD);
    let caught: unknown;
    try {
      ratchetDecrypt(b, { ...e.envelope, mac: encodeBase64(new Uint8Array(16)) }, AD);
    } catch (err) {
      caught = err;
    }
    expect(isProtocolError(caught)).toBe(true);
    const ctx = JSON.stringify((caught as ProtocolError).context);
    const mkB64 = encodeBase64(chainKdf(decodeBase64(a.chainKeySend!)).messageKey);
    for (const secret of [a.chainKeySend!, a.rootKey, b.rootKey, mkB64]) {
      expect(ctx).not.toContain(secret);
      expect(ctx).not.toContain(Array.from(decodeBase64(secret), (x) => x.toString(16).padStart(2, '0')).join(''));
    }
  });
});
