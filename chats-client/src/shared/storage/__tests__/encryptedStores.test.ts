import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { loadSession, saveSession } from '../sessionStore';
import { deleteOneTimePreKeySecret, getOneTimePreKeySecret, storeOneTimePreKeySecret } from '../oneTimePreKeys';
import { clearTrustedIdentity, getTrustedIdentity, setTrustedIdentity } from '../trustedIdentities';
import { listPendingMessages, removePendingMessage, upsertPendingMessage } from '../pendingMessageStore';
import { getOrCreateSessionMasterKey } from '../../crypto/sessionMasterKey';
import type { RatchetSessionV2 } from '@velo/protocol';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// In-memory Keychain: one entry per service, like the real one.
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

const session: RatchetSessionV2 = {
  v: 2,
  protoVersion: 2,
  peerUserId: PEER,
  rootKey: 'ROOTKEY-b64',
  chainKeySend: 'CKS-b64',
  chainKeyRecv: 'CKR-b64',
  Ns: 3,
  Nr: 5,
  PN: 0,
  skippedKeys: { 'dh:1': 'mk1' },
  DHsPublicKey: 'DHSPUB',
  DHsPrivateKey: 'DHSPRIV-b64',
  DHrPublicKey: null,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  (Keychain as unknown as { __store: Map<string, string> }).__store.clear();
});

describe('session master key', () => {
  it('is created once per user with device-only accessibility and reused afterwards', async () => {
    const a = await getOrCreateSessionMasterKey(ME);
    const b = await getOrCreateSessionMasterKey(ME);
    expect(a.length).toBe(32);
    expect(nacl.verify(a, b)).toBe(true);
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'session-mk',
      expect.any(String),
      expect.objectContaining({ service: `session-mk:${ME}`, accessible: 'AccessibleWhenUnlockedThisDeviceOnly' }),
    );
    const other = await getOrCreateSessionMasterKey(PEER);
    expect(nacl.verify(other, a)).toBe(false);
  });
});

