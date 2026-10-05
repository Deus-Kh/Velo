import { useCallback, useEffect, useRef, useState } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  ToastAndroid,
  View,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import ForwardPicker from '../components/ForwardPicker';
import MessageActionsSheet from '../components/MessageActionsSheet';
import { forwardMessage } from '../shared/chat/actions';
import { formatTimer } from '../shared/chat/disappearing';
import TimerSheet from '../components/TimerSheet';
import ReportSheet from '../components/ReportSheet';
import { useBlocksStore } from '../store/blocks.store';
import { blockPeer, reportPeer, unblockPeer } from '../shared/chat/blocks';
import Avatar from '../components/Avatar';
import SearchInChatSheet from '../components/SearchInChatSheet';
import ImageViewer from '../components/ImageViewer';
import { pickImage, sendAttachmentMessage, uploadAttachment } from '../shared/media/attachments';
import { describeMessageForQuote } from '../shared/chat/describeMessage';
import { useLayeredBackHandler } from '../shared/ui/layeredBack';
import { prewarmSafetyNumber } from '../shared/chat/safetyNumber';
import { uploadVoiceNote, type Recording } from '../shared/media/voiceNotes';
import { useProfilesStore } from '../store/profiles.store';
import StatusChip from '../components/StatusChip';
import { toStored, useChatE2EE } from '../shared/chat/useChatE2EE';
import type { ReplyReference, UIMessage } from '../shared/chat/types';
import { useAuthStore } from '../store/auth.store';
import { describeSessionHealth } from '../shared/chat/sessionHealthPresentation';
import ChatHeader, { HeaderAction } from '../components/chat/ChatHeader';
import { Icon } from '../components/Icon';
import { useThemeColors } from '../theme/useThemeColors';
import PresencePill from '../components/chat/PresencePill';
import InlineChatNotice from '../components/chat/InlineChatNotice';
import MessageList from '../components/chat/MessageList';
import ChatActionsSheet from '../components/chat/ChatActionsSheet';
import AttachmentSheet from '../components/chat/AttachmentSheet';
import ChatComposer from '../components/chat/ChatComposer';
import type { UploadState } from '../components/chat/UploadProgressBar';
import { buildMessageListItems, type MessageListItem } from '../shared/chat/messageListItems';
import { getHeaderPresenceMeta } from '../shared/chat/presence';
import { usePeerPresence } from '../shared/chat/usePeerPresence';
import { useOutgoingTyping } from '../shared/chat/useOutgoingTyping';
import { useScrollToLatest } from '../shared/chat/useScrollToLatest';
import { useJumpToMessage } from '../shared/chat/useJumpToMessage';
import { makeConversationId, useMarkConversationRead } from '../shared/chat/useMarkConversationRead';
import { getTrustedIdentity } from '../shared/storage/trustedIdentities';

type SelectedMessageAction = {
  id: string;
  serverMessageId?: string;
  clientMessageId?: string;
  text: string;
  mine: boolean;
  status?: UIMessage['status'];
};

/**
 * One 1:1 conversation. The screen owns the chat state (`useChatE2EE`),
 * the open sheets and the composer draft; the header, the message list,
 * the actions sheet and the composer are components under
 * `components/chat`, and the presence, typing, scroll and jump logic are
 * hooks under `shared/chat` (C1).
 */
