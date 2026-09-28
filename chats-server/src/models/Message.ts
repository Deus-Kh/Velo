import { Schema, model, Types } from 'mongoose';
import { makeConversationId } from '../utils/conversation';

/**
 * Wire v4 envelope (T3.6): {encHeader, ciphertext, mac}. The header travels
 * encrypted under the sender's header key; the server stores three opaque
 * strings and never learns counters or ratchet keys (P1-8).
 */
const V4Schema = new Schema(
  {
    encHeader: { type: String, required: true },
    ciphertext: { type: String, required: true },
    mac: { type: String, required: true },
  },
  { _id: false }
);

const InitPacketSchema = new Schema(
  {
    peerUserId: { type: String, required: true },
    ephPublicKey: { type: String, required: true },
    signedPreKeyId: { type: Number, required: true },
    oneTimePreKeyId: { type: Number, default: null },
    initiatorIdentityDhPublicKey: { type: String, required: true },
    // T3.5 PQ-readiness (PQXDH shape): stored if a client ever sends them, ignored today.
    pqPreKeyId: { type: Number, default: null },
    kemCiphertext: { type: String, default: null },
  },
  { _id: false }
);

const ReplyToSchema = new Schema(
  {
    serverMessageId: { type: String, default: null },
    clientMessageId: { type: String, default: null },
  },
  { _id: false }
);

const MessageSchema = new Schema(
  {
    conversationId: { type: String, required: true, index: true },
    fromUserId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    toUserId: { type: Types.ObjectId, ref: 'User', required: true, index: true },

    protoVersion: { type: Number, default: 4, index: true },

    // v4 envelope. T3.1: unset once the recipient acks delivery; the document
    // then remains as a metadata-only receipt until it expires.
    v4: { type: V4Schema, default: null },
    initPacket: { type: InitPacketSchema, default: null },
    replyTo: { type: ReplyToSchema, default: null },

    clientMessageId: { type: String, required: true },
    /** The sender's clock: display only (T3.2). Ordering and cursors use `seq`. */
    createdAtClient: { type: Number, required: true, index: true },
    /** T3.2: server-assigned, per conversation, strictly increasing. Null only on pre-T3.2 documents. */
    seq: { type: Number, default: null },
    
    // Delivery metadata
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed'],
      default: 'sent',
      index: true,
    },
    deliveredAt: { type: Number, default: null },
    readAt: { type: Number, default: null },

    // T3.1: MongoDB removes the document once this passes (30 days by default).
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAtClient: -1 });
MessageSchema.index({ toUserId: 1, seq: 1 }); // undelivered listing
MessageSchema.index({ conversationId: 1, seq: 1 }, { unique: true, partialFilterExpression: { seq: { $type: 'number' } } });
MessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
MessageSchema.index({ fromUserId: 1, clientMessageId: 1 }, { unique: true });

MessageSchema.pre('validate', function setConversationId() {
  if (!this.conversationId && this.fromUserId && this.toUserId) {
    this.conversationId = makeConversationId(String(this.fromUserId), String(this.toUserId));
  }
});

export const MessageModel = model('Message', MessageSchema);
