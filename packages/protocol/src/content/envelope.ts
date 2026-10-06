import { ProtocolError } from '../errors';
import type { SenderKeyDistributionMessage } from '../senderkey/state';
import { normalizeB64 } from '../primitives/base64';
import { decodeBase64 } from 'tweetnacl-util';
import { ATTACHMENT_KEY_BYTES, MAX_ATTACHMENT_BYTES } from '../attachment/keys';

/**
 * Content envelope (T6.2, extended in T7.1): what the plaintext of a
 * pairwise or group message is. Until Phase 6' the plaintext was the bare
 * text. It is now a versioned JSON document, so control messages (a
 * sender-key distribution, a request for one) and message actions (a
 * reaction, an edit, a delete request, a disappearing-message timer) travel
 * inside the same authenticated session as text, never through the server
 * in the clear.
 *
 * Decoding is lenient in exactly one way: a plaintext that is not a v1
 * envelope is treated as legacy bare text. Both come from the same
 * authenticated peer, so a text that merely looks like an envelope gives
 * that peer nothing it could not send for real.
 *
 * Who may act on what is the receiver's rule, not the envelope's: an edit
 * or a delete names its target by (sender, clientMessageId), and the
 * receiver honours it only when the acting peer is that sender (T7.2).
 */
export const CONTENT_VERSION = 1;

/** Limits a receiver enforces before acting (the server caps the ciphertext; these cap the semantics). */
export const MAX_REACTION_LENGTH = 16; // UTF-16 units: one emoji with modifiers and joiners
export const MAX_MESSAGE_REF_LENGTH = 128;
export const MAX_TIMER_SECONDS = 365 * 24 * 60 * 60;
export const MAX_PROFILE_NAME_LENGTH = 64;
/** base64 of a JPEG of at most ~24 KB: well under the 64 KiB ciphertext cap with the envelope around it. */
export const MAX_AVATAR_BASE64_LENGTH = 32_768;
export const MAX_ATTACHMENT_NAME_LENGTH = 255;
export const MAX_CAPTION_LENGTH = 4000;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_ATTACHMENT_DURATION_MS = 24 * 60 * 60 * 1000;
/** Voice-note waveform (base64): at most this many bytes, one 0..255 level per bar. */
export const MAX_ATTACHMENT_WAVEFORM_BYTES = 64;
/** Photos sent together are shown as one album of at most this many. */
export const MAX_ALBUM_SIZE = 10;
const MAX_ALBUM_ID_LENGTH = 64;

/**
 * Photos sent together (an album): each photo is still its own message, so
 * replies, reactions and deletion stay per photo; receivers draw messages
 * that share an `id` as one grid. `index` orders them, `count` is how many
 * were sent. A client that does not know the field shows separate photos.
 */
export type AttachmentAlbum = { id: string; index: number; count: number };

/** Names a message both sides know: its sender and the sender's client id (stable across the send/ack cycle). */
export type MessageRef = { senderUserId: string; clientMessageId: string };

export type TextContent = {
  v: 1;
  kind: 'text';
  text: string;
  /** T7.1: provenance of a forwarded message (the receiver shows "Forwarded"; the original author is not contacted). */
  forwardedFrom?: { userId: string; createdAt: number };
};
export type SenderKeyDistributionContent = { v: 1; kind: 'skdm'; groupId: string; skdm: SenderKeyDistributionMessage };
export type SenderKeyRequestContent = { v: 1; kind: 'skdm-request'; groupId: string };
/** A reaction to a message; `remove` withdraws this sender's reaction. One reaction per sender per message. */
export type ReactionContent = { v: 1; kind: 'reaction'; target: MessageRef; emoji: string; remove?: boolean };
/** A new text for one of the sender's own messages. */
export type EditContent = { v: 1; kind: 'edit'; target: MessageRef; text: string };
/** "Delete for everyone": a request that the receiver's device replace the sender's own message with a tombstone. */
export type DeleteContent = { v: 1; kind: 'delete'; target: MessageRef };
/** The disappearing-message timer for this conversation from now on; null switches it off. */
export type TimerContent = { v: 1; kind: 'timer'; seconds: number | null };
/** T7.7: what a contact shows for us: a name and an avatar. Newer `updatedAt` wins on the receiver. */
export type ProfileAvatar = { kind: 'emoji'; emoji: string; color: string } | { kind: 'jpeg'; data: string };
export type ProfileContent = { v: 1; kind: 'profile'; name: string; avatar: ProfileAvatar | null; updatedAt: number };
/**
 * T8.1: a message that is an attachment. The blob (attachment/cipher.ts)
 * lives on the server under `blobId`; the key and the digest travel only
 * here, inside the session. Shown as a message, never applied as an action.
 */
