import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ephemeral keys of initPackets already used to build a session with a
 * peer (T2.11). A replayed first message would otherwise re-create an old
 * session and desynchronise the current one. Public data, bounded.
 */
const MAX_SEEN = 32;

function key(myUserId: string, peerUserId: string) {
  return `bootstrap-seen:${myUserId}:${peerUserId}`;
}

async function load(myUserId: string, peerUserId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(key(myUserId, peerUserId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function hasSeenBootstrap(params: { myUserId: string; peerUserId: string; ephPublicKey: string }): Promise<boolean> {
  return (await load(params.myUserId, params.peerUserId)).includes(params.ephPublicKey);
}

export async function markBootstrapSeen(params: { myUserId: string; peerUserId: string; ephPublicKey: string }): Promise<void> {
  const seen = (await load(params.myUserId, params.peerUserId)).filter((e) => e !== params.ephPublicKey);
  seen.push(params.ephPublicKey);
  await AsyncStorage.setItem(key(params.myUserId, params.peerUserId), JSON.stringify(seen.slice(-MAX_SEEN)));
}

export async function clearBootstrapSeen(params: { myUserId: string; peerUserId: string }): Promise<void> {
  await AsyncStorage.removeItem(key(params.myUserId, params.peerUserId));
}
