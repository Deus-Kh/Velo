import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_ERROR_CODES, ProtocolError, isProtocolError, protocolErrorCode } from '../src/errors';
import { verifySignedPreKeyBundle } from '../src/handshake/bundle';
import { applyDhRatchet } from '../src/ratchet/dh';
import { ratchetDecrypt, ratchetEncrypt } from '../src/ratchet/message';
import { createSessionFromX3DH } from '../src/ratchet/session';
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

const rootKey = encodeBase64(new Uint8Array(32).fill(0xaa));
const chainKey = encodeBase64(new Uint8Array(32).fill(0xbb));

function pair(): { a: RatchetSessionV2; b: RatchetSessionV2 } {
  return {
    a: createSessionFromX3DH({ peerUserId: 'b', rootKey, chainKey, isInitiator: true }),
    b: createSessionFromX3DH({ peerUserId: 'a', rootKey, chainKey, isInitiator: false }),
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

  it('lists exactly the fourteen spec codes', () => {
    expect([...PROTOCOL_ERROR_CODES].sort()).toEqual(
      [
        'MISSING_BOOTSTRAP', 'NO_SESSION', 'STALE_SESSION', 'DECRYPT_FAILED', 'REPLAY_DETECTED',
        'UNKNOWN_OLD_MESSAGE', 'SEND_FAILED', 'STORAGE_CORRUPTION', 'TOO_MANY_SKIPPED', 'HEADER_TAMPERED',
        'INVALID_KEY_LENGTH', 'SESSION_RESET_REQUIRED', 'IDENTITY_MISMATCH', 'IDENTITY_BINDING_INVALID',
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
    const e0 = ratchetEncrypt(a, 'm0');
    a = e0.session;
    b = ratchetDecrypt(b, e0.envelope).session;

    expect(codeOf(() => ratchetDecrypt(b, e0.envelope))).toBe('REPLAY_DETECTED');
    expect(codeOf(() => ratchetDecrypt(b, { ...ratchetEncrypt(a, 'x').envelope, nonce: encodeBase64(new Uint8Array(24)) }))).toBe('DECRYPT_FAILED');
    expect(codeOf(() => ratchetEncrypt({ ...a, DHsPublicKey: null }, 'x'))).toBe('STORAGE_CORRUPTION');
    expect(codeOf(() => ratchetEncrypt(a, 'x', { nonce: new Uint8Array(3) }))).toBe('INVALID_KEY_LENGTH');
  });

  it('ratchet/dh.ts and ratchet/session.ts', () => {
    const { a } = pair();
    const peer = nacl.box.keyPair();
    expect(codeOf(() => applyDhRatchet({ ...a, DHsPrivateKey: null }, encodeBase64(peer.publicKey)))).toBe('STORAGE_CORRUPTION');
    expect(codeOf(() => applyDhRatchet(a, encodeBase64(new Uint8Array(31))))).toBe('INVALID_KEY_LENGTH');
    expect(codeOf(() => applyDhRatchet({ ...a, DHsPrivateKey: encodeBase64(new Uint8Array(16)) }, encodeBase64(peer.publicKey)))).toBe('INVALID_KEY_LENGTH');
    expect(codeOf(() => createSessionFromX3DH({ peerUserId: 'b', rootKey, chainKey: encodeBase64(new Uint8Array(16)), isInitiator: true }))).toBe('INVALID_KEY_LENGTH');
  });

  it('handshake/bundle.ts', () => {
    const id = nacl.sign.keyPair();
    const spk = nacl.box.keyPair();
    const other = nacl.sign.keyPair();
    const bundle = {
      userId: 'u',
      identitySignPublicKey: encodeBase64(id.publicKey),
      identityDhPublicKey: encodeBase64(nacl.box.keyPair().publicKey),
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
    const e = ratchetEncrypt(a, 'x');
    let caught: unknown;
    try {
      ratchetDecrypt(b, { ...e.envelope, nonce: encodeBase64(new Uint8Array(24)) });
    } catch (err) {
      caught = err;
    }
    expect(isProtocolError(caught)).toBe(true);
    const ctx = JSON.stringify((caught as ProtocolError).context);
    for (const secret of [a.chainKeySend, a.rootKey, b.chainKeyRecv, e.derivedKeys[0]!.messageKeyB64]) {
      expect(ctx).not.toContain(secret);
      expect(ctx).not.toContain(Array.from(decodeBase64(secret), (x) => x.toString(16).padStart(2, '0')).join(''));
    }
  });
});
