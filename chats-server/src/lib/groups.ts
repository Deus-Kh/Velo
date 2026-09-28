import { Types } from 'mongoose';
import { GroupModel, GROUP_HISTORY_MAX, GROUP_MAX_MEMBERS, type GroupRole } from '../models/Group';
import { UserModel } from '../models/User';
import { emitToUser } from './realtime';

/**
 * Group membership (T6.3). Every mutation goes through here so the epoch,
 * the system feed and the realtime `group:changed` notice stay consistent.
 * Authorization is explicit per operation and returns typed codes.
 */
export type GroupView = {
  groupId: string;
  name: string;
  epoch: number;
  createdBy: string;
  members: Array<{ userId: string; username: string | null; role: GroupRole; addedAt: number }>;
  lastMessageAt: number;
  lastSeq: number;
  history: Array<{ at: number; type: string; byUserId: string; userIds: string[]; epoch: number }>;
};

export type GroupResult<T> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REQUEST' | 'TOO_MANY_MEMBERS' | 'NOT_MEMBER'; error: string };

type GroupDoc = InstanceType<typeof GroupModel>;

function memberOf(group: GroupDoc, userId: string) {
  return group.members.find((m) => String(m.userId) === String(userId)) ?? null;
}

export function isGroupMember(group: GroupDoc, userId: string): boolean {
  return memberOf(group, userId) !== null;
}

export function isGroupAdmin(group: GroupDoc, userId: string): boolean {
  return memberOf(group, userId)?.role === 'admin';
}

export function groupConversationId(groupId: string): string {
  return 'group:' + String(groupId);
}

export async function toGroupView(group: GroupDoc): Promise<GroupView> {
  const ids = group.members.map((m) => m.userId);
  const users = await UserModel.find({ _id: { $in: ids } }).select('username').lean();
  const names = new Map(users.map((u) => [String(u._id), (u as { username?: string }).username ?? null]));
  return {
    groupId: String(group._id),
    name: group.name,
    epoch: group.epoch,
    createdBy: String(group.createdBy),
    members: group.members.map((m) => ({ userId: String(m.userId), username: names.get(String(m.userId)) ?? null, role: m.role as GroupRole, addedAt: m.addedAt })),
    lastMessageAt: group.lastMessageAt ?? 0,
    lastSeq: group.lastSeq ?? 0,
    history: (group.history ?? []).map((e) => ({ at: e.at, type: e.type, byUserId: String(e.byUserId), userIds: (e.userIds ?? []).map(String), epoch: e.epoch })),
  };
}

function pushEvent(group: GroupDoc, type: 'created' | 'added' | 'removed' | 'left' | 'promoted' | 'renamed', byUserId: string, userIds: string[]): void {
  group.history.push({ at: Date.now(), type, byUserId: new Types.ObjectId(byUserId), userIds: userIds.map((id) => new Types.ObjectId(id)), epoch: group.epoch });
  while (group.history.length > GROUP_HISTORY_MAX) group.history.shift();
}

/** Tells every current member (and the ones just removed) that membership changed; they rotate their sender keys (T6.5). */
export function notifyGroupChanged(group: GroupDoc, change: { type: string; byUserId: string; userIds: string[] }, alsoNotify: string[] = []): void {
  const payload = { groupId: String(group._id), epoch: group.epoch, name: group.name, change };
  const targets = new Set<string>([...group.members.map((m) => String(m.userId)), ...alsoNotify]);
  for (const userId of targets) emitToUser(userId, 'group:changed', payload);
}

async function existingUserIds(ids: string[]): Promise<string[]> {
  const users = await UserModel.find({ _id: { $in: ids.filter((id) => Types.ObjectId.isValid(id)) } }).select('_id').lean();
  return users.map((u) => String(u._id));
}

export async function createGroup(params: { creatorId: string; name: string; memberIds: string[] }): Promise<GroupResult<GroupDoc>> {
  const wanted = Array.from(new Set(params.memberIds.map(String).filter((id) => id !== params.creatorId)));
  const found = await existingUserIds(wanted);
  if (found.length !== wanted.length) return { ok: false, code: 'BAD_REQUEST', error: 'Unknown member' };
  if (found.length + 1 > GROUP_MAX_MEMBERS) return { ok: false, code: 'TOO_MANY_MEMBERS', error: 'Too many members' };
  const now = Date.now();
  const group = new GroupModel({
    name: params.name,
    createdBy: new Types.ObjectId(params.creatorId),
    members: [
      { userId: new Types.ObjectId(params.creatorId), role: 'admin', addedAt: now },
      ...found.map((id) => ({ userId: new Types.ObjectId(id), role: 'member' as const, addedAt: now })),
    ],
    epoch: 1,
    lastMessageAt: now,
  });
  pushEvent(group, 'created', params.creatorId, found);
  await group.save();
  notifyGroupChanged(group, { type: 'created', byUserId: params.creatorId, userIds: found });
  return { ok: true, value: group };
}

