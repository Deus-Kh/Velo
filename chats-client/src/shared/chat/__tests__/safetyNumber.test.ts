import AsyncStorage from '@react-native-async-storage/async-storage';
import { computeSafetyNumber } from '@velo/protocol';
import { __resetSafetyNumberCache, cachedSafetyNumber, getSafetyNumber } from '../safetyNumber';

/**
 * Roadmap §8.1 A10 — the safety-number cache: computed once per identity
 * pair, served from memory and disk afterwards, dropped when a key changes.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.setTimeout(60_000);

const b64 = (seed: number): string => Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 31 + seed * 7) % 256)).toString('base64');
const identity = (seed: number) => ({ identitySignPublicKey: b64(seed), identityDhPublicKey: b64(seed + 1) });
const input = { myUserId: 'me', myIdentity: identity(1), peerUserId: 'peer', theirIdentity: identity(10) };

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetSafetyNumberCache();
});

describe('safety-number cache', () => {
  it('computes once with progress, equals the synchronous protocol function, then serves memory and disk', async () => {
    expect(await cachedSafetyNumber(input)).toBeNull();
    const progress: number[] = [];
    const first = await getSafetyNumber(input, { onProgress: (f) => progress.push(f) });
    expect(first).toEqual(computeSafetyNumber({ myUserId: 'me', myIdentity: input.myIdentity, theirUserId: 'peer', theirIdentity: input.theirIdentity }));
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeGreaterThan(10);
    expect(await cachedSafetyNumber(input)).toEqual(first);

    __resetSafetyNumberCache(); // a new process: the disk copy answers
    expect(await cachedSafetyNumber(input)).toEqual(first);
    const p2: number[] = [];
    expect(await getSafetyNumber(input, { onProgress: (f) => p2.push(f) })).toEqual(first);
    expect(p2).toEqual([1]);
  });

  it('a changed identity key on either side misses the cache', async () => {
    const first = await getSafetyNumber(input);
    expect(await cachedSafetyNumber({ ...input, theirIdentity: identity(20) })).toBeNull();
    expect(await cachedSafetyNumber({ ...input, myIdentity: identity(5) })).toBeNull();
    const second = await getSafetyNumber({ ...input, theirIdentity: identity(20) });
    expect(second.display).not.toBe(first.display);
    // the disk record now holds the newer pair; the old pair is a miss until recomputed
    __resetSafetyNumberCache();
    expect(await cachedSafetyNumber(input)).toBeNull();
    expect(await cachedSafetyNumber({ ...input, theirIdentity: identity(20) })).toEqual(second);
  });

  it('concurrent requests for the same pair share one computation', async () => {
    const [a, b] = await Promise.all([getSafetyNumber(input), getSafetyNumber(input)]);
    expect(a).toBe(b);
  });
});
