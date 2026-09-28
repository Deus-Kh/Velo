import { Schema, model, Types } from 'mongoose';

const ConversationSchema = new Schema(
  {
    conversationId: { type: String, required: true, unique: true, index: true },
    members: {
      type: [{ type: Types.ObjectId, ref: 'User', required: true }],
      required: true,
      validate: {
        validator(value: Types.ObjectId[]) {
          return Array.isArray(value) && value.length === 2;
        },
        message: 'Conversation must contain exactly two members',
      },
    },
    /** Server time of the last message (T3.2: never the client's clock). */
    lastMessageAt: { type: Number, required: true, index: true },
    /** T3.2: last sequence number handed out in this conversation (atomic $inc on send). */
    lastSeq: { type: Number, default: 0 },
    lastProtoVersion: { type: Number, required: true, default: 2 },
    lastMessagePreview: { type: String, default: '(Message)' },
    unreadCounts: {
      type: Map,
      of: Number,
      default: new Map(),
    },
  },
  { timestamps: true }
);

ConversationSchema.index({ members: 1, lastMessageAt: -1 });

export const ConversationModel = model('Conversation', ConversationSchema);
