import { launchImageLibrary } from 'react-native-image-picker';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import {
  attachmentDecrypt,
  attachmentEncrypt,
  generateAttachmentKey,
  jpegOrientation,
  stripImageMetadata,
  MAX_ATTACHMENT_BYTES,
  type AttachmentContent,
} from '@velo/protocol';
import { attachmentsApi } from '../api/attachments.api';
import { groupPeerKey, type GroupView } from '../api/groups.api';
import { publishMessagePatch, type ConversationTarget } from '../chat/actions';
import { sendGroupContentMessage } from '../chat/groupMessaging';
import { ensureV2Session } from '../crypto/sessionBootstrap';
import { sendContentMessage } from '../socket/messaging';
import { upsertStoredMessage, type AttachmentMeta, type StoredMessage } from '../storage/messageStore';
import { dataUriFor, rememberDataUri, saveMedia } from './mediaStore';
import { xhrTransport, type BlobTransport, type ProgressFn } from './transport';

/**
 * The attachment pipeline (T8.3). Send: pick → strip metadata → encrypt
 * under a fresh key → reserve → upload the ciphertext → complete → the
 * message carries the id, the key and the digest inside the session.
 * Receive: exchange the id for a URL → download → verify digest and MAC →
 * decrypt → keep the plaintext sealed on the device. The server holds only
 * opaque bytes and their size.
 */
export const AUTO_DOWNLOAD_BYTES = 2 * 1024 * 1024;
export const IMAGE_MAX_EDGE = 1600;

export type PickedImage = { bytes: Uint8Array; contentType: string; width?: number; height?: number; name?: string };