export type AttachmentContent = {
  v: 1;
  kind: 'attachment';
  blobId: string;
  /** base64, 32 bytes */
  key: string;
  /** base64, 32 bytes: SHA-256 of the blob */
  digest: string;
  /** plaintext bytes */
  size: number;
  contentType: string;
  name?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** base64, ≤ 64 bytes: loudness per bar, drawn in the voice bubble (T8.4) */
  waveform?: string;
  caption?: string;
  album?: AttachmentAlbum;
};

export type ControlContent = SenderKeyDistributionContent | SenderKeyRequestContent;
export type ActionContent = ReactionContent | EditContent | DeleteContent | TimerContent | ProfileContent;
export type Content = TextContent | ControlContent | ActionContent | AttachmentContent;

export function textContent(text: string, forwardedFrom?: { userId: string; createdAt: number }): TextContent {
  return forwardedFrom ? { v: CONTENT_VERSION, kind: 'text', text, forwardedFrom } : { v: CONTENT_VERSION, kind: 'text', text };
}

function malformed(what: string, value?: string): ProtocolError {
  return new ProtocolError('STORAGE_CORRUPTION', 'Malformed ' + what + ' content', value === undefined ? { what: 'content.' + what } : { what: 'content.' + what, value });
}

function requireRef(ref: MessageRef, kind: string): MessageRef {
  if (!isMessageRef(ref)) throw malformed(kind);
  return { senderUserId: ref.senderUserId, clientMessageId: ref.clientMessageId };
}

function requireTimer(seconds: number | null): number | null {
  if (seconds === null) return null;
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_TIMER_SECONDS) throw malformed('timer', String(seconds));
  return seconds;
}

function requireProfileName(name: unknown): string {
  if (typeof name !== 'string') throw malformed('profile.name');
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROFILE_NAME_LENGTH) throw malformed('profile.name');
  return trimmed;
}

function requireAvatar(avatar: unknown): ProfileAvatar | null {
  if (avatar === null || avatar === undefined) return null;
  if (!isRecord(avatar)) throw malformed('profile.avatar');
  if (avatar.kind === 'emoji') {
    if (typeof avatar.emoji !== 'string' || typeof avatar.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(avatar.color)) throw malformed('profile.avatar');
    return { kind: 'emoji', emoji: requireEmoji(avatar.emoji), color: avatar.color.toLowerCase() };
  }
  if (avatar.kind === 'jpeg') {
    if (typeof avatar.data !== 'string' || avatar.data.length === 0 || avatar.data.length > MAX_AVATAR_BASE64_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(avatar.data)) throw malformed('profile.avatar');
    return { kind: 'jpeg', data: avatar.data };
  }
  throw malformed('profile.avatar');
}

function requireUpdatedAt(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw malformed('profile.updatedAt');
  return v;
}

function requireBase64Bytes(value: unknown, length: number, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw malformed(what);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(normalizeB64(value));
  } catch {
    throw malformed(what);
  }
  if (bytes.length !== length) throw malformed(what);
  return normalizeB64(value);
}

function optionalBase64Bytes(value: unknown, maxLength: number, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength * 2) throw malformed(what);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(normalizeB64(value));
  } catch {
    throw malformed(what);
  }
  if (bytes.length === 0 || bytes.length > maxLength) throw malformed(what);
  return normalizeB64(value);
}

function optionalInt(value: unknown, max: number, what: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) throw malformed(what);
  return value;
}

function optionalText(value: unknown, max: number, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) throw malformed(what);
  return value;
}

