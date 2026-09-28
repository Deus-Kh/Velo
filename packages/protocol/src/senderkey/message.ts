import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import { utf8Decode, utf8Encode } from '../primitives/utf8';
import { wipe } from '../primitives/zeroize';
import { chainKdf } from '../ratchet/chain';
import { MAX_MESSAGE_NUMBER, MAX_SKIP_PER_STEP, MAX_SKIP_TOTAL, REPLAY_WINDOW } from '../ratchet/limits';
import { expandMessageKey } from '../ratchet/messageKeys';
import { SENDER_KEY_VERSION, type SenderKeyState } from './state';

/**
 * Group message (Sender Keys, T6.1). Wire format `group v1`:
 *   { v: 1, keyId, iteration, ciphertext, signature }
 * ciphertext := secretbox(plaintext, nonce(mk), cipherKey(mk)) with the
 * message key expanded exactly like a pairwise one ("WhisperMessageKeys");
 * signature := Ed25519(sender signing key, canonicalBytes) over
 *   u8 v | u32 keyId | u32 iteration | u32 len ‖ groupId | u32 len ‖ senderUserId | ciphertext
 * so a member cannot forge another member, and a message cannot be
 * re-attributed to another group or sender. The server sees the group, the
 * sender, and three opaque fields.
 */
export interface GroupMessage {
  v: 1;
  keyId: number;
  iteration: number;
  ciphertext: string; // base64
  signature: string; // base64, 64 bytes
}

/** Binds a group message to its group and sender. */
export interface GroupAssociatedData {
  groupId: string;
  senderUserId: string;
}

export type GroupEncryptResult = { state: SenderKeyState; message: GroupMessage };
export type GroupDecryptResult = { state: SenderKeyState; plaintext: string; consumedSkipped: boolean };

function u32(view: DataView, offset: number, value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new ProtocolError('HEADER_TAMPERED', 'Group message field out of range', { what, value: String(value) });
  }
  view.setUint32(offset, value, false);
}

/** Canonical bytes the signature covers (R4: length-prefixed, never JSON). */
export function groupMessageSignedBytes(msg: Omit<GroupMessage, 'signature'>, ad: GroupAssociatedData): Uint8Array {
  const group = utf8Encode(ad.groupId);
  const sender = utf8Encode(ad.senderUserId);
  const ciphertext = decodeBase64(normalizeB64(msg.ciphertext));
  const out = new Uint8Array(1 + 4 + 4 + 4 + group.length + 4 + sender.length + ciphertext.length);
  const view = new DataView(out.buffer);
  let o = 0;
  out[o] = msg.v;
  o += 1;
  u32(view, o, msg.keyId, 'keyId');
  o += 4;
  u32(view, o, msg.iteration, 'iteration');
  o += 4;
  u32(view, o, group.length, 'groupId.length');
  o += 4;
  out.set(group, o);
  o += group.length;
  u32(view, o, sender.length, 'senderUserId.length');
  o += 4;
  out.set(sender, o);
  o += sender.length;
  out.set(ciphertext, o);
  return out;
}

function requireCounter(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_MESSAGE_NUMBER) {
    throw new ProtocolError('HEADER_TAMPERED', 'Group message counter out of range', { what, value: String(value), limit: MAX_MESSAGE_NUMBER });
  }
}

/** Pure sending step: never mutates `state`; wipes every derived key. */
export function groupEncrypt(state: SenderKeyState, plaintext: string, ad: GroupAssociatedData): GroupEncryptResult {
  if (!state.signingPrivateKey) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Sender key state has no signing secret (not ours)', { what: 'signingPrivateKey' });
  }
  requireCounter(state.iteration, 'iteration');
  const ck = decodeBase64(normalizeB64(state.chainKey));
  const step = chainKdf(ck);
  wipe(ck);
  const keys = expandMessageKey(step.messageKey);
  wipe(step.messageKey);
  const signingSecret = decodeBase64(normalizeB64(state.signingPrivateKey));
  try {
    const ciphertext = nacl.secretbox(utf8Encode(plaintext), keys.nonce, keys.cipherKey);
    const unsigned = { v: SENDER_KEY_VERSION as 1, keyId: state.keyId, iteration: state.iteration, ciphertext: encodeBase64(ciphertext) };
    const signature = nacl.sign.detached(groupMessageSignedBytes(unsigned, ad), signingSecret);
    return {
      state: { ...state, chainKey: encodeBase64(step.nextChainKey), iteration: state.iteration + 1 },
      message: { ...unsigned, signature: encodeBase64(signature) },
    };
  } finally {
    wipe(keys.cipherKey, keys.macKey, keys.nonce, step.nextChainKey, signingSecret);
  }
}

function rememberReceived(state: SenderKeyState, iteration: number): number[] {
  const list = [...(state.recentlyReceived ?? []), iteration];
  return list.length > REPLAY_WINDOW ? list.slice(list.length - REPLAY_WINDOW) : list;
}

