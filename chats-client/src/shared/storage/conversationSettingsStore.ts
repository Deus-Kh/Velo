import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';
import { openJson, sealJson } from './sealed';

/**
 * Per-conversation settings agreed over the session (T7.3): today the
 * disappearing-message timer. Sealed like every other record; keyed by the
 * local conversation slot (a peer's user id, or `group:<id>`).
 */
export type ConversationSettings = {
  /** Seconds a message lives once sent (outgoing) or stored (incoming); null = off. */
  timerSeconds: number | null;
  /** Who set the current value and when (for the system line and the chip). */
  timerSetBy: string | null;
  timerSetAt: number | null;
};

export const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = { timerSeconds: null, timerSetBy: null, timerSetAt: null };

const PREFIX = 'convset:v1';

function key(myUserId: string, peerKey: string): string {
  return `${PREFIX}:${myUserId}:${peerKey}`;
}

export async function loadConversationSettings(myUserId: string, peerKey: string): Promise<ConversationSettings> {
  const raw = await AsyncStorage.getItem(key(myUserId, peerKey));
  if (!raw) return DEFAULT_CONVERSATION_SETTINGS;
  const mk = await getOrCreateSessionMasterKey(myUserId);
  const parsed = openJson<Partial<ConversationSettings>>(mk, raw);
  if (!parsed) return DEFAULT_CONVERSATION_SETTINGS;
  return {
    timerSeconds: typeof parsed.timerSeconds === 'number' && parsed.timerSeconds > 0 ? parsed.timerSeconds : null,
    timerSetBy: typeof parsed.timerSetBy === 'string' ? parsed.timerSetBy : null,
    timerSetAt: typeof parsed.timerSetAt === 'number' ? parsed.timerSetAt : null,
  };
}

export async function saveConversationSettings(myUserId: string, peerKey: string, settings: ConversationSettings): Promise<void> {
  const mk = await getOrCreateSessionMasterKey(myUserId);
  await AsyncStorage.setItem(key(myUserId, peerKey), sealJson(mk, settings));
}

/** Prefix for a logout wipe. */
export function conversationSettingsPrefixForUser(myUserId: string): string {
  return `${PREFIX}:${myUserId}:`;
}
