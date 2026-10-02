import { formatConversationPreview, previewSenderLabel } from '../conversationPreview';
import type { StoredMessage } from '../../storage/messageStore';

/**
 * Roadmap §8.1 A1 — the chat-list preview line, by message kind and sender.
 */
const base = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: 'c1',
  clientMessageId: 'c1',
  serverMessageId: null,
  direction: 'in',
  text: 'See you at 6',
  createdAt: 1_700_000_000_000,
  seq: 1,
  status: 'sent',
  deliveredAt: null,
  readAt: null,
  replyTo: null,
  ...over,
});
const audio = { blobId: 'b'.repeat(32), key: 'k', digest: 'd', size: 10, contentType: 'audio/mp4', durationMs: 12_000 };

describe('formatConversationPreview', () => {
  it('text as is; "You: " for an own message; a member name in a group', () => {
    expect(formatConversationPreview(base())).toBe('See you at 6');
    expect(formatConversationPreview(base({ direction: 'out' }), { senderLabel: 'You' })).toBe('You: See you at 6');
    expect(formatConversationPreview(base(), { senderLabel: 'Anna' })).toBe('Anna: See you at 6');
  });

  it('attachments and tombstones use the shared description', () => {
    expect(formatConversationPreview(base({ text: '', attachment: audio }), { senderLabel: 'You' })).toBe('You: Voice message · 0:12');
    expect(formatConversationPreview(base({ text: 'look', attachment: { ...audio, contentType: 'image/jpeg' } }))).toBe('Photo · look');
    expect(formatConversationPreview(base({ text: 'gone', deletedAt: 5 }), { senderLabel: 'You' })).toBe('You: Message deleted');
  });

  it('a system line is shown as it is, with no sender', () => {
    expect(formatConversationPreview(base({ system: true, text: 'Disappearing messages set to 1 h', direction: 'out' }), { senderLabel: 'You' })).toBe('Disappearing messages set to 1 h');
  });

  it('nothing to show gives an empty string', () => {
    expect(formatConversationPreview(base({ text: '   ' }))).toBe('');
  });
});

describe('previewSenderLabel', () => {
  it('You for own, nothing for a 1:1 peer or a system line, the member name in a group', () => {
    expect(previewSenderLabel(base({ direction: 'out' }), { isGroup: false })).toBe('You');
    expect(previewSenderLabel(base(), { isGroup: false })).toBeNull();
    expect(previewSenderLabel(base({ system: true }), { isGroup: true, memberName: 'Anna' })).toBeNull();
    expect(previewSenderLabel(base(), { isGroup: true, memberName: 'Anna' })).toBe('Anna');
    expect(previewSenderLabel(base(), { isGroup: true, memberName: '  ' })).toBe('Member');
  });
});
