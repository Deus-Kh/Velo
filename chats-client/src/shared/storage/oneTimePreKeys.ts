import AsyncStorage from '@react-native-async-storage/async-storage';

function key(myUserId: string, preKeyId: number) {
  return `otpk:${myUserId}:${preKeyId}`; // one-time prekey secret
}

export async function storeOneTimePreKeySecret(params: {
  myUserId: string;
  keyId: number;
  secretKeyBase64: string;
}) {
  await AsyncStorage.setItem(key(params.myUserId, params.keyId), params.secretKeyBase64);
}

export async function getOneTimePreKeySecret(params: {
  myUserId: string;
  keyId: number;
}) {
  return AsyncStorage.getItem(key(params.myUserId, params.keyId));
}

export async function deleteOneTimePreKeySecret(params: {
  myUserId: string;
  keyId: number;
}) {
  await AsyncStorage.removeItem(key(params.myUserId, params.keyId));
}
