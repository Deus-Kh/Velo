import { Schema, model, type InferSchemaType } from 'mongoose';

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 32, index: true },
    passwordHash: { type: String, required: true },

    // base64 public key (tweetnacl.box.keyPair().publicKey)
    publicKey: { type: String, default: null, index: true },
    publicKeyUpdatedAt: { type: Date, default: null },

    identitySignPublicKey: { type: String, default: null, index: true },
    identitySignUpdatedAt: { type: Date, default: null },

    identityDhPublicKey: { type: String, default: null, index: true },
    identityDhUpdatedAt: { type: Date, default: null },

    pushTokens: {
      type: [
        {
          token: { type: String, required: true },
          platform: { type: String, enum: ["android", "ios"], required: true },
          updatedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },


  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const UserModel = model('User', UserSchema);
