import { AttachmentModel } from '../models/Attachment';
import { blobStore } from './blobStore';
import { log } from './logger';

/**
 * T8.2: expiry of attachments is owned here, not by a TTL index, so the
 * file or object goes with the document. Runs hourly (index.ts) and can be
 * called directly (tests, an operator's script).
 */
export const ATTACHMENT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function sweepExpiredAttachments(now: Date = new Date()): Promise<{ removed: number }> {
  const store = blobStore();
  const expired = await AttachmentModel.find({ expiresAt: { $lte: now } }).select('blobId').lean();
  let removed = 0;
  for (const doc of expired) {
    try {
      await store.delete(doc.blobId);
      await AttachmentModel.deleteOne({ _id: doc._id });
      removed += 1;
    } catch (e) {
      log.warn({ err: (e as Error)?.message ?? e }, '[attachments] sweep: could not remove a blob');
    }
  }
  if (removed) log.info({ removed }, '[attachments] sweep');
  return { removed };
}

export function startAttachmentSweep(intervalMs = ATTACHMENT_SWEEP_INTERVAL_MS): () => void {
  const handle = setInterval(() => {
    sweepExpiredAttachments().catch((e) => log.warn({ err: (e as Error)?.message ?? e }, '[attachments] sweep failed'));
  }, intervalMs);
  handle.unref();
  return () => clearInterval(handle);
}
