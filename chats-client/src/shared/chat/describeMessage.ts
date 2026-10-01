import type { AttachmentMeta } from '../storage/messageStore';
import { formatDuration } from '../media/duration';

/**
 * One line that stands for a message wherever only one line fits: the
 * quote above a reply, the "Replying to" and "Editing" bars, the header of
 * the message actions sheet, a notification body, a chat-list preview.
 * A text message is its text; a photo is "📷 Photo" or its caption; a voice
 * note is "🎤 Voice message · 0:12"; a tombstone is "Message deleted".
 * (Roadmap §8.1 A3: a reply to a voice note or a photo used to quote the
 * empty `text` and show nothing.)
 */
export type DescribableMessage = {
  text?: string | null;
  attachment?: AttachmentMeta | null;
  deletedAt?: number | null;
};

export const SNIPPET_MAX_LENGTH = 48;

export function normalizeSnippet(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function truncateSnippet(text: string, maxLength = SNIPPET_MAX_LENGTH): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join('')}…`;
}

export function describeMessageForQuote(message: DescribableMessage, opts: { maxLength?: number } = {}): string {
  const maxLength = opts.maxLength ?? SNIPPET_MAX_LENGTH;
  if (message.deletedAt) return 'Message deleted';
  const attachment = message.attachment;
  if (attachment) {
    const type = attachment.contentType.toLowerCase();
    const caption = normalizeSnippet(message.text);
    if (type.startsWith('audio/')) {
      return attachment.durationMs && attachment.durationMs > 0 ? `🎤 Voice message · ${formatDuration(attachment.durationMs)}` : '🎤 Voice message';
    }
    if (type.startsWith('image/')) return caption ? truncateSnippet(`📷 ${caption}`, maxLength) : '📷 Photo';
    if (type.startsWith('video/')) return caption ? truncateSnippet(`🎬 ${caption}`, maxLength) : '🎬 Video';
    const name = normalizeSnippet(attachment.name);
    return truncateSnippet(`📎 ${name || 'File'}`, maxLength);
  }
  return truncateSnippet(normalizeSnippet(message.text), maxLength);
}
