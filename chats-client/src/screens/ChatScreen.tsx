import { useCallback, useEffect, useRef, useState } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  Text,
  TextInput,
  ToastAndroid,
  View,
  Keyboard,
  BackHandler 
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BottomSheetPanel from '../components/BottomSheetPanel';
import MessageBubble from '../components/MessageBubble';
import StatusChip from '../components/StatusChip';
import { conversationsApi } from '../shared/api/conversations.api';
import { messagesApi } from '../shared/api/messages.api';
import { useChatE2EE } from '../shared/chat/useChatE2EE';
import type { ReplyReference, UIMessage } from '../shared/chat/types';
import { getSocket } from '../shared/socket/socket';
import { useAppearanceStore } from '../store/appearance.store';
import { useAuthStore } from '../store/auth.store';
import { useKeyboard } from '@react-native-community/hooks'


const BOTTOM_OFFSET_THRESHOLD = 80;
const messageListContentStyle = { paddingBottom: 20 };

type MessageListItem =
  | { type: 'message'; id: string; message: UIMessage }
  | { type: 'separator'; id: string; label: string };

type SelectedMessageAction = {
  id: string;
  serverMessageId?: string;
  clientMessageId?: string;
  text: string;
  mine: boolean;
  status?: UIMessage['status'];
};

type HeaderPresenceMeta = {
  subtitle: string;
  pillLabel: string;
  pillTone: 'default' | 'warning' | 'offline';
};

type PresenceSnapshot = {
  online: boolean;
  lastSeenAt: number | null;
};

function formatDayLabel(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return date.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
  });
}

function buildMessageListItems(messages: UIMessage[]): MessageListItem[] {
  const items: MessageListItem[] = [];
  let previousDayKey: string | null = null;

  for (const message of messages) {
    const date = new Date(message.createdAt);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

    if (dayKey !== previousDayKey) {
      items.push({
        type: 'separator',
        id: `separator-${dayKey}`,
        label: formatDayLabel(message.createdAt),
      });
      previousDayKey = dayKey;
    }

    items.push({
      type: 'message',
      id: message.id,
      message,
    });
  }

  return items.reverse();
}

function EmptyChatState() {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      <View className="h-16 w-16 items-center justify-center rounded-full border border-border bg-surface-elevated">
        <View className="h-6 w-6 rounded-full bg-primary/30" />
      </View>
      <Text className="mt-5 text-center text-xl font-semibold text-text">
        Start a secure conversation
      </Text>
      <Text className="mt-2 text-center text-sm leading-6 text-muted">
        Messages are end-to-end encrypted and available only to participants in this chat.
      </Text>
    </View>
  );
}

function getHeaderPresenceMeta({
  peerTyping,
  peerPresence,
  socketReady,
  sessionHealth,
}: {
  peerTyping: boolean;
  peerPresence: PresenceSnapshot;
  socketReady: boolean;
  sessionHealth: { status: 'healthy' | 'reset_required' };
}): HeaderPresenceMeta {
  if (sessionHealth.status === 'reset_required') {
    return {
      subtitle: 'Secure session needs reset',
      pillLabel: 'Needs attention',
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

function formatLastSeen(lastSeenAt: number | null) {
  if (!lastSeenAt) {
    return 'last seen recently';
  }

  const diffMs = Date.now() - lastSeenAt;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return 'last seen just now';
  if (diffMinutes < 60) return `last seen ${diffMinutes}m ago`;

  const date = new Date(lastSeenAt);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return sameDay
    ? `last seen at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `last seen ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: HeaderPresenceMeta['pillTone'];
}) {
  return <StatusChip label={label} tone={tone === 'warning' ? 'warning' : tone === 'offline' ? 'neutral' : 'primary'} />;
}

function InlineChatNotice({
  title,
  body,
  tone,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  tone: 'warning' | 'info';
  actionLabel?: string;
  onAction?: () => void;
}) {
  const toneClasses =
    tone === 'warning'
      ? 'border-warning/40 bg-warning/10'
      : 'border-border bg-surface-elevated/88';
  const titleTone = tone === 'warning' ? 'text-warning' : 'text-text';

  return (
    <View className={`mx-3 mb-2 rounded-[20px] border px-4 py-3 ${toneClasses}`}>
      <Text className={`text-sm font-semibold ${titleTone}`}>{title}</Text>
      <Text className="mt-1 text-[13px] leading-5 text-muted">{body}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          className="mt-3 self-start rounded-full border border-border bg-background-alt/60 px-3.5 py-2 active:opacity-80"
        >
          <Text className="text-[13px] font-semibold text-text">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function buildReplySnippet(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 48) return normalized;
  return `${normalized.slice(0, 48)}...`;
}

function resolveReplyPreview(
  message: UIMessage,
  allMessages: UIMessage[],
  peerName: string,
): { title: string; text: string; targetMessageId: string | null } | null {
  if (!message.replyTo) return null;

  const match = allMessages.find(
    (item) =>
      (message.replyTo?.serverMessageId && item.serverMessageId === message.replyTo.serverMessageId) ||
      (message.replyTo?.clientMessageId && item.clientMessageId === message.replyTo.clientMessageId),
  );

  if (!match) {
    return {
      title: 'Original message',
      text: 'Message not available in the current loaded history.',
      targetMessageId: null,
    };
  }

  return {
    title: match.mine ? 'You' : peerName,
    text: buildReplySnippet(match.text),
    targetMessageId: match.id,
  };
}

function SendIcon({
  color,
}: {
  color: string;
}) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21.8 3.6L3.9 10.9C3.1 11.2 3.1 12.4 3.9 12.7L11.1 15.5L13.9 22.1C14.2 22.9 15.4 22.9 15.7 22.1L23 4.2C23.3 3.4 22.6 2.7 21.8 3.6Z"
        fill={color}
      />
      <Path
        d="M11 15.5L22.3 4.2"
        stroke="#04131E"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.18}
      />
    </Svg>
  );
}

