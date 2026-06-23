import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type RecentContactsByUser = Record<string, string[]>;
type SavedContactsByUser = Record<string, SavedContact[]>;

export interface SavedContact {
  peerUserId: string;
  peerUsername?: string;
  peerEmail?: string;
  addedAt: number;
}

interface ContactsState {
  recentContactIdsByUser: RecentContactsByUser;
  savedContactsByUser: SavedContactsByUser;
  recordRecentContact: (userId: string, peerUserId: string) => void;
  saveContact: (
    userId: string,
    contact: { peerUserId: string; peerUsername?: string; peerEmail?: string },
  ) => void;
  removeSavedContact: (userId: string, peerUserId: string) => void;
}

const MAX_RECENT_CONTACTS = 12;

export const useContactsStore = create<ContactsState>()(
  persist(
    (set) => ({
      recentContactIdsByUser: {},
      savedContactsByUser: {},
      recordRecentContact: (userId, peerUserId) => {
        set((state) => {
          const current = state.recentContactIdsByUser[userId] ?? [];
          const next = [peerUserId, ...current.filter((id) => id !== peerUserId)].slice(
            0,
            MAX_RECENT_CONTACTS,
          );

          return {
            recentContactIdsByUser: {
              ...state.recentContactIdsByUser,
              [userId]: next,
            },
          };
        });
      },
      saveContact: (userId, contact) => {
        set((state) => {
          const current = state.savedContactsByUser[userId] ?? [];
          const withoutExisting = current.filter(
            (item) => item.peerUserId !== contact.peerUserId,
          );

          return {
            savedContactsByUser: {
              ...state.savedContactsByUser,
              [userId]: [
                {
                  peerUserId: contact.peerUserId,
                  peerUsername: contact.peerUsername,
                  peerEmail: contact.peerEmail,
                  addedAt: Date.now(),
                },
                ...withoutExisting,
              ],
            },
          };
        });
      },
      removeSavedContact: (userId, peerUserId) => {
        set((state) => ({
          savedContactsByUser: {
            ...state.savedContactsByUser,
            [userId]: (state.savedContactsByUser[userId] ?? []).filter(
              (item) => item.peerUserId !== peerUserId,
            ),
          },
        }));
      },
    }),
    {
      name: 'contacts-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        recentContactIdsByUser: state.recentContactIdsByUser,
        savedContactsByUser: state.savedContactsByUser,
      }),
    },
  ),
);
