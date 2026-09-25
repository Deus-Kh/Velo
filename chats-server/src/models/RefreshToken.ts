import { Schema, model, Types, type InferSchemaType } from 'mongoose';

/**
 * Refresh tokens (T1.10 / P2-1). Only the SHA-256 of the token is stored; a
 * database leak must not yield usable tokens. Tokens form a *family*: each
 * refresh rotates to a new token in the same family and revokes the old one.
 * Presenting an already-revoked token is reuse (theft or replay) and revokes
 * the whole family.
 */
const RefreshTokenSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    family: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null }, // tokenHash of the successor
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Expired rows (revoked or not) are garbage-collected by MongoDB.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenDoc = InferSchemaType<typeof RefreshTokenSchema>;
export const RefreshTokenModel = model('RefreshToken', RefreshTokenSchema);
