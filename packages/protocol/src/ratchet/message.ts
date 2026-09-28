import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { normalizeB64 } from '../primitives/base64';
import { utf8Decode, utf8Encode } from '../primitives/utf8';
import { chainKdf } from './chain';
import { applyDhRatchet } from './dh';
import type { RatchetSessionV2 } from '../types/session';

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
  if (!plain) throw new Error('secretbox.open failed');

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
    throw new Error('Session missing DHsPublicKey');
  }

  const ck = decodeBase64(session.chainKeySend);
  const { messageKey, nextChainKey } = chainKdf(ck);

  const nonce = options?.nonce ?? nacl.randomBytes(24);
  if (nonce.length !== nacl.secretbox.nonceLength) {
    throw new Error('nonce must be ' + String(nacl.secretbox.nonceLength) + ' bytes');
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
 * Pure receiving step. Synchronous, no I/O, never mutates `session`.
 * On any throw the caller must persist nothing (R7): the returned session is
 * the only thing that may be saved, and only after this function returns.
 *
 * Behaviour is T2.1's client code moved verbatim, including the documented
 * defects: a null `DHrPublicKey` adopts the peer key without ratcheting
 * (P1-0, fixed in T2.0) and `applyDhRatchet` drops skipped keys (P1-3, T2.7).
 */
export function ratchetDecrypt(session: RatchetSessionV2, envelope: V2Encrypted): RatchetDecryptResult {
  let work = session;
  const incomingDhPub = envelope.header.dhPub;

  if (!work.DHrPublicKey) {
    work = { ...work, DHrPublicKey: incomingDhPub };
  } else if (work.DHrPublicKey !== incomingDhPub) {
    work = applyDhRatchet(work, incomingDhPub);
  }

  const targetN = envelope.header.n;
  const skipped: Record<string, string> = { ...(work.skippedKeys || {}) };

  if (targetN < work.Nr) {
    const id = skippedKeyId(incomingDhPub, targetN);
    const mkB64 = skipped[id];
    if (!mkB64) throw new Error('Replay or unknown old message');

    const plaintext = openWithMessageKey(mkB64, envelope);
    delete skipped[id];

    return {
      session: { ...work, skippedKeys: skipped },
      plaintext,
      derivedKeys: [{ direction: 'in', dhPub: incomingDhPub, n: targetN, messageKeyB64: mkB64 }],
      consumedSkippedKeyId: id,
    };
  }

  const derivedKeys: DerivedMessageKey[] = [];
  let ck = decodeBase64(work.chainKeyRecv);
  let nr = work.Nr;
  let messageKey: Uint8Array | null = null;

  while (nr <= targetN) {
    const step = chainKdf(ck);
    const mkB64 = encodeBase64(step.messageKey);

    if (nr === targetN) {
      messageKey = step.messageKey;
    } else if (Object.keys(skipped).length < MAX_SKIP) {
      skipped[skippedKeyId(incomingDhPub, nr)] = mkB64;
    }
    derivedKeys.push({ direction: 'in', dhPub: incomingDhPub, n: nr, messageKeyB64: mkB64 });

    ck = step.nextChainKey;
    nr += 1;
  }

  if (!messageKey) throw new Error('Failed to derive message key');

  const plaintext = openWithMessageKey(encodeBase64(messageKey), envelope);

  return {
    session: { ...work, chainKeyRecv: encodeBase64(ck), Nr: nr, skippedKeys: skipped },
    plaintext,
    derivedKeys,
    consumedSkippedKeyId: null,
  };
}
