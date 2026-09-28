import {
  createSenderKeyState,
  senderKeyDistributionMessage,
  senderKeyStateFromDistribution,
  isControlContent,
  type Content,
  type SenderKeyState,
} from '@velo/protocol';
import type { GroupView } from '../api/groups.api';
import {
  deletePeerSenderKey,
  loadDistribution,
  loadOwnSenderKey,
  loadPeerSenderKey,
  saveDistribution,
  saveOwnSenderKey,
  savePeerSenderKey,
} from '../storage/senderKeyStore';
import { sendContent } from '../socket/messaging';

/**
 * Sender-key lifecycle on the device (T6.4, T6.5).
 *
 *  - Our key for a group exists per membership epoch: a new epoch (someone
 *    joined or left) means a fresh keyId, so a removed member cannot read
 *    what comes after and a new member cannot read what came before.
 *  - Distribution goes to each member over the pairwise session (T6.2);
 *    what was delivered is remembered per epoch so a re-open of the chat
 *    only sends to members who still lack it.
 *  - A member's state arrives as control content and is stored; a message
 *    from a member whose key we lack triggers a request to that member.
 */

/** Pure: is the key on disk usable for this epoch? */
export function ownKeyIsCurrent(record: { epoch: number } | null, epoch: number): boolean {
  return record !== null && record.epoch === epoch;
}

/** Pure: who still needs our key for this epoch/keyId. */
export function membersLackingKey(group: GroupView, myUserId: string, dist: { epoch: number; keyId: number; userIds: string[] } | null, keyId: number): string[] {
  const done = dist && dist.epoch === group.epoch && dist.keyId === keyId ? new Set(dist.userIds) : new Set<string>();
  return group.members.map((m) => m.userId).filter((id) => id !== myUserId && !done.has(id));
}

/** Our sender key for the group's current epoch, rotated when the epoch moved (T6.5). */
export async function ensureOwnSenderKey(params: { myUserId: string; groupId: string; epoch: number }): Promise<{ state: SenderKeyState; rotated: boolean }> {
  const { myUserId, groupId, epoch } = params;
  const existing = await loadOwnSenderKey(myUserId, groupId);
  if (existing && ownKeyIsCurrent(existing, epoch)) return { state: existing.state, rotated: false };
  const state = createSenderKeyState();
  await saveOwnSenderKey(myUserId, groupId, { epoch, state });
  await saveDistribution(myUserId, groupId, { epoch, keyId: state.keyId, userIds: [] });
  return { state, rotated: true };
}

/** Sends our current key to every member who does not have it yet. Best effort per member; failures retry next time. */
export async function distributeSenderKey(params: { myUserId: string; group: GroupView }): Promise<{ sentTo: string[]; failed: string[] }> {
  const { myUserId, group } = params;
  const { state } = await ensureOwnSenderKey({ myUserId, groupId: group.groupId, epoch: group.epoch });
  const dist = await loadDistribution(myUserId, group.groupId);
  const lacking = membersLackingKey(group, myUserId, dist, state.keyId);
  const sentTo: string[] = [];
  const failed: string[] = [];
  const skdm = senderKeyDistributionMessage(state);
  for (const userId of lacking) {
    try {
      await sendContent(userId, { v: 1, kind: 'skdm', groupId: group.groupId, skdm });
      sentTo.push(userId);
    } catch (e) {
      console.warn('[groups] sender key distribution failed:', { userId, e });
      failed.push(userId);
    }
  }
  if (sentTo.length) {
    const base = dist && dist.epoch === group.epoch && dist.keyId === state.keyId ? dist.userIds : [];
    await saveDistribution(myUserId, group.groupId, { epoch: group.epoch, keyId: state.keyId, userIds: Array.from(new Set([...base, ...sentTo])) });
  }
  return { sentTo, failed };
}

/** Ask a member for its current key (we received a message we cannot open). Rate-limited per (group, member). */
const requestedAt = new Map<string, number>();
export const SENDER_KEY_REQUEST_INTERVAL_MS = 30_000;

export async function requestSenderKey(params: { myUserId: string; groupId: string; fromUserId: string; now?: number }): Promise<boolean> {
  const key = params.groupId + ':' + params.fromUserId;
  const now = params.now ?? Date.now();
  const last = requestedAt.get(key);
  if (last !== undefined && now - last < SENDER_KEY_REQUEST_INTERVAL_MS) return false;
  requestedAt.set(key, now);
  try {
    await sendContent(params.fromUserId, { v: 1, kind: 'skdm-request', groupId: params.groupId });
    return true;
  } catch (e) {
    console.warn('[groups] sender key request failed:', e);
    return false;
  }
}

/** Test helper. */
export function resetSenderKeyRequests(): void {
  requestedAt.clear();
}

/**
 * Control content that arrived over a pairwise session (T6.2 `onControl`):
 * a member's key is stored; a request for ours is answered by re-sending
 * our current key to that member. Returns what happened for the caller's
 * bookkeeping (a stored key means undelivered group messages may now open).
 */
export async function handleControlContent(params: {
  myUserId: string;
  fromUserId: string;
  content: Content;
  loadGroup: (groupId: string) => Promise<GroupView | null>;
}): Promise<{ kind: 'stored-key'; groupId: string; fromUserId: string } | { kind: 'answered-request'; groupId: string } | { kind: 'ignored'; reason: string }> {
  const { myUserId, fromUserId, content } = params;
  if (!isControlContent(content)) return { kind: 'ignored', reason: 'not control' };
  const group = await params.loadGroup(content.groupId);
  if (!group || !group.members.some((m) => m.userId === fromUserId)) {
    return { kind: 'ignored', reason: 'sender is not a member of that group' };
  }
  if (content.kind === 'skdm') {
    await savePeerSenderKey(myUserId, content.groupId, fromUserId, senderKeyStateFromDistribution(content.skdm));
    return { kind: 'stored-key', groupId: content.groupId, fromUserId };
  }
  // skdm-request: send our key to exactly this member (mark it as lacking first).
  const { state } = await ensureOwnSenderKey({ myUserId, groupId: group.groupId, epoch: group.epoch });
  const dist = await loadDistribution(myUserId, group.groupId);
  const userIds = (dist && dist.epoch === group.epoch && dist.keyId === state.keyId ? dist.userIds : []).filter((id) => id !== fromUserId);
  await saveDistribution(myUserId, group.groupId, { epoch: group.epoch, keyId: state.keyId, userIds });
  await sendContent(fromUserId, { v: 1, kind: 'skdm', groupId: group.groupId, skdm: senderKeyDistributionMessage(state) });
  await saveDistribution(myUserId, group.groupId, { epoch: group.epoch, keyId: state.keyId, userIds: [...userIds, fromUserId] });
  return { kind: 'answered-request', groupId: group.groupId };
}

/** After a membership change: drop the states of members who are gone (their keys are dead). */
export async function forgetDepartedMembers(params: { myUserId: string; group: GroupView; previousMemberIds: string[] }): Promise<string[]> {
  const current = new Set(params.group.members.map((m) => m.userId));
  const gone = params.previousMemberIds.filter((id) => !current.has(id) && id !== params.myUserId);
  for (const id of gone) await deletePeerSenderKey(params.myUserId, params.group.groupId, id);
  return gone;
}

export { loadPeerSenderKey };
