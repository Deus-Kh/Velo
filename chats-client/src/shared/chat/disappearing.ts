import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Content, TimerContent } from '@velo/protocol';
import { groupPeerKey } from '../api/groups.api';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { cancelConversationNotifications } from '../notifications/notifee';
import { sendContent } from '../socket/messaging';
import { openJson } from '../storage/sealed';
import { loadConversationSettings, saveConversationSettings, type ConversationSettings } from '../storage/conversationSettingsStore';
import { deleteStoredMessage, storedMessagesPrefixForUser, upsertStoredMessage, type StoredMessage } from '../storage/messageStore';
import { deleteMedia } from '../media/mediaStore';
import { peerKeyOf, publishMessagePatch, type ConversationTarget } from './actions';
import { sendGroupContent } from './groupMessaging';

/**
 * Disappearing messages (T7.3). The timer is a conversation setting agreed
 * over the session as `{kind:'timer'}` content: either side of a 1:1 chat
 * may set it, an admin in a group. A message expires `timer` seconds after
 * it was sent (outgoing) or stored on this device (incoming); the record's
 * `expiresAt` is fixed when it is first stored (messageStore.ts), and the
 * sweeper removes expired records and their notifications. The server
 * never learns the timer: it already deletes on delivery (T3.1).
 */
export const TIMER_OPTIONS: Array<{ label: string; seconds: number | null }> = [
  { label: 'Off', seconds: null },
  { label: '1 hour', seconds: 60 * 60 },
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '1 week', seconds: 7 * 24 * 60 * 60 },
];

