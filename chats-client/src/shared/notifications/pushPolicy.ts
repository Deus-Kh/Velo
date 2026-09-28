/**
 * Pure decisions behind push and in-app message alerts (T3.3, P1-9). No
 * native imports, so they are unit-tested; the wiring lives in pushIngest.ts.
 */

/** What a T3.3 push carries: a wake-up naming the message to fetch. */
export type PushWakeup = { type: 'msg'; serverMessageId: string };

export function parsePushData(data: unknown): PushWakeup | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'msg') return null;
  const id = typeof d.serverMessageId === 'string' ? d.serverMessageId : '';
  return id ? { type: 'msg', serverMessageId: id } : null;
}

/**
 * The honest preview toggle: message text appears in a notification only
 * when the user enabled previews. Off means a fixed body, never a hint of
 * length or content.
 */
export function notificationBodyFor(params: { text: string; showMessagePreview: boolean }): string {
  if (!params.showMessagePreview) return 'New message';
  const text = params.text.trim();
  if (!text) return 'New message';
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

/**
 * The sender's name comes from what this device already knows: a saved
 * contact, else the conversation list, else a neutral title. It never
 * arrives in the push.
 */
export function resolveSenderName(params: {
  peerUserId: string;
  savedContacts: ReadonlyArray<{ peerUserId: string; peerUsername?: string }>;
  conversations?: ReadonlyArray<{ peerUserId: string; peerUsername?: string }>;
}): string {
  const saved = params.savedContacts.find((c) => c.peerUserId === params.peerUserId);
  if (saved?.peerUsername) return saved.peerUsername;
  const conv = params.conversations?.find((c) => c.peerUserId === params.peerUserId);
  if (conv?.peerUsername) return conv.peerUsername;
  return 'New message';
}

/**
 * Whether to show a notification for a message that just arrived (live or
 * fetched after a push). The open chat renders it itself; in the foreground
 * the in-app alert preference decides; in the background a message always
 * notifies (that is what push is for).
 */
export function shouldNotifyFor(params: {
  appActive: boolean;
  chatOpenForPeer: boolean;
  inAppAlertsEnabled: boolean;
}): boolean {
  if (params.chatOpenForPeer && params.appActive) return false;
  if (!params.appActive) return true;
  return params.inAppAlertsEnabled;
}

/** Stable notifee id per message: a re-fetch never shows the same message twice. */
export function notificationIdFor(conversationId: string, serverMessageId: string): string {
  return `message:${conversationId}:${serverMessageId}`;
}
