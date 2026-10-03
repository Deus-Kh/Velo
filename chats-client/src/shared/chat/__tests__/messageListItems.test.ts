import { buildMessageListItems, formatDayLabel } from '../messageListItems';
import type { UIMessage } from '../types';

/**
 * C1 — the chat list model moved out of ChatScreen unchanged: one day
 * separator per day, newest first for the inverted list.
 */
const msg = (id: string, createdAt: number, extra: Partial<UIMessage> = {}): UIMessage => ({ id, text: id, mine: false, createdAt, ...extra });

describe('formatDayLabel', () => {
  it('says Today and Yesterday relative to now, otherwise a day and month', () => {
    const now = new Date(2026, 9, 3, 15, 0, 0);
    expect(formatDayLabel(new Date(2026, 9, 3, 1, 0).getTime(), now)).toBe('Today');
    expect(formatDayLabel(new Date(2026, 9, 2, 23, 59).getTime(), now)).toBe('Yesterday');
    expect(formatDayLabel(new Date(2026, 8, 30).getTime(), now)).toBe(new Date(2026, 8, 30).toLocaleDateString([], { day: 'numeric', month: 'long' }));
  });
});

describe('buildMessageListItems', () => {
  it('inserts a separator when the day changes and reverses the result', () => {
    const d1 = new Date(2026, 9, 1, 10, 0).getTime();
    const d2 = new Date(2026, 9, 2, 9, 0).getTime();
    const items = buildMessageListItems([msg('a', d1), msg('b', d1 + 60_000), msg('c', d2)]);
    expect(items.map((i) => (i.type === 'separator' ? `sep:${i.label}` : i.id))).toEqual([
      'c',
      `sep:${formatDayLabel(d2)}`,
      'b',
      'a',
      `sep:${formatDayLabel(d1)}`,
    ]);
    expect(items.filter((i) => i.type === 'separator').map((i) => i.id)).toEqual(['separator-2026-9-2', 'separator-2026-9-1']);
  });

  it('is empty for no messages', () => {
    expect(buildMessageListItems([])).toEqual([]);
  });
});
