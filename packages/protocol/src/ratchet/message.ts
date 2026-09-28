import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { normalizeB64 } from '../primitives/base64';
import { wipe } from '../primitives/zeroize';
import { chainKdf } from './chain';
import { dhRatchet } from './dh';
import type { RatchetSessionV2 } from '../types/session';
import { ProtocolError } from '../errors';
import { openMessage, sealMessage, type AssociatedData, type MessageEnvelope } from './envelope';
import { openHeader, sealHeader, type MessageHeader } from './header';
import { MAX_MESSAGE_NUMBER, MAX_SKIP_EPOCHS, MAX_SKIP_PER_STEP, MAX_SKIP_TOTAL, REPLAY_WINDOW } from './limits';

export type { MessageHeader } from './header';
export type { MessageEnvelope, AssociatedData } from './envelope';

/**
 * T3.4: a step returns the next session, the envelope or plaintext, and
 * nothing else. No message key leaves the step, and every intermediate key
 * the step derived is wiped before it returns, on success and on failure.
 * T3.6: the encrypt step also returns the plaintext header it sealed (the
 * sender's own bookkeeping; not secret to the sender).
 */
export type RatchetEncryptResult = {
  session: RatchetSessionV2;
  envelope: MessageEnvelope;
  header: MessageHeader;
};

export type RatchetDecryptResult = {
  session: RatchetSessionV2;
  plaintext: string;
  /** The header as decrypted (T3.6). */
  header: MessageHeader;
  /** Set when the message was decrypted with a previously skipped key. */
  consumedSkippedKeyId: string | null;
};

export type EncryptOptions = {
  /** Frozen-vector tests only: the 24-byte header nonce. */
  headerNonce?: Uint8Array;
};

/**
 * pruneSkippedKeys (spec §8.1, T2.6, DEVIATION-4): keep skipped keys for at
 * most MAX_SKIP_EPOCHS most recent epochs and at most MAX_SKIP_TOTAL keys
 * overall, evicting oldest-epoch-first (by skippedEpochOrder, never JS
 * object order) and lowest-counter-first within an epoch. Deterministic.
 */
export function pruneSkippedKeys(session: RatchetSessionV2): RatchetSessionV2 {
  const keys = { ...(session.skippedKeys ?? {}) };
  const order = [...(session.skippedEpochOrder ?? [])];

  // 1. Epoch bound: drop every key of an epoch older than the last MAX_SKIP_EPOCHS.
  const kept = order.slice(-MAX_SKIP_EPOCHS);
  const dropped = new Set(order.slice(0, Math.max(0, order.length - MAX_SKIP_EPOCHS)));
  for (const id of Object.keys(keys)) {
    const epoch = id.slice(0, id.lastIndexOf(':'));
    if (dropped.has(epoch) || !kept.includes(epoch)) delete keys[id];
  }

  // 2. Total bound: evict oldest epoch first, lowest n first within it.
  let count = Object.keys(keys).length;
  for (const epoch of kept) {
    if (count <= MAX_SKIP_TOTAL) break;
    const ids = Object.keys(keys)
      .filter((id) => id.slice(0, id.lastIndexOf(':')) === epoch)
      .sort((x, y) => Number(x.slice(x.lastIndexOf(':') + 1)) - Number(y.slice(y.lastIndexOf(':') + 1)));
    for (const id of ids) {
      if (count <= MAX_SKIP_TOTAL) break;
      delete keys[id];
      count -= 1;
    }
  }

  // Header keys of evicted epochs go with their skipped keys (T3.6); the current epoch's HKr lives in the session itself.
  const epochHeaderKeys: Record<string, string> = {};
  for (const [epoch, hk] of Object.entries(session.epochHeaderKeys ?? {})) {
    if (kept.includes(epoch) && epoch !== session.DHrPublicKey) epochHeaderKeys[epoch] = hk;
  }
  return { ...session, skippedKeys: keys, skippedEpochOrder: kept, epochHeaderKeys };
}

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

/** T3.4: the bounded replay window, oldest first. */
function rememberReceived(session: RatchetSessionV2, id: string): string[] {
  const list = [...(session.recentlyReceived ?? []), id];
  return list.length > REPLAY_WINDOW ? list.slice(list.length - REPLAY_WINDOW) : list;
}

export type HeaderEpoch = 'current' | 'next' | 'previous';

/**
 * DecryptHeader (Double Ratchet §4, T3.6): trial-decrypt the encrypted
 * header under the current receiving header key, then the next one (a new
 * epoch), then the retained keys of previous epochs (a late message).
 * Returns null when it opens under none: the receiver cannot tell a
 * modified header from a message of a session it does not have.
 */
