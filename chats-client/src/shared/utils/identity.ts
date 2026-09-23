/**
 * Display helpers for user identity. Email is a login credential, never a
 * display attribute: the server no longer returns other users' emails (T1.6),
 * so contacts are shown by username and by their secure ID.
 */

/** `@alice` — the public handle. */
export function formatHandle(username: string | undefined | null): string {
  const u = (username ?? '').trim();
  return u ? `@${u}` : '';
}

/** `65f0a1…0001` — a compact, recognisable form of the secure ID for lists. */
export function shortSecureId(userId: string | undefined | null): string {
  const id = (userId ?? '').trim();
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** Subtitle for a contact row: handle when known, otherwise the short secure ID. */
export function contactSubtitle(params: { username?: string | null; userId?: string | null }): string {
  return formatHandle(params.username) || shortSecureId(params.userId);
}
