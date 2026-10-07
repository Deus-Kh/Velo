/**
 * Hardware Back once nothing on the current tab is open (an open chat,
 * sheets, subpages and search close first through their own, newer
 * listeners): New Chat and Settings go back to Chats; only on Chats does
 * Android get the press, which leaves the app.
 */
export function tabAfterBack<T extends string>(tab: T, home: T, chatOpen: boolean): T | null {
  if (chatOpen || tab === home) return null;
  return home;
}