function requireAttachment(c: Record<string, unknown>): AttachmentContent {
  if (typeof c.blobId !== 'string' || c.blobId.length === 0 || c.blobId.length > MAX_MESSAGE_REF_LENGTH) throw malformed('attachment.blobId');
  if (typeof c.size !== 'number' || !Number.isInteger(c.size) || c.size < 0 || c.size > MAX_ATTACHMENT_BYTES) throw malformed('attachment.size');
  if (typeof c.contentType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(c.contentType) || c.contentType.length > 128) throw malformed('attachment.contentType');
  const out: AttachmentContent = {
    v: CONTENT_VERSION,
    kind: 'attachment',
    blobId: c.blobId,
    key: requireBase64Bytes(c.key, ATTACHMENT_KEY_BYTES, 'attachment.key'),
    digest: requireBase64Bytes(c.digest, 32, 'attachment.digest'),
    size: c.size,
    contentType: c.contentType.toLowerCase(),
  };
  const name = optionalText(c.name, MAX_ATTACHMENT_NAME_LENGTH, 'attachment.name');
  if (name !== undefined) out.name = name;
  const width = optionalInt(c.width, MAX_IMAGE_DIMENSION, 'attachment.width');
  if (width !== undefined) out.width = width;
  const height = optionalInt(c.height, MAX_IMAGE_DIMENSION, 'attachment.height');
  if (height !== undefined) out.height = height;
  const durationMs = optionalInt(c.durationMs, MAX_ATTACHMENT_DURATION_MS, 'attachment.durationMs');
  if (durationMs !== undefined) out.durationMs = durationMs;
  const waveform = optionalBase64Bytes(c.waveform, MAX_ATTACHMENT_WAVEFORM_BYTES, 'attachment.waveform');
  if (waveform !== undefined) out.waveform = waveform;
  const caption = optionalText(c.caption, MAX_CAPTION_LENGTH, 'attachment.caption');
  if (caption !== undefined) out.caption = caption;
  const album = optionalAlbum(c.album);
  if (album !== undefined) out.album = album;
  return out;
}

function optionalAlbum(value: unknown): AttachmentAlbum | undefined {
  if (value === undefined || value === null) return undefined;
  const a = value as Record<string, unknown>;
  if (typeof a !== 'object' || typeof a.id !== 'string' || a.id.length === 0 || a.id.length > MAX_ALBUM_ID_LENGTH) throw malformed('attachment.album');
  const count = a.count;
  const index = a.index;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 2 || count > MAX_ALBUM_SIZE) throw malformed('attachment.album');
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) throw malformed('attachment.album');
  return { id: a.id, index, count };
}

function requireEmoji(emoji: string): string {
  if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > MAX_REACTION_LENGTH || /\s/.test(emoji)) throw malformed('reaction');
  return emoji;
}

export function encodeContent(content: Content): string {
  switch (content.kind) {
    case 'text': {
      const f = content.forwardedFrom;
      if (f !== undefined && !isForwardedFrom(f)) throw malformed('text.forwardedFrom');
      return JSON.stringify(f ? { v: CONTENT_VERSION, kind: 'text', text: String(content.text), forwardedFrom: { userId: f.userId, createdAt: f.createdAt } } : { v: CONTENT_VERSION, kind: 'text', text: String(content.text) });
    }
    case 'skdm':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'skdm', groupId: content.groupId, skdm: content.skdm });
    case 'skdm-request':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'skdm-request', groupId: content.groupId });
    case 'reaction': {
      const out: Record<string, unknown> = { v: CONTENT_VERSION, kind: 'reaction', target: requireRef(content.target, 'reaction'), emoji: requireEmoji(content.emoji) };
      if (content.remove) out.remove = true;
      return JSON.stringify(out);
    }
    case 'edit':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'edit', target: requireRef(content.target, 'edit'), text: String(content.text) });
    case 'delete':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'delete', target: requireRef(content.target, 'delete') });
    case 'timer':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'timer', seconds: requireTimer(content.seconds) });
    case 'profile':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'profile', name: requireProfileName(content.name), avatar: requireAvatar(content.avatar), updatedAt: requireUpdatedAt(content.updatedAt) });
    case 'attachment':
      return JSON.stringify(requireAttachment(content as unknown as Record<string, unknown>));
    default:
      throw new ProtocolError('STORAGE_CORRUPTION', 'Unknown content kind', { what: 'content.kind' });
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSkdm(v: unknown): v is SenderKeyDistributionMessage {
  return (
    isRecord(v) &&
    v.v === 1 &&
    typeof v.keyId === 'number' &&
    typeof v.iteration === 'number' &&
    typeof v.chainKey === 'string' &&
    typeof v.signingPublicKey === 'string' &&
    v.deviceId === 0
  );
}

