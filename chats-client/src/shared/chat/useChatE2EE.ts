

// useChatE2EE.ts
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import nacl from 'tweetnacl';
import { decodeBase64 } from 'tweetnacl-util';

import { subscribeToMessages } from '../socket/messaging';
import { sendAuto } from '../socket/sendAuto';
import { getSocket } from '../socket/socket';

import { messagesApi } from '../api/messages.api';
import { useAuthStore } from '../../store/auth.store';

import type { V2Encrypted } from '../crypto/messageV2';
import { utf8Decode } from '../crypto/utf8';
import { deleteV2MessageKeysForPair, getV2MessageKey } from '../storage/v2MessageKeyStore';
import {
  listPendingMessages,
  removePendingMessage,
  removePendingMessagesForPair,
  upsertPendingMessage,
  type PendingMessageErrorCode,
  type PendingMessageRecord,
} from '../storage/pendingMessageStore';

import { deleteSession, loadSession } from '../storage/sessionStore';
import type { RatchetSessionV2 } from '../crypto/sessionTypes';
import { decryptV2 } from '../crypto/messageV2';
import { ensureV2SessionFromIncoming } from '../crypto/sessionBootstrap';
import type { X3DHInitPacket } from '../crypto/x3dh';
import { makeConversationId } from '../utils/conversation';
import type { ReplyReference } from './types';

export type UIMessage = {
  id: string;
  serverMessageId?: string;
  clientMessageId?: string;
  text: string;
  mine: boolean;
  createdAt: number;
  replyTo?: ReplyReference | null;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
};

export type SessionHealth =
  | { status: 'healthy'; reason?: undefined }
  | { status: 'reset_required'; reason: string };

type HistoryItem = {
  serverMessageId?: string;
  _id?: string;
  id?: string;
  conversationId?: string;
  fromUserId: string;
  toUserId: string;
  protoVersion?: 2;
  v2?: V2Encrypted | null;
  initPacket?: X3DHInitPacket | null;
  replyTo?: ReplyReference | null;
  clientMessageId?: string | null;
  createdAt?: number;
  createdAtClient?: number;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  deliveredAt?: number | null;
  readAt?: number | null;
};

type StatusChangedEvent = {
  conversationId: string;
  status: 'delivered' | 'read';
  serverMessageId?: string;
  deliveredAt?: number | null;
  readAt?: number | null;
  readerUserId?: string;
  deliveredByUserId?: string;
};

function classifyPendingMessageError(error: unknown): PendingMessageErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (message.includes('Socket')) return 'socket_unavailable';
  if (message.includes('Missing v2 session and initPacket')) return 'missing_bootstrap';
  if (message.includes('No v2 session')) return 'no_session';
  if (message.includes('Decrypt')) return 'decrypt_failed';
  if (message.includes('storage')) return 'storage_corruption';
  if (message) return 'send_failed';
  return 'unknown';
}

// How many messages to fetch per page
const PAGE_SIZE = 30;

const genId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function normalizeB64(b64: string): string {
  let s = String(b64).replace(/ /g, '+').trim();
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad !== 0) s += '='.repeat(4 - pad);
  return s;
}

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
 * Merge `next` into `prev` list, deduplicating by serverMessageId, clientMessageId, then id.
 * Returns a new array sorted ascending by createdAt.
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
      return copy;
    }
  }

  const idx = prev.findIndex((x) => x.id === next.id);
  if (idx !== -1) {
    const copy = prev.slice();
    copy[idx] = { ...prev[idx], ...next };
    return copy;
  }

  // New message — insert sorted by createdAt
  const insertAt = prev.findIndex((x) => x.createdAt > next.createdAt);
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

function warnControlledHistoryFailure(
  reason: string,
  meta: { serverMessageId?: string; clientMessageId?: string; peerUserId: string }
) {
  console.warn(`History controlled failure: ${reason}`, meta);
}

function isPolicyBrokenSessionReason(reason: string): boolean {
  return (
    reason.includes('missing session and initPacket') ||
    reason.includes('Failed to establish v2 session from incoming initPacket')
  );
}

// ---------------------------------------------------------------------------

