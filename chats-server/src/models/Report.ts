import { Schema, model, Types } from 'mongoose';

/**
 * T7.5: a report about a user. The server never sees message plaintext,
 * so a report carries only what the reporter chose to include: a reason
 * and an optional excerpt in the reporter's own words. Review is manual
 * and out of scope for the app; the collection exists so a report is not
 * lost.
 */
export const REPORT_REASONS = ['spam', 'abuse', 'impersonation', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const ReportSchema = new Schema(
  {
    reporterId: { type: Types.ObjectId, ref: 'User', default: null, index: true },
    reportedUserId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    excerpt: { type: String, default: null, maxlength: 2000 },
    groupId: { type: Types.ObjectId, ref: 'Group', default: null },
  },
  { timestamps: true },
);

export const ReportModel = model('Report', ReportSchema);
