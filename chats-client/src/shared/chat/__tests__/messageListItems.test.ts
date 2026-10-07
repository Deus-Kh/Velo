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

describe('buildMessageListItems: albums', () => {
  const t = new Date(2026, 9, 6, 12, 0).getTime();
  const photo = (id: string, index: number, albumId = 'A', extra: Partial<UIMessage> = {}): UIMessage =>
    msg(id, t + index, { mine: true, text: '', attachment: { blobId: id, key: 'k', digest: 'd', size: 1, contentType: 'image/jpeg', album: { id: albumId, index, count: 3 } }, ...extra });

  it('photos of one album become one item in album order, and a jump target inside it finds the item', () => {
    const items = buildMessageListItems([msg('before', t - 1), photo('p0', 0), photo('p2', 2), photo('p1', 1), msg('after', t + 10)]);
    const album = items.find((i) => i.type === 'album');
    expect(album && album.type === 'album' ? album.messages.map((m) => m.id) : null).toEqual(['p0', 'p1', 'p2']);
    expect(items.map((i) => i.type)).toEqual(['message', 'album', 'message', 'separator']);
    const { itemHoldsMessage } = require('../messageListItems') as typeof import('../messageListItems');
    expect(items.findIndex((i) => itemHoldsMessage(i, 'p2'))).toBe(1);
  });

  it('a deleted photo leaves the album; a lone survivor is an ordinary message', () => {
    const items = buildMessageListItems([photo('p0', 0), photo('p1', 1, 'A', { deletedAt: t })]);
    expect(items.map((i) => i.type)).toEqual(['message', 'message', 'separator']);
  });
});
