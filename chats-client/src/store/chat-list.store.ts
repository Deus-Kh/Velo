import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ChatListState {
  pinnedConversationIds: string[];
  archivedConversationIds: string[];
  togglePinnedConversation: (conversationId: string) => void;
  toggleArchivedConversation: (conversationId: string) => void;
}

export const useChatListStore = create<ChatListState>()(
  persist(
    (set) => ({
      pinnedConversationIds: [],
      archivedConversationIds: [],
      togglePinnedConversation: (conversationId) =>
        set((state) => ({
          pinnedConversationIds: state.pinnedConversationIds.includes(conversationId)
            ? state.pinnedConversationIds.filter((id) => id !== conversationId)
            : [conversationId, ...state.pinnedConversationIds],
        })),
      toggleArchivedConversation: (conversationId) =>
        set((state) => ({
          archivedConversationIds: state.archivedConversationIds.includes(conversationId)
            ? state.archivedConversationIds.filter((id) => id !== conversationId)
            : [conversationId, ...state.archivedConversationIds],
          pinnedConversationIds: state.archivedConversationIds.includes(conversationId)
            ? state.pinnedConversationIds
            : state.pinnedConversationIds.filter((id) => id !== conversationId),
        })),
    }),
    {
      name: 'chat-list-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
