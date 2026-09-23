import { ConversationModel } from '../models/Conversation';
import { makeConversationId } from '../utils/conversation';

/**
 * Relationship checks for socket events (P0-7 / P2-10).
 *
 * Presence, typing, and read receipts are only meaningful — and only
 * permitted — between two users who already share a conversation. Without
 * this any account could subscribe to anyone's online status, spray typing
 * indicators, or push forged read receipts.
 *
 * A conversation, once created, is never deleted today, so positive answers
 * are cached briefly; negatives are not, so the first message of a new chat
 * unlocks the checks immediately.
 */

const POSITIVE_TTL_MS = 60_000;
const known = new Map<string, number>(); // conversationId → expiresAt

export async function haveConversation(userId: string, peerUserId: string): Promise<boolean> {
  if (userId === peerUserId) return false;
  const conversationId = makeConversationId(userId, peerUserId);
  const cached = known.get(conversationId);
  const now = Date.now();
  if (cached && cached > now) return true;

  const exists = await ConversationModel.exists({ conversationId });
  if (exists) known.set(conversationId, now + POSITIVE_TTL_MS);
  return Boolean(exists);
}

/** Test helper. */
export function resetConversationCache(): void {
  known.clear();
}
