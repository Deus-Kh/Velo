import { Types } from 'mongoose';
import { BlockModel } from '../models/Block';
import { UserModel } from '../models/User';

/**
 * T7.5: block list queries. A block is one-directional in storage and
 * symmetric in effect: nothing flows between the pair while either has
 * blocked the other.
 */
export async function isBlockedEither(a: string, b: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(a) || !Types.ObjectId.isValid(b)) return false;
  const found = await BlockModel.exists({
    $or: [
      { blockerId: a, blockedId: b },
      { blockerId: b, blockedId: a },
    ],
  });
  return Boolean(found);
}

/** Users the caller has blocked. */
export async function blockedByMe(me: string): Promise<Set<string>> {
  const docs = await BlockModel.find({ blockerId: me }).select('blockedId').lean();
  return new Set(docs.map((d) => String(d.blockedId)));
}

/** Everyone in either direction with the caller (for fan-out filters). */
export async function blockedEitherWay(me: string): Promise<Set<string>> {
  const docs = await BlockModel.find({ $or: [{ blockerId: me }, { blockedId: me }] })
    .select('blockerId blockedId')
    .lean();
  const out = new Set<string>();
  for (const d of docs) out.add(String(d.blockerId) === me ? String(d.blockedId) : String(d.blockerId));
  return out;
}

export async function blockUser(me: string, userId: string): Promise<'ok' | 'SELF' | 'NOT_FOUND'> {
  if (me === userId) return 'SELF';
  if (!(await UserModel.exists({ _id: userId }))) return 'NOT_FOUND';
  await BlockModel.updateOne({ blockerId: me, blockedId: userId }, { $setOnInsert: { blockerId: me, blockedId: userId } }, { upsert: true });
  return 'ok';
}

export async function unblockUser(me: string, userId: string): Promise<boolean> {
  const r = await BlockModel.deleteOne({ blockerId: me, blockedId: userId });
  return r.deletedCount > 0;
}

export async function listBlocks(me: string): Promise<Array<{ userId: string; username: string | null; blockedAt: number }>> {
  const docs = await BlockModel.find({ blockerId: me }).populate('blockedId', 'username').sort({ createdAt: -1 }).lean();
  return docs.map((d) => {
    const u = d.blockedId as unknown as { _id: unknown; username?: string } | null;
    return { userId: String(u?._id ?? d.blockedId), username: u?.username ?? null, blockedAt: (d as unknown as { createdAt?: Date }).createdAt?.getTime() ?? 0 };
  });
}
