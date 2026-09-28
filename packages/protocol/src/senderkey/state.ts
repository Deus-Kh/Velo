import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { ProtocolError } from '../errors';
import { normalizeB64 } from '../primitives/base64';
import { wipe } from '../primitives/zeroize';

/**
 * Sender Keys (Phase 6', T6.1): one symmetric chain per (group, sender),
 * distributed to every member over the pairwise Double Ratchet sessions,
 * and a per-sender Ed25519 signing key so members cannot forge each other.
 *
 * Forward secrecy: the chain ratchets forward per message (a compromised
 * state reveals nothing earlier), but there is no DH step inside an epoch
 * (a compromised state reveals everything later until the key rotates).
 * Rotation on every membership change (a fresh keyId) is the app's job
 * (T6.5). Recorded as DEVIATION-9 alongside Signal's Sender Keys, which
 * have the same property.
 *
 * `deviceId` is carried in the distribution record and is always 0 until
 * multi-device lands (D6): the format will not change then.
 */
export const SENDER_KEY_VERSION = 1;
export const SENDER_KEY_DEVICE_ID = 0;

export interface SenderKeyState {
  v: 1;
  /** Random u32 chosen by the sender; a new one per rotation. */
  keyId: number;
  /** Next message number on the chain. */
  iteration: number;
  /** base64, 32 bytes: the current chain key. */
  chainKey: string;
  /** base64 Ed25519 public key of the sender (all members hold it). */
  signingPublicKey: string;
  /** base64 Ed25519 secret key: only in the sender's own state. */
  signingPrivateKey?: string;
  /** Message keys skipped by out-of-order delivery: `${iteration}` → base64 key (receiver side). */
  skippedKeys?: Record<string, string>;
  /** Consumed iterations, bounded (replay window). */
  recentlyReceived?: number[];
}

/** What travels to the other members over their pairwise sessions. */
export interface SenderKeyDistributionMessage {
  v: 1;
  keyId: number;
  iteration: number;
  chainKey: string; // base64 32 bytes
  signingPublicKey: string; // base64 Ed25519
  deviceId: 0;
}

function requireKey(b64: string, length: number, what: string): Uint8Array {
  const bytes = decodeBase64(normalizeB64(b64));
  if (bytes.length !== length) {
    throw new ProtocolError('INVALID_KEY_LENGTH', what + ' must be ' + String(length) + ' bytes', { what, length: bytes.length });
  }
  return bytes;
}

/** A fresh sender state: random key id, random chain key, fresh signing pair. Injectable for vector tests. */
export function createSenderKeyState(seed?: { keyId?: number; chainKey?: Uint8Array; signing?: nacl.SignKeyPair }): SenderKeyState {
  const keyId = seed?.keyId ?? new DataView(nacl.randomBytes(4).buffer).getUint32(0, false);
  const chainKey = seed?.chainKey ?? nacl.randomBytes(32);
  const signing = seed?.signing ?? nacl.sign.keyPair();
  if (chainKey.length !== 32) throw new ProtocolError('INVALID_KEY_LENGTH', 'chain key must be 32 bytes', { what: 'chainKey', length: chainKey.length });
  const state: SenderKeyState = {
    v: SENDER_KEY_VERSION,
    keyId,
    iteration: 0,
    chainKey: encodeBase64(chainKey),
    signingPublicKey: encodeBase64(signing.publicKey),
    signingPrivateKey: encodeBase64(signing.secretKey),
    skippedKeys: {},
    recentlyReceived: [],
  };
  if (!seed?.chainKey) wipe(chainKey);
  if (!seed?.signing) wipe(signing.secretKey);
  return state;
}

/** The distribution record for the sender's current state (its chain position included, so late joiners start there). */
export function senderKeyDistributionMessage(state: SenderKeyState): SenderKeyDistributionMessage {
  requireKey(state.chainKey, 32, 'chainKey');
  requireKey(state.signingPublicKey, 32, 'signingPublicKey');
  return {
    v: SENDER_KEY_VERSION,
    keyId: state.keyId,
    iteration: state.iteration,
    chainKey: normalizeB64(state.chainKey),
    signingPublicKey: normalizeB64(state.signingPublicKey),
    deviceId: SENDER_KEY_DEVICE_ID,
  };
}

/** A receiver's state built from a distribution record (no signing secret). */
export function senderKeyStateFromDistribution(skdm: SenderKeyDistributionMessage): SenderKeyState {
  if (skdm.v !== SENDER_KEY_VERSION) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Unsupported sender key distribution version', { what: 'skdm.v', value: String(skdm.v) });
  }
  if (!Number.isInteger(skdm.keyId) || skdm.keyId < 0 || !Number.isInteger(skdm.iteration) || skdm.iteration < 0) {
    throw new ProtocolError('STORAGE_CORRUPTION', 'Malformed sender key distribution', { what: 'skdm' });
  }
  requireKey(skdm.chainKey, 32, 'skdm.chainKey');
  requireKey(skdm.signingPublicKey, 32, 'skdm.signingPublicKey');
  return {
    v: SENDER_KEY_VERSION,
    keyId: skdm.keyId,
    iteration: skdm.iteration,
    chainKey: normalizeB64(skdm.chainKey),
    signingPublicKey: normalizeB64(skdm.signingPublicKey),
    skippedKeys: {},
    recentlyReceived: [],
  };
}
