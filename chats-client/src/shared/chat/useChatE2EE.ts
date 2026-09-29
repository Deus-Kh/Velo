

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

import { subscribeToMessages } from '../socket/messaging';
import { sendAuto } from '../socket/sendAuto';
import { getSocket } from '../socket/socket';

import { useAuthStore } from '../../store/auth.store';

import {
  listPendingMessages,
  removePendingMessage,
  removePendingMessagesForPair,
  upsertPendingMessage,
  type PendingMessageRecord,
} from '../storage/pendingMessageStore';

import { deleteSession } from '../storage/sessionStore';
import { protocolErrorCode, type ProtocolErrorCode } from '@velo/protocol';
import { acceptNewIdentity as acceptNewIdentityForPair } from '../crypto/identityTrust';
import { listStoredMessages, upsertStoredMessage, type StoredMessage } from '../storage/messageStore';
import { syncNewerFromServer } from './historySync';
import { deleteForEveryone, deleteForMe, editMessage, reactToMessage, subscribeToMessagePatches, type ConversationTarget } from './actions';
import { setDisappearingTimer, subscribeToTimerChanges, sweepExpiredMessages } from './disappearing';
import { shareProfileWith } from './profile';
import { CHAT_SWEEP_INTERVAL_MS } from './useExpirySweeper';
import { loadConversationSettings, DEFAULT_CONVERSATION_SETTINGS, type ConversationSettings } from '../storage/conversationSettingsStore';
import { classifyPendingMessageError, presentProtocolError } from './protocolErrors';
import { makeConversationId } from '../utils/conversation';
import type { ReplyReference } from './types';

export type UIMessage = {
  id: string;
  serverMessageId?: string;
  clientMessageId?: string;
  text: string;
  mine: boolean;
  createdAt: number;
  /** T3.2: server order; null while a send is in flight. */
  seq?: number | null;
  replyTo?: ReplyReference | null;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
  /** T7.2 */
  reactions?: Record<string, string> | null;
  editedAt?: number | null;
  deletedAt?: number | null;
  forwardedFrom?: { userId: string; createdAt: number } | null;
  /** T7.3 */
  system?: boolean;
  expiresAt?: number | null;
};

export type SessionHealth =
  | { status: 'healthy'; reason?: undefined; code?: undefined }
  | { status: 'reset_required'; reason: string; code?: ProtocolErrorCode | null }
  /** T2.13: the peer's identity no longer matches the pin. Sending is blocked until the user verifies or accepts. */
  | { status: 'identity_changed'; reason: string; code?: ProtocolErrorCode | null }
  /** T4.8: a message could not be decrypted but the session still works; cleared by the next successful message or a reset. */
  | { status: 'degraded'; reason: string; code: ProtocolErrorCode };


type StatusChangedEvent = {
  conversationId: string;
  status: 'delivered' | 'read';
  serverMessageId?: string;
  deliveredAt?: number | null;
  readAt?: number | null;
  readerUserId?: string;
  deliveredByUserId?: string;
};

// How many messages to fetch per page
const PAGE_SIZE = 30;

const genId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function stableKey(
  m: Partial<{
    serverMessageId: string;
    clientMessageId: string;
    createdAt: number;
    fromUserId: string;
    text: string;
  }>
): string {
  return (
    m.serverMessageId ||
    m.clientMessageId ||
    `${m.createdAt ?? Date.now()}-${m.fromUserId ?? 'u'}-${(m.text ?? '').slice(0, 20)}`
  );
}

/**
 * T3.2: the server sequence orders the conversation; the sender's clock only
 * orders messages that have no sequence yet (a send in flight).
 */
function compareOrder(a: UIMessage, b: UIMessage): number {
  if (a.seq != null && b.seq != null) return a.seq - b.seq;
  return a.createdAt - b.createdAt;
}

/**
 * Merge `next` into `prev` list, deduplicating by serverMessageId, clientMessageId, then id.
 * Returns a new array in conversation order (seq, then createdAt for in-flight sends).
 */
