import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import type { RatchetSessionV2 } from '../types/session';
import { kdfRootKey } from './root';
import { normalizeB64 } from '../primitives/base64';
import { ProtocolError } from '../errors';
import type { DhKeyPairB64 } from './session';
import { PEER_EPOCH_HISTORY } from './limits';

/**
 * DH ratchet step (spec §8.1 `dhRatchet`, Signal's DHRatchet):
 *   PN := Ns; Ns := Nr := 0; DHr := dhPub;
 *   (RK, CKr) := KDF_RK(RK, DH(DHs, DHr));
 *   DHs := fresh;
 *   (RK, CKs) := KDF_RK(RK, DH(DHs, DHr)).
 * Pure: returns a new session, never mutates the input. Draining the
 * previous receiving chain to `header.pn` is the caller's job (T2.8).
 * Skipped keys are keyed by epoch and survive the step (T2.7); the new
 * epoch is appended to skippedEpochOrder and peerEpochHistory (T2.6);
 * bounding and pruning is the decrypt step's job.
 *
 * `nextDhs` is injectable for vector tests only.
 */
export function dhRatchet(session: RatchetSessionV2, newPeerDhPubB64: string, nextDhs?: DhKeyPairB64): RatchetSessionV2 {
  if (!session.DHsPrivateKey) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Session missing DHs private key', { what: 'DHsPrivateKey' });
  }

  const rootKeyBytes = decodeBase64(normalizeB64(session.rootKey));
  const dhsPriv = decodeBase64(normalizeB64(session.DHsPrivateKey));
  const peerDhPubB64 = normalizeB64(newPeerDhPubB64);
  const dhrNewPub = decodeBase64(peerDhPubB64);

  if (dhsPriv.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'Bad DHsPrivateKey length', { what: 'DHsPrivateKey', length: dhsPriv.length });
  }
  if (dhrNewPub.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'Bad peer DH public key length', { what: 'peerDhPublicKey', length: dhrNewPub.length });
  }

  // Receiving chain from DH(DHs, DHr_new).
  const step1 = kdfRootKey({ rootKey: rootKeyBytes, dhOut: nacl.scalarMult(dhsPriv, dhrNewPub) });

  // Fresh sending ratchet key, sending chain from DH(DHs_new, DHr_new).
  const next = nextDhs ?? (() => {
    const kp = nacl.box.keyPair();
    return { publicKey: encodeBase64(kp.publicKey), privateKey: encodeBase64(kp.secretKey) };
  })();
  const nextPriv = decodeBase64(normalizeB64(next.privateKey));
  if (nextPriv.length !== 32) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'Bad next DHs private key length', { what: 'nextDhsPrivateKey', length: nextPriv.length });
  }
  const step2 = kdfRootKey({ rootKey: step1.newRootKey, dhOut: nacl.scalarMult(nextPriv, dhrNewPub) });

  return {
    ...session,
    rootKey: encodeBase64(step2.newRootKey),
    chainKeyRecv: encodeBase64(step1.newChainKey),
    chainKeySend: encodeBase64(step2.newChainKey),
    PN: session.Ns,
    Ns: 0,
    Nr: 0,
    skippedKeys: { ...(session.skippedKeys ?? {}) },
    skippedEpochOrder: [...(session.skippedEpochOrder ?? []).filter((e) => e !== peerDhPubB64), peerDhPubB64],
    peerEpochHistory: [...(session.peerEpochHistory ?? []).filter((e) => e !== peerDhPubB64), peerDhPubB64].slice(-PEER_EPOCH_HISTORY),
    DHrPublicKey: peerDhPubB64,
    DHsPublicKey: normalizeB64(next.publicKey),
    DHsPrivateKey: normalizeB64(next.privateKey),
  };
}
