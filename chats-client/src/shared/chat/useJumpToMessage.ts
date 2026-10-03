import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';
import type { MessageListItem } from './messageListItems';

/**
 * T7.8 / C1: jump to a message from search. If it is loaded the list
 * scrolls to it; otherwise older history is paged in until it appears
 * (bounded), then the request is dropped.
 */
export function useJumpToMessage({
  initialMessageId,
  listRef,
  items,
  historyLoading,
  hasMore,
  loadingMore,
  loadMore,
}: {
  initialMessageId: string | undefined;
  listRef: RefObject<FlatList<MessageListItem> | null>;
  items: MessageListItem[];
  historyLoading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}): { jumpTo: (messageId: string) => void } {
  const [jumpTarget, setJumpTarget] = useState<string | null>(initialMessageId ?? null);
  const jumpAttemptsRef = useRef(0);

  useEffect(() => {
    if (!jumpTarget || historyLoading) return;
    const idx = items.findIndex((item) => item.type === 'message' && item.message.id === jumpTarget);
    if (idx >= 0) {
      setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }), 80);
      setJumpTarget(null);
      jumpAttemptsRef.current = 0;
      return;
    }
    if (hasMore && !loadingMore && jumpAttemptsRef.current < 20) {
      jumpAttemptsRef.current += 1;
      loadMore();
      return;
    }
    if (!loadingMore) {
      setJumpTarget(null);
      jumpAttemptsRef.current = 0;
    }
  }, [hasMore, historyLoading, jumpTarget, loadMore, loadingMore, items, listRef]);

  const jumpTo = useCallback((messageId: string) => {
    jumpAttemptsRef.current = 0;
    setJumpTarget(messageId);
  }, []);

  return { jumpTo };
}