function upsertMessage(prev: UIMessage[], next: UIMessage): UIMessage[] {
  if (next.serverMessageId) {
    const idx = prev.findIndex((x) => x.serverMessageId === next.serverMessageId);
    if (idx !== -1) {
      const copy = prev.slice();
      copy[idx] = { ...prev[idx], ...next, id: next.serverMessageId };
      return copy;
    }
  }

  if (next.clientMessageId) {
    const idx = prev.findIndex((x) => x.clientMessageId === next.clientMessageId);
    if (idx !== -1) {
      const copy = prev.slice();
      copy[idx] = {
        ...prev[idx],
        ...next,
        id: next.serverMessageId || prev[idx].id,
      };
      // The send ack brings the seq: settle the message into server order.
      if (next.seq != null && prev[idx].seq == null) copy.sort(compareOrder);
      return copy;
    }
  }

  const idx = prev.findIndex((x) => x.id === next.id);
  if (idx !== -1) {
    const copy = prev.slice();
    copy[idx] = { ...prev[idx], ...next };
    return copy;
  }

  // New message: insert in conversation order
  const insertAt = prev.findIndex((x) => compareOrder(x, next) > 0);
  if (insertAt === -1) {
    return [...prev, next];
  }
  const copy = prev.slice();
  copy.splice(insertAt, 0, next);
  return copy;
}

/**
 * Merge a batch of older messages into the front of the list (prepend),
 * deduplicating against what's already there.
 */
function prependMessages(prev: UIMessage[], batch: UIMessage[]): UIMessage[] {
  let result = prev.slice();
  // Insert each old message; upsertMessage keeps sorted order and deduplicates
  for (const m of batch) {
    result = upsertMessage(result, m);
  }
  return result;
}

function isPolicyBrokenSessionReason(reason: string, code: ProtocolErrorCode | null = null): boolean {
  if (code === 'MISSING_BOOTSTRAP' || code === 'SESSION_RESET_REQUIRED') return true;
  return (
    reason.includes('missing session and initPacket') ||
    reason.includes('Failed to establish v2 session from incoming initPacket')
  );
}

// ---------------------------------------------------------------------------

/** Local store record ↔ UI message (T2.14). */
function toUI(m: StoredMessage): UIMessage {
  return {
    id: m.id,
    serverMessageId: m.serverMessageId ?? undefined,
    clientMessageId: m.clientMessageId ?? undefined,
    text: m.text,
    mine: m.direction === 'out',
    createdAt: m.createdAt,
    seq: m.seq,
    replyTo: m.replyTo,
    status: m.status,
    deliveredAt: m.deliveredAt,
    readAt: m.readAt,
    reactions: m.reactions ?? null,
    editedAt: m.editedAt ?? null,
    deletedAt: m.deletedAt ?? null,
    forwardedFrom: m.forwardedFrom ?? null,
    system: m.system ?? false,
    expiresAt: m.expiresAt,
  };
}

export function toStored(m: UIMessage): StoredMessage {
  return {
    id: m.clientMessageId || m.serverMessageId || m.id,
    serverMessageId: m.serverMessageId ?? null,
    clientMessageId: m.clientMessageId ?? null,
    direction: m.mine ? 'out' : 'in',
    text: m.text,
    createdAt: m.createdAt,
    seq: m.seq ?? null,
    status: m.status ?? 'sent',
    deliveredAt: m.deliveredAt ?? null,
    readAt: m.readAt ?? null,
    replyTo: m.replyTo ?? null,
    reactions: m.reactions ?? null,
    editedAt: m.editedAt ?? null,
    deletedAt: m.deletedAt ?? null,
    forwardedFrom: m.forwardedFrom ?? null,
    system: m.system ?? false,
    expiresAt: m.expiresAt,
  };
}

// ---------------------------------------------------------------------------

