import { useCallback, useEffect, useRef, useState } from 'react';
import { isControlContent } from '@velo/protocol';
import { useAuthStore } from '../../store/auth.store';
import { groupPeerKey, groupsApi, type GroupView } from '../api/groups.api';
import type { HistoryItem } from '../api/messages.api';
import { ensureSocketConnected } from '../socket/socket';
import { listStoredMessages, type StoredMessage } from '../storage/messageStore';
import { deleteGroupKeys } from '../storage/senderKeyStore';
import { distributeSenderKey, ensureOwnSenderKey, forgetDepartedMembers, handleControlContent } from './groupKeys';
import { ingestGroupItems, sendGroupMessage, syncGroupFromServer } from './groupMessaging';
import { deleteForEveryone, deleteForMe, editMessage, reactToMessage, subscribeToMessagePatches } from './actions';
import { setDisappearingTimer, subscribeToTimerChanges, sweepExpiredMessages } from './disappearing';
import { shareProfileWith } from './profile';
import { CHAT_SWEEP_INTERVAL_MS } from './useExpirySweeper';
import { loadConversationSettings, DEFAULT_CONVERSATION_SETTINGS, type ConversationSettings } from '../storage/conversationSettingsStore';
import { subscribeToControlContent } from '../socket/messaging';

/**
 * Group chat state for one group (T6.4): the group's members and epoch,
 * messages from the local store, send, and the live/sync receive paths.
 * On a membership change (`group:changed`) the group is refetched, our key
 * rotates for the new epoch, departed members' keys are forgotten (T6.5).
 */
export type GroupUIMessage = StoredMessage & { mine: boolean };

const PAGE_SIZE = 50;

function toUI(myUserId: string, m: StoredMessage): GroupUIMessage {
  return { ...m, mine: m.direction === 'out' };
}

function upsert(list: GroupUIMessage[], m: GroupUIMessage): GroupUIMessage[] {
  const idx = list.findIndex((x) => x.id === m.id || (m.serverMessageId && x.serverMessageId === m.serverMessageId));
  const next = idx === -1 ? [...list, m] : list.map((x, i) => (i === idx ? { ...x, ...m } : x));
  return next.sort((a, b) => (a.seq != null && b.seq != null ? a.seq - b.seq : a.createdAt - b.createdAt));
}

