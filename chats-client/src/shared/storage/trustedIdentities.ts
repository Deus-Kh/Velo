import AsyncStorage from '@react-native-async-storage/async-storage';

function key(myUserId: string, peerUserId: string) {
  return `trusted-identity:${myUserId}:${peerUserId}`;
}

export async function getTrustedIdentity(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<string | null> {
  return AsyncStorage.getItem(key(params.myUserId, params.peerUserId));
}

export async function setTrustedIdentity(params: {
  myUserId: string;
  peerUserId: string;
  identitySignPublicKey: string;
}): Promise<void> {
  await AsyncStorage.setItem(
    key(params.myUserId, params.peerUserId),
    params.identitySignPublicKey
  );
}

export async function clearTrustedIdentity(params: {
  myUserId: string;
  peerUserId: string;
}): Promise<void> {
  await AsyncStorage.removeItem(key(params.myUserId, params.peerUserId));
}

export async function listTrustedPeerUserIds(myUserId: string): Promise<string[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `trusted-identity:${myUserId}:`;

  return allKeys
    .filter((storageKey) => storageKey.startsWith(prefix))
    .map((storageKey) => storageKey.slice(prefix.length))
    .filter(Boolean);
}
