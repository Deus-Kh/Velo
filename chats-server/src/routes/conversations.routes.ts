import { Router } from 'express';
import { ConversationModel } from '../models/Conversation';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { makeConversationId } from '../utils/conversation';

export const conversationsRouter = Router();

conversationsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const me = String(req.userId);

  const docs = await ConversationModel.find({ members: me })
    .populate('members', '_id username email identitySignUpdatedAt identityDhUpdatedAt')
    .sort({ lastMessageAt: -1 })
    .limit(100);

  const items = docs
    .map((doc: any) => {
      const peer = Array.isArray(doc.members)
        ? doc.members.find((member: any) => String(member?._id) !== me)
        : null;

      if (!peer?._id) return null;
      
      let unreadCount = 0;
      if (doc.unreadCounts) {
        const counts = doc.unreadCounts;
        if (counts instanceof Map) {
          unreadCount = counts.get(me) ?? 0;
        } else if (typeof counts === 'object') {
          unreadCount = counts[me] ?? 0;
        }
      }

      return {
        conversationId: doc.conversationId,
        peerUserId: String(peer._id),
        peerUsername: peer.username,
        peerEmail: peer.email,
        peerHasPublicKey: !!(peer.identitySignUpdatedAt && peer.identityDhUpdatedAt),
        lastMessageAt: doc.lastMessageAt,
        lastProtoVersion: doc.lastProtoVersion,
         lastMessagePreview: doc.lastMessagePreview || '(Message)',
        unreadCount: typeof unreadCount === 'number' ? unreadCount : 0,
      };
    })
    .filter(Boolean);

  return res.json({ items });
});

conversationsRouter.post('/mark-read/:peerUserId', requireAuth, async (req: AuthedRequest, res) => {
  const me = String(req.userId);
  const peer = String(req.params.peerUserId);

  const conversationId = makeConversationId(me, peer);

  const updated = await ConversationModel.findOneAndUpdate(
    { conversationId },
    {
      $set: {
        [`unreadCounts.${me}`]: 0,
      },
    },
    { new: true }
  );

  console.log('[mark-read]', {
    me,
    conversationId,
    unreadCounts: updated?.unreadCounts,
  });

  return res.json({ ok: true, unreadCounts: updated?.unreadCounts });
});

