import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { MessageModel } from "../models/Message";
import { makeConversationId } from "../utils/conversation";
import { markDelivered } from "../lib/delivery";

export const messagesRouter = Router();

/**
 * GET /messages/with/:userId
 * Returns encrypted history between current user and peer (ciphertext only).
 * T3.1: kept only for the T2.14 migration window (archived keys → local
 * store). Delivered messages no longer carry ciphertext, so the newer
 * `/messages/undelivered` is what the client syncs from.
 * Query:
 *   - limit (default 50, max 200)
 *   - before (optional) : timestamp (createdAtClient) for pagination (older page, newest first)
 *   - after  (optional) : timestamp (createdAtClient); returns messages newer than it, oldest first (T2.14 sync)
 */
messagesRouter.get(
  "/with/:userId",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const me = req.userId!;
    const peer = String(req.params.userId);
    const conversationId = makeConversationId(me, peer);

    const limit = Math.min(Number(req.query.limit || 50), 200);
    const before = req.query.before ? Number(req.query.before) : null;
    const after = req.query.after !== undefined ? Number(req.query.after) : null;

    const baseFilter: any = {
      conversationId,
    };

    if (before && Number.isFinite(before)) {
      baseFilter.createdAtClient = { $lt: before };
    } else if (after !== null && Number.isFinite(after)) {
      baseFilter.createdAtClient = { $gt: after };
    }

    const docs = await MessageModel.find(baseFilter)
      .select("_id conversationId fromUserId toUserId protoVersion v3 initPacket replyTo clientMessageId createdAtClient status deliveredAt readAt")
      .sort({ createdAtClient: after !== null && !before ? 1 : -1 })
      .limit(limit);

    // Вернём в порядке "старые -> новые"
    const items = docs
      .map((d) => ({
        serverMessageId: String(d._id),
        conversationId: (d as any).conversationId,
        fromUserId: String(d.fromUserId),
        toUserId: String(d.toUserId),
        protoVersion: (d.protoVersion ?? 3) as 3,
        v3: d.v3 ?? null,
        initPacket: (d as any).initPacket ?? null,
        replyTo: (d as any).replyTo ?? null,
        clientMessageId: d.clientMessageId,
        createdAt: d.createdAtClient,
        status: (d as any).status ?? 'sent',
        deliveredAt: (d as any).deliveredAt ?? null,
        readAt: (d as any).readAt ?? null,
      }))
      .reverse();

    return res.json({ items });
  },
);

/**
 * GET /messages/undelivered  (T3.1)
 * Ciphertext the server still holds for the caller: messages addressed to
 * me whose recipient device has not acked delivery yet. Oldest first.
 * Query:
 *   - peerUserId (optional) : restrict to one conversation
 *   - after      (optional) : createdAtClient cursor (T3.2 switches it to seq)
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

    const filter: any = { toUserId: me, v3: { $ne: null } };
    if (peer) filter.conversationId = makeConversationId(me, peer);
    if (after !== null && Number.isFinite(after)) filter.createdAtClient = { $gt: after };

    const docs = await MessageModel.find(filter)
      .select("_id conversationId fromUserId toUserId protoVersion v3 initPacket replyTo clientMessageId createdAtClient status deliveredAt readAt")
      .sort({ createdAtClient: 1, _id: 1 })
      .limit(limit);

    const items = docs.map((d) => ({
      serverMessageId: String(d._id),
      conversationId: (d as any).conversationId,
      fromUserId: String(d.fromUserId),
      toUserId: String(d.toUserId),
      protoVersion: (d.protoVersion ?? 3) as 3,
      v3: d.v3 ?? null,
      initPacket: (d as any).initPacket ?? null,
      replyTo: (d as any).replyTo ?? null,
      clientMessageId: d.clientMessageId,
      createdAt: d.createdAtClient,
      status: (d as any).status ?? 'sent',
      deliveredAt: (d as any).deliveredAt ?? null,
      readAt: (d as any).readAt ?? null,
    }));

    let receipts: Array<{ serverMessageId: string; clientMessageId: string; createdAt: number; status: string; deliveredAt: number | null; readAt: number | null }> = [];
    if (peer && receiptsSince !== null && Number.isFinite(receiptsSince)) {
      const stubs = await MessageModel.find({
        conversationId: makeConversationId(me, peer),
        fromUserId: me,
        status: { $in: ['delivered', 'read'] },
        updatedAt: { $gt: new Date(receiptsSince) },
      })
        .select("_id clientMessageId createdAtClient status deliveredAt readAt")
        .sort({ createdAtClient: 1 })
        .limit(500);
      receipts = stubs.map((d) => ({
        serverMessageId: String(d._id),
        clientMessageId: d.clientMessageId,
        createdAt: d.createdAtClient,
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

    console.log('[messages] mark-read', {
      conversationId,
      forUser: me,
      updatedCount: result.modifiedCount,
    });

    return res.json({ ok: true, updatedCount: result.modifiedCount });
  }
);
