import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/auth.store';

import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import MainTabsScreen from '../screens/MainTabsScreen';
import VerifyContactScreen from '../screens/VerifyContactScreen'

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
