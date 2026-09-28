import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SenderKeyState } from '@velo/protocol';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { openJson, sealJson } from './sealed';

/**
 * Sender-key state at rest (T6.4), sealed under the per-user session master
 * key like every other secret. Per group:
 *   sk:v1:<me>:<group>:own          our own state (with the signing secret) and the epoch it was made for
 *   sk:v1:<me>:<group>:peer:<user>  a member's state (no secret)
 *   skdist:v1:<me>:<group>          which members received our current key, and for which epoch
 */
export type OwnSenderKeyRecord = { epoch: number; state: SenderKeyState };
export type DistributionRecord = { epoch: number; keyId: number; userIds: string[] };

const ownKey = (me: string, groupId: string) => `sk:v1:${me}:${groupId}:own`;
const peerKey = (me: string, groupId: string, userId: string) => `sk:v1:${me}:${groupId}:peer:${userId}`;
const distKey = (me: string, groupId: string) => `skdist:v1:${me}:${groupId}`;

async function readSealed<T>(myUserId: string, key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  const mk = await getOrCreateSessionMasterKey(myUserId);
  return openJson<T>(mk, raw);
}

async function writeSealed(myUserId: string, key: string, value: unknown): Promise<void> {
  const mk = await getOrCreateSessionMasterKey(myUserId);
  await AsyncStorage.setItem(key, sealJson(mk, value));
}

export async function loadOwnSenderKey(myUserId: string, groupId: string): Promise<OwnSenderKeyRecord | null> {
  return readSealed<OwnSenderKeyRecord>(myUserId, ownKey(myUserId, groupId));
}

export async function saveOwnSenderKey(myUserId: string, groupId: string, record: OwnSenderKeyRecord): Promise<void> {
  await writeSealed(myUserId, ownKey(myUserId, groupId), record);
}

export async function loadPeerSenderKey(myUserId: string, groupId: string, userId: string): Promise<SenderKeyState | null> {
  return readSealed<SenderKeyState>(myUserId, peerKey(myUserId, groupId, userId));
}

export async function savePeerSenderKey(myUserId: string, groupId: string, userId: string, state: SenderKeyState): Promise<void> {
  await writeSealed(myUserId, peerKey(myUserId, groupId, userId), state);
}

export async function deletePeerSenderKey(myUserId: string, groupId: string, userId: string): Promise<void> {
  await AsyncStorage.removeItem(peerKey(myUserId, groupId, userId));
}

export async function loadDistribution(myUserId: string, groupId: string): Promise<DistributionRecord | null> {
  const raw = await AsyncStorage.getItem(distKey(myUserId, groupId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DistributionRecord;
    return Array.isArray(parsed.userIds) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveDistribution(myUserId: string, groupId: string, record: DistributionRecord): Promise<void> {
  await AsyncStorage.setItem(distKey(myUserId, groupId), JSON.stringify(record));
}

/** Everything about one group on this device (leave / removed / group deleted). */
export async function deleteGroupKeys(myUserId: string, groupId: string): Promise<void> {
  const prefix = `sk:v1:${myUserId}:${groupId}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix) || k === distKey(myUserId, groupId));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
