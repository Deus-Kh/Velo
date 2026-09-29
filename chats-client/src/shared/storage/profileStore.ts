import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProfileAvatar } from '@velo/protocol';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { openJson, sealJson } from './sealed';

/**
 * Profiles at rest (T7.7): ours and every contact's, sealed like the rest.
 * The server stores none of it; a profile reaches a contact over the
 * pairwise session (`{kind:'profile'}` content) and is kept here.
 *   profile:v1:<me>:own            our name + avatar + updatedAt
 *   profile:v1:<me>:peer:<userId>  a contact's, as last received
 *   profile:v1:<me>:sent:<userId>  the updatedAt we last shared with that contact (plain: a timestamp)
 */
export type StoredProfile = { name: string; avatar: ProfileAvatar | null; updatedAt: number };

const PREFIX = 'profile:v1';
const ownKey = (me: string) => `${PREFIX}:${me}:own`;
const peerKey = (me: string, userId: string) => `${PREFIX}:${me}:peer:${userId}`;
const sentKey = (me: string, userId: string) => `${PREFIX}:${me}:sent:${userId}`;

function isProfile(v: unknown): v is StoredProfile {
  return typeof v === 'object' && v !== null && typeof (v as StoredProfile).name === 'string' && typeof (v as StoredProfile).updatedAt === 'number';
}

async function readSealed(me: string, key: string): Promise<StoredProfile | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  const mk = await getOrCreateSessionMasterKey(me);
  const v = openJson<StoredProfile>(mk, raw);
  return isProfile(v) ? v : null;
}

async function writeSealed(me: string, key: string, value: StoredProfile): Promise<void> {
  const mk = await getOrCreateSessionMasterKey(me);
  await AsyncStorage.setItem(key, sealJson(mk, value));
}

export const loadOwnProfile = (me: string) => readSealed(me, ownKey(me));
export const saveOwnProfile = (me: string, p: StoredProfile) => writeSealed(me, ownKey(me), p);
export const loadPeerProfile = (me: string, userId: string) => readSealed(me, peerKey(me, userId));
export const savePeerProfile = (me: string, userId: string, p: StoredProfile) => writeSealed(me, peerKey(me, userId), p);

/** Every contact's profile on this device (sign-in hydration). */
export async function loadAllPeerProfiles(me: string): Promise<Record<string, StoredProfile>> {
  const prefix = `${PREFIX}:${me}:peer:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  if (keys.length === 0) return {};
  const mk = await getOrCreateSessionMasterKey(me);
  const rows = await AsyncStorage.multiGet(keys);
  const out: Record<string, StoredProfile> = {};
  for (const [k, raw] of rows) {
    const v = openJson<StoredProfile>(mk, raw);
    if (isProfile(v)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

export async function loadSharedAt(me: string, userId: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(sentKey(me, userId));
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function saveSharedAt(me: string, userId: string, updatedAt: number): Promise<void> {
  await AsyncStorage.setItem(sentKey(me, userId), String(updatedAt));
}

/** Contacts we have shared our profile with (a change is re-sent to them). */
export async function listSharedWith(me: string): Promise<string[]> {
  const prefix = `${PREFIX}:${me}:sent:`;
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

export function profilePrefixForUser(me: string): string {
  return `${PREFIX}:${me}:`;
}
