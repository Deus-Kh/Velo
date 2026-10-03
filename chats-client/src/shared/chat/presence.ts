import { describeSessionHealth } from './sessionHealthPresentation';
import type { SessionHealth } from './useChatE2EE';

/**
 * C1: what the chat header says under the contact's name, from the
 * session health, typing, the socket and the contact's presence.
 */
export type PresenceSnapshot = {
  online: boolean;
  lastSeenAt: number | null;
};

export type HeaderPresenceMeta = {
  subtitle: string;
  pillLabel: string;
  pillTone: 'default' | 'warning' | 'offline';
};

export function getHeaderPresenceMeta({
  peerTyping,
  peerPresence,
  socketReady,
  sessionHealth,
}: {
  peerTyping: boolean;
  peerPresence: PresenceSnapshot;
  socketReady: boolean;
  sessionHealth: SessionHealth;
}): HeaderPresenceMeta {
  // T4.8: every non-healthy state is described by the spec 8.3 taxonomy in one place.
  const described = describeSessionHealth(sessionHealth);
  if (described) {
    return {
      subtitle: described.subtitle,
      pillLabel: described.pillLabel,
      pillTone: 'warning',
    };
  }

  if (peerTyping) {
    return {
      subtitle: 'typing...',
      pillLabel: '',
      pillTone: 'default',
    };
  }

  if (!socketReady) {
    return {
      subtitle: 'Offline. Messages will send after reconnect.',
      pillLabel: 'Offline',
      pillTone: 'offline',
    };
  }

  if (peerPresence.online) {
    return {
      subtitle: 'online',
      pillLabel: '',
      pillTone: 'default',
    };
  }

  return {
    subtitle: formatLastSeen(peerPresence.lastSeenAt),
    pillLabel: '',
    pillTone: 'default',
  };
}

export function formatLastSeen(lastSeenAt: number | null, now: number = Date.now()): string {
  if (!lastSeenAt) {
    return 'end-to-end encrypted'; // T7.4: presence hidden by the peer (the default), so say nothing about it
  }

  const diffMs = now - lastSeenAt;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return 'last seen just now';
  if (diffMinutes < 60) return `last seen ${diffMinutes}m ago`;

  const date = new Date(lastSeenAt);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return sameDay
    ? `last seen at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `last seen ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}
