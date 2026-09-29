import { Schema, model, Types } from 'mongoose';

/**
 * T7.5: a block, one document per (blocker, blocked). The server enforces it
 * silently: messages between the pair are dropped, presence and typing are
 * not shared, group copies between them are not fanned out. The blocked
 * user is never told.
 */
const BlockSchema = new Schema(
  {
    blockerId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    blockedId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
);

BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

export const BlockModel = model('Block', BlockSchema);