export function useGroupChat(groupId: string) {
  const myUserId = useAuthStore((s) => s.userId);
  const [group, setGroup] = useState<GroupView | null>(null);
  const [messages, setMessages] = useState<GroupUIMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [waitingForKeys, setWaitingForKeys] = useState<string[]>([]);
  const [securityWarning, setSecurityWarning] = useState<{ code: string; fromUserId: string } | null>(null);
  /** T6.5: we are no longer a member (removed, or the group is gone); keys wiped, nothing more to do here. */
  const [removed, setRemoved] = useState(false);
  const groupRef = useRef<GroupView | null>(null);
  const memberIdsRef = useRef<string[]>([]);
  const adminIdsRef = useRef<string[]>([]);
  const [timer, setTimerState] = useState<ConversationSettings>(DEFAULT_CONVERSATION_SETTINGS);

  const onSecurityWarning = useCallback((code: string, fromUserId: string) => setSecurityWarning({ code, fromUserId }), []);

  const refreshGroup = useCallback(async () => {
    if (!myUserId) return null;
    let g: GroupView;
    try {
      g = (await groupsApi.get(groupId)).data;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 403 || status === 404) {
        // T6.5: removed (or the group was deleted): our key and every member's key are dead here.
        await deleteGroupKeys(String(myUserId), groupId);
        groupRef.current = null;
        setGroup(null);
        setRemoved(true);
        return null;
      }
      throw e;
    }
    const previous = memberIdsRef.current;
    groupRef.current = g;
    memberIdsRef.current = g.members.map((m) => m.userId);
    adminIdsRef.current = g.members.filter((m) => m.role === 'admin').map((m) => m.userId);
    setGroup(g);
    // T6.5: a new epoch rotates our key; departed members' keys are dead.
    await ensureOwnSenderKey({ myUserId: String(myUserId), groupId, epoch: g.epoch });
    if (previous.length) await forgetDepartedMembers({ myUserId: String(myUserId), group: g, previousMemberIds: previous });
    return g;
  }, [groupId, myUserId]);

  const sync = useCallback(async () => {
    if (!myUserId) return;
    const r = await syncGroupFromServer({ myUserId: String(myUserId), groupId, memberIds: memberIdsRef.current.length ? memberIdsRef.current : null, adminIds: adminIdsRef.current.length ? adminIdsRef.current : null, onSecurityWarning });
    setWaitingForKeys(r.waitingForKey);
    if (r.received.length) setMessages((prev) => r.received.reduce((acc, m) => upsert(acc, toUI(String(myUserId), m)), prev));
  }, [groupId, myUserId, onSecurityWarning]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeControl: (() => void) | null = null;
    // T7.2: reactions, edits and deletions change stored records; mirror them into the list.
    const unsubscribePatches = subscribeToMessagePatches((p) => {
      if (cancelled || !myUserId || p.myUserId !== String(myUserId) || p.peerKey !== groupPeerKey(groupId)) return;
      setMessages((prev) => (p.message ? upsert(prev, toUI(String(myUserId), p.message)) : prev.filter((m) => m.id !== p.id && m.clientMessageId !== p.id)));
    });
    // T7.3: the timer setting and the sweep for this conversation.
    const unsubscribeTimer = subscribeToTimerChanges((e) => {
      if (!cancelled && myUserId && e.myUserId === String(myUserId) && e.peerKey === groupPeerKey(groupId)) setTimerState(e.settings);
    });
    const sweep = () => {
      if (myUserId) sweepExpiredMessages({ myUserId: String(myUserId), peerKey: groupPeerKey(groupId) }).catch((e) => console.warn('[disappearing] sweep failed:', e));
    };
    const sweepInterval = setInterval(sweep, CHAT_SWEEP_INTERVAL_MS);
    (async () => {
      if (!myUserId) return;
      setLoading(true);
      try {
        await sweepExpiredMessages({ myUserId: String(myUserId), peerKey: groupPeerKey(groupId) });
        loadConversationSettings(String(myUserId), groupPeerKey(groupId)).then((s) => {
          if (!cancelled) setTimerState(s);
        });
        const stored = await listStoredMessages({ myUserId: String(myUserId), peerUserId: groupPeerKey(groupId), limit: PAGE_SIZE });
        if (!cancelled) setMessages(stored.map((m) => toUI(String(myUserId), m)));
        const g = await refreshGroup();
        if (g) {
          await distributeSenderKey({ myUserId: String(myUserId), group: g });
          await sync();
          // T7.7: members get our profile over their pairwise sessions (once per version each).
          for (const m of g.members) if (m.userId !== String(myUserId)) shareProfileWith(String(myUserId), m.userId).catch((e) => console.warn('[profile] share failed:', e));
        }
      } catch (e) {
        console.warn('[groups] open failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }

      try {
        const socket = await ensureSocketConnected();
        const onNew = async (evt: HistoryItem & { groupId?: string | null }) => {
          if (!evt?.g1 || String(evt.groupId ?? '') !== groupId) return;
          const r = await ingestGroupItems({ myUserId: String(myUserId), groupId, items: [evt], memberIds: memberIdsRef.current.length ? memberIdsRef.current : null, adminIds: adminIdsRef.current.length ? adminIdsRef.current : null, onSecurityWarning });
          if (r.received.length) setMessages((prev) => r.received.reduce((acc, m) => upsert(acc, toUI(String(myUserId), m)), prev));
          if (r.waitingForKey.length) setWaitingForKeys((prev) => Array.from(new Set([...prev, ...r.waitingForKey])));
        };
        const onChanged = async (evt: { groupId: string }) => {
          if (evt?.groupId !== groupId) return;
          try {
            const g = await refreshGroup();
            if (g) await distributeSenderKey({ myUserId: String(myUserId), group: g });
          } catch (e) {
            console.warn('[groups] refresh after change failed:', e);
          }
        };
        socket.on('message:new', onNew);
        socket.on('group:changed', onChanged);
        unsubscribe = () => {
          socket.off('message:new', onNew);
          socket.off('group:changed', onChanged);
        };
        // A member's key arriving over a pairwise session may unlock messages we could not open.
        unsubscribeControl = subscribeToControlContent(async (content, meta) => {
          if (!isControlContent(content) || content.groupId !== groupId) return;
          await handleControlContent({ myUserId: String(myUserId), fromUserId: meta.fromUserId, content, loadGroup: async () => groupRef.current });
          if (content.kind === 'skdm') {
            setWaitingForKeys((prev) => prev.filter((id) => id !== meta.fromUserId));
            await sync();
          }
        });
      } catch (e) {
        console.warn('[groups] socket not ready:', e);
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(sweepInterval);
      unsubscribeTimer();
      unsubscribePatches();
      unsubscribe?.();
      unsubscribeControl?.();
    };
  }, [groupId, myUserId, refreshGroup, sync, onSecurityWarning]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !myUserId || !groupRef.current) return;
      const clientMessageId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const createdAt = Date.now();
      const optimistic: GroupUIMessage = { id: clientMessageId, clientMessageId, serverMessageId: null, direction: 'out', senderUserId: String(myUserId), text: trimmed, createdAt, seq: null, status: 'sending', deliveredAt: null, readAt: null, replyTo: null, mine: true };
      setMessages((prev) => upsert(prev, optimistic));
      try {
        const { stored, ack } = await sendGroupMessage({ myUserId: String(myUserId), group: groupRef.current, text: trimmed, clientMessageId, createdAt });
        setMessages((prev) => upsert(prev, toUI(String(myUserId), stored)));
        if (!ack.ok && ack.code === 'STALE_EPOCH') {
          const g = await refreshGroup();
          if (g) await distributeSenderKey({ myUserId: String(myUserId), group: g });
        }
      } catch (e) {
        console.warn('[groups] send failed:', e);
        setMessages((prev) => upsert(prev, { ...optimistic, status: 'failed' }));
      }
    },
    [myUserId, refreshGroup],
  );

  const addMembers = useCallback(async (userIds: string[]) => {
    await groupsApi.addMembers(groupId, userIds);
    await refreshGroup();
  }, [groupId, refreshGroup]);

  const removeMember = useCallback(async (userId: string) => {
    await groupsApi.removeMember(groupId, userId);
    await refreshGroup();
  }, [groupId, refreshGroup]);

  // T7.2: message actions on the group chain (local-first).
  const react = useCallback(async (message: GroupUIMessage, emoji: string, remove = false) => {
    if (!myUserId || !groupRef.current) return;
    await reactToMessage({ myUserId: String(myUserId), target: { kind: 'group', group: groupRef.current }, message, emoji, remove });
  }, [myUserId]);
  const edit = useCallback(async (message: GroupUIMessage, text: string) => {
    if (!myUserId || !groupRef.current) return;
    await editMessage({ myUserId: String(myUserId), target: { kind: 'group', group: groupRef.current }, message, text });
  }, [myUserId]);
  const deleteEverywhere = useCallback(async (message: GroupUIMessage) => {
    if (!myUserId || !groupRef.current) return;
    await deleteForEveryone({ myUserId: String(myUserId), target: { kind: 'group', group: groupRef.current }, message });
  }, [myUserId]);
  const deleteLocally = useCallback(async (message: GroupUIMessage) => {
    if (!myUserId) return;
    await deleteForMe({ myUserId: String(myUserId), peerKey: groupPeerKey(groupId), message });
  }, [groupId, myUserId]);

  const setTimer = useCallback(async (seconds: number | null) => {
    if (!myUserId || !groupRef.current) return;
    const g = groupRef.current;
    const nameOf = (userId: string) => g.members.find((m) => m.userId === userId)?.username ?? userId;
    await setDisappearingTimer({ myUserId: String(myUserId), target: { kind: 'group', group: g }, seconds, nameOf });
  }, [myUserId]);

  return { group, messages, loading, removed, waitingForKeys, securityWarning, timer, setTimer, send, sync, addMembers, removeMember, refreshGroup, react, edit, deleteEverywhere, deleteLocally };
}