/**
 * Pure receiving step: verify the signature first (nothing is derived for
 * a message that is not the sender's), then the skipped-key fast path, the
 * replay window, the per-step and total skip bounds, derive forward, open,
 * commit. Never mutates `state`; on any throw the caller persists nothing.
 */
export function groupDecrypt(state: SenderKeyState, message: GroupMessage, ad: GroupAssociatedData): GroupDecryptResult {
  if (message.v !== SENDER_KEY_VERSION) {
    throw new ProtocolError('HEADER_TAMPERED', 'Unsupported group message version', { what: 'v', value: String(message.v) });
  }
  requireCounter(message.iteration, 'iteration');
  if (message.keyId !== state.keyId) {
    throw new ProtocolError('SENDER_KEY_STALE', 'Group message uses a sender key this member does not hold', { keyId: message.keyId, current: state.keyId });
  }

  // 0. Authenticate the sender before touching any key.
  let signature: Uint8Array;
  try {
    signature = decodeBase64(normalizeB64(message.signature ?? ''));
  } catch {
    signature = new Uint8Array(0);
  }
  const signedBytes = groupMessageSignedBytes(message, ad);
  const signingPublic = decodeBase64(normalizeB64(state.signingPublicKey));
  if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(signedBytes, signature, signingPublic)) {
    throw new ProtocolError('SENDER_KEY_SIGNATURE_INVALID', 'Group message signature does not verify for its sender', { iteration: message.iteration });
  }

  const ciphertext = decodeBase64(normalizeB64(message.ciphertext));
  const retained: Record<string, string> = { ...(state.skippedKeys ?? {}) };
  const id = String(message.iteration);

  // 1. Skipped-key fast path.
  const skipped = retained[id];
  if (skipped) {
    const mk = decodeBase64(normalizeB64(skipped));
    const plaintext = openWith(mk, ciphertext, message.iteration);
    delete retained[id];
    return { state: { ...state, skippedKeys: retained, recentlyReceived: rememberReceived(state, message.iteration) }, plaintext, consumedSkipped: true };
  }
  if ((state.recentlyReceived ?? []).includes(message.iteration)) {
    throw new ProtocolError('REPLAY_DETECTED', 'Group message already received', { iteration: message.iteration });
  }
  if (message.iteration < state.iteration) {
    throw new ProtocolError('UNKNOWN_OLD_MESSAGE', 'Group message older than the chain position with no retained key', { iteration: message.iteration, current: state.iteration });
  }
  const gap = message.iteration - state.iteration;
  if (gap > MAX_SKIP_PER_STEP) {
    throw new ProtocolError('TOO_MANY_SKIPPED', 'Too many skipped group messages in one step', { gap, limit: MAX_SKIP_PER_STEP });
  }

  // 2. Derive forward, retaining skipped keys (bounded), then open.
  let ck = decodeBase64(normalizeB64(state.chainKey));
  let iteration = state.iteration;
  let messageKey: Uint8Array | null = null;
  try {
    while (iteration <= message.iteration) {
      const step = chainKdf(ck);
      if (iteration === message.iteration) {
        messageKey = step.messageKey;
      } else {
        retained[String(iteration)] = encodeBase64(step.messageKey);
        wipe(step.messageKey);
      }
      wipe(ck);
      ck = step.nextChainKey;
      iteration += 1;
    }
    if (!messageKey) throw new ProtocolError('DECRYPT_FAILED', 'Failed to derive group message key', { iteration: message.iteration });
    const plaintext = openWith(messageKey, ciphertext, message.iteration);
    messageKey = null; // consumed by openWith

    // Bound the retained keys: lowest iterations go first.
    const ids = Object.keys(retained).map(Number).sort((a, b) => a - b);
    while (ids.length > MAX_SKIP_TOTAL) delete retained[String(ids.shift())];

    return {
      state: { ...state, chainKey: encodeBase64(ck), iteration, skippedKeys: retained, recentlyReceived: rememberReceived(state, message.iteration) },
      plaintext,
      consumedSkipped: false,
    };
  } finally {
    wipe(ck, messageKey);
  }
}

/** Opens a group ciphertext with a message key; consumes (wipes) the key. */
function openWith(messageKey: Uint8Array, ciphertext: Uint8Array, iteration: number): string {
  const keys = expandMessageKey(messageKey);
  wipe(messageKey);
  let plain: Uint8Array | null = null;
  try {
    plain = nacl.secretbox.open(ciphertext, keys.nonce, keys.cipherKey);
    if (!plain) throw new ProtocolError('DECRYPT_FAILED', 'Group message does not open under its key', { iteration });
    return utf8Decode(plain);
  } finally {
    wipe(keys.cipherKey, keys.macKey, keys.nonce, plain);
  }
}
