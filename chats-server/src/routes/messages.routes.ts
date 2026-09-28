import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { MessageModel } from "../models/Message";
import { makeConversationId } from "../utils/conversation";
import { markDelivered } from "../lib/delivery";
import { log } from '../lib/logger';

export const messagesRouter = Router();

/**
 * GET /messages/undelivered  (T3.1)
 * Ciphertext the server still holds for the caller: messages addressed to
 * me whose recipient device has not acked delivery yet. Oldest first.
 * Query:
 *   - peerUserId (optional) : restrict to one conversation
 *   - after      (optional) : seq cursor (T3.2): only messages with seq > after
 *   - limit      (default 100, max 200)
 *   - receiptsSince (optional, ms; with peerUserId) : also return delivery/read
 *     receipts for my own messages in that conversation updated after this time,
 *     so a sender who was offline still learns the state of what they sent.
 */
messagesRouter.get(
  "/undelivered",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const me = String(req.userId);
    const peer = typeof req.query.peerUserId === 'string' ? req.query.peerUserId : null;
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 200);
    const after = req.query.after !== undefined ? Number(req.query.after) : null;
    const receiptsSince = req.query.receiptsSince !== undefined ? Number(req.query.receiptsSince) : null;
    const serverTime = Date.now();

    const filter: any = { toUserId: me, v4: { $ne: null } };
    if (peer) filter.conversationId = makeConversationId(me, peer);
    if (after !== null && Number.isFinite(after)) filter.seq = { $gt: after };

    const docs = await MessageModel.find(filter)
      .select("_id conversationId fromUserId toUserId protoVersion v4 initPacket replyTo clientMessageId createdAtClient seq status deliveredAt readAt")
      .sort({ seq: 1, _id: 1 })
      .limit(limit);

    const items = docs.map((d) => ({
      serverMessageId: String(d._id),
      conversationId: (d as any).conversationId,
      fromUserId: String(d.fromUserId),
      toUserId: String(d.toUserId),
      protoVersion: (d.protoVersion ?? 4) as 4,
      v4: d.v4 ?? null,
      initPacket: (d as any).initPacket ?? null,
      replyTo: (d as any).replyTo ?? null,
      clientMessageId: d.clientMessageId,
      createdAt: d.createdAtClient,
      seq: (d as any).seq ?? null,
      status: (d as any).status ?? 'sent',
      deliveredAt: (d as any).deliveredAt ?? null,
      readAt: (d as any).readAt ?? null,
    }));

    let receipts: Array<{ serverMessageId: string; clientMessageId: string; createdAt: number; seq: number | null; status: string; deliveredAt: number | null; readAt: number | null }> = [];
    if (peer && receiptsSince !== null && Number.isFinite(receiptsSince)) {
      const stubs = await MessageModel.find({
        conversationId: makeConversationId(me, peer),
        fromUserId: me,
        status: { $in: ['delivered', 'read'] },
        updatedAt: { $gt: new Date(receiptsSince) },
      })
        .select("_id clientMessageId createdAtClient seq status deliveredAt readAt")
        .sort({ seq: 1 })
        .limit(500);
      receipts = stubs.map((d) => ({
        serverMessageId: String(d._id),
        clientMessageId: d.clientMessageId,
        createdAt: d.createdAtClient,
        seq: (d as any).seq ?? null,
        status: (d as any).status,
        deliveredAt: (d as any).deliveredAt ?? null,
        readAt: (d as any).readAt ?? null,
      }));
    }

    return res.json({ items, receipts, serverTime });
  },
);

/**
 * POST /messages/delivered  (T3.1)
 * Body: { serverMessageIds: string[] } (max 200). The HTTP twin of the
 * `message:delivered` socket ack, used by the history sync after it has
 * decrypted and stored a message. Each ack deletes that message's ciphertext.
 */
messagesRouter.post(
  "/delivered",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const me = String(req.userId);
    const ids = Array.isArray(req.body?.serverMessageIds) ? req.body.serverMessageIds : null;
    if (!ids || ids.length > 200 || !ids.every((x: unknown) => typeof x === 'string')) {
      return res.status(400).json({ ok: false, code: 'BAD_REQUEST', error: 'serverMessageIds: string[] (max 200)' });
    }
    const results: Record<string, string> = {};
    for (const id of ids as string[]) {
      const r = await markDelivered({ recipientId: me, serverMessageId: id });
      results[id] = r.ok ? r.status : r.code;
    }
    return res.json({ ok: true, results });
  },
);

/**
 * POST /messages/mark-read/:conversationId
 * Marks all messages from sender as read when receiver opens chat
 */
messagesRouter.post(
  "/mark-read/:conversationId",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const me = String(req.userId);
    const conversationId = String(req.params.conversationId);

    // Only mark messages FROM others TO me
    const result = await MessageModel.updateMany(
      {
        conversationId,
        toUserId: me,
        status: { $ne: 'read' }, // Don't update if already read
      },
      {
        $set: {
          status: 'read',
          readAt: Date.now(),
        },
      }
    );

    log.info({
      conversationId,
      forUser: me,
      updatedCount: result.modifiedCount,
    }, '[messages] mark-read');

    return res.json({ ok: true, updatedCount: result.modifiedCount });
  }
);
