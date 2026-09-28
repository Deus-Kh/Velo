import { AppState } from 'react-native';
import { messagesApi, type HistoryItem } from '../api/messages.api';
import { conversationsApi, type ConversationListItem } from '../api/conversations.api';
import { loadStoredSession } from '../auth/tokenStore';
import { ingestUndeliveredItems } from '../chat/historySync';
import { ingestGroupItems } from '../chat/groupMessaging';
import { groupsApi } from '../api/groups.api';
import { makeConversationId } from '../utils/conversation';
import type { StoredMessage } from '../storage/messageStore';
import { useAppUiStore } from '../../store/app-ui.store';
import { useContactsStore } from '../../store/contacts.store';
import {
  getNotificationPreferencesForUser,
  useNotificationPreferencesStore,
} from '../../store/notification-preferences.store';
import { displayIncomingMessageNotification } from './notifee';
import { notificationBodyFor, notificationIdFor, resolveSenderName, shouldNotifyFor } from './pushPolicy';

/**
 * T3.3: what happens when a message arrives and no chat is rendering it.
 * The device fetches (or is handed) the ciphertext, decrypts it through the
 * normal receive path, stores it, acks so the server deletes it, and only
 * then renders a notification with the sender's name from local data and
 * the text only if previews are enabled. The same code serves the
 * background push wake-up, the foreground push, and a live socket message
 * for a chat that is not open.
 */

const PUSH_FETCH_LIMIT = 50;

/** Who is signed in on this device, from the persisted session (works in a headless task). */
export async function currentUserIdForBackground(): Promise<string | null> {
  const stored = await loadStoredSession();
  return stored?.userId ?? null;
}

/** Zustand persist stores rehydrate lazily; a headless task must wait for them. */
async function ensureStoresHydrated(): Promise<void> {
  const stores = [useContactsStore, useNotificationPreferencesStore] as const;
  await Promise.all(
    stores.map(async (s) => {
      const p = (s as unknown as { persist?: { hasHydrated: () => boolean; rehydrate: () => Promise<void> | void } }).persist;
      if (p && !p.hasHydrated()) await p.rehydrate();
    }),
  );
}

let conversationsCache: { at: number; items: ConversationListItem[] } | null = null;

async function conversationsForNames(): Promise<ConversationListItem[]> {
  if (conversationsCache && Date.now() - conversationsCache.at < 60_000) return conversationsCache.items;
  try {
    const res = await conversationsApi.list();
    const items = Array.isArray(res.data?.items) ? res.data.items : [];
    conversationsCache = { at: Date.now(), items };
    return items;
  } catch {
    return conversationsCache?.items ?? [];
  }
}

async function notifyStored(params: { myUserId: string; peerUserId: string; messages: StoredMessage[] }): Promise<void> {
  const { myUserId, peerUserId, messages } = params;
  if (messages.length === 0) return;
  await ensureStoresHydrated();

  const preferences = getNotificationPreferencesForUser(
    useNotificationPreferencesStore.getState().preferencesByUserId,
    myUserId,
  );
  const appActive = AppState.currentState === 'active';
  const chatOpenForPeer = useAppUiStore.getState().activeChatPeerUserId === peerUserId;
  if (!shouldNotifyFor({ appActive, chatOpenForPeer, inAppAlertsEnabled: preferences.inAppAlertsEnabled })) return;

  const savedContacts = useContactsStore.getState().savedContactsByUser[myUserId] ?? [];
  let title = resolveSenderName({ peerUserId, savedContacts });
  if (title === 'New message') title = resolveSenderName({ peerUserId, savedContacts, conversations: await conversationsForNames() });

  const conversationId = makeConversationId(myUserId, peerUserId);
  for (const m of messages) {
    await displayIncomingMessageNotification({
      id: notificationIdFor(conversationId, m.serverMessageId ?? m.id),
      title,
      body: notificationBodyFor({ text: m.text, showMessagePreview: preferences.showMessagePreview }),
      conversationId,
      fromUserId: peerUserId,
      soundEnabled: preferences.soundEnabled,
      vibrationEnabled: preferences.vibrationEnabled,
    });
  }
}

