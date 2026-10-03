import AsyncStorage from '@react-native-async-storage/async-storage';
import { safetyNumberJob, type Identity, type SafetyNumber } from '@velo/protocol';
import { ensureIdentityKeyPairForUser } from '../crypto/identityKeys';
import { ensureIdentityDhKeyPairForUser } from '../crypto/identityDhKeys';
import { getTrustedIdentity } from '../storage/trustedIdentities';

/**
 * The safety number for a contact, computed once per identity pair and
 * kept (roadmap §8.1 A10). The number is 2 × 5200 SHA-512 rounds, which
 * is seconds of JavaScript on a phone: it is computed in chunks that
 * yield to the UI, cached in memory and on disk keyed by both parties'
 * identity keys (public values; the number itself is meant to be read
 * aloud), and prewarmed when a chat with a pinned contact opens, so the
 * Verify screen usually finds it ready.
 */
export type SafetyNumberInput = { myUserId: string; myIdentity: Identity; peerUserId: string; theirIdentity: Identity };

type CacheRecord = { v: 1; mySign: string; myDh: string; theirSign: string; theirDh: string; result: SafetyNumber };

/** ~50 ms of hashing per slice on a mid-range phone in a development bundle. */
const ROUNDS_PER_SLICE = 50;
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const memory = new Map<string, SafetyNumber>();
const inFlight = new Map<string, Promise<SafetyNumber>>();

const storageKey = (myUserId: string, peerUserId: string): string => `safety-number:v1:${myUserId}:${peerUserId}`;
const pairKey = (p: SafetyNumberInput): string =>
  [p.myUserId, p.peerUserId, p.myIdentity.identitySignPublicKey, p.myIdentity.identityDhPublicKey, p.theirIdentity.identitySignPublicKey, p.theirIdentity.identityDhPublicKey].join('|');

function matches(record: CacheRecord, p: SafetyNumberInput): boolean {
  return (
    record.mySign === p.myIdentity.identitySignPublicKey &&
    record.myDh === p.myIdentity.identityDhPublicKey &&
    record.theirSign === p.theirIdentity.identitySignPublicKey &&
    record.theirDh === p.theirIdentity.identityDhPublicKey
  );
}

/** The cached number for exactly these identities, or null; never computes. */
export async function cachedSafetyNumber(p: SafetyNumberInput): Promise<SafetyNumber | null> {
  const key = pairKey(p);
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const raw = await AsyncStorage.getItem(storageKey(p.myUserId, p.peerUserId));
    if (!raw) return null;
    const record = JSON.parse(raw) as CacheRecord;
    if (record?.v !== 1 || !matches(record, p) || typeof record.result?.display !== 'string') return null;
    memory.set(key, record.result);
    return record.result;
  } catch {
    return null;
  }
}

/** The number, from the cache or computed in chunks (one computation per pair at a time); `onProgress` is 0..1. */
export async function getSafetyNumber(p: SafetyNumberInput, opts: { onProgress?: (fraction: number) => void } = {}): Promise<SafetyNumber> {
  const cached = await cachedSafetyNumber(p);
  if (cached) {
    opts.onProgress?.(1);
    return cached;
  }
  const key = pairKey(p);
  const running = inFlight.get(key);
  if (running) return running;
  const work = (async () => {
    // The protocol package is synchronous and pure; this is where the rounds are sliced and the
    // event loop gets a turn between slices, so the screen keeps painting while the number grows.
    const job = safetyNumberJob({ myUserId: p.myUserId, myIdentity: p.myIdentity, theirUserId: p.peerUserId, theirIdentity: p.theirIdentity });
    while (!job.step(ROUNDS_PER_SLICE)) {
      opts.onProgress?.(job.done / job.total);
      await yieldToEventLoop();
    }
    opts.onProgress?.(1);
    const result = job.result();
    if (!result) throw new Error('safety number job did not complete');
    memory.set(key, result);
    const record: CacheRecord = {
      v: 1,
      mySign: p.myIdentity.identitySignPublicKey,
      myDh: p.myIdentity.identityDhPublicKey,
      theirSign: p.theirIdentity.identitySignPublicKey,
      theirDh: p.theirIdentity.identityDhPublicKey,
      result,
    };
    try {
      await AsyncStorage.setItem(storageKey(p.myUserId, p.peerUserId), JSON.stringify(record));
    } catch {
      /* the memory cache still holds it */
    }
    return result;
  })().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, work);
  return work;
}

/** When a chat with a pinned contact opens: compute the number in the background if it is not cached yet. */
export async function prewarmSafetyNumber(params: { myUserId: string; peerUserId: string }): Promise<void> {
  try {
    const pin = await getTrustedIdentity(params);
    if (!pin || !pin.identityDhPublicKey) return;
    const [mySign, myDh] = await Promise.all([ensureIdentityKeyPairForUser(params.myUserId), ensureIdentityDhKeyPairForUser(params.myUserId)]);
    await getSafetyNumber({
      myUserId: params.myUserId,
      myIdentity: { identitySignPublicKey: mySign, identityDhPublicKey: myDh },
      peerUserId: params.peerUserId,
      theirIdentity: { identitySignPublicKey: pin.identitySignPublicKey, identityDhPublicKey: pin.identityDhPublicKey },
    });
  } catch (e) {
    console.warn('[safety-number] prewarm failed:', (e as Error)?.message ?? e);
  }
}

/** Tests only. */
export function __resetSafetyNumberCache(): void {
  memory.clear();
  inFlight.clear();
}
