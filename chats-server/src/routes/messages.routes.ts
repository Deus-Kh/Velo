import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { MessageModel } from "../models/Message";
import { makeConversationId } from "../utils/conversation";

export const messagesRouter = Router();

/**
 * GET /messages/with/:userId
 * Returns encrypted history between current user and peer (ciphertext only).
 * Query:
 *   - limit (default 50, max 200)
 *   - before (optional) : timestamp (createdAtClient) for pagination
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

    const baseFilter: any = {
      conversationId,
    };

    if (before && Number.isFinite(before)) {
      baseFilter.createdAtClient = { $lt: before };
    }

    const docs = await MessageModel.find(baseFilter)
      .select("_id conversationId fromUserId toUserId protoVersion v2 initPacket replyTo clientMessageId createdAtClient status deliveredAt readAt")
      .sort({ createdAtClient: -1 })
      .limit(limit);

    // Вернём в порядке "старые -> новые"
    const items = docs
      .map((d) => ({
        serverMessageId: String(d._id),
        conversationId: (d as any).conversationId,
        fromUserId: String(d.fromUserId),
        toUserId: String(d.toUserId),
        protoVersion: (d.protoVersion ?? 2) as 2,
        v2: d.v2 ?? null,
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
