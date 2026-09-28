import { x3dhInitiate, type X3DHInitPacket } from './x3dh';
import { loadSession, createInitiatorSession } from '../storage/sessionStore';

export async function ensureV2Session(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<{ created: boolean; initPacket: X3DHInitPacket | null }> {
  const existing = await loadSession({ myUserId: params.myUserId, peerUserId: params.peerUserId });
  if (existing) return { created: false, initPacket: null };

  const { sessionKeys, initPacket, theirSignedPreKeyPublicKey } = await x3dhInitiate({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
  });

  await createInitiatorSession({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    sharedSecret: sessionKeys.rootKey,
    headerKeyA: sessionKeys.headerKeyA,
    nextHeaderKeyB: sessionKeys.nextHeaderKeyB,
    theirSignedPreKeyPublicKey,
  });

  return { created: true, initPacket };
}

// The inbound bootstrap (ensureV2SessionFromIncoming) moved to chat/incoming.ts in T2.11:
// the session is persisted only after the first message decrypts (R7).