function isMessageRef(v: unknown): v is MessageRef {
  return (
    isRecord(v) &&
    typeof v.senderUserId === 'string' &&
    v.senderUserId.length > 0 &&
    v.senderUserId.length <= MAX_MESSAGE_REF_LENGTH &&
    typeof v.clientMessageId === 'string' &&
    v.clientMessageId.length > 0 &&
    v.clientMessageId.length <= MAX_MESSAGE_REF_LENGTH
  );
}

function isForwardedFrom(v: unknown): v is { userId: string; createdAt: number } {
  return isRecord(v) && typeof v.userId === 'string' && v.userId.length > 0 && v.userId.length <= MAX_MESSAGE_REF_LENGTH && typeof v.createdAt === 'number' && Number.isFinite(v.createdAt);
}

/** A v1 envelope, or legacy bare text. Never throws on text. */
export function decodeContent(plaintext: string): Content {
  if (!plaintext.startsWith('{')) return textContent(plaintext);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return textContent(plaintext);
  }
  if (!isRecord(parsed) || parsed.v !== CONTENT_VERSION || typeof parsed.kind !== 'string') return textContent(plaintext);
  switch (parsed.kind) {
    case 'text': {
      const text = typeof parsed.text === 'string' ? parsed.text : '';
      if (parsed.forwardedFrom === undefined) return textContent(text);
      if (!isForwardedFrom(parsed.forwardedFrom)) throw malformed('text.forwardedFrom');
      return textContent(text, { userId: parsed.forwardedFrom.userId, createdAt: parsed.forwardedFrom.createdAt });
    }
    case 'skdm':
      if (typeof parsed.groupId === 'string' && parsed.groupId.length > 0 && isSkdm(parsed.skdm)) {
        return { v: CONTENT_VERSION, kind: 'skdm', groupId: parsed.groupId, skdm: parsed.skdm };
      }
      throw malformed('skdm');
    case 'skdm-request':
      if (typeof parsed.groupId === 'string' && parsed.groupId.length > 0) {
        return { v: CONTENT_VERSION, kind: 'skdm-request', groupId: parsed.groupId };
      }
      throw malformed('skdm-request');
    case 'reaction': {
      if (!isMessageRef(parsed.target) || typeof parsed.emoji !== 'string') throw malformed('reaction');
      const out: ReactionContent = { v: CONTENT_VERSION, kind: 'reaction', target: requireRef(parsed.target, 'reaction'), emoji: requireEmoji(parsed.emoji) };
      if (parsed.remove === true) out.remove = true;
      return out;
    }
    case 'edit':
      if (!isMessageRef(parsed.target) || typeof parsed.text !== 'string') throw malformed('edit');
      return { v: CONTENT_VERSION, kind: 'edit', target: requireRef(parsed.target, 'edit'), text: parsed.text };
    case 'delete':
      if (!isMessageRef(parsed.target)) throw malformed('delete');
      return { v: CONTENT_VERSION, kind: 'delete', target: requireRef(parsed.target, 'delete') };
    case 'timer':
      if (parsed.seconds !== null && typeof parsed.seconds !== 'number') throw malformed('timer');
      return { v: CONTENT_VERSION, kind: 'timer', seconds: requireTimer(parsed.seconds as number | null) };
    case 'profile':
      return { v: CONTENT_VERSION, kind: 'profile', name: requireProfileName(parsed.name), avatar: requireAvatar(parsed.avatar), updatedAt: requireUpdatedAt(parsed.updatedAt) };
    case 'attachment':
      return requireAttachment(parsed);
    default:
      // A kind this build does not know: a newer peer. Not text, not ours to act on.
      throw new ProtocolError('STORAGE_CORRUPTION', 'Unknown content kind', { what: 'content.kind', value: String(parsed.kind) });
  }
}

/** Sender-key traffic (T6.2): handled by the group key lifecycle, never shown. */
export function isControlContent(content: Content): content is ControlContent {
  return content.kind === 'skdm' || content.kind === 'skdm-request';
}

/** T8.1: a message that is an attachment (shown like text; the blob is fetched and decrypted on demand). */
export function isAttachmentContent(content: Content): content is AttachmentContent {
  return content.kind === 'attachment';
}

/** Message actions (T7.1): applied to the local store, never shown as a message of their own. */
export function isActionContent(content: Content): content is ActionContent {
  return content.kind === 'reaction' || content.kind === 'edit' || content.kind === 'delete' || content.kind === 'timer' || content.kind === 'profile';
}
