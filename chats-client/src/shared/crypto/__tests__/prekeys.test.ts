import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { decodeBase64 } from 'tweetnacl-util';
import { isProtocolError, verifySignedPreKey } from '@velo/protocol';
import { keysApi } from '../../api/keys.api';
import { ensureIdentityKeyPairForUser } from '../identityKeys';
import { ensureSignedPreKeyForUser, getSignedPreKeyPairForKeyId } from '../prekeys';

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

jest.mock('../../api/keys.api', () => ({
  keysApi: { uploadSignedPreKey: jest.fn(async () => ({ data: { ok: true } })) },
}));

const ME = '65f000000000000000000001';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 28);

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return isProtocolError(e) ? e.code : 'NOT_PROTOCOL_ERROR';
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  (Keychain as unknown as { __store: Map<string, string> }).__store.clear();
  jest.clearAllMocks();
});

describe('signed prekey rotation (T2.10)', () => {
  it('creates, signs over keyId ‖ publicKey, uploads; then keeps the key for 7 days and rotates after', async () => {
    const identityPub = await ensureIdentityKeyPairForUser(ME);

    const first = await ensureSignedPreKeyForUser(ME, T0);
    expect(first.rotated).toBe(true);
    const upload = (keysApi.uploadSignedPreKey as jest.Mock).mock.calls[0][0];
    expect(upload.keyId).toBe(first.keyId);
    expect(verifySignedPreKey({ identitySignPublicKey: identityPub, keyId: upload.keyId, publicKey: upload.publicKey, signature: upload.signature })).toBe(true);

    const day6 = await ensureSignedPreKeyForUser(ME, T0 + 6 * DAY);
    expect(day6.rotated).toBe(false);
    expect(day6.keyId).toBe(first.keyId);

    const day8 = await ensureSignedPreKeyForUser(ME, T0 + 8 * DAY);
    expect(day8.rotated).toBe(true);
    expect(day8.keyId).not.toBe(first.keyId);

    // Both keys resolve by id; the old one is retained.
    expect((await getSignedPreKeyPairForKeyId(ME, first.keyId, T0 + 20 * DAY)).keyId).toBe(first.keyId);
    expect(decodeBase64((await getSignedPreKeyPairForKeyId(ME, day8.keyId, T0 + 9 * DAY)).privateKey).length).toBe(32);
  });

  it('a retained key expires after 30 days and an unknown id is refused, both as SESSION_RESET_REQUIRED', async () => {
    await ensureIdentityKeyPairForUser(ME);
    const first = await ensureSignedPreKeyForUser(ME, T0);
    await ensureSignedPreKeyForUser(ME, T0 + 8 * DAY);
    expect(await codeOf(getSignedPreKeyPairForKeyId(ME, first.keyId, T0 + 31 * DAY))).toBe('SESSION_RESET_REQUIRED');
    expect(await codeOf(getSignedPreKeyPairForKeyId(ME, 424242, T0))).toBe('SESSION_RESET_REQUIRED');
  });

  it('a pre-T2.10 record (single key, old signature format) is replaced on the next bootstrap', async () => {
    await ensureIdentityKeyPairForUser(ME);
    (Keychain as unknown as { __store: Map<string, string> }).__store.set(
      `signed-prekey:${ME}`,
      JSON.stringify({ keyId: 1, publicKey: 'x', privateKey: 'y', signature: 'z' }),
    );
    const r = await ensureSignedPreKeyForUser(ME, T0);
    expect(r.rotated).toBe(true);
    expect(await codeOf(getSignedPreKeyPairForKeyId(ME, 1, T0))).toBe('SESSION_RESET_REQUIRED');
  });
});
