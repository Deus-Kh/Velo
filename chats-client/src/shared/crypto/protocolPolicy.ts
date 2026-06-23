export type ProtocolVersion = 2;

/**
 * Policy:
 * - During v2 stabilization, all active chats use v2 only.
 * - If a session does not exist yet, the caller is responsible for creating it.
 */
export async function chooseProtocol(params: {
  // Reserved for future policy rules; kept so callers do not need to change again.
  myUserId: string;
  peerUserId: string;
}): Promise<ProtocolVersion> {
  void params;
  return 2;
}
