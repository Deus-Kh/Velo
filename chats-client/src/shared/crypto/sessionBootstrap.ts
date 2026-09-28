import { x3dhInitiate, x3dhRespond, type X3DHInitPacket } from './x3dh';
import { loadSession, createInitiatorSession, createResponderSession } from '../storage/sessionStore';
import { authenticateInitiator } from './identityTrust';

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
    theirSignedPreKeyPublicKey,
  });

  return { created: true, initPacket };
}

export async function ensureV2SessionFromIncoming(params: {
  myUserId: string;
  peerUserId: string;
  initPacket: X3DHInitPacket;
}): Promise<void> {
  const existing = await loadSession({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
  });
  if (existing) return;

  // T2.13: the initiator's identity DH key must be the pinned one (fetched
  // and pinned first on first contact). Throws IDENTITY_MISMATCH otherwise.
  await authenticateInitiator({ myUserId: params.myUserId, peerUserId: params.peerUserId, initPacket: params.initPacket });

  const { sessionKeys, signedPreKey } = await x3dhRespond({
    myUserId: params.myUserId,
    initPacket: params.initPacket,
  });

  await createResponderSession({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    sharedSecret: sessionKeys.rootKey,
    signedPreKey,
  });
}