export function decryptHeader(session: RatchetSessionV2, envelope: MessageEnvelope): { header: MessageHeader; epoch: HeaderEpoch; epochDhPub: string | null } | null {
  const enc = envelope.encHeader;
  if (session.headerKeyRecv) {
    const header = openHeader({ headerKey: decodeBase64(normalizeB64(session.headerKeyRecv)), encHeader: enc });
    if (header) return { header, epoch: 'current', epochDhPub: session.DHrPublicKey };
  }
  const next = openHeader({ headerKey: decodeBase64(normalizeB64(session.nextHeaderKeyRecv)), encHeader: enc });
  if (next) return { header: next, epoch: 'next', epochDhPub: null };
  for (const [dhPub, hk] of Object.entries(session.epochHeaderKeys ?? {})) {
    const header = openHeader({ headerKey: decodeBase64(normalizeB64(hk)), encHeader: enc });
    if (header) return { header, epoch: 'previous', epochDhPub: dhPub };
  }
  return null;
}

/**
 * Pure sending step (RatchetEncryptHE). Synchronous, no I/O, never mutates
 * `session`. The header is sealed under HKs; `ad` binds the envelope to the
 * sender/receiver identity pair and to the encrypted header (T2.5, T3.6).
 * Persistence is the caller's job and must happen only after this returns.
 */
export function ratchetEncrypt(session: RatchetSessionV2, plaintext: string, ad: AssociatedData, opts: EncryptOptions = {}): RatchetEncryptResult {
  if (!session.DHsPublicKey) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Session missing DHsPublicKey', { what: 'DHsPublicKey' });
  }
  if (!session.chainKeySend || !session.headerKeySend) {
    // A responder that has not received yet has no sending chain and no sending header key (§8.1).
    throw new ProtocolError('SESSION_RESET_REQUIRED', 'Session has no sending chain yet', { what: 'chainKeySend' });
  }

  const ck = decodeBase64(session.chainKeySend);
  const { messageKey, nextChainKey } = chainKdf(ck);
  wipe(ck);
  try {
    const header: MessageHeader = { n: session.Ns, pn: session.PN, dhPub: session.DHsPublicKey };
    const encHeader = sealHeader({ headerKey: decodeBase64(normalizeB64(session.headerKeySend)), header, nonce: opts.headerNonce });
    const envelope = sealMessage({ messageKey, encHeader, plaintext, ad }); // consumes (wipes) messageKey

    const next: RatchetSessionV2 = {
      ...session,
      chainKeySend: encodeBase64(nextChainKey),
      Ns: session.Ns + 1,
    };
    return { session: next, envelope, header };
  } finally {
    wipe(messageKey, nextChainKey);
  }
}

/**
 * Pure receiving step (RatchetDecryptHE, spec §8.1). Synchronous, no I/O,
 * never mutates `session`. On any throw the caller must persist nothing (R7).
 *
 *  0. decrypt the header under HKr, else NHKr (new epoch), else a retained
 *     previous-epoch key (late message); none → DECRYPT_FAILED;
 *  1. skipped-key fast path; 1b. explicit replay window (T3.4);
 *  2. new epoch: drain the previous receiving chain to header.pn into the
 *     skipped keys (T2.8), then a full DH ratchet step (R13), which also
 *     rotates the header keys;
 *  3. derive forward on the current receiving chain to header.n, keeping
 *     the skipped keys (T2.7);
 *  4-6. derive the target key, authenticate (MAC over identities and the
 *     encrypted header, T2.5/T3.6), decrypt, commit.
 * Every chain key, message key and header key copy derived along the way is
 * wiped before the step returns, whether it returns or throws (T3.4).
 */
