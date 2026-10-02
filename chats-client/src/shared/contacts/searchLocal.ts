/**
 * Local contact search for the New Chat screen (roadmap §8.1 A11).
 *
 * The directory on the server answers prefix queries of at least
 * `DIRECTORY_SEARCH_MIN_LENGTH` characters and returns an empty list for
 * anything shorter (chats-server `USER_SEARCH_MIN_QUERY_LENGTH`). The
 * lists the device already holds (saved contacts, verified and recent
 * conversations) are filtered from the first character instead, so a
 * two-letter query never claims that no contacts exist.
 */
export const DIRECTORY_SEARCH_MIN_LENGTH = 3;

export type LocalContactCandidate = {
  peerUserId: string;
  username?: string | null;
  displayName?: string | null;
};

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^@/, '');
}

/** Case-insensitive prefix on the username, on the display name and on each word of the display name. */
export function matchesLocalQuery(query: string, candidate: LocalContactCandidate): boolean {
  const q = normalize(query);
  if (!q) return false;
  if (normalize(candidate.username).startsWith(q)) return true;
  const name = normalize(candidate.displayName);
  if (!name) return false;
  if (name.startsWith(q)) return true;
  return name.split(/\s+/).some((word) => word.startsWith(q));
}

/** The candidates that match, in their given order, each user once (the first occurrence wins). */
export function filterLocalContacts<T extends LocalContactCandidate>(query: string, candidates: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.peerUserId)) continue;
    seen.add(candidate.peerUserId);
    if (matchesLocalQuery(query, candidate)) out.push(candidate);
  }
  return out;
}
