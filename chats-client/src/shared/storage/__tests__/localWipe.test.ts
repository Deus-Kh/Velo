import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { asyncStoragePrefixesFor, keychainServicesFor, wipeLocalStateForUser } from '../localWipe';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-keychain', () => ({
  resetGenericPassword: jest.fn(async () => true),
}));

const ME = '65f000000000000000000001';
const OTHER = '65f000000000000000000002';

async function seed() {
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    [`session:v2:${ME}:peerA`, 'session-a'],
    [`v2mk:${ME}:peerA:in:dh:0`, 'mk'],
    [`pending_messages_v1:${ME}`, '[{"text":"secret draft"}]'],
    [`otpk:${ME}:1`, 'opk-secret'],
    [`trusted-identity:${ME}:peerA`, 'pin'],
    ['accessToken', 'jwt'],
    ['userId', ME],
    [`session:v2:${OTHER}:peerB`, 'session-other'],
    [`v2mk:${OTHER}:peerB:in:dh:0`, 'mk-other'],
    [`otpk:${OTHER}:1`, 'opk-other'],
  ]);
  (Keychain.resetGenericPassword as jest.Mock).mockClear();
}

describe('wipeLocalStateForUser', () => {
  beforeEach(seed);

  it("'messages' removes sessions, message keys, the pending queue and the history master key only", async () => {
    const report = await wipeLocalStateForUser(ME, 'messages');
    expect(report.failures).toEqual([]);
    expect(report.removedKeys).toBe(3);

    const remaining = await AsyncStorage.getAllKeys();
    expect(remaining).toEqual(
      expect.arrayContaining([`otpk:${ME}:1`, `trusted-identity:${ME}:peerA`, 'accessToken', 'userId']),
    );
    expect(remaining).not.toContain(`session:v2:${ME}:peerA`);
    expect(remaining).not.toContain(`pending_messages_v1:${ME}`);

    const services = (Keychain.resetGenericPassword as jest.Mock).mock.calls.map((c) => c[0].service);
    expect(services).toEqual([`history-mk:${ME}`]);
  });

  it("'all' additionally removes prekey secrets, trust pins and every Keychain entry", async () => {
    const report = await wipeLocalStateForUser(ME, 'all');
    expect(report.removedKeys).toBe(5);
    const remaining = await AsyncStorage.getAllKeys();
    expect(remaining.filter((k) => k.includes(ME))).toEqual([]); // no namespaced key left for ME
    expect(remaining).toEqual(expect.arrayContaining(['accessToken', 'userId'])); // auth keys are logout's job
    const services = (Keychain.resetGenericPassword as jest.Mock).mock.calls.map((c) => c[0].service);
    expect(services).toEqual(keychainServicesFor(ME, 'all'));
    expect(services).toContain(`identity-sign:${ME}`);
  });

  it('never touches another account on the same device', async () => {
    await wipeLocalStateForUser(ME, 'all');
    const remaining = await AsyncStorage.getAllKeys();
    expect(remaining).toEqual(
      expect.arrayContaining([`session:v2:${OTHER}:peerB`, `v2mk:${OTHER}:peerB:in:dh:0`, `otpk:${OTHER}:1`]),
    );
    const services = (Keychain.resetGenericPassword as jest.Mock).mock.calls.map((c) => c[0].service);
    expect(services.some((s) => s.includes(OTHER))).toBe(false);
  });

  it('reports Keychain failures without aborting the rest', async () => {
    (Keychain.resetGenericPassword as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('locked');
    });
    const report = await wipeLocalStateForUser(ME, 'all');
    expect(report.failures).toHaveLength(1);
    expect(report.resetServices).toBe(keychainServicesFor(ME, 'all').length - 1);
    expect(report.removedKeys).toBe(5);
  });

  it('is a no-op for an empty user id', async () => {
    const report = await wipeLocalStateForUser('', 'all');
    expect(report).toEqual({ removedKeys: 0, resetServices: 0, failures: [] });
    expect(await AsyncStorage.getAllKeys()).toHaveLength(10);
  });

  it('exposes the namespaces so Settings and logout stay in sync', () => {
    expect(asyncStoragePrefixesFor(ME, 'messages').every((p) => p.includes(ME))).toBe(true);
    expect(keychainServicesFor(ME, 'messages')).toEqual([`history-mk:${ME}`]);
  });
});
