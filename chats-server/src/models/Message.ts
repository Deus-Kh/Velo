import { Schema, model, Types } from 'mongoose';
import { makeConversationId } from '../utils/conversation';

const V2Schema = new Schema(
  {
    header: {
      n: { type: Number, required: true },
      pn: { type: Number, required: true },
      // позже (3.6) добавим dhPub
      dhPub: { type: String, required: true },
    },
    nonce: { type: String, required: true },
    ciphertext: { type: String, required: true },
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

    protoVersion: { type: Number, default: 2, index: true },

    // v2 payload
    v2: { type: V2Schema, default: null },
    initPacket: { type: InitPacketSchema, default: null },
    replyTo: { type: ReplyToSchema, default: null },

    clientMessageId: { type: String, required: true },
    createdAtClient: { type: Number, required: true, index: true },
    
    // Delivery metadata
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed'],
      default: 'sent',
      index: true,
    },
    deliveredAt: { type: Number, default: null },
    readAt: { type: Number, default: null },
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAtClient: -1 });
MessageSchema.index({ fromUserId: 1, clientMessageId: 1 }, { unique: true });

MessageSchema.pre('validate', function setConversationId() {
  if (!this.conversationId && this.fromUserId && this.toUserId) {
    this.conversationId = makeConversationId(String(this.fromUserId), String(this.toUserId));
  }
});

export const MessageModel = model('Message', MessageSchema);
