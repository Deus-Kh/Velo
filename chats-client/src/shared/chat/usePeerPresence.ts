import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket/socket';
import type { PresenceSnapshot } from './presence';

/**
 * C1: the contact's presence and typing state for one open chat. Subscribes
 * on the socket while the chat is open; a typing flag clears itself after
 * a few seconds in case the stop event never arrives.
 */
export function usePeerPresence({ peerUserId, conversationId }: { peerUserId: string; conversationId: string | null }): {
  peerPresence: PresenceSnapshot;
  peerTyping: boolean;
} {
  const [peerPresence, setPeerPresence] = useState<PresenceSnapshot>({
    online: false,
    lastSeenAt: null,
  });
  const [peerTyping, setPeerTyping] = useState(false);
  const typingIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const subscribePresence = async () => {
      try {
        const socket = getSocket();

        const handlePresenceUpdate = (event: {
          userId?: string;
          online?: boolean;
          lastSeenAt?: number | null;
        }) => {
          if (cancelled || event.userId !== peerUserId) return;

          setPeerPresence({
            online: Boolean(event.online),
            lastSeenAt:
              typeof event.lastSeenAt === 'number' && Number.isFinite(event.lastSeenAt)
                ? event.lastSeenAt
                : null,
          });
        };

        const handleTypingUpdate = (event: {
          fromUserId?: string;
          conversationId?: string;
          isTyping?: boolean;
        }) => {
          if (
            cancelled ||
            event.fromUserId !== peerUserId ||
            event.conversationId !== conversationId
          ) {
            return;
          }

          setPeerTyping(Boolean(event.isTyping));

          if (typingIndicatorTimeoutRef.current) {
            clearTimeout(typingIndicatorTimeoutRef.current);
            typingIndicatorTimeoutRef.current = null;
          }

          if (event.isTyping) {
            typingIndicatorTimeoutRef.current = setTimeout(() => {
              setPeerTyping(false);
            }, 3200);
          }
        };

        socket.on('presence:update', handlePresenceUpdate);
        socket.on('typing:update', handleTypingUpdate);
        socket.emit('presence:subscribe', { peerUserId });

        return () => {
          socket.emit('presence:unsubscribe', { peerUserId });
          socket.off('presence:update', handlePresenceUpdate);
          socket.off('typing:update', handleTypingUpdate);
        };
      } catch (e) {
        console.warn('[ChatScreen] Failed to subscribe to presence:', (e as any)?.message || e);
        return undefined;
      }
    };

    let cleanupPromise: Promise<(() => void) | undefined> | undefined;
    if (conversationId) {
      cleanupPromise = subscribePresence();
    }

    return () => {
      cancelled = true;
      cleanupPromise?.then((cleanup) => cleanup?.()).catch(() => undefined);
      if (typingIndicatorTimeoutRef.current) {
        clearTimeout(typingIndicatorTimeoutRef.current);
        typingIndicatorTimeoutRef.current = null;
      }
    };
  }, [conversationId, peerUserId]);

  return { peerPresence, peerTyping };
}
