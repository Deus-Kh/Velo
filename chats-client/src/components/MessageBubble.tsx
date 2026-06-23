import { Pressable, Text, View } from 'react-native';
import { useRef } from 'react';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | undefined;

function getStatusGlyph(status: MessageStatus) {
  switch (status) {
    case 'sending':
      return '...';
    case 'sent':
      return '\u2713';
    case 'delivered':
      return '\u2713\u2713';
    case 'read':
      return '\u2713\u2713';
    case 'failed':
      return '!';
    default:
      return null;
  }
}

function getStatusColor(status: MessageStatus, mine: boolean) {
  switch (status) {
    case 'sending':
      return mine ? 'rgba(255,255,255,0.92)' : '#F59E0B';
    case 'delivered':
      return mine ? 'rgba(255,255,255,0.92)' : '#2DD4BF';
    case 'read':
      return mine ? 'rgba(255,255,255,0.92)' : '#22C55E';
    case 'failed':
      return '#F87171';
    case 'sent':
    default:
      return mine ? 'rgba(255,255,255,0.92)' : '#94A3B8';
  }
}

function formatMessageTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MessageBubble({
  text,
  mine,
  status,
  timestamp,
  replyPreview,
  onReplyPreviewPress,
  onPress,
  onSwipeReply,
}: {
  text: string;
  mine: boolean;
  status: MessageStatus;
  timestamp: number;
  replyPreview?: {
    title: string;
    text: string;
  } | null;
  onReplyPreviewPress?: (() => void) | undefined;
  onPress?: (() => void) | undefined;
  onSwipeReply?: (() => void) | undefined;
}) {
  const statusGlyph = getStatusGlyph(status);
  const timeLabel = formatMessageTime(timestamp);
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const bubbleTone = mine ? 'bg-primary' : 'bg-surface-elevated';
  const footerTextTone = mine ? 'text-background/65' : 'text-muted';
  const statusColor = getStatusColor(status, mine);
  const showMeta = Boolean(timeLabel) || Boolean(statusGlyph);
  const messageTextTone = mine ? 'text-background' : 'text-text';
  const compactMeta =
    showMeta &&
    !replyPreview &&
    !text.includes('\n') &&
    text.trim().length <= 24;
  const replyPreviewSurfaceClass = mine ? 'bg-[#0A6F80]' : 'bg-surface';
  const replyPreviewAccentClass = mine ? 'bg-white/75' : 'bg-primary';
  const replyPreviewTitleTone = mine ? 'text-white' : 'text-primary';
  const replyPreviewTextTone = mine ? 'text-white/82' : 'text-muted';
  const replySwipeTriggeredRef = useRef(false);

  const metaNode = showMeta ? (
    <View className="flex-row items-center">
      {timeLabel ? (
        <Text className={`text-[11px] ${footerTextTone}`}>
          {timeLabel}
        </Text>
      ) : null}

      {statusGlyph && mine ? (
        <Text
          className={`${timeLabel ? 'ml-1' : ''} text-[11px] font-semibold`}
          style={{ color: statusColor }}
        >
          {statusGlyph}
        </Text>
      ) : null}
    </View>
  ) : null;

  const ReplyPreviewContainer = onReplyPreviewPress ? Pressable : View;

  const replyPreviewNode = replyPreview ? (
    <ReplyPreviewContainer
      {...(onReplyPreviewPress
        ? {
            onPress: (event: any) => {
              event?.stopPropagation?.();
              onReplyPreviewPress();
            },
            disabled: !onReplyPreviewPress,
          }
        : {})}
      className={`mb-2 flex-row rounded-[14px] px-3 py-2.5 ${replyPreviewSurfaceClass} ${
        onReplyPreviewPress ? 'active:opacity-85' : ''
      }`}
    >
      <View className={`mr-2.5 w-1 rounded-full ${replyPreviewAccentClass}`} />
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className={`text-[11px] font-semibold ${replyPreviewTitleTone}`}
        >
          {replyPreview.title}
        </Text>
        <Text
          numberOfLines={2}
          className={`mt-1 text-[12px] leading-[18px] ${replyPreviewTextTone}`}
        >
          {replyPreview.text}
        </Text>
      </View>
    </ReplyPreviewContainer>
  ) : null;

  const bubbleContent = (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      className={`relative mb-1.5 max-w-[80%] rounded-[20px] px-4 py-2.5 ${
        mine ? 'self-end rounded-br-[8px] bg-primary' : 'self-start rounded-bl-[8px] bg-surface-elevated'
      } ${replyPreview ? 'min-w-[156px]' : ''} ${bubbleTone} ${onPress ? 'active:opacity-80' : ''}`}
    >
      {compactMeta ? (
        <View className="flex-row items-end">
          <View className="shrink">
            {replyPreviewNode}
            <Text className={`text-[15px] leading-[21px] ${messageTextTone}`}>
              {text}
            </Text>
          </View>
          <View className="ml-2 pb-0.5">
            {metaNode}
          </View>
        </View>
      ) : (
        <>
          {replyPreviewNode}
          <Text className={`text-[15px] leading-[21px] ${messageTextTone}`}>
            {text}
          </Text>

          {showMeta ? (
            <View className="mt-1 flex-row items-center self-end">
              {metaNode}
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );

  if (!onSwipeReply) {
    return bubbleContent;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      friction={1.25}
      overshootRight={false}
      overshootFriction={8}
      rightThreshold={22}
      animationOptions={{
        speed: 22,
        bounciness: 0,
      }}
      renderRightActions={() => (
        <View className="mb-1.5 w-[74px] items-center justify-center pr-2">
          <View className="rounded-full border border-primary/35 bg-surface-elevated px-3 py-2">
            <Text className="text-xs font-semibold text-primary">Reply</Text>
          </View>
        </View>
      )}
      onSwipeableOpenStartDrag={() => {
        replySwipeTriggeredRef.current = false;
      }}
      onSwipeableOpen={(direction) => {
        if (direction !== SwipeDirection.LEFT || replySwipeTriggeredRef.current) {
          return;
        }

        replySwipeTriggeredRef.current = true;
        onSwipeReply();
        swipeableRef.current?.close();
      }}
      onSwipeableClose={() => {
        replySwipeTriggeredRef.current = false;
      }}
    >
      {bubbleContent}
    </ReanimatedSwipeable>
  );
}
