import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

/**
 * Все Keychain services, которые используются в приложении
 * ❗️ВАЖНО: сюда нужно добавить ВСЕ service, которые ты когда-либо setGenericPassword
 */

const myUserId = '697a33d1623d170c12c62dde'; // wildcard для всех юзеров
const peerUserId = '697a33bb623d170c12c62d6e';
const preKeyId = '697a33dd623d170c12c62ded';
const userId = '697a33d1623d170c12c62dde';
const KEYCHAIN_SERVICES = [
    `session:v2:${myUserId}:${peerUserId}`,
    `trusted-identity:${myUserId}:${peerUserId}`,
    `otpk:${myUserId}:${preKeyId}`,
    `history-mk:${userId}`,
    `identity-dh:${userId}`,
    `identity-sign:${userId}`,
    `e2ee-keypair:${userId}`,
    `signed-prekey:${userId}`
];

/**
 * Полный сброс приложения:
 * - AsyncStorage
 * - Keychain (все services)
 */
export async function clearAllLocalData(): Promise<void> {
  const errors: unknown[] = [];

  // 1. AsyncStorage
  try {
    await AsyncStorage.clear();
  } catch (e) {
    errors.push(e);
  }

  // 2. Keychain services
  for (const service of KEYCHAIN_SERVICES) {
    try {
      await Keychain.resetGenericPassword({ service });
    } catch (e) {
      // service может не существовать — это НОРМА
      errors.push({ service, error: e });
    }
  }

  // 3. дефолтный service (на всякий случай)
  try {
    await Keychain.resetGenericPassword();
  } catch (e) {
    errors.push(e);
  }

  if (errors.length > 0) {
    console.warn('[Storage reset] completed with warnings', errors);
  } else {
    console.log('[Storage reset] completed successfully');
  }
}


import { View, Text,Pressable } from 'react-native'
import React from 'react'

const ChatReset = () => {
  return (
    <View>
        <Pressable onPress={async ()=>{
          await clearAllLocalData();
        }}>
          <Text className='text-white text-lg'>ChatReset</Text>
        </Pressable>
    </View>
  )
}

export default ChatReset