export async function loadGroupForMember(groupId: string, userId: string): Promise<GroupResult<GroupDoc>> {
  if (!Types.ObjectId.isValid(groupId)) return { ok: false, code: 'NOT_FOUND', error: 'Group not found' };
  const group = await GroupModel.findById(groupId);
  if (!group) return { ok: false, code: 'NOT_FOUND', error: 'Group not found' };
  if (!isGroupMember(group, userId)) return { ok: false, code: 'NOT_MEMBER', error: 'Not a member' };
  return { ok: true, value: group };
}

export async function addMembers(params: { groupId: string; byUserId: string; userIds: string[] }): Promise<GroupResult<GroupDoc>> {
  const loaded = await loadGroupForMember(params.groupId, params.byUserId);
  if (!loaded.ok) return loaded;
  const group = loaded.value;
  if (!isGroupAdmin(group, params.byUserId)) return { ok: false, code: 'FORBIDDEN', error: 'Admins only' };
  const wanted = Array.from(new Set(params.userIds.map(String))).filter((id) => !isGroupMember(group, id));
  if (wanted.length === 0) return { ok: true, value: group };
  const found = await existingUserIds(wanted);
  if (found.length !== wanted.length) return { ok: false, code: 'BAD_REQUEST', error: 'Unknown member' };
  if (group.members.length + found.length > GROUP_MAX_MEMBERS) return { ok: false, code: 'TOO_MANY_MEMBERS', error: 'Too many members' };
  const now = Date.now();
  for (const id of found) group.members.push({ userId: new Types.ObjectId(id), role: 'member', addedAt: now });
  group.epoch += 1;
  pushEvent(group, 'added', params.byUserId, found);
  await group.save();
  notifyGroupChanged(group, { type: 'added', byUserId: params.byUserId, userIds: found });
  return { ok: true, value: group };
}

/** Removal by an admin, or a member leaving (userId === byUserId). The last admin leaving promotes the longest-standing member. */
export async function removeMember(params: { groupId: string; byUserId: string; userId: string }): Promise<GroupResult<GroupDoc | null>> {
  const loaded = await loadGroupForMember(params.groupId, params.byUserId);
  if (!loaded.ok) return loaded;
  const group = loaded.value;
  const leaving = params.userId === params.byUserId;
  if (!leaving && !isGroupAdmin(group, params.byUserId)) return { ok: false, code: 'FORBIDDEN', error: 'Admins only' };
  if (!isGroupMember(group, params.userId)) return { ok: false, code: 'NOT_FOUND', error: 'Not a member' };

  group.members = group.members.filter((m) => String(m.userId) !== String(params.userId)) as typeof group.members;
  group.epoch += 1;
  pushEvent(group, leaving ? 'left' : 'removed', params.byUserId, [params.userId]);

  if (group.members.length === 0) {
    await GroupModel.deleteOne({ _id: group._id });
    emitToUser(params.userId, 'group:changed', { groupId: String(group._id), epoch: group.epoch, name: group.name, change: { type: leaving ? 'left' : 'removed', byUserId: params.byUserId, userIds: [params.userId] } });
    return { ok: true, value: null };
  }
  if (!group.members.some((m) => m.role === 'admin')) {
    const oldest = [...group.members].sort((a, b) => a.addedAt - b.addedAt)[0]!;
    oldest.role = 'admin';
    pushEvent(group, 'promoted', params.byUserId, [String(oldest.userId)]);
  }
  await group.save();
  notifyGroupChanged(group, { type: leaving ? 'left' : 'removed', byUserId: params.byUserId, userIds: [params.userId] }, [params.userId]);
  return { ok: true, value: group };
}

export async function renameGroup(params: { groupId: string; byUserId: string; name: string }): Promise<GroupResult<GroupDoc>> {
  const loaded = await loadGroupForMember(params.groupId, params.byUserId);
  if (!loaded.ok) return loaded;
  const group = loaded.value;
  if (!isGroupAdmin(group, params.byUserId)) return { ok: false, code: 'FORBIDDEN', error: 'Admins only' };
  group.name = params.name;
  pushEvent(group, 'renamed', params.byUserId, []);
  await group.save();
  notifyGroupChanged(group, { type: 'renamed', byUserId: params.byUserId, userIds: [] });
  return { ok: true, value: group };
}

export function httpStatusFor(code: Exclude<GroupResult<unknown>, { ok: true }>['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
    case 'NOT_MEMBER':
      return 403;
    case 'TOO_MANY_MEMBERS':
    case 'BAD_REQUEST':
    default:
      return 400;
  }
}
