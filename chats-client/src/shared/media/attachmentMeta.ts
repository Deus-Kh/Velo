import type { AttachmentContent } from '@velo/protocol';
import type { AttachmentMeta } from '../storage/messageStore';

/**
 * What a message keeps of an attachment it received or sent: everything
 * but the caption (that is the message text). One function for the live
 * 1:1 path, the group path and history sync, so a new optional field
 * (the voice waveform, the photo album) is never dropped on one of them.
 */
export function attachmentMetaOf(c: AttachmentContent): AttachmentMeta {
  const meta: AttachmentMeta = { blobId: c.blobId, key: c.key, digest: c.digest, size: c.size, contentType: c.contentType };
  if (c.width !== undefined) meta.width = c.width;
  if (c.height !== undefined) meta.height = c.height;
  if (c.durationMs !== undefined) meta.durationMs = c.durationMs;
  if (c.waveform !== undefined) meta.waveform = c.waveform;
  if (c.name !== undefined) meta.name = c.name;
  if (c.album !== undefined) meta.album = { ...c.album };
  return meta;
}
