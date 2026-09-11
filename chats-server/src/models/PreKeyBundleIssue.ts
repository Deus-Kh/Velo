import { Schema, model, Types, type InferSchemaType } from 'mongoose';

/**
 * Ledger of prekey-bundle issues: who fetched whose bundle, when, and which
 * one-time prekey was consumed. Used for depletion forensics ("how do you
 * DETECT a drain?") and for identity-change diagnostics (T2.13). Not a cache:
 * a bundle is never re-served from here, because the responder deletes a
 * one-time prekey secret after first use, so re-issuing the same key would
 * break every session established after a client-side reset.
 */
const PreKeyBundleIssueSchema = new Schema(
  {
    requesterId: { type: Types.ObjectId, ref: 'User', required: true },
    targetId: { type: Types.ObjectId, ref: 'User', required: true },
    signedPreKeyId: { type: Number, required: true },
    oneTimePreKeyId: { type: Number, default: null },
    issuedAt: { type: Date, default: Date.now, required: true },
  },
  { timestamps: false },
);

PreKeyBundleIssueSchema.index({ targetId: 1, issuedAt: -1 });
PreKeyBundleIssueSchema.index({ requesterId: 1, issuedAt: -1 });
// Keep 30 days of history, then let MongoDB expire it.
PreKeyBundleIssueSchema.index({ issuedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export type PreKeyBundleIssueDoc = InferSchemaType<typeof PreKeyBundleIssueSchema>;
export const PreKeyBundleIssueModel = model('PreKeyBundleIssue', PreKeyBundleIssueSchema);
