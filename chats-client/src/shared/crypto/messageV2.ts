import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

import type { RatchetSessionV2 } from './sessionTypes';
import { chainKdf } from './ratchetChain';
import { saveSession } from '../storage/sessionStore';
import { utf8Encode, utf8Decode } from './utf8';
import { applyDhRatchet } from './dhRatchet';
import { putV2MessageKey } from '../storage/v2MessageKeyStore';

export type V2Header = {
  n: number;
  pn: number;
  dhPub: string;
};

export type V2Encrypted = {
  header: V2Header;
  nonce: string;
  ciphertext: string;
};

const MAX_SKIP = 50;

function skippedKeyId(dhPub: string, n: number) {
  return `${dhPub}:${n}`;
}

function normalizeB64(b64: string): string {
  let s = String(b64).replace(/ /g, '+').trim();
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad !== 0) s += '='.repeat(4 - pad);
  return s;
}

function decryptWithMessageKey(mkB64: string, encrypted: V2Encrypted): string {
  const mk = decodeBase64(normalizeB64(mkB64));
  const nonce = decodeBase64(normalizeB64(encrypted.nonce));
  const cipher = decodeBase64(normalizeB64(encrypted.ciphertext));

  const plain = nacl.secretbox.open(cipher, nonce, mk);
  if (!plain) throw new Error('secretbox.open failed');

  return utf8Decode(plain);
}

export async function encryptV2(params: {
  myUserId: string;
  peerUserId: string;
  session: RatchetSessionV2;
  plaintext: string;
}): Promise<{ encrypted: V2Encrypted; updatedSession: RatchetSessionV2 }> {
  const { session } = params;

  if (!session.DHsPublicKey) {
    throw new Error('Session missing DHsPublicKey');
  }

  const ck = decodeBase64(session.chainKeySend);
  const { messageKey, nextChainKey } = chainKdf(ck);

  await putV2MessageKey({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    direction: 'out',
    dhPub: session.DHsPublicKey,
    n: session.Ns,
    messageKeyB64: encodeBase64(messageKey),
  });

  const nonce = nacl.randomBytes(24);
  const plainBytes = utf8Encode(params.plaintext);
  const cipherBytes = nacl.secretbox(plainBytes, nonce, messageKey);

  const updatedSession: RatchetSessionV2 = {
    ...session,
    chainKeySend: encodeBase64(nextChainKey),
    Ns: session.Ns + 1,
  };

  await saveSession({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    session: updatedSession,
  });

  return {
    encrypted: {
      header: { n: session.Ns, pn: session.PN, dhPub: session.DHsPublicKey },
      nonce: encodeBase64(nonce),
      ciphertext: encodeBase64(cipherBytes),
    },
    updatedSession,
  };
}

export async function decryptV2(params: {
  myUserId: string;
  peerUserId: string;
  session: RatchetSessionV2;
  encrypted: V2Encrypted;
}): Promise<{ plaintext: string; updatedSession: RatchetSessionV2 }> {
  let session = params.session;
  const encrypted = params.encrypted;
  const incomingDhPub = encrypted.header.dhPub;

  if (!session.DHrPublicKey) {
    session = {
      ...session,
      DHrPublicKey: incomingDhPub,
    };
  } else if (session.DHrPublicKey !== incomingDhPub) {
    session = applyDhRatchet(session, incomingDhPub);
  }

  const targetN = encrypted.header.n;
  const skipped: Record<string, string> = { ...(session.skippedKeys || {}) };

  if (targetN < session.Nr) {
    const id = skippedKeyId(incomingDhPub, targetN);
    const mkB64 = skipped[id];

    if (!mkB64) throw new Error('Replay or unknown old message');

    await putV2MessageKey({
      myUserId: params.myUserId,
      peerUserId: params.peerUserId,
      direction: 'in',
      dhPub: incomingDhPub,
      n: targetN,
      messageKeyB64: mkB64,
    });

    const plaintext = decryptWithMessageKey(mkB64, encrypted);
    delete skipped[id];

    const updatedSession: RatchetSessionV2 = {
      ...session,
      skippedKeys: skipped,
    };

    await saveSession({
      myUserId: params.myUserId,
      peerUserId: params.peerUserId,
      session: updatedSession,
    });

    return { plaintext, updatedSession };
  }

  let ck = decodeBase64(session.chainKeyRecv);
  let nr = session.Nr;
  let messageKey: Uint8Array | null = null;

  while (nr <= targetN) {
    const step = chainKdf(ck);
    const mkB64 = encodeBase64(step.messageKey);

    if (nr === targetN) {
      messageKey = step.messageKey;

      await putV2MessageKey({
        myUserId: params.myUserId,
        peerUserId: params.peerUserId,
        direction: 'in',
        dhPub: incomingDhPub,
        n: nr,
        messageKeyB64: mkB64,
      });
    } else {
      try {
        if (Object.keys(skipped).length < MAX_SKIP) {
          skipped[skippedKeyId(incomingDhPub, nr)] = mkB64;
        }
      } catch (e) {
        console.warn('Failed to store skipped key', e);
      }

      await putV2MessageKey({
        myUserId: params.myUserId,
        peerUserId: params.peerUserId,
        direction: 'in',
        dhPub: incomingDhPub,
        n: nr,
        messageKeyB64: mkB64,
      });
    }

    ck = step.nextChainKey;
    nr += 1;
  }

  if (!messageKey) throw new Error('Failed to derive message key');

  const plaintext = decryptWithMessageKey(encodeBase64(messageKey), encrypted);

  const updatedSession: RatchetSessionV2 = {
    ...session,
    chainKeyRecv: encodeBase64(ck),
    Nr: nr,
    skippedKeys: skipped,
  };

  await saveSession({
    myUserId: params.myUserId,
    peerUserId: params.peerUserId,
    session: updatedSession,
  });

  return { plaintext, updatedSession };
}