async function notifyStoredGroup(params: { myUserId: string; groupId: string; title: string; messages: StoredMessage[] }): Promise<void> {
  const { myUserId, groupId, title, messages } = params;
  await ensureStoresHydrated();
  const preferences = getNotificationPreferencesForUser(useNotificationPreferencesStore.getState().preferencesByUserId, myUserId);
  const appActive = AppState.currentState === 'active';
  const chatOpenForPeer = useAppUiStore.getState().activeChatPeerUserId === 'group:' + groupId;
  if (!shouldNotifyFor({ appActive, chatOpenForPeer, inAppAlertsEnabled: preferences.inAppAlertsEnabled })) return;
  const conversationId = 'group:' + groupId;
  for (const m of messages) {
    await displayIncomingMessageNotification({
      id: notificationIdFor(conversationId, m.serverMessageId ?? m.id),
      title,
      body: notificationBodyFor({ text: m.text, showMessagePreview: preferences.showMessagePreview }),
      conversationId,
      fromUserId: 'group:' + groupId,
      soundEnabled: preferences.soundEnabled,
      vibrationEnabled: preferences.vibrationEnabled,
    });
  }
}

/**
 * A live `message:new` for a chat that is not open: decrypt, store, ack,
 * notify. Returns the stored message, or null if it could not be ingested
 * (it then stays on the server for the chat's own sync).
 */
export async function ingestLiveMessage(params: { myUserId: string; item: HistoryItem }): Promise<StoredMessage | null> {
  const peerUserId = String(params.item.fromUserId);
  if (peerUserId === params.myUserId) return null;
  const { received } = await ingestUndeliveredItems({ myUserId: params.myUserId, peerUserId, items: [params.item] });
  await notifyStored({ myUserId: params.myUserId, peerUserId, messages: received });
  return received[0] ?? null;
}

/** T6.4: a live `message:new` group copy for a group that is not open: decrypt, store, ack, notify. */
export async function ingestLiveGroupMessage(params: { myUserId: string; item: HistoryItem }): Promise<StoredMessage | null> {
  const groupId = String(params.item.groupId ?? '');
  if (!groupId || String(params.item.fromUserId) === params.myUserId) return null;
  const { received } = await ingestGroupItems({ myUserId: params.myUserId, groupId, items: [params.item] });
  if (received.length) {
    let title = 'Group message';
    try {
      title = (await groupsApi.get(groupId)).data.name;
    } catch {
      /* name unknown offline */
    }
    await notifyStoredGroup({ myUserId: params.myUserId, groupId, title, messages: received });
  }
  return received[0] ?? null;
}

/**
 * The push wake-up: fetch everything the server still holds for this
 * device (the push names one message, but anything else waiting is just as
 * undelivered), ingest per peer, notify. Idempotent: a message the socket
 * already consumed is acked without a notification.
 */
export async function fetchAndIngestUndelivered(myUserId: string): Promise<StoredMessage[]> {
  const res = await messagesApi.getUndelivered({ limit: PUSH_FETCH_LIMIT });
  const items: HistoryItem[] = Array.isArray(res.data?.items) ? res.data.items : [];
  const byPeer = new Map<string, HistoryItem[]>();
  const byGroup = new Map<string, HistoryItem[]>();
  for (const it of items) {
    const peer = String(it.fromUserId);
    if (peer === myUserId) continue;
    if (it.g1 && it.groupId) {
      const list = byGroup.get(String(it.groupId)) ?? [];
      list.push(it);
      byGroup.set(String(it.groupId), list);
      continue;
    }
    const list = byPeer.get(peer) ?? [];
    list.push(it);
    byPeer.set(peer, list);
  }

  const all: StoredMessage[] = [];
  // T6.4: group copies, one notification per message with the group's name.
  for (const [groupId, groupItems] of byGroup) {
    const { received } = await ingestGroupItems({ myUserId, groupId, items: groupItems });
    all.push(...received);
    if (received.length) {
      let title = 'Group message';
      try {
        title = (await groupsApi.get(groupId)).data.name;
      } catch {
        /* name unknown offline */
      }
      await notifyStoredGroup({ myUserId, groupId, title, messages: received });
    }
  }
  for (const [peerUserId, peerItems] of byPeer) {
    const { received } = await ingestUndeliveredItems({ myUserId, peerUserId, items: peerItems });
    all.push(...received);
    await notifyStored({ myUserId, peerUserId, messages: received });
  }
  return all;
}
