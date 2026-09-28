import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { normalizeB64 } from '../primitives/base64';
import { chainKdf } from './chain';
import { dhRatchet } from './dh';
import type { RatchetSessionV2 } from '../types/session';
import { ProtocolError } from '../errors';
import { openMessage, sealMessage, type AssociatedData, type MessageEnvelope } from './envelope';
import type { MessageHeader } from './header';
import { MAX_MESSAGE_NUMBER, MAX_SKIP_PER_STEP } from './limits';

export type { MessageHeader } from './header';
export type { MessageEnvelope, AssociatedData } from './envelope';
/** @deprecated v2 names kept for one release; the envelope is version 3. */
export type V2Header = MessageHeader;
/** @deprecated see MessageEnvelope. */
export type V2Encrypted = MessageEnvelope;

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
  envelope: MessageEnvelope;
  derivedKeys: DerivedMessageKey[];
};

export type RatchetDecryptResult = {
  session: RatchetSessionV2;
  plaintext: string;
  derivedKeys: DerivedMessageKey[];
  /** Set when the message was decrypted with a previously skipped key. */
  consumedSkippedKeyId: string | null;
};

/** Bound on retained skipped keys per session (count only; the epoch-aware policy lands with the prune step). */
export const MAX_SKIP = 50;

function requireCounter(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_MESSAGE_NUMBER) {
    throw new ProtocolError('HEADER_TAMPERED', 'Header counter out of range', { what, value: String(value), limit: MAX_MESSAGE_NUMBER });
  }
}

/** T2.6: refuse a gap larger than MAX_SKIP_PER_STEP before deriving anything. */
function requireGap(until: number, from: number, what: string): void {
  const gap = until - from;
  if (gap > MAX_SKIP_PER_STEP) {
    throw new ProtocolError('TOO_MANY_SKIPPED', 'Too many skipped messages in one step', { what, gap, limit: MAX_SKIP_PER_STEP });
  }
}

export function skippedKeyId(dhPub: string, n: number): string {
  return dhPub + ':' + String(n);
}

/**
 * Pure sending step. Synchronous, no I/O, never mutates `session`.
 * `ad` binds the envelope to the sender/receiver identity pair (T2.5).
 * Persistence is the caller's job and must happen only after this returns.
 */
export function ratchetEncrypt(session: RatchetSessionV2, plaintext: string, ad: AssociatedData): RatchetEncryptResult {
  if (!session.DHsPublicKey) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Session missing DHsPublicKey', { what: 'DHsPublicKey' });
  }
  if (!session.chainKeySend) {
    // A responder that has not received yet has no sending chain (§8.1).
    throw new ProtocolError('SESSION_RESET_REQUIRED', 'Session has no sending chain yet', { what: 'chainKeySend' });
  }

  const ck = decodeBase64(session.chainKeySend);
  const { messageKey, nextChainKey } = chainKdf(ck);

  const header: MessageHeader = { n: session.Ns, pn: session.PN, dhPub: session.DHsPublicKey };
  const envelope = sealMessage({ messageKey, header, plaintext, ad });

  const next: RatchetSessionV2 = {
    ...session,
    chainKeySend: encodeBase64(nextChainKey),
    Ns: session.Ns + 1,
  };

  return {
    session: next,
    envelope,
    derivedKeys: [{ direction: 'out', dhPub: session.DHsPublicKey, n: session.Ns, messageKeyB64: encodeBase64(messageKey) }],
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
 *  4-6. derive the target key, authenticate (MAC over identities and the
 *     canonical header, T2.5), decrypt, commit.
 */
export function ratchetDecrypt(session: RatchetSessionV2, envelope: MessageEnvelope, ad: AssociatedData): RatchetDecryptResult {
  const incomingDhPub = normalizeB64(envelope.header.dhPub);
  const targetN = envelope.header.n;
  requireCounter(targetN, 'header.n');
  requireCounter(envelope.header.pn, 'header.pn');

  // 1. Skipped-key fast path.
  const retained: Record<string, string> = { ...(session.skippedKeys || {}) };
  const skippedId = skippedKeyId(incomingDhPub, targetN);
  const skippedKey = retained[skippedId];
  if (skippedKey) {
    const plaintext = openMessage({ messageKey: decodeBase64(normalizeB64(skippedKey)), envelope, ad });
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
      requireGap(envelope.header.pn, work.Nr, 'header.pn');
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

  // 3–4. Derive forward to the target, retaining skipped keys (bounded per step, T2.6).
  requireGap(targetN, work.Nr, 'header.n');
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

  // 5. Authenticate and decrypt — nothing above this line may be persisted.
  const plaintext = openMessage({ messageKey, envelope, ad });

  // 6. Commit.
  return {
    session: { ...work, chainKeyRecv: encodeBase64(ck), Nr: nr, skippedKeys: retained },
    plaintext,
    derivedKeys,
    consumedSkippedKeyId: null,
  };
}
