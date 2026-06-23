import { create } from 'zustand';

type AppUiState = {
  activeChatPeerUserId: string | null;
  setActiveChatPeerUserId: (peerUserId: string | null) => void;
};

export const useAppUiStore = create<AppUiState>((set) => ({
  activeChatPeerUserId: null,
  setActiveChatPeerUserId: (peerUserId) => set({ activeChatPeerUserId: peerUserId }),
}));