export default function ChatScreen({
  peerUserId,
  peerUsername,
  onClose,
  onVerify,
}: {
  peerUserId: string;
  peerUsername?: string;
  onClose: () => void;
  onVerify: () => void;
}) {
  const myUserId = useAuthStore((s) => s.userId);
  const insets = useSafeAreaInsets();
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);
  
const { keyboardShown , keyboardHeight } = useKeyboard()

  const {
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
  } = useChatE2EE(peerUserId);

  const [text, setText] = useState('');
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [pendingNewMessages, setPendingNewMessages] = useState(0);
  const [showComposerActions, setShowComposerActions] = useState(false);
  const [selectedMessageAction, setSelectedMessageAction] = useState<SelectedMessageAction | null>(null);
  const [replyTarget, setReplyTarget] = useState<SelectedMessageAction | null>(null);
  const [peerPresence, setPeerPresence] = useState<PresenceSnapshot>({
    online: false,
    lastSeenAt: null,
  });
  const [peerTyping, setPeerTyping] = useState(false);
  const flatListRef = useRef<FlatList<MessageListItem>>(null);
  const composerInputRef = useRef<TextInput>(null);
  const isNearBottomRef = useRef(true);
  const typingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const typingIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedText = text.trim();
  const canSend = socketReady && trimmedText.length > 0;
  const conversationName = peerUsername ?? 'Secure chat';
  const messageListItems = buildMessageListItems(messages);
  const presenceMeta = getHeaderPresenceMeta({
    peerTyping,
    peerPresence,
    socketReady,
    sessionHealth,
  });
  const composerSurfaceClass =
    surfaceStyle === 'glass' ? 'bg-surface/84' : 'bg-surface-elevated';
  const composerButtonSizeClass =
    interfaceDensity === 'compact' ? 'h-11 w-11' : 'h-12 w-12';
  const composerPaddingTopClass =
    interfaceDensity === 'compact' ? 'pt-1.5' : 'pt-2';
  const composerInputMinHeightClass =
    interfaceDensity === 'compact' ? 'min-h-[40px] py-2.5' : 'min-h-[44px] py-3';
  const composerContainerMinHeightClass =
    interfaceDensity === 'compact' ? 'min-h-[44px]' : 'min-h-[48px]';
  const composerDisabledReason =
    sessionHealth.status === 'reset_required'
      ? 'Reset the secure session to send new messages.'
      : !socketReady
        ? 'Reconnect to send messages. Your draft stays here.'
        : null;

  const makeConversationId = (userA: string, userB: string) =>
    [userA, userB].sort().join(':');
  const conversationId = myUserId ? makeConversationId(myUserId, peerUserId) : null;

  useEffect(() => {
  return () => {
    Keyboard.dismiss();
  };
}, []);
const hasNavigationButtons = insets.bottom >= 40;
useEffect(() => {
  const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    onClose();
    return true; // true = событие обработано, не пропускать дальше
  });

  return () => subscription.remove();
}, [onClose]);
  useEffect(() => {
    if (!myUserId) return;

    conversationsApi.markAsRead(peerUserId).catch((e) => {
      console.warn('[ChatScreen] Failed to mark conversation as read:', e?.message || e);
    });

    const currentConversationId = makeConversationId(myUserId, peerUserId);
    messagesApi.markAsRead(currentConversationId).catch((e) => {
      console.warn('[ChatScreen] Failed to mark messages as read:', e?.message || e);
    });

    try {
      const socket = getSocket();
      socket.emit('message:read', { conversationId: currentConversationId });
    } catch (e) {
      console.warn('[ChatScreen] Socket not available for message:read:', (e as any)?.message);
    }
  }, [myUserId, peerUserId]);

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
      socket.emit('typing:stop', { toUserId: peerUserId, conversationId });
    };

    if (!trimmedText) {
      stopTyping();
      return;
    }

    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      socket.emit('typing:start', { toUserId: peerUserId, conversationId });
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
      socket.emit('typing:stop', { toUserId: peerUserId, conversationId });
    } catch {
      // ignore missing socket during unmount cleanup
    }
  }, [conversationId, peerUserId]);

  const prevLengthRef = useRef(messages.length);
  const prevNewestMessageRef = useRef<UIMessage | null>(
    messages[messages.length - 1] ?? null,
  );

  useEffect(() => {
    const prev = prevLengthRef.current;
    const curr = messages.length;
    const prevNewest = prevNewestMessageRef.current;
    const currNewest = curr > 0 ? messages[curr - 1] : null;

    prevLengthRef.current = curr;
    prevNewestMessageRef.current = currNewest;

    if (curr <= prev || historyLoading) return;

    const newestChanged =
      !currNewest ||
      !prevNewest ||
      currNewest.id !== prevNewest.id ||
      currNewest.createdAt !== prevNewest.createdAt;

    if (!newestChanged) return;

    const shouldAutoScroll = Boolean(currNewest?.mine) || isNearBottomRef.current;

    if (shouldAutoScroll) {
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 60);
      setShowScrollToBottom(false);
      setPendingNewMessages(0);
      return;
    }

    setShowScrollToBottom(true);
    setPendingNewMessages((count) => count + Math.max(1, curr - prev));
  }, [messages.length, historyLoading, messages]);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    setPendingNewMessages(0);
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      const nearBottom = offsetY <= BOTTOM_OFFSET_THRESHOLD;

      if (nearBottom === isNearBottomRef.current) return;

      isNearBottomRef.current = nearBottom;
      if (nearBottom) {
        setShowScrollToBottom(false);
        setPendingNewMessages(0);
      }
    },
    [],
  );

  const onSend = async () => {
    if (!trimmedText) return;
    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = null;
    }
    typingActiveRef.current = false;
    if (conversationId) {
      try {
        const socket = getSocket();
        socket.emit('typing:stop', { toUserId: peerUserId, conversationId });
      } catch {
        // ignore missing socket on send cleanup
      }
    }
    setText('');
    const replyTo: ReplyReference | null = replyTarget
      ? {
          serverMessageId: replyTarget.serverMessageId ?? null,
          clientMessageId: replyTarget.clientMessageId ?? null,
        }
      : null;
    setReplyTarget(null);
    await send(trimmedText, { replyTo });
  };

  const handleOpenComposerActions = useCallback(() => {
    setShowComposerActions(true);
  }, []);

  const handleCloseComposerActions = useCallback(() => {
    setShowComposerActions(false);
  }, []);

  const handleOpenMessageActions = useCallback((message: UIMessage) => {
    setSelectedMessageAction({
      id: message.id,
      serverMessageId: message.serverMessageId,
      clientMessageId: message.clientMessageId,
      text: message.text,
      mine: message.mine,
      status: message.status,
    });
  }, []);

  const handleCloseMessageActions = useCallback(() => {
    setSelectedMessageAction(null);
  }, []);

  const handleReplyToMessage = useCallback(() => {
    if (!selectedMessageAction) return;
    setReplyTarget(selectedMessageAction);
    setSelectedMessageAction(null);
    setTimeout(() => {
      composerInputRef.current?.focus();
    }, 60);
  }, [selectedMessageAction]);

  const handleReplyToSpecificMessage = useCallback(
    (message: UIMessage) => {
      setReplyTarget({
        id: message.id,
        serverMessageId: message.serverMessageId,
        clientMessageId: message.clientMessageId,
        text: message.text,
        mine: message.mine,
        status: message.status,
      });
      setSelectedMessageAction(null);
      setTimeout(() => {
        composerInputRef.current?.focus();
      }, 60);
    },
    [],
  );
  useEffect(() => {
  if (keyboardShown) {
    console.log('[keyboard] keyboardHeight:', keyboardHeight);
    console.log('[keyboard] insets.bottom:', insets.bottom);
    console.log('[keyboard] diff:', keyboardHeight - insets.bottom);
  }
}, [keyboardShown, keyboardHeight, insets.bottom]);
  const handleCopySelectedMessage = useCallback(() => {
    if (!selectedMessageAction?.text) return;

    Clipboard.setString(selectedMessageAction.text);
    setSelectedMessageAction(null);

    if (Platform.OS === 'android') {
      ToastAndroid.show('Message copied', ToastAndroid.SHORT);
    }
  }, [selectedMessageAction]);

  const handleEndReached = useCallback(() => {
    if (hasMore && !loadingMore && !historyLoading) {
      loadMore();
    }
  }, [hasMore, loadingMore, historyLoading, loadMore]);

  const handleScrollToMessageId = useCallback(
    (targetMessageId: string | null) => {
      if (!targetMessageId) return;

      const targetIndex = messageListItems.findIndex(
        (item) => item.type === 'message' && item.message.id === targetMessageId,
      );

      if (targetIndex < 0) return;

      flatListRef.current?.scrollToIndex({
        index: targetIndex,
        animated: true,
        viewPosition: 0.5,
      });
    },
    [messageListItems],
  );

  const ListFooterComponent = loadingMore ? (
    <View className="items-center py-3">
      <ActivityIndicator size="small" color="#94A3B8" />
      <Text className="mt-2 text-xs text-muted">Loading older messages...</Text>
    </View>
  ) : hasMore ? (
    <View className="items-center py-2">
      <Text className="text-xs text-muted">Scroll up for older encrypted messages</Text>
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      // behavior={keyboardShown ? 'height' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <View className="px-4" style={{ paddingTop: insets.top + 6}}>
        <View
          className={`rounded-[22px] border border-border px-4 ${
            interfaceDensity === 'compact' ? 'py-2.5' : 'py-3'
          } ${surfaceStyle === 'glass' ? 'bg-surface/88' : 'bg-surface-elevated'}`}
        >
          <View className="flex-row items-center">
            <Pressable
              onPress={onClose}
              className={`mr-3 items-center justify-center rounded-full border border-border active:opacity-80 ${
                interfaceDensity === 'compact' ? 'h-9 w-9' : 'h-10 w-10'
              } ${surfaceStyle === 'glass' ? 'bg-background-alt/60' : 'bg-background-alt'}`}
            >
              <Text className="text-2xl leading-none text-text">{'\u2039'}</Text>
            </Pressable>

            <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
              <Text className="text-base font-semibold text-primary">
                {conversationName.slice(0, 1).toUpperCase()}
              </Text>
            </View>

            <View className="flex-1 pr-2">
              <Text className="text-[20px] font-semibold text-text">{conversationName}</Text>
              <Text className="mt-1 text-sm leading-5 text-muted">{presenceMeta.subtitle}</Text>
              {presenceMeta.pillLabel ? (
                <View className="mt-2.5">
                  <StatusPill label={presenceMeta.pillLabel} tone={presenceMeta.pillTone} />
                </View>
              ) : null}
            </View>

            <Pressable
              onPress={onVerify}
              className={`rounded-full border border-border px-4 ${
                interfaceDensity === 'compact' ? 'py-1.5' : 'py-2'
              } active:opacity-80 ${
                surfaceStyle === 'glass' ? 'bg-background-alt/60' : 'bg-background-alt'
              }`}
            >
              <Text className="text-sm font-semibold text-text">Verify</Text>
            </Pressable>
          </View>

        </View>
      </View>

      {historyLoading ? (
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="small" color="#2DD4BF" />
          <Text className="mt-4 text-sm text-muted">Decrypting conversation history...</Text>
        </View>
      ) : (
        <View className="relative flex-1 px-3 pb-2 pt-2">
          {sessionHealth.status === 'reset_required' ? (
            <InlineChatNotice
              title="Secure session needs attention"
              body="This conversation cannot decrypt reliably until the secure session is reset."
              tone="warning"
              actionLabel="Reset secure session"
              onAction={resetSession}
            />
          ) : null}

          {!socketReady && sessionHealth.status !== 'reset_required' ? (
            <InlineChatNotice
              title="You are offline"
              body="You can keep reading this chat. New outgoing messages will resume after reconnect."
              tone="info"
            />
          ) : null}

          {messages.length === 0 ? (
            <EmptyChatState />
          ) : (
            <FlatList
              ref={flatListRef}
              inverted
              data={messageListItems}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                if (item.type === 'separator') {
                  return (
                    <View className="mb-3 items-center">
                      <View className="rounded-full border border-border bg-surface/82 px-3 py-1.5">
                        <Text className="text-xs font-medium text-muted">{item.label}</Text>
                      </View>
                    </View>
                  );
                }

                return (
                  (() => {
                    const replyPreview = resolveReplyPreview(item.message, messages, conversationName);

                    return (
                  <MessageBubble
                    text={item.message.text}
                    mine={item.message.mine}
                    status={item.message.status}
                    timestamp={item.message.createdAt}
                    replyPreview={replyPreview}
                    onReplyPreviewPress={
                      replyPreview?.targetMessageId
                        ? () => handleScrollToMessageId(replyPreview.targetMessageId)
                        : undefined
                    }
                    onPress={() => handleOpenMessageActions(item.message)}
                    onSwipeReply={() => handleReplyToSpecificMessage(item.message)}
                  />
                    );
                  })()
                );
              }}
              contentContainerStyle={messageListContentStyle}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.3}
              ListFooterComponent={ListFooterComponent}
              removeClippedSubviews={false}
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 10,
              }}
              onScrollToIndexFailed={(info) => {
                setTimeout(() => {
                  flatListRef.current?.scrollToOffset({
                    offset: Math.max(0, info.averageItemLength * info.index),
                    animated: true,
                  });
                }, 120);
              }}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {showScrollToBottom ? (
            <Pressable
              onPress={scrollToBottom}
              className="absolute bottom-3 self-center rounded-full border border-border bg-surface-elevated/92 px-4 py-3 active:opacity-80"
            >
              <Text className="text-sm font-medium text-text">
                {pendingNewMessages > 0
                  ? `${pendingNewMessages} new message${pendingNewMessages > 1 ? 's' : ''}`
                  : 'New messages'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {showComposerActions ? (
        <BottomSheetPanel title="Chat Actions" onClose={handleCloseComposerActions}>
          <Pressable
            onPress={() => {
              handleCloseComposerActions();
              onVerify();
            }}
            className="rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text className="text-[15px] font-medium text-text">Verify contact</Text>
            <Text className="mt-1 text-[13px] leading-5 text-muted">
              Review identity fingerprints and trust this contact on this device.
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              handleCloseComposerActions();
              scrollToBottom();
            }}
            className="rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text className="text-[15px] font-medium text-text">Jump to latest</Text>
            <Text className="mt-1 text-[13px] leading-5 text-muted">
              Scroll to the newest message in this conversation.
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              handleCloseComposerActions();
              if (sessionHealth.status === 'reset_required') {
                resetSession();
              }
            }}
            className="rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text
              className={`text-[15px] font-medium ${
                sessionHealth.status === 'reset_required' ? 'text-warning' : 'text-text'
              }`}
            >
              Reset secure session
            </Text>
            <Text className="mt-1 text-[13px] leading-5 text-muted">
              Rebuild the encrypted session if this conversation stops decrypting reliably.
            </Text>
          </Pressable>
        </BottomSheetPanel>
      ) : null}

      {selectedMessageAction ? (
        <BottomSheetPanel title="Message Actions" onClose={handleCloseMessageActions}>
          <View className="rounded-[18px] bg-background-alt/55 px-3 py-3">
            <Text className="text-[13px] leading-5 text-muted">
              {buildReplySnippet(selectedMessageAction.text)}
            </Text>
          </View>

          <Pressable
            onPress={handleReplyToMessage}
            className="mt-2 rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text className="text-[15px] font-medium text-text">Reply</Text>
            <Text className="mt-1 text-[13px] leading-5 text-muted">
              Quote this message in your next outgoing reply.
            </Text>
          </Pressable>

          <Pressable
            onPress={handleCopySelectedMessage}
            className="rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text className="text-[15px] font-medium text-text">Copy</Text>
            <Text className="mt-1 text-[13px] leading-5 text-muted">
              Copy this message text to your clipboard.
            </Text>
          </Pressable>

          {selectedMessageAction.mine && selectedMessageAction.status === 'failed' ? (
            <Pressable
              onPress={() => {
                handleCloseMessageActions();
                retryMessage(selectedMessageAction.id);
              }}
              className="rounded-[18px] px-3 py-3 active:opacity-80"
            >
              <Text className="text-[15px] font-medium text-warning">Retry send</Text>
              <Text className="mt-1 text-[13px] leading-5 text-muted">
                Attempt to send this failed message again.
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={handleCloseMessageActions}
            className="rounded-[18px] px-3 py-3 active:opacity-80"
          >
            <Text className="text-[15px] font-medium text-text">Cancel</Text>
          </Pressable>
        </BottomSheetPanel>
      ) : null}

      <View className={`px-3 ${composerPaddingTopClass}`}
        style={{ paddingBottom: keyboardShown ?  hasNavigationButtons ? keyboardHeight+insets.bottom+5: insets.bottom +5: insets.bottom + 8}}
  //       style={{
  //   paddingBottom: Platform.OS === 'android'
  //     ? (keyboardShown ? keyboardHeight + 55 : insets.bottom )
  //     : (keyboardShown ? 8 : insets.bottom + 8),
  // }}
      >
        {replyTarget ? (
          <View
            className={`mb-2.5 rounded-[20px] border border-border px-4 py-3 ${
              surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
            }`}
          >
            <View className="flex-row items-start gap-3">
              <View className="mt-0.5 h-8 w-1 rounded-full bg-primary" />
              <View className="flex-1">
                <Text className="text-[12px] font-semibold uppercase tracking-[1px] text-primary">
                  Replying to {replyTarget.mine ? 'yourself' : conversationName}
                </Text>
                <Text className="mt-1 text-[13px] leading-5 text-muted">
                  {buildReplySnippet(replyTarget.text)}
                </Text>
              </View>
              <Pressable
                onPress={() => setReplyTarget(null)}
                className="h-8 w-8 items-center justify-center rounded-full bg-background-alt/60 active:opacity-80"
              >
                <Text className="text-lg leading-none text-text">×</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {composerDisabledReason ? (
          <Text className="mb-2 px-1 text-[12px] leading-5 text-muted">
            {composerDisabledReason}
          </Text>
        ) : null}

        <View className="flex-row items-center gap-2.5">
          <Pressable
            onPress={handleOpenComposerActions}
            className={`${composerButtonSizeClass} items-center justify-center rounded-full border border-border ${composerSurfaceClass} active:opacity-80`}
          >
            <Text className="text-[24px] leading-none text-text">+</Text>
          </Pressable>

          <View
            className={`flex-1 rounded-[24px] border border-border bg-surface-elevated px-4 ${composerContainerMinHeightClass} ${
              interfaceDensity === 'compact' ? 'py-0.5' : 'py-1'
            }`}
          >
            <TextInput
              ref={composerInputRef}
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor="#94A3B8"
              selectionColor="#2DD4BF"
              cursorColor="#2DD4BF"
              underlineColorAndroid="transparent"
              className={`max-h-32 text-[15px] leading-6 text-text ${composerInputMinHeightClass}`}
              returnKeyType="send"
              onSubmitEditing={onSend}
              editable={socketReady}
              multiline
              maxLength={4000}
              textAlignVertical="top"
            />
          </View>

          <Pressable
            onPress={onSend}
            disabled={!canSend}
            className={`${composerButtonSizeClass} items-center justify-center rounded-full ${
              canSend ? 'bg-primary' : `border border-border ${composerSurfaceClass}`
            } active:opacity-80`}
          >
            <SendIcon color={canSend ? '#04131E' : '#94A3B8'} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