export function ratchetDecrypt(session: RatchetSessionV2, envelope: MessageEnvelope, ad: AssociatedData): RatchetDecryptResult {
  // 0. The header must open under a key this session knows.
  const opened = decryptHeader(session, envelope);
  if (!opened) {
    throw new ProtocolError('DECRYPT_FAILED', 'Header does not open under any known header key', { stage: 'header' });
  }
  const { header, epoch } = opened;
  const incomingDhPub = normalizeB64(header.dhPub);
  const targetN = header.n;
  requireCounter(targetN, 'header.n');
  requireCounter(header.pn, 'header.pn');
  // A header sealed under a known key must name that key's epoch.
  if (epoch === 'current' && incomingDhPub !== session.DHrPublicKey) {
    throw new ProtocolError('DECRYPT_FAILED', 'Header names a ratchet key that does not belong to its header key', { stage: 'header' });
  }
  if (epoch === 'previous' && incomingDhPub !== opened.epochDhPub) {
    throw new ProtocolError('DECRYPT_FAILED', 'Header names a ratchet key that does not belong to its header key', { stage: 'header' });
  }

  // 1. Skipped-key fast path.
  const retained: Record<string, string> = { ...(session.skippedKeys || {}) };
  const skippedId = skippedKeyId(incomingDhPub, targetN);
  const skippedKey = retained[skippedId];
  if (skippedKey) {
    const mk = decodeBase64(normalizeB64(skippedKey));
    const plaintext = openMessage({ messageKey: mk, envelope, ad }); // consumes (wipes) mk
    delete retained[skippedId];
    return {
      session: { ...session, skippedKeys: retained, recentlyReceived: rememberReceived(session, skippedId) },
      plaintext,
      header,
      consumedSkippedKeyId: skippedId,
    };
  }

  // 1b. Explicit replay window (T3.4): a second copy of a consumed message, whatever its epoch.
  if ((session.recentlyReceived ?? []).includes(skippedId)) {
    throw new ProtocolError('REPLAY_DETECTED', 'Message already received', { n: targetN });
  }

  // A previous epoch with no retained key for this counter: never ratchet backwards (T2.6).
  if (epoch === 'previous') {
    throw new ProtocolError('UNKNOWN_OLD_MESSAGE', 'Message from a previous epoch whose keys are no longer retained', { n: targetN });
  }

  let work = session;

  // 2. New peer ratchet key: drain the old chain to header.pn (T2.8), then ratchet (R13).
  if (epoch === 'next') {
    if ((work.peerEpochHistory ?? []).includes(incomingDhPub) || incomingDhPub === work.DHrPublicKey) {
      throw new ProtocolError('DECRYPT_FAILED', 'A new-epoch header reuses a known ratchet key', { stage: 'header' });
    }
    if (work.DHrPublicKey && work.chainKeyRecv) {
      requireGap(header.pn, work.Nr, 'header.pn');
      let oldCk = decodeBase64(work.chainKeyRecv);
      let oldNr = work.Nr;
      while (oldNr < header.pn) {
        const step = chainKdf(oldCk);
        retained[skippedKeyId(work.DHrPublicKey, oldNr)] = encodeBase64(step.messageKey);
        wipe(oldCk, step.messageKey);
        oldCk = step.nextChainKey;
        oldNr += 1;
      }
      wipe(oldCk);
    }
    work = dhRatchet(work, incomingDhPub);
  }
  if (!work.chainKeyRecv) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Session has no receiving chain after ratchet', { what: 'chainKeyRecv' });
  }

  // An old counter on the current chain with no skipped key and outside the replay window:
  // a skipped key that was evicted, or a copy older than the window. Refused, never derived.
  if (targetN < work.Nr) {
    throw new ProtocolError('UNKNOWN_OLD_MESSAGE', 'Old message whose key is no longer retained', { n: targetN, nr: work.Nr });
  }

  // 3–4. Derive forward to the target, retaining skipped keys (bounded per step, T2.6).
  requireGap(targetN, work.Nr, 'header.n');
  let ck = decodeBase64(work.chainKeyRecv);
  let nr = work.Nr;
  let messageKey: Uint8Array | null = null;

  try {
    while (nr <= targetN) {
      const step = chainKdf(ck);
      if (nr === targetN) {
        messageKey = step.messageKey;
      } else {
        retained[skippedKeyId(incomingDhPub, nr)] = encodeBase64(step.messageKey);
        wipe(step.messageKey);
      }
      wipe(ck);
      ck = step.nextChainKey;
      nr += 1;
    }

    if (!messageKey) throw new ProtocolError('DECRYPT_FAILED', 'Failed to derive message key', { n: targetN, nr: work.Nr });

    // 5. Authenticate and decrypt — nothing above this line may be persisted.
    const plaintext = openMessage({ messageKey, envelope, ad }); // consumes (wipes) messageKey

    // 6. Commit, then prune (bounded by epochs and total, T2.6).
    return {
      session: pruneSkippedKeys({ ...work, chainKeyRecv: encodeBase64(ck), Nr: nr, skippedKeys: retained, recentlyReceived: rememberReceived(work, skippedId) }),
      plaintext,
      header,
      consumedSkippedKeyId: null,
    };
  } finally {
    wipe(ck, messageKey);
  }
}
