import { Schema, model, Types } from 'mongoose';

/**
 * T8.2: one reserved or uploaded ciphertext blob. `blobId` is a 128-bit
 * random capability: whoever holds it (every recipient of the message that
 * carries it, over the session) may download; the key and digest travel
 * only inside the message. No TTL index: `lib/attachmentSweep.ts` owns
 * expiry so the file or object goes with the document.
 */
export const ATTACHMENT_STATUSES = ['reserved', 'uploaded'] as const;

const AttachmentSchema = new Schema(
  {
    blobId: { type: String, required: true, unique: true, index: true },
    ownerId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    /** Ciphertext length the owner declared at reservation; the upload must match it. */
    size: { type: Number, required: true },
    status: { type: String, enum: ATTACHMENT_STATUSES, default: 'reserved', index: true },
    uploadedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

export const AttachmentModel = model('Attachment', AttachmentSchema);