/** The photo picker, downscaled by the library; metadata is stripped here before anything else happens. */
export async function pickImages(): Promise<PickedImage[]> {
  const res = await launchImageLibrary({ mediaType: 'photo', maxWidth: IMAGE_MAX_EDGE, maxHeight: IMAGE_MAX_EDGE, quality: 0.8, includeBase64: true, selectionLimit: 0 });
  if (res.didCancel || !res.assets || res.assets.length === 0) return [];

  return res.assets.map((asset) => {
    if (!asset.base64) throw new Error(res.errorMessage || 'The picker returned no image data');
    const raw = decodeBase64(asset.base64);
    const stripped = stripImageMetadata(raw);
    const contentType = (asset.type && /^image\//i.test(asset.type) ? asset.type : stripped.kind === 'png' ? 'image/png' : 'image/jpeg').toLowerCase();
    if (stripped.bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('This image is too large to send (8 MB max)');
    const orientation = jpegOrientation(raw);
    const rotated = orientation >= 5 && orientation <= 8;
    return {
      bytes: stripped.bytes,
      contentType,
      width: rotated ? asset.height : asset.width,
      height: rotated ? asset.width : asset.height,
      name: asset.fileName,
    };
  });
}

export type UploadParams = {
  myUserId: string;
  bytes: Uint8Array;
  contentType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** voice notes: base64 waveform, ≤ 64 bytes */
  waveform?: string;
  name?: string;
  caption?: string;
  onProgress?: ProgressFn;
  transport?: BlobTransport;
};

/** Encrypt, upload (one retry), complete; returns the content to send. The plaintext is kept locally for the sender. */
export async function uploadAttachment(p: UploadParams): Promise<AttachmentContent> {
  const transport = p.transport ?? xhrTransport;
  const key = generateAttachmentKey();
  const enc = attachmentEncrypt(p.bytes, key);
  const reserved = (await attachmentsApi.reserve(enc.blob.length)).data;
  try {
    await transport.put(reserved.upload, enc.blob, p.onProgress);
  } catch (first) {
    console.warn('[attachments] upload failed once, retrying:', (first as Error)?.message);
    await transport.put(reserved.upload, enc.blob, p.onProgress);
  }
  await attachmentsApi.complete(reserved.blobId);
  await saveMedia({ myUserId: p.myUserId, blobId: reserved.blobId, bytes: p.bytes });
  rememberDataUri(reserved.blobId, dataUriFor(p.contentType, p.bytes));
  const content: AttachmentContent = {
    v: 1,
    kind: 'attachment',
    blobId: reserved.blobId,
    key: encodeBase64(key),
    digest: encodeBase64(enc.digest),
    size: enc.size,
    contentType: p.contentType,
  };
  if (p.width) content.width = p.width;
  if (p.height) content.height = p.height;
  if (p.durationMs) content.durationMs = p.durationMs;
  if (p.waveform) content.waveform = p.waveform;
  if (p.name) content.name = p.name;
  if (p.caption?.trim()) content.caption = p.caption.trim();
  key.fill(0);
  return content;
}

/** Download, verify (digest, then MAC), decrypt, keep. Throws the protocol codes on any integrity failure; nothing is kept then. */
export async function downloadAttachment(p: { myUserId: string; meta: AttachmentMeta; onProgress?: ProgressFn; transport?: BlobTransport }): Promise<Uint8Array> {
  const transport = p.transport ?? xhrTransport;
  const target = (await attachmentsApi.download(p.meta.blobId)).data;
  const blob = await transport.get(target.download, p.onProgress);
  const key = decodeBase64(p.meta.key);
  try {
    const bytes = attachmentDecrypt(blob, key, { digest: decodeBase64(p.meta.digest), size: p.meta.size });
    await saveMedia({ myUserId: p.myUserId, blobId: p.meta.blobId, bytes });
    rememberDataUri(p.meta.blobId, dataUriFor(p.meta.contentType, bytes));
    return bytes;
  } finally {
    key.fill(0);
  }
}

export function metaOf(content: AttachmentContent): AttachmentMeta {
  const meta: AttachmentMeta = { blobId: content.blobId, key: content.key, digest: content.digest, size: content.size, contentType: content.contentType };
  if (content.width !== undefined) meta.width = content.width;
  if (content.height !== undefined) meta.height = content.height;
  if (content.durationMs !== undefined) meta.durationMs = content.durationMs;
  if (content.waveform !== undefined) meta.waveform = content.waveform;
  if (content.name !== undefined) meta.name = content.name;
  return meta;
}

export function contentOf(meta: AttachmentMeta, caption?: string | null): AttachmentContent {
  const c: AttachmentContent = { v: 1, kind: 'attachment', blobId: meta.blobId, key: meta.key, digest: meta.digest, size: meta.size, contentType: meta.contentType };
  if (meta.width !== undefined) c.width = meta.width;
  if (meta.height !== undefined) c.height = meta.height;
  if (meta.durationMs !== undefined) c.durationMs = meta.durationMs;
  if (meta.waveform !== undefined) c.waveform = meta.waveform;
  if (meta.name !== undefined) c.name = meta.name;
  if (caption?.trim()) c.caption = caption.trim();
  return c;
}

const genId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Send an attachment message (1:1 or group) and store it locally; the UI learns of it through the patch bus. */
export async function sendAttachmentMessage(p: { myUserId: string; target: ConversationTarget; content: AttachmentContent }): Promise<StoredMessage> {
  const { myUserId, target, content } = p;
  const clientMessageId = genId();
  const createdAt = Date.now();
  const meta = metaOf(content);
  const text = content.caption ?? '';
  if (target.kind === 'group') {
    const { stored } = await sendGroupContentMessage({ myUserId, group: target.group, content, text, attachment: meta, clientMessageId, createdAt });
    publishMessagePatch({ myUserId, peerKey: groupPeerKey(target.group.groupId), id: stored.id, message: stored });
    return stored;
  }
  const bootstrap = await ensureV2Session({ myUserId, peerUserId: target.peerUserId });
  const base: StoredMessage = { id: clientMessageId, clientMessageId, serverMessageId: null, direction: 'out', text, createdAt, seq: null, status: 'sending', deliveredAt: null, readAt: null, replyTo: null, attachment: meta };
  let stored: StoredMessage;
  try {
    const r = await sendContentMessage({ toUserId: target.peerUserId, content, clientMessageId, initPacket: bootstrap.initPacket ?? null });
    stored = { ...base, serverMessageId: r.serverMessageId, seq: r.seq, status: 'sent' };
  } catch (e) {
    stored = { ...base, status: 'failed' };
    await upsertStoredMessage({ myUserId, peerUserId: target.peerUserId, message: stored });
    publishMessagePatch({ myUserId, peerKey: target.peerUserId, id: stored.id, message: stored });
    throw e;
  }
  await upsertStoredMessage({ myUserId, peerUserId: target.peerUserId, message: stored });
  publishMessagePatch({ myUserId, peerKey: target.peerUserId, id: stored.id, message: stored });
  return stored;
}

export function isImage(meta: AttachmentMeta): boolean {
  return /^image\//.test(meta.contentType);
}

export function isAudio(meta: AttachmentMeta): boolean {
  return /^audio\//.test(meta.contentType);
}

export function describeAttachment(meta: AttachmentMeta): string {
  if (isImage(meta)) return 'Photo';
  if (isAudio(meta)) return 'Voice message';
  return meta.name || 'File';
}

export { type GroupView };