export function formatTimer(seconds: number | null): string {
  if (!seconds) return 'off';
  const known = TIMER_OPTIONS.find((o) => o.seconds === seconds);
  if (known) return known.label.toLowerCase();
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

type TimerListener = (evt: { myUserId: string; peerKey: string; settings: ConversationSettings }) => void;
const timerListeners = new Set<TimerListener>();

export function subscribeToTimerChanges(listener: TimerListener): () => void {
  timerListeners.add(listener);
  return () => {
    timerListeners.delete(listener);
  };
}

/** The system line both sides show when the timer changes. */
export function timerSystemText(params: { setBy: string; myUserId: string; seconds: number | null; nameOf?: (userId: string) => string }): string {
  const who = params.setBy === params.myUserId ? 'You' : (params.nameOf?.(params.setBy) ?? params.setBy);
  return params.seconds ? `${who} set messages to disappear after ${formatTimer(params.seconds)}` : `${who} turned disappearing messages off`;
}

/**
 * Apply a timer to the conversation: persist the setting, tell the UI, and
 * store a system line (which itself never expires).
 */
export async function applyTimer(params: { myUserId: string; peerKey: string; setBy: string; seconds: number | null; now?: number; nameOf?: (userId: string) => string }): Promise<ConversationSettings> {
  const { myUserId, peerKey, setBy } = params;
  const now = params.now ?? Date.now();
  const seconds = params.seconds && params.seconds > 0 ? params.seconds : null;
  const current = await loadConversationSettings(myUserId, peerKey);
  const settings: ConversationSettings = { timerSeconds: seconds, timerSetBy: setBy, timerSetAt: now };
  await saveConversationSettings(myUserId, peerKey, settings);
  if (current.timerSeconds !== seconds || current.timerSetBy !== setBy) {
    const line: StoredMessage = {
      id: `timer-${now}-${setBy}`,
      clientMessageId: null,
      serverMessageId: null,
      direction: setBy === myUserId ? 'out' : 'in',
      senderUserId: setBy,
      text: timerSystemText({ setBy, myUserId, seconds, nameOf: params.nameOf }),
      createdAt: now,
      seq: null,
      status: 'sent',
      deliveredAt: null,
      readAt: null,
      replyTo: null,
      system: true,
      expiresAt: null,
    };
    await upsertStoredMessage({ myUserId, peerUserId: peerKey, message: line });
    publishMessagePatch({ myUserId, peerKey, id: line.id, message: line });
  }
  for (const l of timerListeners) {
    try {
      l({ myUserId, peerKey, settings });
    } catch (e) {
      console.warn('[disappearing] listener failed:', e);
    }
  }
  return settings;
}

/**
 * Inbound `{kind:'timer'}` content. In a group only an admin may set it;
 * with the admin list unknown (offline wake-up) the change is refused.
 */
export async function handleInboundTimer(params: { myUserId: string; peerKey: string; actorUserId: string; content: Content; groupAdminIds?: string[] | null; nameOf?: (userId: string) => string }): Promise<boolean> {
  const { content } = params;
  if (content.kind !== 'timer') return false;
  if (params.peerKey.startsWith('group:')) {
    if (!params.groupAdminIds || !params.groupAdminIds.includes(params.actorUserId)) {
      console.warn('[disappearing] timer change refused: not an admin or admins unknown');
      return false;
    }
  }
  await applyTimer({ myUserId: params.myUserId, peerKey: params.peerKey, setBy: params.actorUserId, seconds: content.seconds, nameOf: params.nameOf });
  return true;
}

/** Our own change: applied locally, then sent over the session. */
export async function setDisappearingTimer(params: { myUserId: string; target: ConversationTarget; seconds: number | null; nameOf?: (userId: string) => string }): Promise<ConversationSettings> {
  const { myUserId, target, seconds } = params;
  const content: TimerContent = { v: 1, kind: 'timer', seconds: seconds && seconds > 0 ? seconds : null };
  const settings = await applyTimer({ myUserId, peerKey: peerKeyOf(target), setBy: myUserId, seconds: content.seconds, nameOf: params.nameOf });
  if (target.kind === 'peer') await sendContent(target.peerUserId, content);
  else {
    const ack = await sendGroupContent({ myUserId, group: target.group, content });
    if (!ack.ok) throw new Error(ack.code || ack.error || 'group send refused');
  }
  return settings;
}

/**
 * Remove every expired record of one conversation (or all of the user's),
 * cancel the conversation's notifications, and tell the UI. Records are
 * sealed, so this decrypts what it inspects; bounded by the local store.
 */
export async function sweepExpiredMessages(params: { myUserId: string; peerKey?: string | null; now?: number }): Promise<{ removed: number; conversations: string[] }> {
  const { myUserId } = params;
  const now = params.now ?? Date.now();
  const userPrefix = storedMessagesPrefixForUser(myUserId);
  const prefix = params.peerKey ? `${userPrefix}${params.peerKey}:` : userPrefix;
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  if (keys.length === 0) return { removed: 0, conversations: [] };
  const mk = await getOrCreateSessionMasterKey(myUserId);
  const rows = await AsyncStorage.multiGet(keys);
  const touched = new Set<string>();
  let removed = 0;
  for (const [k, raw] of rows) {
    const m = openJson<StoredMessage>(mk, raw);
    if (!m || typeof m.expiresAt !== 'number' || m.expiresAt > now) continue;
    // The slot is the segment between the user prefix and the 15-digit time.
    const rest = k.slice(userPrefix.length);
    const peerKey = rest.slice(0, rest.length - (16 + m.id.length) - 1);
    await deleteStoredMessage({ myUserId, peerUserId: peerKey, id: m.id, createdAt: m.createdAt });
    if (m.attachment) await deleteMedia(myUserId, m.attachment.blobId); // T8.3
    publishMessagePatch({ myUserId, peerKey, id: m.id, message: null });
    touched.add(peerKey);
    removed += 1;
  }
  for (const peerKey of touched) {
    const conversationId = peerKey.startsWith('group:') ? peerKey : [myUserId, peerKey].sort().join(':');
    await cancelConversationNotifications(conversationId).catch(() => undefined);
  }
  return { removed, conversations: [...touched] };
}

export { groupPeerKey };
