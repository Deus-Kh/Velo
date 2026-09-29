import { create } from 'zustand';
import type { StoredProfile } from '../shared/storage/profileStore';

/**
 * T7.7: in-memory mirror of the sealed profile store, so lists and headers
 * can render names and avatars synchronously. Hydrated at sign-in and kept
 * in step by chat/profile.ts; never persisted here (the sealed store is).
 */
type ProfilesState = {
  own: StoredProfile | null;
  byUser: Record<string, StoredProfile>;
  hydrate: (own: StoredProfile | null, byUser: Record<string, StoredProfile>) => void;
  setOwn: (p: StoredProfile | null) => void;
  setPeer: (userId: string, p: StoredProfile) => void;
  reset: () => void;
};

export const useProfilesStore = create<ProfilesState>((set) => ({
  own: null,
  byUser: {},
  hydrate: (own, byUser) => set({ own, byUser }),
  setOwn: (own) => set({ own }),
  setPeer: (userId, p) => set((s) => ({ byUser: { ...s.byUser, [userId]: p } })),
  reset: () => set({ own: null, byUser: {} }),
}));

/** The name to show for a user: their shared profile name, else the fallback (username, id). */
export function displayNameFor(byUser: Record<string, StoredProfile>, userId: string | null | undefined, fallback: string): string {
  if (!userId) return fallback;
  const name = byUser[userId]?.name?.trim();
  return name ? name : fallback;
}
