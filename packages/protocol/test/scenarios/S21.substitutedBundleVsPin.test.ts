/**
 * S21 — Substituted bundle identity vs pin.
 * Checklist: none (malicious server).
 * Defect covered: P0-9 — the initiator pins B's identity on first contact
 * but never checks later bundles against the pin. A self-consistent
 * attacker bundle (attacker's identity signs attacker's signed prekey)
 * passes signature verification and is accepted.
 * Expected before fixes: FAIL. After T2.13: pass with IDENTITY_MISMATCH.
 */
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { codeOf, makeWorld } from '../harness';

describe('S21 substituted bundle identity vs pin', () => {
  it.fails('A refuses a bundle whose identity keys differ from the pinned ones', () => {
    const { server, clients } = makeWorld();
    const { A } = clients;

    A!.send('B', 'first contact'); // TOFU pin of B's real identity
    const pinned = A!.trustedIdentity('B')!;
    A!.resetSession('B');

    const attackerSign = nacl.sign.keyPair();
    const attackerDh = nacl.box.keyPair();
    const attackerSpk = nacl.box.keyPair();
    server.malicious.substituteBundle = (bundle) => ({
      ...bundle,
      identitySignPublicKey: encodeBase64(attackerSign.publicKey),
      identityDhPublicKey: encodeBase64(attackerDh.publicKey),
      signedPreKey: {
        keyId: 4242,
        publicKey: encodeBase64(attackerSpk.publicKey),
        signature: encodeBase64(nacl.sign.detached(attackerSpk.publicKey, attackerSign.secretKey)),
      },
      oneTimePreKey: null,
    });

    const code = codeOf(() => A!.send('B', 'second contact'));
    expect(code, 'a bundle with different identity keys than the pinned ones was accepted (P0-9)').toBe('IDENTITY_MISMATCH');
    expect(A!.trustedIdentity('B')).toEqual(pinned);
    expect(A!.hasSession('B')).toBe(false);
  });
});
