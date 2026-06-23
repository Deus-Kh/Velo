import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth.store';

import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import MainTabsScreen from '../screens/MainTabsScreen';
import VerifyContactScreen from '../screens/VerifyContactScreen'

import AsyncStorage from '@react-native-async-storage/async-storage';
// import ChatReset from '../components/ChatReset';

export async function clearV2StateForPair(myUserId: string, peerUserId: string) {
  const keys = await AsyncStorage.getAllKeys();

  const match = (k: string) =>
    (k.includes(myUserId) && k.includes(peerUserId)) &&
    (
      k.startsWith('session:v2:') ||        // твой sessionStore key
      k.startsWith('v2mk:') ||              // если так назван keystore
      k.includes('v2mk') ||                 // на случай другого префикса
      k.includes('session:v2')
    );

  const toRemove = keys.filter(match);

  console.log('[wipe] removing', toRemove.length, 'keys');
  if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
}

// clearV2StateForPair('6974ed23318bba6f4417c78f', '6974ed0c318bba6f4417c784');


export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Chats: undefined;
  VerifyContact: {
    peerUserId: string;
    peerUsername?: string;
    peerEmail?: string;
    source?: 'chat' | 'new-chat';
  };

};


const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { isAuthenticated, hydrate, isLoading } = useAuthStore();
  
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (isLoading) return null;

  return (
    <NavigationContainer>
      {/* <ChatReset/> */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        ) : (
          <>
          <Stack.Screen name="Chats" component={MainTabsScreen} />
          <Stack.Screen name="VerifyContact" component={VerifyContactScreen} />

          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
