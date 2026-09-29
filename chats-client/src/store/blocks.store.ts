import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * T7.5: the users this account has blocked, mirrored from the server so
 * the inbound paths can drop synchronously and the lists can hide them.
 * Per account, so a second account on the device inherits nothing.
 */
type BlocksState = {
  blockedByUser: Record<string, string[]>;
  setBlocked: (myUserId: string, userIds: string[]) => void;
  addBlocked: (myUserId: string, userId: string) => void;
  removeBlocked: (myUserId: string, userId: string) => void;
};

/**
 * Shared empty list for users with no blocks entry. Zustand v5 selects through
 * useSyncExternalStore, which compares snapshots by reference: a selector that
 * returns a fresh `[]` on every call re-renders forever ("The result of
 * getSnapshot should be cached"), so the fallback must be one stable object.
 */
export const EMPTY_BLOCKED: readonly string[] = Object.freeze([]);

/** Stable selector: the caller's block list, or the shared empty list. */
export const selectBlockedIds =
  (myUserId: string | null | undefined) =>
  (s: { blockedByUser: Record<string, string[]> }): readonly string[] =>
    (myUserId ? s.blockedByUser[String(myUserId)] : undefined) ?? EMPTY_BLOCKED;

export const useBlocksStore = create<BlocksState>()(
  persist(
    (set) => ({
      blockedByUser: {},
      setBlocked: (myUserId, userIds) => set((s) => ({ blockedByUser: { ...s.blockedByUser, [myUserId]: Array.from(new Set(userIds)) } })),
      addBlocked: (myUserId, userId) =>
        set((s) => ({ blockedByUser: { ...s.blockedByUser, [myUserId]: Array.from(new Set([...(s.blockedByUser[myUserId] ?? []), userId])) } })),
      removeBlocked: (myUserId, userId) =>
        set((s) => ({ blockedByUser: { ...s.blockedByUser, [myUserId]: (s.blockedByUser[myUserId] ?? []).filter((id) => id !== userId) } })),
    }),
    { name: 'blocks-v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** Synchronous check for the inbound paths. */
export function isBlockedLocally(myUserId: string, userId: string): boolean {
  return (useBlocksStore.getState().blockedByUser[myUserId] ?? []).includes(userId);
}
