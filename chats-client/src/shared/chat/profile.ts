import { useEffect } from 'react';
import type { Content, ProfileAvatar, ProfileContent } from '@velo/protocol';
import { useProfilesStore } from '../../store/profiles.store';
import { sendContent } from '../socket/messaging';
import {
  listSharedWith,
  loadAllPeerProfiles,
  loadOwnProfile,
  loadPeerProfile,
  loadSharedAt,
  saveOwnProfile,
  savePeerProfile,
  saveSharedAt,
  type StoredProfile,
} from '../storage/profileStore';

/**
 * Profile over the session (T7.7). Our name and avatar reach each contact
 * as `{kind:'profile'}` content inside the pairwise ratchet: never through
 * the server, which stores no profile. A contact keeps the newest version
 * it received; we remember what we last sent to whom and re-send on change.
 *
 * Avatars are an emoji on a colour (chosen in the app) or a small JPEG
 * (accepted and shown; producing one needs a picker the app does not ship).
 */
export const AVATAR_EMOJIS = ['\u{1F98A}', '\u{1F43B}', '\u{1F431}', '\u{1F436}', '\u{1F42D}', '\u{1F430}', '\u{1F98B}', '\u{1F41D}', '\u{1F33B}', '\u{1F335}', '\u{1F344}', '\u{1F30A}', '\u{1F525}', '⭐', '\u{1F308}', '\u{1F680}', '\u{1F3B8}', '\u{1F3AF}', '\u{1F9E9}', '\u{1F4DA}', '☕', '\u{1F36A}', '\u{1F3D4}', '\u{1F30C}'];
export const AVATAR_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export function profileContentOf(p: StoredProfile): ProfileContent {
  return { v: 1, kind: 'profile', name: p.name, avatar: p.avatar, updatedAt: p.updatedAt };
}

/** Sign-in: mirror the sealed store into memory. */
export async function hydrateProfiles(myUserId: string): Promise<void> {
  const [own, byUser] = await Promise.all([loadOwnProfile(myUserId), loadAllPeerProfiles(myUserId)]);
  useProfilesStore.getState().hydrate(own, byUser);
}

export function useProfilesSync(myUserId: string | null | undefined): void {
  useEffect(() => {
    if (!myUserId) {
      useProfilesStore.getState().reset();
      return;
    }
    hydrateProfiles(String(myUserId)).catch((e) => console.warn('[profile] hydrate failed:', e));
  }, [myUserId]);
}

/** Inbound: a contact's profile; the newest `updatedAt` wins, an older or equal one is ignored. */
export async function applyInboundProfile(params: { myUserId: string; actorUserId: string; content: Content }): Promise<boolean> {
  const { myUserId, actorUserId, content } = params;
  if (content.kind !== 'profile') return false;
  if (actorUserId === myUserId) return false;
  const current = await loadPeerProfile(myUserId, actorUserId);
  if (current && current.updatedAt >= content.updatedAt) return false;
  const next: StoredProfile = { name: content.name, avatar: content.avatar, updatedAt: content.updatedAt };
  await savePeerProfile(myUserId, actorUserId, next);
  useProfilesStore.getState().setPeer(actorUserId, next);
  return true;
}

/** Send our profile to one contact unless that contact already has this version. */
export async function shareProfileWith(myUserId: string, peerUserId: string): Promise<boolean> {
  if (peerUserId === myUserId) return false;
  const own = await loadOwnProfile(myUserId);
  if (!own) return false;
  const sentAt = await loadSharedAt(myUserId, peerUserId);
  if (sentAt !== null && sentAt >= own.updatedAt) return false;
  await sendContent(peerUserId, profileContentOf(own));
  await saveSharedAt(myUserId, peerUserId, own.updatedAt);
  return true;
}

/** Our profile changed: everyone who had the old version gets the new one (best effort per contact). */
export async function reshareProfile(myUserId: string): Promise<{ sentTo: string[]; failed: string[] }> {
  const sentTo: string[] = [];
  const failed: string[] = [];
  for (const peer of await listSharedWith(myUserId)) {
    try {
      if (await shareProfileWith(myUserId, peer)) sentTo.push(peer);
    } catch (e) {
      console.warn('[profile] reshare failed:', { peer, e });
      failed.push(peer);
    }
  }
  return { sentTo, failed };
}

export async function updateOwnProfile(myUserId: string, patch: { name?: string; avatar?: ProfileAvatar | null }): Promise<StoredProfile> {
  const current = (await loadOwnProfile(myUserId)) ?? { name: '', avatar: null, updatedAt: 0 };
  const next: StoredProfile = {
    name: (patch.name ?? current.name).trim(),
    avatar: patch.avatar === undefined ? current.avatar : patch.avatar,
    updatedAt: Math.max(Date.now(), current.updatedAt + 1),
  };
  if (!next.name) throw new Error('A display name is required');
  await saveOwnProfile(myUserId, next);
  useProfilesStore.getState().setOwn(next);
  reshareProfile(myUserId).catch((e) => console.warn('[profile] reshare failed:', e));
  return next;
}
