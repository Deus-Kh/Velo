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

// Usernames are unique case-insensitively ("Alice" and "alice" would otherwise be
// two accounts, which is an impersonation vector in a username-only UI). The
// default unique index above stays for exact lookups; this one enforces the
// case-insensitive rule at the database level.
UserSchema.index(
  { username: 1 },
  { unique: true, name: 'username_ci_unique', collation: { locale: 'en', strength: 2 } },
);

export const USERNAME_CI_COLLATION = { locale: 'en', strength: 2 } as const;

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const UserModel = model('User', UserSchema);
