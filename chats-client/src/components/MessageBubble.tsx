import React, { useRef, isValidElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';
import { useAppearanceStore } from '../store/appearance.store';
import { densityTokens } from '../theme/density';
import type { LucideIconName } from '../shared/chat/describeMessage';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | undefined;

/** Delivery state as a Lucide icon (B14 adds the read colour): a clock while sending, one check sent, two delivered / read, an alert on failure. */
function statusIconName(status: MessageStatus): LucideIconName | null {
  switch (status) {
    case 'sending':
      return 'clock';
    case 'sent':
      return 'check';
    case 'delivered':
      return 'check-check';
    case 'read':
      return 'check-check';
    case 'failed':
      return 'circle-alert';
    default:
      return null;
  }
}

/** B3: the status icon takes the outgoing bubble's muted text colour; failure is the danger tone (B14 adds the read accent). */
function getStatusColor(status: MessageStatus, colors: { bubbleOutMuted: string; danger: string }) {
  return status === 'failed' ? colors.danger : colors.bubbleOutMuted;
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
  reactions,
  edited,
  deleted,
  forwarded,
  attachment,
  attachmentMetaInline,
}: {
  text: string;
  mine: boolean;
  status: MessageStatus;
  timestamp: number;
  /** T7.2 */
  reactions?: Array<{ emoji: string; count: number; mine: boolean }>;
  edited?: boolean;
  deleted?: boolean;
  forwarded?: boolean;
  /** T8.3: rendered above the text (the caption). */
  attachment?: React.ReactNode;
  /** T8.4: a voice note takes the time and status on its own last line instead of a row below. */
  attachmentMetaInline?: boolean;
  replyPreview?: {
    title: string;
    text: string;
    /** the quoted message's kind icon (mic, image, …), from describeMessage */
    icon?: LucideIconName | null;
  } | null;
  onReplyPreviewPress?: (() => void) | undefined;
  onPress?: (() => void) | undefined;
  onSwipeReply?: (() => void) | undefined;
}) {
  const colors = useThemeColors();
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const density = densityTokens(interfaceDensity);
  const statusIcon = statusIconName(status);
  const timeLabel = formatMessageTime(timestamp);
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  // B3: bubble tokens per theme (src/theme/theme.ts): outgoing is the accent at reduced saturation
  // with its own text pair, incoming the elevated surface with a hairline where the theme wants one
  const bubbleTone = mine ? 'bg-bubble-out' : 'border border-bubble-in-border bg-bubble-in';
  const footerTextTone = mine ? 'text-bubble-out-muted' : 'text-muted';
  const statusColor = getStatusColor(status, colors);
  const showMeta = Boolean(timeLabel) || Boolean(statusIcon);
  const messageTextTone = mine ? 'text-bubble-out-text' : 'text-text';
  const hasReactions = Boolean(reactions && reactions.length > 0);
  const compactMeta =
    showMeta &&
    !replyPreview &&
    !deleted &&
    !forwarded &&
    !hasReactions &&
    !attachment &&
    !text.includes('\n') &&
    text.trim().length <= 24;
  const replyPreviewSurfaceClass = mine ? 'bg-bubble-out-text/10' : 'bg-surface';
  const replyPreviewAccentClass = 'bg-primary';
  const replyPreviewTitleTone = 'text-primary';
  const replyPreviewTextTone = mine ? 'text-bubble-out-muted' : 'text-muted';
  const replySwipeTriggeredRef = useRef(false);
  const inlineMeta = Boolean(attachmentMetaInline && attachment && !text && !deleted && showMeta);

  const metaNode = showMeta ? (
    <View className="flex-row items-center">
      {edited && !deleted ? (
        <Text className={`mr-1 text-[11px] italic ${footerTextTone}`}>edited</Text>
      ) : null}
      {timeLabel ? (
        <Text className={`text-[11px] ${footerTextTone}`}>
          {timeLabel}
        </Text>
      ) : null}

      {statusIcon && mine ? (
        <View className={timeLabel ? 'ml-1' : ''}>
          <Icon lib="Lucide" name={statusIcon} size={13} color={statusColor} />
        </View>
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
      {/* shrink, not flex-1: with flexBasis 0 Yoga sizes this column at zero when the bubble
          measures its own width, so the bubble never grew for the quote and the text wrapped at
          render time below a one-line box; with flexBasis auto the quote widens the bubble (up to
          its 80 %) and, when it still has to wrap, is measured at the width it wraps in */}
      <View className="min-w-0 shrink">
        <Text
          numberOfLines={1}
          className={`text-[11px] font-semibold ${replyPreviewTitleTone}`}
        >
          {replyPreview.title}
        </Text>
        <View className="mt-1 flex-row items-center">
          {replyPreview.icon ? (
            <View className="mr-1.5">
              <Icon lib="Lucide" name={replyPreview.icon} size={13} color={mine ? colors.bubbleOutMuted : colors.muted} />
            </View>
          ) : null}
          <Text numberOfLines={2} className={`shrink text-[12px] leading-[18px] ${replyPreviewTextTone}`}>
            {replyPreview.text}
          </Text>
        </View>
      </View>
    </ReplyPreviewContainer>
  ) : null;

  const bubbleContent = (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      className={`relative mb-1.5 max-w-[80%] rounded-[20px] ${
        mine ? 'self-end rounded-br-[8px]' : 'self-start rounded-bl-[8px]'
      } ${replyPreview ? 'min-w-[156px]' : ''} ${bubbleTone} ${onPress ? 'active:opacity-80' : ''}`}
      style={{ paddingHorizontal: density.bubbleHorizontalPadding, paddingVertical: density.bubbleVerticalPadding }}
    >
      {compactMeta ? (
        <View className="flex-row items-end">
          <View className="shrink">
            {replyPreviewNode}
            <Text
              className={messageTextTone}
              style={{ fontSize: density.messageFontSize, lineHeight: density.messageLineHeight }}
            >
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
          {forwarded && !deleted ? (
            <View className="mb-0.5 flex-row items-center">
              <Icon lib="Lucide" name="corner-up-right" size={12} color={mine ? colors.bubbleOutMuted : colors.primary} />
              <Text className={`ml-1 text-[11px] font-semibold ${mine ? 'text-bubble-out-muted' : 'text-primary'}`}>Forwarded</Text>
            </View>
          ) : null}
          {!deleted && attachment ? (
            inlineMeta && isValidElement<{ trailing?: React.ReactNode }>(attachment) ? (
              // the voice note draws the time at the end of its duration line, so the waveform keeps the full width
              React.cloneElement(attachment, { trailing: metaNode })
            ) : (
              attachment
            )
          ) : null}
          {deleted ? (
            <Text className={`text-[15px] italic leading-[21px] ${mine ? 'text-bubble-out-muted' : 'text-muted'}`}>This message was deleted</Text>
          ) : text || !attachment ? (
            <Text
              className={messageTextTone}
              style={{ fontSize: density.messageFontSize, lineHeight: density.messageLineHeight }}
            >
              {text}
            </Text>
          ) : null}

          {showMeta && !inlineMeta ? (
            <View className="mt-1 flex-row items-center self-end">
              {metaNode}
            </View>
          ) : null}

          {hasReactions ? (
            <View className="mt-1.5 flex-row flex-wrap gap-1">
              {reactions!.map((r) => (
                <View
                  key={r.emoji}
                  className={`flex-row items-center rounded-full px-2 py-0.5 ${r.mine ? (mine ? 'bg-bubble-out-text/25' : 'bg-primary/20') : mine ? 'bg-bubble-out-text/12' : 'bg-text/10'}`}
                >
                  <Text className="text-[13px]">{r.emoji}</Text>
                  {r.count > 1 ? <Text className={`ml-1 text-[11px] font-semibold ${messageTextTone}`}>{r.count}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );

  if (!onSwipeReply || deleted) {
    return bubbleContent;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      // reply is a swipe to the left only; a swipe to the right belongs to the
      // chat's back gesture (MainTabsScreen), so the row must never claim it
      dragOffsetFromLeftEdge={10_000}
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
