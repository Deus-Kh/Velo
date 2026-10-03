import { formatLastSeen, getHeaderPresenceMeta } from '../presence';

/**
 * C1 — the chat header's subtitle, moved out of ChatScreen unchanged.
 */
const healthy = { status: 'healthy' as const };
const hidden = { online: false, lastSeenAt: null };

describe('getHeaderPresenceMeta', () => {
  it('ranks session health above typing, typing above the socket, the socket above presence', () => {
    expect(getHeaderPresenceMeta({ peerTyping: true, peerPresence: hidden, socketReady: false, sessionHealth: { status: 'reset_required', reason: 'x' } }).pillTone).toBe('warning');
    expect(getHeaderPresenceMeta({ peerTyping: true, peerPresence: hidden, socketReady: false, sessionHealth: healthy })).toEqual({ subtitle: 'typing...', pillLabel: '', pillTone: 'default' });
    expect(getHeaderPresenceMeta({ peerTyping: false, peerPresence: { online: true, lastSeenAt: null }, socketReady: false, sessionHealth: healthy })).toEqual({
      subtitle: 'Offline. Messages will send after reconnect.',
      pillLabel: 'Offline',
      pillTone: 'offline',
    });
    expect(getHeaderPresenceMeta({ peerTyping: false, peerPresence: { online: true, lastSeenAt: null }, socketReady: true, sessionHealth: healthy }).subtitle).toBe('online');
  });

  it('says nothing about presence when the contact hides it (T7.4)', () => {
    expect(getHeaderPresenceMeta({ peerTyping: false, peerPresence: hidden, socketReady: true, sessionHealth: healthy }).subtitle).toBe('end-to-end encrypted');
  });
});

describe('formatLastSeen', () => {
  it('counts minutes, then the time today, then the date', () => {
    const now = new Date(2026, 9, 3, 15, 0, 0).getTime();
    expect(formatLastSeen(now - 10_000, now)).toBe('last seen just now');
    expect(formatLastSeen(now - 5 * 60_000, now)).toBe('last seen 5m ago');
    const earlierToday = new Date(2026, 9, 3, 9, 30).getTime();
    expect(formatLastSeen(earlierToday, now)).toBe(`last seen at ${new Date(earlierToday).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    const lastWeek = new Date(2026, 8, 27, 9, 30).getTime();
    expect(formatLastSeen(lastWeek, now)).toBe(`last seen ${new Date(lastWeek).toLocaleDateString([], { day: 'numeric', month: 'short' })}`);
  });
});
