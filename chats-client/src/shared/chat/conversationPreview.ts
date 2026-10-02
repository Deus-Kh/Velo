import type { StoredMessage } from '../storage/messageStore';
import { describeMessageForQuote } from './describeMessage';

/**
 * The one line under a chat's name in the list (roadmap §8.1 A1). It comes
 * from the newest record in the sealed local store, never from the server,
 * which only ever knew a constant: a text's text, "Photo", "Voice message
 * · 0:12", "Message deleted", a timer line as it is, with "You: " in front
 * of an own message and the sender's name in front of a group member's.
 */
export function formatConversationPreview(message: StoredMessage, opts: { senderLabel?: string | null } = {}): string {
  const text = describeMessageForQuote(message);
  if (!text) return '';
  if (message.system) return text;
  const label = opts.senderLabel?.trim();
  return label ? `${label}: ${text}` : text;
}

/** "You" for an own message; a group member's name for theirs; nothing for a 1:1 peer or a system line. */
export function previewSenderLabel(message: StoredMessage, opts: { isGroup: boolean; memberName?: string | null }): string | null {
  if (message.system) return null;
  if (message.direction === 'out') return 'You';
  if (!opts.isGroup) return null;
  return opts.memberName?.trim() || 'Member';
}
