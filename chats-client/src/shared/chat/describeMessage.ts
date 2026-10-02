import type { ComponentProps } from 'react';
import type { Lucide } from '@react-native-vector-icons/lucide/static';
import type { AttachmentMeta } from '../storage/messageStore';
import { formatDuration } from '../media/duration';

/**
 * One line that stands for a message wherever only one line fits: the
 * quote above a reply, the "Replying to" and "Editing" bars, the header of
 * the message actions sheet, a notification body, a chat-list preview.
 * A text message is its text; a photo is "Photo" or "Photo · caption"; a
 * voice note is "Voice message · 0:12"; a tombstone is "Message deleted".
 * Each kind also names the icon a component may draw in front of the
 * text. The text itself never carries emoji or stand-in glyphs: the
 * interface uses real icons only (owner's rule, 2026-10-02).
 * (Roadmap §8.1 A3: a reply to a voice note or a photo used to quote the
 * empty `text` and show nothing.)
 */
export type DescribableMessage = {
  text?: string | null;
  attachment?: AttachmentMeta | null;
  deletedAt?: number | null;
};

export type LucideIconName = ComponentProps<typeof Lucide>['name'];
export type MessageKind = 'text' | 'photo' | 'video' | 'file' | 'voice' | 'deleted';
export type MessageDescription = { kind: MessageKind; text: string; icon: LucideIconName | null };

export const SNIPPET_MAX_LENGTH = 48;

export function normalizeSnippet(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function truncateSnippet(text: string, maxLength = SNIPPET_MAX_LENGTH): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join('')}…`;
}

export function describeMessage(message: DescribableMessage, opts: { maxLength?: number } = {}): MessageDescription {
  const maxLength = opts.maxLength ?? SNIPPET_MAX_LENGTH;
  if (message.deletedAt) return { kind: 'deleted', text: 'Message deleted', icon: 'trash-2' };
  const attachment = message.attachment;
  if (attachment) {
    const type = attachment.contentType.toLowerCase();
    const caption = normalizeSnippet(message.text);
    if (type.startsWith('audio/')) {
      const text = attachment.durationMs && attachment.durationMs > 0 ? `Voice message · ${formatDuration(attachment.durationMs)}` : 'Voice message';
      return { kind: 'voice', text, icon: 'mic' };
    }
    if (type.startsWith('image/')) return { kind: 'photo', text: caption ? truncateSnippet(`Photo · ${caption}`, maxLength) : 'Photo', icon: 'image' };
    if (type.startsWith('video/')) return { kind: 'video', text: caption ? truncateSnippet(`Video · ${caption}`, maxLength) : 'Video', icon: 'video' };
    const name = normalizeSnippet(attachment.name);
    return { kind: 'file', text: truncateSnippet(name ? `File · ${name}` : 'File', maxLength), icon: 'paperclip' };
  }
  return { kind: 'text', text: truncateSnippet(normalizeSnippet(message.text), maxLength), icon: null };
}

/** The description's text alone, for places that have no icon slot (notification bodies, sheet headers). */
export function describeMessageForQuote(message: DescribableMessage, opts: { maxLength?: number } = {}): string {
  return describeMessage(message, opts).text;
}