async function decryptHistoryBatch(
  rawItems: HistoryItem[],
  myUserId: string,
  peerUserId: string,
  v2SessionIn: RatchetSessionV2 | null,
  onSessionUpdated: (s: RatchetSessionV2) => void,
  onResetRequired: (reason: string) => void,
  options?: {
    mode?: 'live' | 'stored_keys_only';
  },
): Promise<UIMessage[]> {
  const mode = options?.mode ?? 'live';
  let v2Session = v2SessionIn;
  const mapped: UIMessage[] = [];

  for (const it of rawItems) {
    const mine = String(it.fromUserId) === String(myUserId);
    const serverMessageId = it.serverMessageId || it._id || it.id;
    const clientMessageId = it.clientMessageId ?? undefined;
    const createdAt = Number(it.createdAt ?? it.createdAtClient ?? Date.now());
    let text = '[Encrypted]';

    try {
      if (it.protoVersion !== 2) {
        text = '[Unsupported message]';
      } else {
        const header = it.v2?.header;

        if (
          !header ||
          typeof header.n !== 'number' ||
          typeof header.dhPub !== 'string' ||
          typeof it.v2?.nonce !== 'string' ||
          typeof it.v2?.ciphertext !== 'string'
        ) {
          text = '[Encrypted]';
        } else {
          const dhPub = normalizeB64(header.dhPub);
          const n = header.n;
          const nonceB64 = normalizeB64(it.v2.nonce);
          const cipherB64 = normalizeB64(it.v2.ciphertext);

          if (mode === 'live' && !mine && !v2Session && it.initPacket) {
            try {
              await ensureV2SessionFromIncoming({
                myUserId,
                peerUserId,
                initPacket: it.initPacket,
              });
              const createdSession = await loadSession({ myUserId, peerUserId });
              if (createdSession && createdSession.protoVersion === 2) {
                v2Session = createdSession as RatchetSessionV2;
              }
            } catch (e) {
              console.warn('Failed to bootstrap incoming v2 session from history:', e);
            }
          }

          if (mode === 'live' && !mine && v2Session) {
            try {
              const r = await decryptV2({
                myUserId,
                peerUserId,
                session: v2Session,
                encrypted: { header: { ...header, dhPub }, nonce: nonceB64, ciphertext: cipherB64 },
              });
              v2Session = r.updatedSession;
              onSessionUpdated(r.updatedSession);
              text = r.plaintext;
            } catch {
              const mkB64 = await getV2MessageKey({
                myUserId,
                peerUserId,
                direction: 'in',
                dhPub,
                n,
              });
              if (mkB64) {
                const mk = decodeBase64(normalizeB64(mkB64));
                const nonce = decodeBase64(nonceB64);
                const cipher = decodeBase64(cipherB64);
                const plain = nacl.secretbox.open(cipher, nonce, mk);
                text = plain ? utf8Decode(plain) : '[Decrypt failed]';
              } else {
                text = '[Encrypted]';
              }
            }
          } else if (mine || mode === 'stored_keys_only') {
            const direction = mine ? 'out' as const : 'in' as const;
            const mkB64 = await getV2MessageKey({
              myUserId,
              peerUserId,
              direction,
              dhPub,
              n,
            });
            if (mkB64) {
              const mk = decodeBase64(normalizeB64(mkB64));
              const nonce = decodeBase64(nonceB64);
              const cipher = decodeBase64(cipherB64);
              const plain = nacl.secretbox.open(cipher, nonce, mk);
              text = plain ? utf8Decode(plain) : '[Decrypt failed]';
            } else {
              text = '[Encrypted]';
            }
          } else {
            const reason = 'missing session and initPacket for inbound history item';
            if (mode === 'live') {
              warnControlledHistoryFailure(reason, {
                serverMessageId: serverMessageId ? String(serverMessageId) : undefined,
                clientMessageId: clientMessageId ? String(clientMessageId) : undefined,
                peerUserId,
              });
              onResetRequired(reason);
            }
            text = '[Encrypted]';
          }
        }
      }
    } catch (e) {
      console.warn('History decrypt failed:', { serverMessageId, e });
    }

    const id = stableKey({
      serverMessageId: serverMessageId ? String(serverMessageId) : undefined,
      clientMessageId: clientMessageId ? String(clientMessageId) : undefined,
      createdAt,
      fromUserId: it.fromUserId,
      text,
    });

    mapped.push({
      id,
      serverMessageId: serverMessageId ? String(serverMessageId) : undefined,
      clientMessageId: clientMessageId ? String(clientMessageId) : undefined,
      text,
      mine,
      createdAt,
      status: it.status || 'sent',
      replyTo: it.replyTo ?? null,
      deliveredAt: it.deliveredAt || null,
      readAt: it.readAt || null,
    });
  }

  return mapped;
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

  const unsubRef = useRef<null | (() => void)>(null);
  const statusUnsubRef = useRef<null | (() => void)>(null);
  const messagesRef = useRef<UIMessage[]>([]);
  const isFlushingPendingRef = useRef(false);

  /**
   * The earliest createdAt timestamp we've loaded so far.
   * Used as `before` cursor for the next page request.
   */
  const oldestCreatedAtRef = useRef<number | null>(null);

  /**
   * Cached v2 session shared across initial load and loadMore calls.
   * We keep it in a ref so we don't trigger re-renders when it advances.
   */
  const v2SessionRef = useRef<RatchetSessionV2 | null>(null);

  const canRun = useMemo(() => !!myUserId && !!peerUserId, [myUserId, peerUserId]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const markResetRequiredRef = useRef<(reason: string) => void>(() => {});

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
          text: trimmed,
          mine: true,
          createdAt: params.createdAt,
          replyTo: params.replyTo ?? null,
          status: 'sent',
          deliveredAt: null,
          readAt: null,
        })
      );
    } catch (e) {
      console.warn('Send failed:', e);

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

    const markResetRequired = (reason: string) => {
      if (cancelled) return;
      setSessionHealth((prev) =>
        prev.status === 'reset_required' ? prev : { status: 'reset_required', reason }
      );
    };
    markResetRequiredRef.current = markResetRequired;

    setSessionHealth({ status: 'healthy' });
    oldestCreatedAtRef.current = null;
    v2SessionRef.current = null;
    loadPendingForCurrentPeer().catch((e) => {
      console.warn('Failed to load pending messages:', e);
    });

    async function loadInitialHistory() {
      setHistoryLoading(true);
      try {
        const res = await messagesApi.getWithUser(peerUserId, { limit: PAGE_SIZE });
        const rawItems: HistoryItem[] = Array.isArray(res.data?.items) ? res.data.items : [];

        // Sort ascending so decryption ratchet advances correctly
        rawItems.sort((a, b) => {
          const ta = Number(a.createdAt ?? a.createdAtClient ?? 0);
          const tb = Number(b.createdAt ?? b.createdAtClient ?? 0);
          return ta - tb;
        });

        // Seed session from storage
        try {
          const s = await loadSession({ myUserId: String(myUserId), peerUserId });
          if (s && (s as any).protoVersion === 2) {
            v2SessionRef.current = s as RatchetSessionV2;
          }
        } catch {
          // ignore
        }

        const mapped = await decryptHistoryBatch(
          rawItems,
          String(myUserId),
          peerUserId,
          v2SessionRef.current,
          (updated) => { v2SessionRef.current = updated; },
          markResetRequired,
        );

        if (!cancelled) {
          // Track oldest timestamp for pagination cursor
          if (mapped.length > 0) {
            oldestCreatedAtRef.current = mapped[0].createdAt;
          }
          // We fetched exactly PAGE_SIZE — if so, there may be more
          setHasMore(rawItems.length === PAGE_SIZE);
          setMessages((prev) => prependMessages(prev, mapped));
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

            setMessages((prev) =>
              upsertMessage(prev, {
                id,
                serverMessageId: m.serverMessageId || undefined,
                clientMessageId: m.clientMessageId || undefined,
                text: m.text,
                mine: false,
                createdAt: m.createdAt,
                replyTo: m.replyTo ?? null,
                status: m.status || 'sent',
                deliveredAt: m.deliveredAt || null,
                readAt: m.readAt || null,
              })
            );
          },
          {
            peerUserId,
            onFailure: (reason) => {
              if (isPolicyBrokenSessionReason(reason)) {
                markResetRequiredRef.current(reason);
              }
            },
          }
        );

        unsubRef.current = unsubscribe;
        if (!cancelled) setSocketReady(true);
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
          };

          socket.on('connect', handleSocketConnect);
          socket.on('disconnect', handleSocketDisconnect);
          socket.on('message:status-changed', statusHandler);
          statusUnsubRef.current = () => {
            socket.off('connect', handleSocketConnect);
            socket.off('disconnect', handleSocketDisconnect);
            socket.off('message:status-changed', statusHandler);
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
      const res = await messagesApi.getWithUser(peerUserId, {
        limit: PAGE_SIZE,
        before: oldestCreatedAtRef.current,
      });
      const rawItems: HistoryItem[] = Array.isArray(res.data?.items) ? res.data.items : [];

      rawItems.sort((a, b) => {
        const ta = Number(a.createdAt ?? a.createdAtClient ?? 0);
        const tb = Number(b.createdAt ?? b.createdAtClient ?? 0);
        return ta - tb;
      });

      if (rawItems.length === 0) {
        setHasMore(false);
        return;
      }

      const mapped = await decryptHistoryBatch(
        rawItems,
        String(myUserId),
        peerUserId,
        null,
        () => {},
        markResetRequiredRef.current,
        { mode: 'stored_keys_only' },
      );

      if (mapped.length === 0) {
        setHasMore(false);
        return;
      }

      // Update cursor to the oldest message in this new batch
      oldestCreatedAtRef.current = mapped[0].createdAt;
      setHasMore(rawItems.length === PAGE_SIZE);

      // Prepend without touching newer messages → no scroll jump for them
      setMessages((prev) => prependMessages(prev, mapped));
    } catch (e) {
      console.warn('Failed to load older messages:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, historyLoading, myUserId, peerUserId]);

  

  

  async function send(text: string, options?: { replyTo?: ReplyReference | null }) {
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

    await deleteSession({ myUserId: String(myUserId), peerUserId });
    await deleteV2MessageKeysForPair({ myUserId: String(myUserId), peerUserId });
    await removePendingMessagesForPair(String(myUserId), peerUserId);

    v2SessionRef.current = null;
    oldestCreatedAtRef.current = null;
    setSessionHealth({ status: 'healthy' });
    setMessages([]);
    setReloadToken((x) => x + 1);
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
  };
}
