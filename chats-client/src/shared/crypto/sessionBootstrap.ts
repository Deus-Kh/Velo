import { x3dhInitiate, x3dhRespond, type X3DHInitPacket } from './x3dh';
import { loadSession, createSessionFromX3DH } from '../storage/sessionStore';

export async function ensureV2Session(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<{ created: boolean; initPacket: X3DHInitPacket | null }> {
  const existing = await loadSession({ myUserId: params.myUserId, peerUserId: params.peerUserId });
  if (existing) return { created: false, initPacket: null };

  const { sessionKeys, initPacket } = await x3dhInitiate({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
  });

  await createSessionFromX3DH({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    rootKey: sessionKeys.rootKey,
    chainKey: sessionKeys.chainKey,
    isInitiator: true,
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

  const sessionKeys = await x3dhRespond({
    myUserId: params.myUserId,
    initPacket: params.initPacket,
  });

  await createSessionFromX3DH({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    rootKey: sessionKeys.rootKey,
    chainKey: sessionKeys.chainKey,
    isInitiator: false,
  });
}
