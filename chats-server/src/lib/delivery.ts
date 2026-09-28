import { Types } from 'mongoose';
import { config } from '../config';
import { MessageModel } from '../models/Message';
import { emitToUser } from './realtime';

/**
 * Delete-on-delivery (T3.1, P1-10 server side).
 *
 * The server holds ciphertext only until the recipient's device has
 * decrypted it. The recipient acks with `message:delivered` (socket) or
 * `POST /messages/delivered` (HTTP, used by the history sync); the ack
 * strips `v3` and `initPacket` from the document. What remains is a
 * metadata-only receipt (status, deliveredAt, readAt) so a sender who was
 * offline at the time still learns the delivery and read state; the
 * receipt expires with the TTL index like everything else.
 *
 * Authorization: only the message's recipient may mark it delivered. A
 * message already read is never regressed to delivered.
 */
export const MESSAGE_TTL_MS = config.MESSAGE_TTL_DAYS * 24 * 60 * 60 * 1000;

export function messageExpiry(from: number = Date.now()): Date {
  return new Date(from + MESSAGE_TTL_MS);
}

export type DeliveredResult =
  | { ok: true; status: 'delivered' | 'read' }
  | { ok: false; code: 'BAD_ID' | 'NOT_FOUND' | 'FORBIDDEN' };

export async function markDelivered(params: { recipientId: string; serverMessageId: string }): Promise<DeliveredResult> {
  const { recipientId, serverMessageId } = params;
  if (!Types.ObjectId.isValid(serverMessageId)) return { ok: false, code: 'BAD_ID' };

  const doc = await MessageModel.findById(serverMessageId).select('toUserId fromUserId conversationId status v3');
  if (!doc) return { ok: false, code: 'NOT_FOUND' };
  if (String(doc.toUserId) !== String(recipientId)) return { ok: false, code: 'FORBIDDEN' };
  if (doc.status === 'read') return { ok: true, status: 'read' };

  const deliveredAt = Date.now();
  const r = await MessageModel.updateOne(
    { _id: doc._id, status: { $ne: 'read' } },
    {
      $set: { status: 'delivered', deliveredAt, expiresAt: messageExpiry(deliveredAt) },
      $unset: { v3: 1, initPacket: 1 },
    },
  );

  // Emit once: a repeated ack (already delivered, ciphertext already gone) changes nothing.
  if (r.modifiedCount > 0 && doc.v3) {
    emitToUser(String(doc.fromUserId), 'message:status-changed', {
      conversationId: doc.conversationId,
      status: 'delivered',
      serverMessageId,
      deliveredAt,
      deliveredByUserId: String(recipientId),
    });
  }
  return { ok: true, status: 'delivered' };
}