export default function ChatScreen({
  peerUserId,
  peerUsername,
  jumpToMessageId,
  onClose,
  onVerify,
}: {
  peerUserId: string;
  peerUsername?: string;
  /** T7.8: a message to scroll to once history is loaded (from search). */
  jumpToMessageId?: string;
  onClose: () => void;
  onVerify: () => void;
}) {
  const myUserId = useAuthStore((s) => s.userId);
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

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
    acceptNewIdentity,
    react,
    edit,
    deleteEverywhere,
    deleteLocally,
    timer,
    setTimer,
    peerDeleted,
  } = useChatE2EE(peerUserId);
  const [showTimerSheet, setShowTimerSheet] = useState(false);
  const [showReportSheet, setShowReportSheet] = useState(false);
  const [showSearchSheet, setShowSearchSheet] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [peerTrusted, setPeerTrusted] = useState(false);

  // A10: with a pinned contact, compute the safety number in the background now, so the
  // Verify screen opens with it ready instead of spending seconds of SHA-512 on first use.
  useEffect(() => {
    if (!myUserId) return;
    prewarmSafetyNumber({ myUserId: String(myUserId), peerUserId });
  }, [myUserId, peerUserId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!myUserId) {
        setPeerTrusted(false);
        return undefined;
      }
      getTrustedIdentity({ myUserId: String(myUserId), peerUserId })
        .then((identity) => {
          if (active) setPeerTrusted(Boolean(identity));
        })
        .catch((error) => {
          if (active) setPeerTrusted(false);
          console.warn('[ChatScreen] Failed to read trusted contact:', error);
        });
      return () => {
        active = false;
      };
    }, [myUserId, peerUserId]),
  );
  const [reportBusy, setReportBusy] = useState(false);
  const peerBlocked = useBlocksStore((s) => (myUserId ? s.blockedByUser[String(myUserId)] : undefined)?.includes(peerUserId) ?? false);

  const [text, setText] = useState('');
  const [editTarget, setEditTarget] = useState<UIMessage | null>(null);
  const [forwardTarget, setForwardTarget] = useState<UIMessage | null>(null);
  const [showComposerActions, setShowComposerActions] = useState(false);
  const [showChatActions, setShowChatActions] = useState(false);
  const [selectedMessageAction, setSelectedMessageAction] = useState<SelectedMessageAction | null>(null);
  const [replyTarget, setReplyTarget] = useState<SelectedMessageAction | null>(null);
  const flatListRef = useRef<FlatList<MessageListItem>>(null);
  const composerInputRef = useRef<TextInput>(null);

  const trimmedText = text.trim();
  const canSend = socketReady && trimmedText.length > 0 && !peerBlocked && !peerDeleted;
  const peerProfile = useProfilesStore((s) => s.byUser[peerUserId] ?? null);
  const conversationName = peerProfile?.name?.trim() || peerUsername || 'Secure chat';
  const messageListItems = buildMessageListItems(messages);
  const healthPresentation = describeSessionHealth(sessionHealth, conversationName);
  const composerDisabledReason =
    (peerDeleted ? 'This account was deleted. Your copy of the conversation stays on this device.' : null) ??
    (peerBlocked ? 'You blocked this contact. Unblock from the chat actions to send again.' : null) ??
    healthPresentation?.composerDisabledReason ??
    (!socketReady ? 'Reconnect to send messages. Your draft stays here.' : null);

  const conversationId = myUserId ? makeConversationId(myUserId, peerUserId) : null;

  useEffect(() => {
    return () => {
      Keyboard.dismiss();
    };
  }, []);
  // Back closes the topmost open layer first; the screen only when nothing is open (A7).
  // Bottom to top; the image viewer is a Modal and handles Back on its own.
  useLayeredBackHandler(
    [
      { open: Boolean(replyTarget), close: () => setReplyTarget(null) },
      {
        open: Boolean(editTarget),
        close: () => {
          setEditTarget(null);
          setText('');
        },
      },
      { open: showComposerActions, close: () => setShowComposerActions(false) },
      { open: showChatActions, close: () => setShowChatActions(false) },
      { open: showTimerSheet, close: () => setShowTimerSheet(false) },
      { open: showReportSheet, close: () => setShowReportSheet(false) },
      { open: showSearchSheet, close: () => setShowSearchSheet(false) },
      { open: Boolean(selectedMessageAction), close: () => setSelectedMessageAction(null) },
      { open: Boolean(forwardTarget), close: () => setForwardTarget(null) },
    ],
    onClose,
  );
  useMarkConversationRead({ myUserId, peerUserId });
  const { peerPresence, peerTyping } = usePeerPresence({ peerUserId, conversationId });
  const { stopTypingNow } = useOutgoingTyping({ conversationId, peerUserId, socketReady, trimmedText });
  const { showScrollToBottom, pendingNewMessages, scrollToBottom, handleScroll } = useScrollToLatest({
    listRef: flatListRef,
    messages,
    historyLoading,
  });

  const presenceMeta = getHeaderPresenceMeta({
    peerTyping,
    peerPresence,
    socketReady,
    sessionHealth,
  });
  const peerVerified = peerTrusted && sessionHealth.status !== 'identity_changed';

  const onSend = async () => {
    if (!trimmedText) return;
    if (editTarget) {
      const target = editTarget;
      setEditTarget(null);
      setText('');
      await edit(target, trimmedText);
      return;
    }
    stopTypingNow();
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

  // T8.3: pick a photo, strip its metadata, encrypt, upload, send; the caption is the composer text.
  const handleSendPhoto = useCallback(async () => {
    if (!myUserId || uploadState) return;
    try {
      const picked = await pickImage();
      if (!picked) return;
      setUploadState({ label: 'Encrypting photo…', progress: null });
      const caption = text.trim();
      const content = await uploadAttachment({
        myUserId: String(myUserId),
        bytes: picked.bytes,
        contentType: picked.contentType,
        width: picked.width,
        height: picked.height,
        name: picked.name,
        caption,
        onProgress: (loaded, total) => setUploadState({ label: 'Uploading encrypted photo…', progress: total > 0 ? loaded / total : null }),
      });
      setUploadState({ label: 'Sending…', progress: null });
      await sendAttachmentMessage({ myUserId: String(myUserId), target: { kind: 'peer', peerUserId }, content });
      if (caption) setText('');
    } catch (e: any) {
      console.warn('[ChatScreen] photo send failed:', e);
      if (Platform.OS === 'android') ToastAndroid.show(e?.message || 'Could not send the photo', ToastAndroid.SHORT);
    } finally {
      setUploadState(null);
    }
  }, [myUserId, peerUserId, text, uploadState]);

  // T8.4: a finished recording is encrypted, uploaded and sent like a photo.
  const handleVoiceNote = useCallback(
    async (recording: Recording) => {
      if (!myUserId) return;
      try {
        setUploadState({ label: 'Encrypting voice message…', progress: null });
        const content = await uploadVoiceNote({ myUserId: String(myUserId), recording, onProgress: (l, t) => setUploadState({ label: 'Uploading encrypted voice message…', progress: t > 0 ? l / t : null }) });
        setUploadState({ label: 'Sending…', progress: null });
        await sendAttachmentMessage({ myUserId: String(myUserId), target: { kind: 'peer', peerUserId }, content });
      } catch (e: any) {
        console.warn('[ChatScreen] voice note failed:', e);
        if (Platform.OS === 'android') ToastAndroid.show(e?.message || 'Could not send the voice message', ToastAndroid.SHORT);
      } finally {
        setUploadState(null);
      }
    },
    [myUserId, peerUserId],
  );

  const handleOpenComposerActions = useCallback(() => {
    setShowComposerActions(true);
  }, []);

  const handleCloseComposerActions = useCallback(() => {
    setShowComposerActions(false);
  }, []);
  const handleCloseChatActions = useCallback(() => {
    setShowChatActions(false);
  }, []);

  const handleToggleBlock = useCallback(() => {
    if (!myUserId) return;
    const action = peerBlocked ? unblockPeer(String(myUserId), peerUserId) : blockPeer(String(myUserId), peerUserId);
    action.catch((e) => console.warn('[ChatScreen] block change failed:', e));
  }, [myUserId, peerBlocked, peerUserId]);

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
  const handleCopySelectedMessage = useCallback(() => {
    if (!selectedMessageAction?.text) return;

    Clipboard.setString(selectedMessageAction.text);
    setSelectedMessageAction(null);

    if (Platform.OS === 'android') {
      ToastAndroid.show('Message copied', ToastAndroid.SHORT);
    }
  }, [selectedMessageAction]);

  const { jumpTo } = useJumpToMessage({
    initialMessageId: jumpToMessageId,
    listRef: flatListRef,
    items: messageListItems,
    historyLoading,
    hasMore,
    loadingMore,
    loadMore,
  });

  const handleEndReached = useCallback(() => {
    if (hasMore && !loadingMore && !historyLoading) {
      loadMore();
    }
  }, [hasMore, loadingMore, historyLoading, loadMore]);

  const showMic = trimmedText.length === 0 && socketReady && !peerBlocked && !peerDeleted && !editTarget;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <ChatHeader
        onClose={onClose}
        avatar={<Avatar name={conversationName} profile={peerProfile} size="md" className="mr-3" />}
        title={conversationName}
        titleAccessory={
          peerVerified ? (
            <View className="ml-1.5">
              <Icon lib="Ionicons" name="checkmark-circle" size={18} color={colors.primary} />
            </View>
          ) : null
        }
        subtitle={presenceMeta.subtitle}
        actions={
          <View className="flex-row items-center gap-2">
            {!peerVerified ? (
              <HeaderAction onPress={onVerify}>
                <Text className="text-sm font-semibold text-text">Verify</Text>
              </HeaderAction>
            ) : null}
            <HeaderAction onPress={() => setShowChatActions(true)} horizontalPadding="px-3">
              <Icon lib="Lucide" name="ellipsis-vertical" size={20} color={colors.text} />
            </HeaderAction>
          </View>
        }
      >
        {presenceMeta.pillLabel ? (
          <View className="mt-2.5">
            <PresencePill label={presenceMeta.pillLabel} tone={presenceMeta.pillTone} />
          </View>
        ) : null}
        {timer.timerSeconds ? (
          <View className="mt-2">
            <StatusChip tone="primary" icon="timer" label={`Disappear after ${formatTimer(timer.timerSeconds)}`} />
          </View>
        ) : null}
      </ChatHeader>

      {historyLoading ? (
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="small" color="#2DD4BF" />
          <Text className="mt-4 text-sm text-muted">Decrypting conversation history...</Text>
        </View>
      ) : (
        <View className="relative flex-1 px-3 pb-2 pt-2">
          {sessionHealth.status === 'identity_changed' ? (
            <InlineChatNotice
              title={`Safety number with ${conversationName} has changed`}
              body="This contact's identity keys changed — a reinstall or new device, or someone interfering. Compare safety numbers before continuing. Sending is blocked until you verify or accept the new identity."
              tone="danger"
              actionLabel="Verify"
              onAction={onVerify}
              secondaryActionLabel="Accept new identity"
              onSecondaryAction={acceptNewIdentity}
            />
          ) : null}

          {sessionHealth.status === 'reset_required' && healthPresentation ? (
            <InlineChatNotice
              title={healthPresentation.title}
              body={healthPresentation.body}
              tone={healthPresentation.tone}
              actionLabel="Reset secure session"
              onAction={resetSession}
            />
          ) : null}

          {sessionHealth.status === 'degraded' && healthPresentation ? (
            <InlineChatNotice
              title={healthPresentation.title}
              body={healthPresentation.body}
              tone={healthPresentation.tone}
              actionLabel={healthPresentation.action === 'reset' ? 'Reset secure session' : healthPresentation.action === 'verify' ? 'Verify' : undefined}
              onAction={healthPresentation.action === 'reset' ? resetSession : healthPresentation.action === 'verify' ? onVerify : undefined}
            />
          ) : null}

          {!socketReady && sessionHealth.status === 'healthy' ? (
            <InlineChatNotice
              title="You are offline"
              body="You can keep reading this chat. New outgoing messages will resume after reconnect."
              tone="info"
            />
          ) : null}

          <MessageList
            listRef={flatListRef}
            items={messageListItems}
            messages={messages}
            myUserId={myUserId}
            conversationName={conversationName}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onScroll={handleScroll}
            onEndReached={handleEndReached}
            onOpenMessageActions={handleOpenMessageActions}
            onSwipeReply={handleReplyToSpecificMessage}
            onOpenImage={setViewerUri}
          />

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
        <AttachmentSheet
          onClose={handleCloseComposerActions}
          onSendPhoto={handleSendPhoto}
        />
      ) : null}

      {showChatActions ? (
        <ChatActionsSheet
          peerBlocked={peerBlocked}
          verified={peerVerified}
          timerSeconds={timer.timerSeconds}
          sessionResetRequired={sessionHealth.status === 'reset_required'}
          onClose={handleCloseChatActions}
          onVerify={onVerify}
          onToggleBlock={handleToggleBlock}
          onReport={() => setShowReportSheet(true)}
          onJumpToLatest={scrollToBottom}
          onSendPhoto={handleSendPhoto}
          onSearch={() => setShowSearchSheet(true)}
          onTimer={() => setShowTimerSheet(true)}
          onResetSession={resetSession}
        />
      ) : null}

      {selectedMessageAction
        ? (() => {
            const full = messages.find((m) => m.id === selectedMessageAction.id) ?? null;
            return (
              <MessageActionsSheet
                snippet={describeMessageForQuote(full ?? selectedMessageAction)}
                mine={selectedMessageAction.mine}
                deleted={Boolean(full?.deletedAt)}
                failed={selectedMessageAction.status === 'failed'}
                myReaction={myUserId && full?.reactions ? full.reactions[String(myUserId)] ?? null : null}
                onReact={(emoji, remove) => {
                  handleCloseMessageActions();
                  if (full) react(full, emoji, remove).catch((e) => console.warn('[ChatScreen] reaction failed:', e));
                }}
                onReply={handleReplyToMessage}
                onCopy={handleCopySelectedMessage}
                onEdit={() => {
                  handleCloseMessageActions();
                  if (!full) return;
                  setReplyTarget(null);
                  setEditTarget(full);
                  setText(full.text);
                  setTimeout(() => composerInputRef.current?.focus(), 60);
                }}
                onForward={() => {
                  handleCloseMessageActions();
                  if (full) setForwardTarget(full);
                }}
                onDeleteForMe={() => {
                  handleCloseMessageActions();
                  if (full) deleteLocally(full).catch((e) => console.warn('[ChatScreen] delete failed:', e));
                }}
                onDeleteForEveryone={() => {
                  handleCloseMessageActions();
                  if (full) deleteEverywhere(full).catch((e) => console.warn('[ChatScreen] delete for everyone failed:', e));
                }}
                onRetry={() => {
                  handleCloseMessageActions();
                  retryMessage(selectedMessageAction.id);
                }}
                onClose={handleCloseMessageActions}
              />
            );
          })()
        : null}

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />

      {showSearchSheet && myUserId ? (
        <SearchInChatSheet
          myUserId={String(myUserId)}
          peerKey={peerUserId}
          senderName={(_userId, mine) => (mine ? 'You' : conversationName)}
          onClose={() => setShowSearchSheet(false)}
          onJump={(hit) => {
            setShowSearchSheet(false);
            jumpTo(hit.message.id);
          }}
        />
      ) : null}

      {showReportSheet ? (
        <ReportSheet
          name={conversationName}
          busy={reportBusy}
          onClose={() => setShowReportSheet(false)}
          onSubmit={(reason, excerpt) => {
            setReportBusy(true);
            reportPeer({ reportedUserId: peerUserId, reason, excerpt })
              .then(() => {
                setShowReportSheet(false);
                if (Platform.OS === 'android') ToastAndroid.show('Report sent', ToastAndroid.SHORT);
              })
              .catch((e) => console.warn('[ChatScreen] report failed:', e))
              .finally(() => setReportBusy(false));
          }}
        />
      ) : null}

      {showTimerSheet ? (
        <TimerSheet
          current={timer.timerSeconds}
          onClose={() => setShowTimerSheet(false)}
          onPick={(seconds) => {
            setShowTimerSheet(false);
            setTimer(seconds).catch((e) => console.warn('[ChatScreen] timer change failed:', e));
          }}
        />
      ) : null}

      {forwardTarget && myUserId ? (
        <ForwardPicker
          myUserId={String(myUserId)}
          excludePeerKey={peerUserId}
          onClose={() => setForwardTarget(null)}
          onPick={(target) => {
            const message = forwardTarget;
            setForwardTarget(null);
            forwardMessage({ myUserId: String(myUserId), fromPeerKey: peerUserId, message: toStored(message), to: target })
              .then(() => {
                if (Platform.OS === 'android') ToastAndroid.show('Forwarded', ToastAndroid.SHORT);
              })
              .catch((e) => console.warn('[ChatScreen] forward failed:', e));
          }}
        />
      ) : null}

      {/* A8: the search sheet replaces the composer while it is open (the sheet's own field takes the keyboard) */}
      {showSearchSheet ? null : (
        <ChatComposer
          inputRef={composerInputRef}
          text={text}
          onChangeText={setText}
          onSend={onSend}
          canSend={canSend}
          showMic={showMic}
          editable={socketReady}
          conversationName={conversationName}
          replyTarget={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
          editTarget={editTarget}
          onCancelEdit={() => {
            setEditTarget(null);
            setText('');
          }}
          uploadState={uploadState}
          disabledReason={composerDisabledReason}
          onOpenActions={handleOpenComposerActions}
          onRecorded={handleVoiceNote}
        />
      )}
    </KeyboardAvoidingView>
  );
}
