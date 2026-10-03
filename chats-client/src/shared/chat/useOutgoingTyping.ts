import { useCallback, useEffect, useRef } from 'react';
import { getSocket } from '../socket/socket';

/**
 * C1: tells the contact that we are typing. A non-empty draft starts the
 * signal; it stops after a short pause, when the draft is cleared, when a
 * message is sent (`stopTypingNow`) and when the chat closes.
 */
export function useOutgoingTyping({
  conversationId,
  peerUserId,
  socketReady,
  trimmedText,
}: {
  conversationId: string | null;
  peerUserId: string;
  socketReady: boolean;
  trimmedText: string;
}): { stopTypingNow: () => void } {
  const typingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);

  useEffect(() => {
    if (!socketReady || !conversationId) {
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      typingActiveRef.current = false;
      return;
    }

    let socket;
    try {
      socket = getSocket();
    } catch {
      return;
    }

    const stopTyping = () => {
      if (!typingActiveRef.current) return;
      typingActiveRef.current = false;
      socket.emit('typing:stop', { toUserId: peerUserId });
    };

    if (!trimmedText) {
      stopTyping();
      return;
    }

    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      socket.emit('typing:start', { toUserId: peerUserId });
    }

    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
    }

    typingStopTimeoutRef.current = setTimeout(() => {
      stopTyping();
      typingStopTimeoutRef.current = null;
    }, 1400);

    return () => {
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
    };
  }, [conversationId, peerUserId, socketReady, trimmedText]);

  useEffect(() => () => {
    if (!typingActiveRef.current || !conversationId) return;

    try {
      const socket = getSocket();
      socket.emit('typing:stop', { toUserId: peerUserId });
    } catch {
      // ignore missing socket during unmount cleanup
    }
  }, [conversationId, peerUserId]);

  const stopTypingNow = useCallback(() => {
    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = null;
    }
    typingActiveRef.current = false;
    if (conversationId) {
      try {
        const socket = getSocket();
        socket.emit('typing:stop', { toUserId: peerUserId });
      } catch {
        // ignore missing socket on send cleanup
      }
    }
  }, [conversationId, peerUserId]);

  return { stopTypingNow };
}
