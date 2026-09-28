import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { verifySignedPreKeyBundle } from '../src/handshake/bundle';
import type { PreKeyBundle } from '../src/handshake/types';
import { signIdentityBinding, verifyIdentityBinding } from '../src/identity/binding';
import { signSignedPreKey } from '../src/handshake/signedPrekey';

function bundleFor(identity = nacl.sign.keyPair(), spk = nacl.box.keyPair(), dh = nacl.box.keyPair()): PreKeyBundle {
  return {
    userId: 'u',
    identitySignPublicKey: encodeBase64(identity.publicKey),
    identityDhPublicKey: encodeBase64(dh.publicKey),
    identityBindingSignature: signIdentityBinding(identity.secretKey, encodeBase64(dh.publicKey)),
    signedPreKey: {
      keyId: 1,
      publicKey: encodeBase64(spk.publicKey),
      signature: signSignedPreKey(identity.secretKey, 1, encodeBase64(spk.publicKey)),
    },
    oneTimePreKey: null,
  };
}

describe('verifySignedPreKeyBundle', () => {
  it('accepts a bundle whose signed prekey is signed by the bundle identity', () => {
    expect(() => verifySignedPreKeyBundle(bundleFor())).not.toThrow();
  });

  it('rejects a substituted signed prekey or a foreign signature', () => {
    const b = bundleFor();
    const swapped = { ...b, signedPreKey: { ...b.signedPreKey, publicKey: encodeBase64(nacl.box.keyPair().publicKey) } };
    expect(() => verifySignedPreKeyBundle(swapped)).toThrow(/Invalid signedPreKey signature/);

    const other = nacl.sign.keyPair();
    const foreign = { ...b, signedPreKey: { ...b.signedPreKey, signature: encodeBase64(nacl.sign.detached(new Uint8Array(32), other.secretKey)) } };
    expect(() => verifySignedPreKeyBundle(foreign)).toThrow();
    // T2.10: a signature made for another key id is refused.
    const replayed = { ...b, signedPreKey: { ...b.signedPreKey, keyId: 2 } };
    expect(() => verifySignedPreKeyBundle(replayed)).toThrow(/Invalid signedPreKey signature/);
  });

  it('is self-referential by construction: a bundle re-signed with a new identity passes the signature checks', () => {
    // The signature and binding checks prove internal consistency only.
    // Trust comes from the pin (identity/trust.ts), enforced by the client
    // and harness on every bundle and initPacket (T2.13).
    const attacker = nacl.sign.keyPair();
    const b = bundleFor(attacker);
    expect(() => verifySignedPreKeyBundle(b)).not.toThrow();
    expect(() => verifyIdentityBinding(b)).not.toThrow();
  });
});
