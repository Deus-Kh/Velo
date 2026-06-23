import { Schema, model, Types, type InferSchemaType } from 'mongoose';

const SignedPreKeySchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    keyId: { type: Number, required: true }, // client-generated id
    publicKey: { type: String, required: true }, // base64 (X25519 pub)
    signature: { type: String, required: true }, // base64 (Ed25519 detached sig)
  },
  { timestamps: true }
);

// one active signed prekey per user+keyId, allow rotation by incrementing keyId
SignedPreKeySchema.index({ userId: 1, keyId: 1 }, { unique: true });
// useful for "latest"
SignedPreKeySchema.index({ userId: 1, createdAt: -1 });

export type SignedPreKeyDoc = InferSchemaType<typeof SignedPreKeySchema>;
export const SignedPreKeyModel = model('SignedPreKey', SignedPreKeySchema);
