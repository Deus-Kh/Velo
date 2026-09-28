import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import { isProtocolError, signIdentityBinding, type BoundIdentity, type X3DHInitPacket } from '@velo/protocol';
import { keysApi } from '../../api/keys.api';
import { acceptNewIdentity, authenticateInitiator, enforcePinnedIdentity, fetchBoundIdentity } from '../identityTrust';
import { getTrustedIdentity, setTrustedIdentity } from '../../storage/trustedIdentities';
import { saveSession, loadSession } from '../../storage/sessionStore';
import { initInitiatorSession } from '@velo/protocol';

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
  keysApi: { getIdentityKey: jest.fn() },
}));

const ME = '65f000000000000000000001';
const PEER = '65f000000000000000000002';

function identity(seed: number): BoundIdentity {
  const sign = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seed));
  const dh = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(seed + 1));
  const identityDhPublicKey = encodeBase64(dh.publicKey);
  return {
    identitySignPublicKey: encodeBase64(sign.publicKey),
    identityDhPublicKey,
    identityBindingSignature: signIdentityBinding(sign.secretKey, identityDhPublicKey),
  };
}

function serverHas(id: BoundIdentity | null) {
  (keysApi.getIdentityKey as jest.Mock).mockResolvedValue({
    data: id
      ? { userId: PEER, ...id, identityChangedAt: null }
      : { userId: PEER, identitySignPublicKey: 'x', identityDhPublicKey: null, identityBindingSignature: null, identityChangedAt: null },
  });
}

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return isProtocolError(e) ? e.code : 'NOT_PROTOCOL_ERROR';
  }
}

const packetFrom = (id: BoundIdentity): X3DHInitPacket => ({
  peerUserId: ME,
  ephPublicKey: encodeBase64(new Uint8Array(32).fill(9)),
  signedPreKeyId: 1,
  oneTimePreKeyId: null,
  initiatorIdentityDhPublicKey: id.identityDhPublicKey,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  (Keychain as unknown as { __store: Map<string, string> }).__store.clear();
  jest.clearAllMocks();
});

describe('enforcePinnedIdentity (initiator side)', () => {
  it('pins silently on first contact, accepts a match, refuses a different identity without re-pinning', async () => {
    const a = identity(0x10);
    await enforcePinnedIdentity({ myUserId: ME, peerUserId: PEER, presented: a });
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: PEER })).toEqual({
      identitySignPublicKey: a.identitySignPublicKey,
      identityDhPublicKey: a.identityDhPublicKey,
    });
    await expect(enforcePinnedIdentity({ myUserId: ME, peerUserId: PEER, presented: a })).resolves.toBeTruthy();

    const b = identity(0x20);
    expect(await codeOf(enforcePinnedIdentity({ myUserId: ME, peerUserId: PEER, presented: b }))).toBe('IDENTITY_MISMATCH');
    expect((await getTrustedIdentity({ myUserId: ME, peerUserId: PEER }))!.identitySignPublicKey).toBe(a.identitySignPublicKey);
  });

  it('refuses an identity whose binding does not verify, even on first contact', async () => {
    const a = identity(0x30);
    const forged = { ...a, identityDhPublicKey: identity(0x40).identityDhPublicKey };
    expect(await codeOf(enforcePinnedIdentity({ myUserId: ME, peerUserId: PEER, presented: forged }))).toBe('IDENTITY_BINDING_INVALID');
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: PEER })).toBeNull();
  });

  it('upgrades a legacy signing-key-only pin when the signing key matches', async () => {
    const a = identity(0x50);
    await AsyncStorage.setItem(`trusted-identity:${ME}:${PEER}`, a.identitySignPublicKey); // pre-T1.3 plaintext pin
    await enforcePinnedIdentity({ myUserId: ME, peerUserId: PEER, presented: a });
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: PEER })).toEqual({
      identitySignPublicKey: a.identitySignPublicKey,
      identityDhPublicKey: a.identityDhPublicKey,
    });
  });
});

describe('authenticateInitiator (responder side)', () => {
  it('without a pin, fetches and pins the identity, then requires the packet to carry that DH key', async () => {
    const a = identity(0x60);
    serverHas(a);
    await expect(authenticateInitiator({ myUserId: ME, peerUserId: PEER, initPacket: packetFrom(a) })).resolves.toBeUndefined();
    expect(keysApi.getIdentityKey).toHaveBeenCalledWith(PEER);
    expect((await getTrustedIdentity({ myUserId: ME, peerUserId: PEER }))!.identityDhPublicKey).toBe(a.identityDhPublicKey);

    // Forged packet: a different initiator DH key than the pinned one (S20).
    const m = identity(0x70);
    expect(await codeOf(authenticateInitiator({ myUserId: ME, peerUserId: PEER, initPacket: packetFrom(m) }))).toBe('IDENTITY_MISMATCH');
  });

  it('with a pin, does not consult the server', async () => {
    const a = identity(0x80);
    await setTrustedIdentity({ myUserId: ME, peerUserId: PEER, identitySignPublicKey: a.identitySignPublicKey, identityDhPublicKey: a.identityDhPublicKey });
    await authenticateInitiator({ myUserId: ME, peerUserId: PEER, initPacket: packetFrom(a) });
    expect(keysApi.getIdentityKey).not.toHaveBeenCalled();
  });

  it('refuses when the peer has no bound identity on the server', async () => {
    serverHas(null);
    expect(await codeOf(fetchBoundIdentity(PEER))).toBe('IDENTITY_BINDING_INVALID');
  });
});

describe('acceptNewIdentity', () => {
  it('re-pins from the server (binding verified) and drops the session; stored history is untouched (T2.14)', async () => {
    const old = identity(0x90);
    const fresh = identity(0xa0);
    await setTrustedIdentity({ myUserId: ME, peerUserId: PEER, identitySignPublicKey: old.identitySignPublicKey, identityDhPublicKey: old.identityDhPublicKey });
    const spk = nacl.box.keyPair();
    await saveSession({
      myUserId: ME,
      peerUserId: PEER,
      session: initInitiatorSession({ peerUserId: PEER, sharedSecret: encodeBase64(new Uint8Array(32).fill(1)), headerKeyA: encodeBase64(new Uint8Array(32).fill(2)), nextHeaderKeyB: encodeBase64(new Uint8Array(32).fill(3)), theirSignedPreKeyPublicKey: encodeBase64(spk.publicKey) }),
    });
    await AsyncStorage.setItem(`v2mk:${ME}:${PEER}:out:x:0`, 'k');

    serverHas(fresh);
    const pinned = await acceptNewIdentity({ myUserId: ME, peerUserId: PEER });
    expect(pinned.identityDhPublicKey).toBe(fresh.identityDhPublicKey);
    expect(await getTrustedIdentity({ myUserId: ME, peerUserId: PEER })).toEqual({
      identitySignPublicKey: fresh.identitySignPublicKey,
      identityDhPublicKey: fresh.identityDhPublicKey,
    });
    expect(await loadSession({ myUserId: ME, peerUserId: PEER })).toBeNull();
    // T2.14: accepting a new identity never deletes history or the legacy archive; the migration owns that.
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('v2mk:'))).toHaveLength(1);
  });
});
