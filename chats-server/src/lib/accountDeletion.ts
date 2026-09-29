import { BlockModel } from '../models/Block';
import { ConversationModel } from '../models/Conversation';
import { GroupModel } from '../models/Group';
import { MessageModel } from '../models/Message';
import { OneTimePreKeyModel } from '../models/OneTimePreKey';
import { PreKeyBundleIssueModel } from '../models/PreKeyBundleIssue';
import { RefreshTokenModel } from '../models/RefreshToken';
import { ReportModel } from '../models/Report';
import { SignedPreKeyModel } from '../models/SignedPreKey';
import { UserModel } from '../models/User';
import { removeMember } from './groups';
import { log } from './logger';
import { disconnectUser, emitToUser } from './realtime';

/**
 * Account deletion (T7.6, GDPR Art. 17). Everything the server holds for
 * the user goes: the account (keys and push tokens with it), prekeys and
 * bundle issues, ciphertext and receipts in both directions, conversations,
 * refresh-token families, blocks in both directions. Group memberships end
 * as a leave (epoch bump, promotion, deletion of an emptied group), so the
 * remaining members rotate their sender keys (T6.5). Reports the user filed
 * are kept without the reporter. Peers are told `user:deleted` so their
 * chats can say so; the user's sockets are disconnected.
 *
 * Nothing the server never had can be deleted here: plaintext lives only on
 * the user's device, which the client wipes (T1.14 scope 'all').
 */
export type DeletionReport = {
  userId: string;
  peersNotified: number;
  groupsLeft: number;
  messages: number;
  conversations: number;
  signedPreKeys: number;
  oneTimePreKeys: number;
  bundleIssues: number;
  refreshTokens: number;
  blocks: number;
  reportsAnonymised: number;
};

export async function deleteAccount(userId: string): Promise<DeletionReport | null> {
  const user = await UserModel.findById(userId).select('_id');
  if (!user) return null;

  // Who must hear about it: conversation peers and group co-members, collected before anything goes.
  const peers = new Set<string>();
  const conversations = await ConversationModel.find({ members: userId }).select('members').lean();
  for (const c of conversations) for (const m of c.members as unknown[]) if (String(m) !== userId) peers.add(String(m));
  const groups = await GroupModel.find({ 'members.userId': userId }).select('_id members').lean();
  for (const g of groups) for (const m of g.members as Array<{ userId: unknown }>) if (String(m.userId) !== userId) peers.add(String(m.userId));

  // Leave every group (epoch bump, promotion, deletion of an emptied group; members told).
  let groupsLeft = 0;
  for (const g of groups) {
    const r = await removeMember({ groupId: String(g._id), byUserId: userId, userId });
    if (r.ok) groupsLeft += 1;
    else log.warn({ groupId: String(g._id), code: r.code }, '[account] leave on deletion failed');
  }

  const [messages, convs, spk, opk, issues, tokens, blocks, reports] = await Promise.all([
    MessageModel.deleteMany({ $or: [{ fromUserId: userId }, { toUserId: userId }] }),
    ConversationModel.deleteMany({ members: userId }),
    SignedPreKeyModel.deleteMany({ userId }),
    OneTimePreKeyModel.deleteMany({ userId }),
    PreKeyBundleIssueModel.deleteMany({ $or: [{ requesterId: userId }, { targetId: userId }] }),
    RefreshTokenModel.deleteMany({ userId }),
    BlockModel.deleteMany({ $or: [{ blockerId: userId }, { blockedId: userId }] }),
    ReportModel.updateMany({ reporterId: userId }, { $set: { reporterId: null } }),
  ]);
  await UserModel.deleteOne({ _id: userId });

  for (const peer of peers) emitToUser(peer, 'user:deleted', { userId });
  disconnectUser(userId);

  const report: DeletionReport = {
    userId,
    peersNotified: peers.size,
    groupsLeft,
    messages: messages.deletedCount,
    conversations: convs.deletedCount,
    signedPreKeys: spk.deletedCount,
    oneTimePreKeys: opk.deletedCount,
    bundleIssues: issues.deletedCount,
    refreshTokens: tokens.deletedCount,
    blocks: blocks.deletedCount,
    reportsAnonymised: reports.modifiedCount,
  };
  log.info({ groupsLeft, messages: report.messages, conversations: report.conversations }, '[account] deleted'); // counts only (T4.5)
  return report;
}
