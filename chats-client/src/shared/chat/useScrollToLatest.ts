import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { UIMessage } from './types';

const BOTTOM_OFFSET_THRESHOLD = 80;

/**
 * C1: the "new messages" pill of an inverted message list. A message of
 * our own, or a new one while we are near the bottom, scrolls the list;
 * otherwise the pill counts what arrived until the user scrolls down.
 */
export function useScrollToLatest<Item>({
  listRef,
  messages,
  historyLoading,
}: {
  listRef: RefObject<FlatList<Item> | null>;
  messages: UIMessage[];
  historyLoading: boolean;
}): {
  showScrollToBottom: boolean;
  pendingNewMessages: number;
  scrollToBottom: () => void;
  handleScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [pendingNewMessages, setPendingNewMessages] = useState(0);
  const isNearBottomRef = useRef(true);

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
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 60);
      setShowScrollToBottom(false);
      setPendingNewMessages(0);
      return;
    }

    setShowScrollToBottom(true);
    setPendingNewMessages((count) => count + Math.max(1, curr - prev));
  }, [messages.length, historyLoading, messages, listRef]);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    setPendingNewMessages(0);
  }, [listRef]);

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

  return { showScrollToBottom, pendingNewMessages, scrollToBottom, handleScroll };
}
