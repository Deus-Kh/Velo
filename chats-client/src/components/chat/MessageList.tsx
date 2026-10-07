import type { RefObject } from 'react';
import { ActivityIndicator, FlatList, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import AttachmentView from '../AttachmentView';
import { cachedMediaDataUri } from '../../shared/media/mediaStore';
import { isImage } from '../../shared/media/attachments';
import type { ViewerImage } from '../ImageViewer';
import MessageBubble from '../MessageBubble';
import SystemMessagePill from './SystemMessagePill';
import { summarizeReactions } from '../../shared/chat/actions';
import { isAudio } from '../../shared/media/attachments';
import { itemHoldsMessage, type MessageListItem } from '../../shared/chat/messageListItems';
import { albumStatus, mergeReactionSummaries } from '../../shared/media/albums';
import { photoMaxWidth } from '../../shared/media/photoFrame';
import PhotoAlbum, { albumFrame } from './PhotoAlbum';
import { resolveReplyPreview } from '../../shared/chat/replyPreview';
import type { UIMessage } from '../../shared/chat/types';

const messageListContentStyle = { paddingBottom: 20 };

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

function DaySeparator({ label }: { label: string }) {
  return (
    <View className="mb-3 items-center">
      <View className="rounded-full border border-border bg-surface/82 px-3 py-1.5">
        <Text className="text-xs font-medium text-muted">{label}</Text>
      </View>
    </View>
  );
}

/**
 * C1: the 1:1 chat's inverted message list: day separators, system lines
 * and bubbles with their reply quotes; older history loads at the top.
 */
export default function MessageList({
  listRef,
  items,
  messages,
  myUserId,
  conversationName,
  loadingMore,
  hasMore,
  onScroll,
  onEndReached,
  onOpenMessageActions,
  onSwipeReply,
  onOpenImage,
}: {
  listRef: RefObject<FlatList<MessageListItem> | null>;
  items: MessageListItem[];
  messages: UIMessage[];
  myUserId: string | null;
  conversationName: string;
  loadingMore: boolean;
  hasMore: boolean;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onEndReached: () => void;
  onOpenMessageActions: (message: UIMessage) => void;
  onSwipeReply: (message: UIMessage) => void;
  onOpenImage: (images: ViewerImage[], initialIndex: number) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const openImage = (uri: string) => {
    const images = messages.flatMap<ViewerImage>((message) => {
      if (!message.attachment || !isImage(message.attachment)) return [];
      const cached = cachedMediaDataUri(message.attachment.blobId);
      return cached ? [{ uri: cached, caption: message.text || undefined }] : [];
    });
    const currentIndex = images.findIndex((image) => image.uri === uri);
    onOpenImage(
      currentIndex >= 0 ? images : [{ uri }],
      currentIndex >= 0 ? currentIndex : 0,
    );
  };
  const scrollToMessageId = (targetMessageId: string | null) => {
    if (!targetMessageId) return;

    const targetIndex = items.findIndex((item) => itemHoldsMessage(item, targetMessageId));

    if (targetIndex < 0) return;

    listRef.current?.scrollToIndex({
      index: targetIndex,
      animated: true,
      viewPosition: 0.5,
    });
  };

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

  if (messages.length === 0) {
    return <EmptyChatState />;
  }

  return (
    <FlatList
      ref={listRef}
      inverted
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        if (item.type === 'separator') {
          return <DaySeparator label={item.label} />;
        }

        if (item.type === 'album') {
          // photos sent together: one bubble; each tile is still its own message
          const first = item.messages[0]!;
          const captioned = item.messages.find((m) => m.text) ?? null;
          const albumReply = resolveReplyPreview(first, messages, conversationName);
          return (
            <MessageBubble
              text={captioned?.text ?? ''}
              mine={first.mine}
              status={albumStatus(item.messages.map((m) => m.status))}
              timestamp={Math.max(...item.messages.map((m) => m.createdAt))}
              reactions={mergeReactionSummaries(item.messages.map((m) => summarizeReactions(m.reactions, String(myUserId ?? ''))))}
              edited={Boolean(captioned?.editedAt)}
              forwarded={Boolean(first.forwardedFrom)}
              attachment={
                myUserId ? (
                  <PhotoAlbum
                    myUserId={String(myUserId)}
                    photos={item.messages}
                    mine={first.mine}
                    width={photoMaxWidth(windowWidth)}
                    onOpen={openImage}
                    onLongPressPhoto={onOpenMessageActions}
                  />
                ) : undefined
              }
              mediaFrame={albumFrame(item.messages, photoMaxWidth(windowWidth))}
              replyPreview={albumReply}
              onReplyPreviewPress={albumReply?.targetMessageId ? () => scrollToMessageId(albumReply.targetMessageId) : undefined}
              onPress={() => onOpenMessageActions(captioned ?? first)}
              onSwipeReply={() => onSwipeReply(captioned ?? first)}
            />
          );
        }

        if (item.message.system) {
          return <SystemMessagePill text={item.message.text} />;
        }

        const replyPreview = resolveReplyPreview(item.message, messages, conversationName);

        return (
          <MessageBubble
            text={item.message.text}
            mine={item.message.mine}
            status={item.message.status}
            timestamp={item.message.createdAt}
            reactions={summarizeReactions(item.message.reactions, String(myUserId ?? ''))}
            edited={Boolean(item.message.editedAt)}
            deleted={Boolean(item.message.deletedAt)}
            forwarded={Boolean(item.message.forwardedFrom)}
            attachment={item.message.attachment && myUserId ? <AttachmentView myUserId={String(myUserId)} meta={item.message.attachment} mine={item.message.mine} onOpen={openImage} onLongPress={() => onOpenMessageActions(item.message)} /> : undefined}
            attachmentMetaInline={Boolean(item.message.attachment && isAudio(item.message.attachment))}
            photoSize={item.message.attachment && isImage(item.message.attachment) ? item.message.attachment : null}
            replyPreview={replyPreview}
            onReplyPreviewPress={
              replyPreview?.targetMessageId
                ? () => scrollToMessageId(replyPreview.targetMessageId)
                : undefined
            }
            onPress={() => onOpenMessageActions(item.message)}
            onSwipeReply={() => onSwipeReply(item.message)}
          />
        );
      }}
      contentContainerStyle={messageListContentStyle}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.3}
      ListFooterComponent={ListFooterComponent}
      removeClippedSubviews={false}
      maintainVisibleContentPosition={{
        minIndexForVisible: 0,
        autoscrollToTopThreshold: 10,
      }}
      onScrollToIndexFailed={(info) => {
        setTimeout(() => {
          listRef.current?.scrollToOffset({
            offset: Math.max(0, info.averageItemLength * info.index),
            animated: true,
          });
        }, 120);
      }}
      keyboardShouldPersistTaps="handled"
    />
  );
}
