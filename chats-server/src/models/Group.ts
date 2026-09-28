import { Schema, model, Types } from 'mongoose';

/**
 * Group (Phase 6', T6.3). Membership and roles live here; nothing about
 * keys does: sender keys are distributed device to device over pairwise
 * sessions (T6.2/T6.4). `epoch` increments on every membership change and
 * travels on every group message, so a message from a stale epoch is
 * detectable by members and a removed member's copies stop at its epoch.
 */
export const GROUP_NAME_MAX = 64;
export const GROUP_MAX_MEMBERS = 64;
export const GROUP_HISTORY_MAX = 50;

const MemberSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['admin', 'member'], required: true },
    addedAt: { type: Number, required: true },
  },
  { _id: false },
);

/** System feed entry (bounded). */
const EventSchema = new Schema(
  {
    at: { type: Number, required: true },
    type: { type: String, enum: ['created', 'added', 'removed', 'left', 'promoted', 'renamed'], required: true },
    byUserId: { type: Types.ObjectId, ref: 'User', required: true },
    userIds: { type: [Types.ObjectId], default: [] },
    epoch: { type: Number, required: true },
  },
  { _id: false },
);

const GroupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: GROUP_NAME_MAX },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
    members: { type: [MemberSchema], required: true },
    /** Increments on every membership change; carried by every group message. */
    epoch: { type: Number, required: true, default: 1 },
    /** Per-group sequence counter (T3.2 semantics). */
    lastSeq: { type: Number, default: 0 },
    lastMessageAt: { type: Number, default: 0 },
    history: { type: [EventSchema], default: [] },
  },
  { timestamps: true },
);

GroupSchema.index({ 'members.userId': 1, lastMessageAt: -1 });

export const GroupModel = model('Group', GroupSchema);

export type GroupRole = 'admin' | 'member';
