export function makeConversationId(userA: string, userB: string): string {
  return [String(userA), String(userB)].sort().join(':');
}
