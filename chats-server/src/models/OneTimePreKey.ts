import { Schema, model, Types, type InferSchemaType } from 'mongoose';

const OneTimePreKeySchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    keyId: { type: Number, required: true }, // client-generated id
    publicKey: { type: String, required: true }, // base64 (X25519 pub)
    used: { type: Boolean, default: false, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

OneTimePreKeySchema.index({ userId: 1, keyId: 1 }, { unique: true });
OneTimePreKeySchema.index({ userId: 1, used: 1, createdAt: 1 });

export type OneTimePreKeyDoc = InferSchemaType<typeof OneTimePreKeySchema>;
export const OneTimePreKeyModel = model('OneTimePreKey', OneTimePreKeySchema);
