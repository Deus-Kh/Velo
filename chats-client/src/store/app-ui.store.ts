import { create } from 'zustand';

type AppUiState = {
  activeChatPeerUserId: string | null;
  setActiveChatPeerUserId: (peerUserId: string | null) => void;
  /** T3.3: set by a notification tap; the signed-in shell opens that chat and clears it. */
  pendingOpenChatPeerUserId: string | null;
  setPendingOpenChatPeerUserId: (peerUserId: string | null) => void;
};

export const useAppUiStore = create<AppUiState>((set) => ({
  activeChatPeerUserId: null,
  setActiveChatPeerUserId: (peerUserId) => set({ activeChatPeerUserId: peerUserId }),
  pendingOpenChatPeerUserId: null,
  setPendingOpenChatPeerUserId: (peerUserId) => set({ pendingOpenChatPeerUserId: peerUserId }),
}));
