import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { initInitiatorSession, initResponderSession, isProtocolError, type RatchetSessionV2 } from '@velo/protocol';
import { decryptAndPersist, decryptArchived, encryptAndPersist } from '../ratchetAdapter';
import { loadSession, saveSession } from '../../storage/sessionStore';
import { getV2MessageKey } from '../../storage/v2MessageKeyStore';
import { setTrustedIdentity } from '../../storage/trustedIdentities';
import { ensureIdentityKeyPairForUser } from '../../crypto/identityKeys';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-keychain', () => {
  const store = new Map<string, string>();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    getGenericPassword: jest.fn(async ({ service }: { service: string }) =>
      store.has(service) ? { service, username: 'u', password: store.get(service)! } : false,
    ),
    setGenericPassword: jest.fn(async (_u: string, password: string, { service }: { service: string }) => {
      store.set(service, password);
      return true;
    }),
    resetGenericPassword: jest.fn(async ({ service }: { service: string }) => store.delete(service)),
    __store: store,
  };
});

const ME = '65f000000000000000000001';
const PEER = '65f000000000000000000002';

const sharedSecret = encodeBase64(new Uint8Array(32).fill(0xaa));

function sessions(): { a: RatchetSessionV2; b: RatchetSessionV2 } {
  const spk = nacl.box.keyPair();
  const signedPreKey = { publicKey: encodeBase64(spk.publicKey), privateKey: encodeBase64(spk.secretKey) };
  return {
    a: initInitiatorSession({ peerUserId: PEER, sharedSecret, theirSignedPreKeyPublicKey: signedPreKey.publicKey }),
    b: initResponderSession({ peerUserId: ME, sharedSecret, signedPreKey }),
  };
}

async function messageKeyRows(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('v2mk:'));
}

/** Both users have identity keys and pin each other (T2.13 guarantees this before any session). */
async function pinBoth() {
  const mine = await ensureIdentityKeyPairForUser(ME);
  const theirs = await ensureIdentityKeyPairForUser(PEER);
  const dh = encodeBase64(nacl.box.keyPair().publicKey);
  await setTrustedIdentity({ myUserId: ME, peerUserId: PEER, identitySignPublicKey: theirs, identityDhPublicKey: dh });
  await setTrustedIdentity({ myUserId: PEER, peerUserId: ME, identitySignPublicKey: mine, identityDhPublicKey: dh });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  (Keychain as unknown as { __store: Map<string, string> }).__store.clear();
  await pinBoth();
});

describe('ratchetAdapter', () => {
  it('encrypt persists the outgoing key and the advanced session', async () => {
    const { a } = sessions();
    const r = await encryptAndPersist({ myUserId: ME, peerUserId: PEER, session: a, plaintext: 'hi' });

    expect(r.updatedSession.Ns).toBe(1);
    const stored = await loadSession({ myUserId: ME, peerUserId: PEER });
    expect(stored).toEqual(r.updatedSession);

    const mk = await getV2MessageKey({ myUserId: ME, peerUserId: PEER, direction: 'out', dhPub: a.DHsPublicKey, n: 0 });
    expect(mk).not.toBeNull();
    expect(decodeBase64(mk!).length).toBe(32);
    expect(await decryptArchived({ myUserId: ME, peerUserId: PEER, direction: 'out', encrypted: r.encrypted })).toBe('hi');
  });

  it('decrypt persists every derived key (skipped ones included) and then the session', async () => {
    let { a, b } = sessions();
    const e0 = await encryptAndPersist({ myUserId: ME, peerUserId: PEER, session: a, plaintext: 'm0' });
    a = e0.updatedSession;
    const e1 = await encryptAndPersist({ myUserId: ME, peerUserId: PEER, session: a, plaintext: 'm1' });
    a = e1.updatedSession;
    const e2 = await encryptAndPersist({ myUserId: ME, peerUserId: PEER, session: a, plaintext: 'm2' });

    const d = await decryptAndPersist({ myUserId: PEER, peerUserId: ME, session: b, encrypted: e2.encrypted });
    expect(d.plaintext).toBe('m2');
    b = d.updatedSession;
    expect(await loadSession({ myUserId: PEER, peerUserId: ME })).toEqual(b);
    for (const n of [0, 1, 2]) {
      const mk = await getV2MessageKey({ myUserId: PEER, peerUserId: ME, direction: 'in', dhPub: a.DHsPublicKey, n });
      expect(mk).not.toBeNull();
    }
    expect(Object.keys(b.skippedKeys ?? {}).length).toBe(2);
    expect(await decryptArchived({ myUserId: PEER, peerUserId: ME, direction: 'in', encrypted: e0.encrypted })).toBe('m0');
  });

  it('a failed decrypt persists nothing: stored session and key rows are untouched (R7)', async () => {
    const { a, b } = sessions();
    await saveSession({ myUserId: PEER, peerUserId: ME, session: b });
    const e = await encryptAndPersist({ myUserId: ME, peerUserId: PEER, session: a, plaintext: 'secret' });
    const rowsBefore = await messageKeyRows();
    const storedBefore = await loadSession({ myUserId: PEER, peerUserId: ME });

    const tampered = { ...e.encrypted, header: { ...e.encrypted.header, pn: 9 } };
    let code: string | null = null;
    try {
      await decryptAndPersist({ myUserId: PEER, peerUserId: ME, session: b, encrypted: tampered });
    } catch (err) {
      code = isProtocolError(err) ? err.code : 'other';
    }
    expect(code).toBe('HEADER_TAMPERED');

    expect(await loadSession({ myUserId: PEER, peerUserId: ME })).toEqual(storedBefore);
    expect(await messageKeyRows()).toEqual(rowsBefore);

    const ok = await decryptAndPersist({ myUserId: PEER, peerUserId: ME, session: b, encrypted: e.encrypted });
    expect(ok.plaintext).toBe('secret');
  });

  it('a replayed message is rejected without changing anything', async () => {
    let { a, b } = sessions();
    const e = await encryptAndPersist({ myUserId: ME, peerUserId: PEER, session: a, plaintext: 'once' });
    a = e.updatedSession;
    b = (await decryptAndPersist({ myUserId: PEER, peerUserId: ME, session: b, encrypted: e.encrypted })).updatedSession;
    const rows = await messageKeyRows();

    await expect(
      decryptAndPersist({ myUserId: PEER, peerUserId: ME, session: b, encrypted: e.encrypted }),
    ).rejects.toThrow('Replay or unknown old message');
    expect(await loadSession({ myUserId: PEER, peerUserId: ME })).toEqual(b);
    expect(await messageKeyRows()).toEqual(rows);
    expect(a.Ns).toBe(1);
  });

  it('a pre-T2.0 session on disk is discarded on load so the pair re-bootstraps', async () => {
    const { a } = sessions();
    const legacy = { ...a, v: 1, chainKeyRecv: a.chainKeySend } as unknown as RatchetSessionV2;
    await saveSession({ myUserId: ME, peerUserId: PEER, session: legacy });
    expect(await loadSession({ myUserId: ME, peerUserId: PEER })).toBeNull();
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('session:'))).toEqual([]);
  });
});
