import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { normalizeB64 } from '../primitives/base64';
import { utf8Decode, utf8Encode } from '../primitives/utf8';
import { chainKdf } from './chain';
import { dhRatchet } from './dh';
import type { RatchetSessionV2 } from '../types/session';
import { ProtocolError } from '../errors';

/** Wire header of a v2 message. */
export type V2Header = {
  n: number;
  pn: number;
  dhPub: string;
};

/** Wire envelope of a v2 message (secretbox until T2.5 moves to an AEAD). */
export type V2Encrypted = {
  header: V2Header;
  nonce: string;
  ciphertext: string;
};

/**
 * A message key the step derived. The client decides what to do with it
 * (today: archive it for history; after T2.14: delete after use).
 */
export type DerivedMessageKey = {
  direction: 'in' | 'out';
  dhPub: string;
  n: number;
  messageKeyB64: string;
};

export type RatchetEncryptResult = {
  session: RatchetSessionV2;
  envelope: V2Encrypted;
  derivedKeys: DerivedMessageKey[];
};

export type RatchetDecryptResult = {
  session: RatchetSessionV2;
  plaintext: string;
  derivedKeys: DerivedMessageKey[];
  /** Set when the message was decrypted with a previously skipped key. */
  consumedSkippedKeyId: string | null;
};

/** Bound on retained skipped keys per session. Behaviour pinned; T2.6 revisits. */
export const MAX_SKIP = 50;

export function skippedKeyId(dhPub: string, n: number): string {
  return dhPub + ':' + String(n);
}

function openWithMessageKey(mkB64: string, envelope: V2Encrypted): string {
  const mk = decodeBase64(normalizeB64(mkB64));
  const nonce = decodeBase64(normalizeB64(envelope.nonce));
  const cipher = decodeBase64(normalizeB64(envelope.ciphertext));

  const plain = nacl.secretbox.open(cipher, nonce, mk);
  if (!plain) {
    throw new ProtocolError('DECRYPT_FAILED', 'secretbox.open failed', { n: envelope.header.n, pn: envelope.header.pn });
  }

  return utf8Decode(plain);
}

/**
 * Pure sending step. Synchronous, no I/O, never mutates `session`.
 * Persistence is the caller's job and must happen only after this returns.
 *
 * `nonce` is injectable for frozen-vector tests only; production callers
 * leave it undefined and get 24 random bytes.
 */
export function ratchetEncrypt(
  session: RatchetSessionV2,
  plaintext: string,
  options?: { nonce?: Uint8Array },
): RatchetEncryptResult {
  if (!session.DHsPublicKey) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Session missing DHsPublicKey', { what: 'DHsPublicKey' });
  }
  if (!session.chainKeySend) {
    // A responder that has not received yet has no sending chain (§8.1).
    throw new ProtocolError('SESSION_RESET_REQUIRED', 'Session has no sending chain yet', { what: 'chainKeySend' });
  }

  const ck = decodeBase64(session.chainKeySend);
  const { messageKey, nextChainKey } = chainKdf(ck);

  const nonce = options?.nonce ?? nacl.randomBytes(24);
  if (nonce.length !== nacl.secretbox.nonceLength) {
    throw new ProtocolError('INVALID_KEY_LENGTH', 'nonce must be ' + String(nacl.secretbox.nonceLength) + ' bytes', {
      what: 'nonce',
      length: nonce.length,
    });
  }
  const cipherBytes = nacl.secretbox(utf8Encode(plaintext), nonce, messageKey);

  const next: RatchetSessionV2 = {
    ...session,
    chainKeySend: encodeBase64(nextChainKey),
    Ns: session.Ns + 1,
  };

  return {
    session: next,
    envelope: {
      header: { n: session.Ns, pn: session.PN, dhPub: session.DHsPublicKey },
      nonce: encodeBase64(nonce),
      ciphertext: encodeBase64(cipherBytes),
    },
    derivedKeys: [
      { direction: 'out', dhPub: session.DHsPublicKey, n: session.Ns, messageKeyB64: encodeBase64(messageKey) },
    ],
  };
}

