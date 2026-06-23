import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type NotificationPreferences = {
  pushEnabled: boolean;
  inAppAlertsEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  showMessagePreview: boolean;
};

type NotificationPreferencesState = {
  preferencesByUserId: Record<string, NotificationPreferences>;
  setUserNotificationPreferences: (
    userId: string,
    patch: Partial<NotificationPreferences>,
  ) => void;
  resetUserNotificationPreferences: (userId: string) => void;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  pushEnabled: true,
  inAppAlertsEnabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  showMessagePreview: true,
};

export function getNotificationPreferencesForUser(
  preferencesByUserId: Record<string, NotificationPreferences>,
  userId: string | null,
): NotificationPreferences {
  if (!userId) return defaultNotificationPreferences;
  return preferencesByUserId[userId] ?? defaultNotificationPreferences;
}

export const useNotificationPreferencesStore = create<NotificationPreferencesState>()(
  persist(
    (set) => ({
      preferencesByUserId: {},
      setUserNotificationPreferences: (userId, patch) =>
        set((state) => ({
          preferencesByUserId: {
            ...state.preferencesByUserId,
            [userId]: {
              ...(state.preferencesByUserId[userId] ?? defaultNotificationPreferences),
              ...patch,
            },
          },
        })),
      resetUserNotificationPreferences: (userId) =>
        set((state) => {
          const next = { ...state.preferencesByUserId };
          delete next[userId];
          return { preferencesByUserId: next };
        }),
    }),
    {
      name: 'notification-preferences',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
