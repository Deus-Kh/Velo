import {
  notificationBodyFor,
  notificationIdFor,
  parsePushData,
  resolveSenderName,
  shouldNotifyFor,
} from '../pushPolicy';

describe('T3.3 push policy', () => {
  it('accepts only the data-only wake-up shape', () => {
    expect(parsePushData({ type: 'msg', serverMessageId: 'abc' })).toEqual({ type: 'msg', serverMessageId: 'abc' });
    expect(parsePushData({ type: 'chat_message', serverMessageId: 'abc' })).toBeNull(); // pre-T3.3 shape
    expect(parsePushData({ type: 'msg' })).toBeNull();
    expect(parsePushData(undefined)).toBeNull();
    expect(parsePushData('msg')).toBeNull();
  });

  it('shows message text only when previews are enabled; off is a fixed body', () => {
    expect(notificationBodyFor({ text: 'hello there', showMessagePreview: true })).toBe('hello there');
    expect(notificationBodyFor({ text: 'hello there', showMessagePreview: false })).toBe('New message');
    expect(notificationBodyFor({ text: '   ', showMessagePreview: true })).toBe('New message');
    const long = 'x'.repeat(300);
    const body = notificationBodyFor({ text: long, showMessagePreview: true });
    expect(body.length).toBe(240);
    expect(body.endsWith('…')).toBe(true);
  });

  it('resolves the sender name locally: saved contact, then conversation list, then neutral', () => {
    const savedContacts = [{ peerUserId: 'p1', peerUsername: 'alice' }, { peerUserId: 'p2' }];
    const conversations = [{ peerUserId: 'p2', peerUsername: 'bob' }];
    expect(resolveSenderName({ peerUserId: 'p1', savedContacts, conversations })).toBe('alice');
    expect(resolveSenderName({ peerUserId: 'p2', savedContacts, conversations })).toBe('bob');
    expect(resolveSenderName({ peerUserId: 'p3', savedContacts, conversations })).toBe('New message');
    expect(resolveSenderName({ peerUserId: 'p3', savedContacts })).toBe('New message');
  });

  it('never notifies for the open chat in the foreground, always in the background, else per the in-app preference', () => {
    expect(shouldNotifyFor({ appActive: true, chatOpenForPeer: true, inAppAlertsEnabled: true })).toBe(false);
    expect(shouldNotifyFor({ appActive: false, chatOpenForPeer: true, inAppAlertsEnabled: false })).toBe(true);
    expect(shouldNotifyFor({ appActive: true, chatOpenForPeer: false, inAppAlertsEnabled: true })).toBe(true);
    expect(shouldNotifyFor({ appActive: true, chatOpenForPeer: false, inAppAlertsEnabled: false })).toBe(false);
  });

  it('uses one stable notification id per message', () => {
    expect(notificationIdFor('a:b', 'm1')).toBe('message:a:b:m1');
    expect(notificationIdFor('a:b', 'm1')).toBe(notificationIdFor('a:b', 'm1'));
  });
});
