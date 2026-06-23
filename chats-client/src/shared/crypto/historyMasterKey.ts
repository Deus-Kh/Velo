import nacl from 'tweetnacl';
import * as Keychain from 'react-native-keychain';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

function service(userId: string) {
  return `history-mk:${userId}`;
}

/**
 * Master key used to encrypt per-message keys at rest.
 * Stored in Keychain so AsyncStorage leaks do not reveal message keys.
 */
export async function getOrCreateHistoryMasterKey(userId: string): Promise<Uint8Array> {
  const creds = await Keychain.getGenericPassword({ service: service(userId) });

  if (creds !== false && creds?.password) {
    return decodeBase64(creds.password);
  }

  const mk = nacl.randomBytes(32);
  await Keychain.setGenericPassword('history-mk', encodeBase64(mk), { service: service(userId) });
  return mk;
}
