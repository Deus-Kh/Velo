import { randomBytes } from 'crypto';
import express, { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { AttachmentModel } from '../models/Attachment';
import { services } from '../lib/services';
import { BLOB_ID_PATTERN, LocalBlobStore, blobStore } from '../lib/blobStore';
import { metrics } from '../lib/metrics';
import { log } from '../lib/logger';
import { config } from '../config';
import { reserveAttachmentSchema, validateBody } from '../utils/validation';

/**
 * T8.2: attachments are ciphertext blobs the server (or a bucket) stores
 * for a while. Reserve → upload to the returned URL → complete; recipients
 * exchange the blob id for a download URL. The key never comes here.
 */
/** Plaintext cap 8 MiB (protocol) plus the chunk overhead and the MAC trailer. */
export const MAX_BLOB_BYTES = 8 * 1024 * 1024 + Math.ceil((8 * 1024 * 1024) / (64 * 1024)) * 16 + 32;
export const ATTACHMENT_TTL_MS = config.ATTACHMENT_TTL_DAYS * 24 * 60 * 60 * 1000;
/** How long an upload or download URL stays valid. */
export const ATTACHMENT_URL_TTL_MS = 15 * 60 * 1000;

export const attachmentsRouter = Router();

attachmentsRouter.post('/', requireAuth, validateBody(reserveAttachmentSchema), async (req: AuthedRequest, res) => {
  const me = String(req.userId);
  const { size } = req.body as { size: number };
  const budget = await services.attachmentLimiter.hit(me);
  if (!budget.allowed) {
    res.setHeader('Retry-After', String(budget.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many attachments. Please wait and try again.', code: 'RATE_LIMITED', retryAfterSeconds: budget.retryAfterSeconds });
  }
  const blobId = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + ATTACHMENT_TTL_MS);
  await AttachmentModel.create({ blobId, ownerId: me, size, status: 'reserved', expiresAt });
  const upload = blobStore().uploadTarget(blobId, size, new Date(Date.now() + ATTACHMENT_URL_TTL_MS));
  metrics.attachmentsReserved.inc();
  return res.status(201).json({ blobId, size, upload, expiresAt: expiresAt.getTime() });
});

attachmentsRouter.post('/:blobId/complete', requireAuth, async (req: AuthedRequest, res) => {
  const me = String(req.userId);
  const blobId = String(req.params.blobId ?? '');
  if (!BLOB_ID_PATTERN.test(blobId)) return res.status(400).json({ error: 'Invalid blob id', code: 'BAD_ID' });
  const doc = await AttachmentModel.findOne({ blobId });
  if (!doc || doc.expiresAt.getTime() <= Date.now()) return res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' });
  if (String(doc.ownerId) !== me) return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
  if (doc.status === 'uploaded') return res.json({ ok: true, size: doc.size });
  const stored = await blobStore().stat(blobId);
  if (stored === null) return res.status(404).json({ error: 'Blob not uploaded', code: 'NOT_UPLOADED' });
  if (stored !== doc.size) {
    await blobStore().delete(blobId);
    return res.status(400).json({ error: 'Uploaded size does not match the reservation', code: 'SIZE_MISMATCH' });
  }
  doc.status = 'uploaded';
  doc.uploadedAt = new Date();
  await doc.save();
  metrics.attachmentsUploaded.inc();
  metrics.attachmentBytes.inc(doc.size);
  return res.json({ ok: true, size: doc.size });
});

/** Any signed-in holder of the blob id (it travels only inside the session) gets a short-lived download URL. */
attachmentsRouter.post('/:blobId/download', requireAuth, async (req: AuthedRequest, res) => {
  const blobId = String(req.params.blobId ?? '');
  if (!BLOB_ID_PATTERN.test(blobId)) return res.status(400).json({ error: 'Invalid blob id', code: 'BAD_ID' });
  const doc = await AttachmentModel.findOne({ blobId }).lean();
  if (!doc || doc.status !== 'uploaded' || doc.expiresAt.getTime() <= Date.now()) return res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' });
  const download = blobStore().downloadTarget(blobId, new Date(Date.now() + ATTACHMENT_URL_TTL_MS));
  return res.json({ blobId, size: doc.size, download, expiresAt: doc.expiresAt.getTime() });
});

// ───────── the local store's own transport: PUT/GET /blobs/:id?exp=&sig= ─────────

export const blobsRouter = Router();

function localStoreOr404(res: Response): LocalBlobStore | null {
  const store = blobStore();
  if (store.kind !== 'local') {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return null;
  }
  return store as LocalBlobStore;
}

blobsRouter.put('/:blobId', express.raw({ type: () => true, limit: MAX_BLOB_BYTES + 1024 }), async (req: Request, res: Response) => {
  const store = localStoreOr404(res);
  if (!store) return;
  const blobId = String(req.params.blobId ?? '');
  const q = req.query as Record<string, string | undefined>;
  if (!store.verifyToken('put', blobId, q.exp, q.sig)) return res.status(403).json({ error: 'Invalid or expired upload token', code: 'FORBIDDEN' });
  const doc = await AttachmentModel.findOne({ blobId }).lean();
  if (!doc || doc.expiresAt.getTime() <= Date.now()) return res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' });
  if (doc.status === 'uploaded') return res.status(409).json({ error: 'Already uploaded', code: 'ALREADY_UPLOADED' });
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (body.length !== doc.size) return res.status(400).json({ error: 'Body length does not match the reservation', code: 'SIZE_MISMATCH' });
  await store.write(blobId, body);
  return res.status(204).end();
});

blobsRouter.get('/:blobId', async (req: Request, res: Response) => {
  const store = localStoreOr404(res);
  if (!store) return;
  const blobId = String(req.params.blobId ?? '');
  const q = req.query as Record<string, string | undefined>;
  if (!store.verifyToken('get', blobId, q.exp, q.sig)) return res.status(403).json({ error: 'Invalid or expired download token', code: 'FORBIDDEN' });
  const doc = await AttachmentModel.findOne({ blobId }).lean();
  if (!doc || doc.status !== 'uploaded' || doc.expiresAt.getTime() <= Date.now()) return res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' });
  const size = await store.stat(blobId);
  if (size === null) return res.status(404).json({ error: 'Blob missing', code: 'NOT_FOUND' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = store.readStream(blobId);
  stream.on('error', (e) => {
    log.warn({ err: e.message }, '[blobs] read failed');
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  stream.pipe(res);
});