describe('sessionStore', () => {
  it('stores only a sealed blob and round-trips the session', async () => {
    await saveSession({ myUserId: ME, peerUserId: PEER, session });
    const raw = await AsyncStorage.getItem(`session:v2:${ME}:${PEER}`);
    expect(raw).not.toBeNull();
    for (const secret of ['ROOTKEY', 'CKS-b64', 'CKR-b64', 'DHSPRIV', 'mk1']) {
      expect(raw).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(raw!)).sort()).toEqual(['ciphertext', 'nonce', 'v']);
    expect(await loadSession({ myUserId: ME, peerUserId: PEER })).toEqual(session);
  });

  it('returns null for a corrupted blob without throwing', async () => {
    await saveSession({ myUserId: ME, peerUserId: PEER, session });
    const key = `session:v2:${ME}:${PEER}`;
    const blob = JSON.parse((await AsyncStorage.getItem(key))!);
    blob.ciphertext = blob.ciphertext.slice(0, -8) + 'AAAAAAA=';
    await AsyncStorage.setItem(key, JSON.stringify(blob));
    await expect(loadSession({ myUserId: ME, peerUserId: PEER })).resolves.toBeNull();
  });

  it('migrates a legacy plaintext session in place', async () => {
    const key = `session:v2:${ME}:${PEER}`;
    await AsyncStorage.setItem(key, JSON.stringify(session));
    expect(await loadSession({ myUserId: ME, peerUserId: PEER })).toEqual(session);
    const raw = await AsyncStorage.getItem(key);
    expect(raw).not.toContain('ROOTKEY');
    expect(Object.keys(JSON.parse(raw!)).sort()).toEqual(['ciphertext', 'nonce', 'v']);
  });

  it('drops legacy junk that is not a session', async () => {
    const key = `session:v2:${ME}:${PEER}`;
    await AsyncStorage.setItem(key, JSON.stringify({ hello: 'world' }));
    expect(await loadSession({ myUserId: ME, peerUserId: PEER })).toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it('cannot be read with another user\'s master key', async () => {
    await saveSession({ myUserId: ME, peerUserId: PEER, session });
    const raw = await AsyncStorage.getItem(`session:v2:${ME}:${PEER}`);
    await AsyncStorage.setItem(`session:v2:${PEER}:${ME}`, raw!); // pretend PEER copied ME's blob
    expect(await loadSession({ myUserId: PEER, peerUserId: ME })).toBeNull();
  });
});

describe('oneTimePreKeys', () => {
  it('seals secrets, round-trips them, and migrates legacy plaintext', async () => {
    const secret = encodeBase64(new Uint8Array(32).fill(9));
    await storeOneTimePreKeySecret({ myUserId: ME, keyId: 7, secretKeyBase64: secret });
    expect(await AsyncStorage.getItem(`otpk:${ME}:7`)).not.toContain(secret);
    expect(await getOneTimePreKeySecret({ myUserId: ME, keyId: 7 })).toBe(secret);

    await AsyncStorage.setItem(`otpk:${ME}:8`, secret); // legacy
    expect(await getOneTimePreKeySecret({ myUserId: ME, keyId: 8 })).toBe(secret);
    expect(await AsyncStorage.getItem(`otpk:${ME}:8`)).not.toContain(secret);

    await deleteOneTimePreKeySecret({ myUserId: ME, keyId: 7 });
    expect(await getOneTimePreKeySecret({ myUserId: ME, keyId: 7 })).toBeNull();
  });
});

describe('trustedIdentities', () => {
  it('pins both identity keys, authenticates the pin and ignores tampered ones', async () => {
    await setTrustedIdentity({ myUserId: ME, peerUserId: PEER, identitySignPublicKey: 'PEERSIGN', identityDhPublicKey: 'PEERDH' });
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: PEER })).toEqual({ identitySignPublicKey: 'PEERSIGN', identityDhPublicKey: 'PEERDH' });

    const key = `trusted-identity:${ME}:${PEER}`;
    const record = JSON.parse((await AsyncStorage.getItem(key))!);
    expect(record.v).toBe(2);
    record.identityDhPublicKey = 'ATTACKERDH';
    await AsyncStorage.setItem(key, JSON.stringify(record));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: PEER })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('honours a v1 pin (signing key only) with an unknown DH key, still bound to the pair', async () => {
    const key = `trusted-identity:${ME}:${PEER}`;
    await AsyncStorage.setItem(key, 'LEGACYKEY+/==');
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: PEER })).toEqual({ identitySignPublicKey: 'LEGACYKEY+/==', identityDhPublicKey: null });
    const record = JSON.parse((await AsyncStorage.getItem(key))!);
    expect(record.v).toBe(1);
    expect(typeof record.mac).toBe('string');

    // Copying the record to another pair must not carry the trust over.
    await AsyncStorage.setItem(`trusted-identity:${ME}:65f000000000000000000003`, JSON.stringify(record));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: '65f000000000000000000003' })).toBeNull();
    warn.mockRestore();

    // Upgrading to a v2 pin replaces the record.
    await setTrustedIdentity({ myUserId: ME, peerUserId: PEER, identitySignPublicKey: 'LEGACYKEY+/==', identityDhPublicKey: 'NEWDH' });
    expect(JSON.parse((await AsyncStorage.getItem(key))!).v).toBe(2);

    await clearTrustedIdentity({ myUserId: ME, peerUserId: PEER });
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: PEER })).toBeNull();
  });
});

describe('pendingMessageStore', () => {
  it('never stores message bodies in the clear and migrates a legacy queue', async () => {
    await upsertPendingMessage(ME, {
      clientMessageId: 'c1',
      toUserId: PEER,
      text: 'top secret draft',
      createdAt: 1,
      attempts: 0,
      lastErrorCode: null,
    });
    const raw = await AsyncStorage.getItem(`pending_messages_v1:${ME}`);
    expect(raw).not.toContain('top secret');
    expect((await listPendingMessages(ME)).map((m) => m.text)).toEqual(['top secret draft']);

    await AsyncStorage.setItem(
      `pending_messages_v1:${ME}`,
      JSON.stringify([{ clientMessageId: 'legacy', toUserId: PEER, text: 'old plaintext', createdAt: 0, attempts: 1, lastErrorCode: null }]),
    );
    expect((await listPendingMessages(ME)).map((m) => m.clientMessageId)).toEqual(['legacy']);
    expect(await AsyncStorage.getItem(`pending_messages_v1:${ME}`)).not.toContain('old plaintext');

    await removePendingMessage(ME, 'legacy');
    expect(await listPendingMessages(ME)).toEqual([]);
  });
});