/**
 * Pure receiving step (spec §8.1). Synchronous, no I/O, never mutates
 * `session`. On any throw the caller must persist nothing (R7).
 *
 *  1. skipped-key fast path;
 *  2. if the peer's ratchet key is new (or there is none yet): drain the
 *     previous receiving chain to header.pn into the skipped keys (T2.8),
 *     then perform a full DH ratchet step — never merely adopt (R13);
 *  3. derive forward on the current receiving chain to header.n, keeping
 *     the skipped keys (T2.7);
 *  4-6. derive the target key, authenticate, commit.
 */
export function ratchetDecrypt(session: RatchetSessionV2, envelope: V2Encrypted): RatchetDecryptResult {
  const incomingDhPub = normalizeB64(envelope.header.dhPub);
  const targetN = envelope.header.n;

  // 1. Skipped-key fast path.
  const retained: Record<string, string> = { ...(session.skippedKeys || {}) };
  const skippedId = skippedKeyId(incomingDhPub, targetN);
  const skippedKey = retained[skippedId];
  if (skippedKey) {
    const plaintext = openWithMessageKey(skippedKey, envelope);
    delete retained[skippedId];
    return {
      session: { ...session, skippedKeys: retained },
      plaintext,
      derivedKeys: [{ direction: 'in', dhPub: incomingDhPub, n: targetN, messageKeyB64: skippedKey }],
      consumedSkippedKeyId: skippedId,
    };
  }

  const derivedKeys: DerivedMessageKey[] = [];
  let work = session;

  // 2. New peer ratchet key: drain the old chain to header.pn (T2.8), then ratchet (R13).
  if (!work.DHrPublicKey || work.DHrPublicKey !== incomingDhPub) {
    if (work.DHrPublicKey && work.chainKeyRecv) {
      let oldCk = decodeBase64(work.chainKeyRecv);
      let oldNr = work.Nr;
      while (oldNr < envelope.header.pn) {
        const step = chainKdf(oldCk);
        const mkB64 = encodeBase64(step.messageKey);
        if (Object.keys(retained).length < MAX_SKIP) {
          retained[skippedKeyId(work.DHrPublicKey, oldNr)] = mkB64;
        }
        derivedKeys.push({ direction: 'in', dhPub: work.DHrPublicKey, n: oldNr, messageKeyB64: mkB64 });
        oldCk = step.nextChainKey;
        oldNr += 1;
      }
    }
    work = dhRatchet(work, incomingDhPub);
  }
  if (!work.chainKeyRecv) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Session has no receiving chain after ratchet', { what: 'chainKeyRecv' });
  }

  // An old counter on the current chain with no skipped key: consumed or never retained.
  if (targetN < work.Nr) {
    throw new ProtocolError('REPLAY_DETECTED', 'Replay or unknown old message', { n: targetN, nr: work.Nr });
  }

  // 3–4. Derive forward to the target, retaining skipped keys.
  let ck = decodeBase64(work.chainKeyRecv);
  let nr = work.Nr;
  let messageKey: Uint8Array | null = null;

  while (nr <= targetN) {
    const step = chainKdf(ck);
    const mkB64 = encodeBase64(step.messageKey);

    if (nr === targetN) {
      messageKey = step.messageKey;
    } else if (Object.keys(retained).length < MAX_SKIP) {
      retained[skippedKeyId(incomingDhPub, nr)] = mkB64;
    }
    derivedKeys.push({ direction: 'in', dhPub: incomingDhPub, n: nr, messageKeyB64: mkB64 });

    ck = step.nextChainKey;
    nr += 1;
  }

  if (!messageKey) throw new ProtocolError('DECRYPT_FAILED', 'Failed to derive message key', { n: targetN, nr: work.Nr });

  // 5. Authenticate — nothing above this line may be persisted.
  const plaintext = openWithMessageKey(encodeBase64(messageKey), envelope);

  // 6. Commit.
  return {
    session: { ...work, chainKeyRecv: encodeBase64(ck), Nr: nr, skippedKeys: retained },
    plaintext,
    derivedKeys,
    consumedSkippedKeyId: null,
  };
}