export function useChatE2EE(peerUserId: string) {
  const myUserId = useAuthStore((s) => s.userId);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [socketReady, setSocketReady] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  /** True while loading an older page (not the initial load) */
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sessionHealth, setSessionHealth] = useState<SessionHealth>({ status: 'healthy' });
  const [reloadToken, setReloadToken] = useState(0);
  /** T7.6: the peer deleted its account (server notice); sending is pointless. */
  const [peerDeleted, setPeerDeleted] = useState(false);
  /** T7.3: the disappearing-message timer of this conversation. */
  const [timer, setTimerState] = useState<ConversationSettings>(DEFAULT_CONVERSATION_SETTINGS);

  const unsubRef = useRef<null | (() => void)>(null);
  const statusUnsubRef = useRef<null | (() => void)>(null);
  const messagesRef = useRef<UIMessage[]>([]);
  const isFlushingPendingRef = useRef(false);

  /**
   * The earliest createdAt timestamp we've loaded so far.
   * Used as `before` cursor for the next page request.
   */
  const oldestCreatedAtRef = useRef<number | null>(null);


  const canRun = useMemo(() => !!myUserId && !!peerUserId, [myUserId, peerUserId]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const markResetRequiredRef = useRef<(reason: string, code?: ProtocolErrorCode | null) => void>(() => {});
  const markIdentityChangedRef = useRef<(reason: string, code?: ProtocolErrorCode | null) => void>(() => {});
  const markDegradedRef = useRef<(reason: string, code: ProtocolErrorCode) => void>(() => {});
  const sessionHealthRef = useRef<SessionHealth>({ status: 'healthy' });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionHealthRef.current = sessionHealth;
  }, [sessionHealth]);

  const mergePendingMessages = useCallback((items: PendingMessageRecord[]) => {
    setMessages((prev) => {
      let next = prev;

      for (const item of items) {
        next = upsertMessage(next, {
          id: item.clientMessageId,
          clientMessageId: item.clientMessageId,
          text: item.text,
          mine: true,
          createdAt: item.createdAt,
          replyTo: item.replyTo ?? null,
          status: 'failed',
          deliveredAt: null,
          readAt: null,
        });
      }

      return next;
    });
  }, []);

  const loadPendingForCurrentPeer = useCallback(async () => {
    if (!myUserId) return;

    const pending = await listPendingMessages(String(myUserId));
    mergePendingMessages(pending.filter((item) => item.toUserId === peerUserId));
  }, [mergePendingMessages, myUserId, peerUserId]);

  // ---------------------------------------------------------------------------
  // Initial + paginated history load
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  const sendAttempt = useCallback(async (params: {
    text: string;
    clientMessageId: string;
    createdAt: number;
    replyTo?: ReplyReference | null;
  }) => {
    const trimmed = params.text.trim();
    if (!trimmed || !myUserId) return;

    const existingPending = (await listPendingMessages(String(myUserId))).find(
      (item) => item.clientMessageId === params.clientMessageId
    );

    await upsertPendingMessage(String(myUserId), {
      clientMessageId: params.clientMessageId,
      toUserId: peerUserId,
      text: trimmed,
      createdAt: params.createdAt,
      replyTo: params.replyTo ?? null,
      attempts: existingPending?.attempts ?? 0,
      lastErrorCode: existingPending?.lastErrorCode ?? null,
    });

    setMessages((prev) =>
      upsertMessage(prev, {
        id: params.clientMessageId,
        clientMessageId: params.clientMessageId,
        text: trimmed,
        mine: true,
        createdAt: params.createdAt,
        replyTo: params.replyTo ?? null,
        status: 'sending',
        deliveredAt: null,
        readAt: null,
      })
    );
    await upsertStoredMessage({
      myUserId: String(myUserId),
      peerUserId,
      message: { id: params.clientMessageId, clientMessageId: params.clientMessageId, serverMessageId: null, direction: 'out', text: trimmed, createdAt: params.createdAt, seq: null, status: 'sending', deliveredAt: null, readAt: null, replyTo: params.replyTo ?? null },
    });

    try {
      const r = await sendAuto({
        toUserId: peerUserId,
        plaintext: trimmed,
        clientMessageId: params.clientMessageId,
        replyTo: params.replyTo ?? null,
      });

      await removePendingMessage(String(myUserId), params.clientMessageId);

      setMessages((prev) =>
        upsertMessage(prev, {
          id: r.serverMessageId,
          serverMessageId: r.serverMessageId,
          clientMessageId: params.clientMessageId,
          seq: r.seq,
          text: trimmed,
          mine: true,
          createdAt: params.createdAt,
          replyTo: params.replyTo ?? null,
          status: 'sent',
          deliveredAt: null,
          readAt: null,
        })
      );
      await upsertStoredMessage({
        myUserId: String(myUserId),
        peerUserId,
        message: { id: params.clientMessageId, clientMessageId: params.clientMessageId, serverMessageId: r.serverMessageId, direction: 'out', text: trimmed, createdAt: params.createdAt, seq: r.seq, status: 'sent', deliveredAt: null, readAt: null, replyTo: params.replyTo ?? null },
      });
    } catch (e) {
      console.warn('Send failed:', e);
      if (protocolErrorCode(e) === 'IDENTITY_MISMATCH') {
        markIdentityChangedRef.current('peer identity does not match the pinned identity', 'IDENTITY_MISMATCH');
      }

      const currentPending = (await listPendingMessages(String(myUserId))).find(
        (item) => item.clientMessageId === params.clientMessageId
      );

      await upsertPendingMessage(String(myUserId), {
        clientMessageId: params.clientMessageId,
        toUserId: peerUserId,
        text: trimmed,
        createdAt: params.createdAt,
        replyTo: params.replyTo ?? null,
        attempts: (currentPending?.attempts ?? 0) + 1,
        lastErrorCode: classifyPendingMessageError(e),
      });

      setMessages((prev) =>
        upsertMessage(prev, {
          id: params.clientMessageId,
          clientMessageId: params.clientMessageId,
          text: trimmed,
          mine: true,
          createdAt: params.createdAt,
          replyTo: params.replyTo ?? null,
          status: 'failed',
        })
      );
      await upsertStoredMessage({
        myUserId: String(myUserId),
        peerUserId,
        message: { id: params.clientMessageId, clientMessageId: params.clientMessageId, serverMessageId: null, direction: 'out', text: trimmed, createdAt: params.createdAt, seq: null, status: 'failed', deliveredAt: null, readAt: null, replyTo: params.replyTo ?? null },
      });
    }
  }, [myUserId, peerUserId]);


  const flushPendingForCurrentPeer = useCallback(async () => {
    if (!myUserId || isFlushingPendingRef.current) return;

    isFlushingPendingRef.current = true;
    try {
      const pending = await listPendingMessages(String(myUserId));
      const currentPeerPending = pending.filter((item) => item.toUserId === peerUserId);

      for (const item of currentPeerPending) {
        await sendAttempt({
          text: item.text,
          clientMessageId: item.clientMessageId,
          createdAt: item.createdAt,
          replyTo: item.replyTo ?? null,
        });
      }
    } finally {
      isFlushingPendingRef.current = false;
    }
  }, [myUserId, peerUserId, sendAttempt]);






  useEffect(() => {
    if (!canRun) return;

    let cancelled = false;

    const markResetRequired = (reason: string, code: ProtocolErrorCode | null = null) => {
      if (cancelled) return;
      setSessionHealth((prev) =>
        prev.status === 'reset_required' || prev.status === 'identity_changed' ? prev : { status: 'reset_required', reason, code }
      );
    };
    markResetRequiredRef.current = markResetRequired;

    const markIdentityChanged = (reason: string, code: ProtocolErrorCode | null = 'IDENTITY_MISMATCH') => {
      if (cancelled) return;
      setSessionHealth((prev) => (prev.status === 'identity_changed' ? prev : { status: 'identity_changed', reason, code }));
    };
    markIdentityChangedRef.current = markIdentityChanged;

    // T4.8: a decrypt failure that does not break the session is shown, not swallowed.
    const markDegraded = (reason: string, code: ProtocolErrorCode) => {
      if (cancelled) return;
      setSessionHealth((prev) => (prev.status === 'healthy' || prev.status === 'degraded' ? { status: 'degraded', reason, code } : prev));
    };
    markDegradedRef.current = markDegraded;

    setSessionHealth({ status: 'healthy' });
    oldestCreatedAtRef.current = null;
    loadPendingForCurrentPeer().catch((e) => {
      console.warn('Failed to load pending messages:', e);
    });

    // T7.3: the timer setting and a periodic sweep of expired records while the chat is open.
    const me = String(myUserId);
    loadConversationSettings(me, peerUserId).then((s) => {
      if (!cancelled) setTimerState(s);
    });
    const unsubTimer = subscribeToTimerChanges((e) => {
      if (!cancelled && e.myUserId === me && e.peerKey === peerUserId) setTimerState(e.settings);
    });
    const sweep = () => sweepExpiredMessages({ myUserId: me, peerKey: peerUserId }).catch((e) => console.warn('[disappearing] sweep failed:', e));
    const sweepInterval = setInterval(sweep, CHAT_SWEEP_INTERVAL_MS);

    // T7.2: reactions, edits and deletions change stored records; mirror them into the list.
    const unsubPatches = subscribeToMessagePatches((p) => {
      if (cancelled || p.myUserId !== String(myUserId) || p.peerKey !== peerUserId) return;
      setMessages((prev) => (p.message ? upsertMessage(prev, toUI(p.message)) : prev.filter((m) => m.id !== p.id && m.clientMessageId !== p.id)));
    });

    async function loadInitialHistory() {
      setHistoryLoading(true);
      try {
        await sweep(); // T7.3: never show what has already expired
        // T2.14: history lives on the device: the newest page from the store, then only what
        // the server still holds beyond it (the pre-T2.14 archive migration ended with wire v4).
        const page = await listStoredMessages({ myUserId: me, peerUserId, limit: PAGE_SIZE });
        if (!cancelled) {
          if (page.length > 0) oldestCreatedAtRef.current = page[0]!.createdAt;
          setHasMore(page.length === PAGE_SIZE);
          setMessages((prev) => prependMessages(prev, page.map(toUI)));
        }

        // T3.1: only what the server still holds (undelivered ciphertext, acked after storing) and
        // receipts for our own messages; delivered ciphertext no longer exists on the server.
        const sync = await syncNewerFromServer({
          myUserId: me,
          peerUserId,
          onIdentityChanged: markIdentityChanged,
          onResetRequired: markResetRequired,
          onDecryptFailure: markDegraded,
        });
        if (!cancelled && sync.received.length > 0) {
          if (oldestCreatedAtRef.current === null) oldestCreatedAtRef.current = sync.received[0]!.createdAt;
          setMessages((prev) => prependMessages(prev, sync.received.map(toUI)));
        }
        if (!cancelled && sync.updated.length > 0) {
          setMessages((prev) => sync.updated.reduce((acc, m) => upsertMessage(acc, toUI(m)), prev));
        }
      } catch (e) {
        console.warn('Failed to load initial history:', e);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    async function setupRealtime() {
      try {
        const unsubscribe = await subscribeToMessages(
          (m) => {
            const id = stableKey({
              serverMessageId: m.serverMessageId,
              clientMessageId: m.clientMessageId,
              createdAt: m.createdAt,
              fromUserId: m.fromUserId,
              text: m.text,
            });

            const incoming: UIMessage = {
              id,
              serverMessageId: m.serverMessageId || undefined,
              clientMessageId: m.clientMessageId || undefined,
              text: m.text,
              mine: false,
              createdAt: m.createdAt,
              seq: m.seq,
              replyTo: m.replyTo ?? null,
              status: m.status || 'sent',
              deliveredAt: m.deliveredAt || null,
              readAt: m.readAt || null,
              forwardedFrom: m.forwardedFrom ?? null,
            };
            setMessages((prev) => upsertMessage(prev, incoming));
            setSessionHealth((prev) => (prev.status === 'degraded' ? { status: 'healthy' } : prev)); // a good message clears a degraded state
            // T2.14: decrypted once, stored locally; the message key is gone.
            upsertStoredMessage({ myUserId: String(myUserId), peerUserId, message: toStored(incoming) }).catch((e) => {
              console.warn('Failed to store incoming message:', e);
            });
          },
          {
            peerUserId,
            onFailure: (reason, code) => {
              if (code === 'IDENTITY_MISMATCH') {
                markIdentityChangedRef.current(reason, code);
              } else if (isPolicyBrokenSessionReason(reason, code)) {
                markResetRequiredRef.current(reason, code);
              } else if (code && presentProtocolError(code).userMessage) {
                markDegradedRef.current(reason, code); // T4.8: the taxonomy decides what the user sees
              }
            },
          }
        );

        unsubRef.current = unsubscribe;
        if (!cancelled) setSocketReady(true);
        // T7.7: the peer gets our profile once per version, over this session.
        shareProfileWith(String(myUserId), peerUserId).catch((e) => console.warn('[profile] share failed:', e));
        flushPendingForCurrentPeer().catch((e) => {
          console.warn('Failed to flush pending messages:', e);
        });

        try {
          const socket = getSocket();
          const currentConversationId = makeConversationId(String(myUserId), peerUserId);

          const handleSocketConnect = () => {
            if (!cancelled) setSocketReady(true);
            flushPendingForCurrentPeer().catch((e) => {
              console.warn('Failed to flush pending messages after reconnect:', e);
            });
          };

          const handleSocketDisconnect = () => {
            if (!cancelled) setSocketReady(false);
          };

          const statusHandler = (evt: StatusChangedEvent) => {
            if (evt.conversationId !== currentConversationId) return;

            if (evt.status === 'delivered' && evt.serverMessageId) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.mine &&
                  msg.serverMessageId === evt.serverMessageId &&
                  msg.status !== 'read' &&
                  msg.status !== 'delivered'
                    ? {
                        ...msg,
                        status: 'delivered' as const,
                        deliveredAt: evt.deliveredAt ?? Date.now(),
                      }
                    : msg
                )
              );
            }
            if (evt.status === 'read') {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.mine && msg.status !== 'read'
                    ? { ...msg, status: 'read' as const, readAt: evt.readAt ?? Date.now() }
                    : msg
                )
              );
            }

            // T2.14: keep the stored copies in step with delivery/read state.
            const persistStatus = (m: UIMessage) => {
              upsertStoredMessage({ myUserId: String(myUserId), peerUserId, message: toStored(m) }).catch((e) => {
                console.warn('Failed to store message status:', e);
              });
            };
            for (const msg of messagesRef.current) {
              if (!msg.mine) continue;
              if (evt.status === 'delivered' && evt.serverMessageId && msg.serverMessageId === evt.serverMessageId && msg.status !== 'read' && msg.status !== 'delivered') {
                persistStatus({ ...msg, status: 'delivered', deliveredAt: evt.deliveredAt ?? Date.now() });
              } else if (evt.status === 'read' && msg.status !== 'read') {
                persistStatus({ ...msg, status: 'read', readAt: evt.readAt ?? Date.now() });
              }
            }
          };

          // T2.13: the server reports a peer's identity change; block until the user decides.
          const identityHandler = (evt: { userId?: string }) => {
            if (String(evt?.userId) === String(peerUserId)) {
              markIdentityChangedRef.current('the server reported that this contact\u2019s identity changed');
            }
          };

          // T7.6: the server tells every peer when an account is deleted.
          const deletedHandler = (evt: { userId?: string }) => {
            if (!cancelled && String(evt?.userId) === String(peerUserId)) setPeerDeleted(true);
          };

          socket.on('connect', handleSocketConnect);
          socket.on('disconnect', handleSocketDisconnect);
          socket.on('message:status-changed', statusHandler);
          socket.on('identity:changed', identityHandler);
          socket.on('user:deleted', deletedHandler);
          statusUnsubRef.current = () => {
            socket.off('connect', handleSocketConnect);
            socket.off('disconnect', handleSocketDisconnect);
            socket.off('message:status-changed', statusHandler);
            socket.off('identity:changed', identityHandler);
            socket.off('user:deleted', deletedHandler);
          };
        } catch (e) {
          console.warn('Failed to setup message:status-changed listener:', (e as any)?.message);
        }
      } catch (e) {
        console.warn('Failed to subscribe to messages:', e);
        if (!cancelled) setSocketReady(false);
      }
    }

    (async () => {
      await setupRealtime();
      await loadInitialHistory();
    })();

    return () => {
      cancelled = true;
      clearInterval(sweepInterval);
      unsubTimer();
      unsubPatches();
      unsubRef.current?.();
      unsubRef.current = null;
      statusUnsubRef.current?.();
      statusUnsubRef.current = null;
      setSocketReady(false);
      setHistoryLoading(true);
      setHasMore(false);
      setLoadingMore(false);
    };
  }, [canRun, peerUserId, myUserId, reloadToken, loadPendingForCurrentPeer, flushPendingForCurrentPeer]);

  // ---------------------------------------------------------------------------
  // Load older page (cursor-based, prepend)
  // ---------------------------------------------------------------------------

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || historyLoading || !myUserId) return;
    if (oldestCreatedAtRef.current === null) return;

    setLoadingMore(true);
    try {
      const page = await listStoredMessages({
        myUserId: String(myUserId),
        peerUserId,
        limit: PAGE_SIZE,
        before: oldestCreatedAtRef.current,
      });
      if (page.length === 0) {
        setHasMore(false);
        return;
      }
      oldestCreatedAtRef.current = page[0]!.createdAt;
      setHasMore(page.length === PAGE_SIZE);
      // Prepend without touching newer messages → no scroll jump for them
      setMessages((prev) => prependMessages(prev, page.map(toUI)));
    } catch (e) {
      console.warn('Failed to load older messages:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, historyLoading, myUserId, peerUserId]);

  

  

  async function send(text: string, options?: { replyTo?: ReplyReference | null }) {
    // Sending is blocked while the peer's identity is unverified (T2.13, §8.3).
    if (sessionHealthRef.current.status === 'identity_changed') return;
    await sendAttempt({
      text,
      clientMessageId: genId(),
      createdAt: Date.now(),
      replyTo: options?.replyTo ?? null,
    });
  }

  async function retryMessage(messageId: string) {
    const target = messagesRef.current.find(
      (message) => message.id === messageId && message.mine && message.status === 'failed'
    );

    if (!target || !target.clientMessageId) return;

    await sendAttempt({
      text: target.text,
      clientMessageId: target.clientMessageId,
      createdAt: target.createdAt,
      replyTo: target.replyTo ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Reset session
  // ---------------------------------------------------------------------------

  async function resetSession() {
    if (!myUserId) return;

    // T2.14: a reset touches the session and the outgoing queue, never the stored history.
    await deleteSession({ myUserId: String(myUserId), peerUserId });
    await removePendingMessagesForPair(String(myUserId), peerUserId);

    oldestCreatedAtRef.current = null;
    setSessionHealth({ status: 'healthy' });
    setReloadToken((x) => x + 1);
  }

  // ---------------------------------------------------------------------------
  // Accept a changed identity (T2.13): re-pin from the server, drop the
  // session, reload so the next message re-bootstraps on the new keys.
  // ---------------------------------------------------------------------------

  async function acceptNewIdentity() {
    if (!myUserId) return;
    await acceptNewIdentityForPair({ myUserId: String(myUserId), peerUserId });
    oldestCreatedAtRef.current = null;
    setSessionHealth({ status: 'healthy' });
    setReloadToken((x) => x + 1);
  }

  // T7.2: message actions (local-first, then over the session).
  const actionTarget: ConversationTarget = { kind: 'peer', peerUserId };
  async function react(message: UIMessage, emoji: string, remove = false) {
    if (!myUserId) return;
    await reactToMessage({ myUserId: String(myUserId), target: actionTarget, message: toStored(message), emoji, remove });
  }
  async function edit(message: UIMessage, text: string) {
    if (!myUserId) return;
    await editMessage({ myUserId: String(myUserId), target: actionTarget, message: toStored(message), text });
  }
  async function deleteEverywhere(message: UIMessage) {
    if (!myUserId) return;
    await deleteForEveryone({ myUserId: String(myUserId), target: actionTarget, message: toStored(message) });
  }
  async function deleteLocally(message: UIMessage) {
    if (!myUserId) return;
    await deleteForMe({ myUserId: String(myUserId), peerKey: peerUserId, message: toStored(message) });
  }
  async function setTimer(seconds: number | null) {
    if (!myUserId) return;
    await setDisappearingTimer({ myUserId: String(myUserId), target: actionTarget, seconds });
  }

  return {
    socketReady,
    historyLoading,
    loadingMore,
    hasMore,
    sessionHealth,
    messages,
    send,
    retryMessage,
    loadMore,
    resetSession,
    acceptNewIdentity,
    react,
    edit,
    deleteEverywhere,
    deleteLocally,
    timer,
    setTimer,
    peerDeleted,
  };
}
