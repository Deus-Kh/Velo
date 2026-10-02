import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { useThemeColors } from '../theme/useThemeColors';
import { useResolvedTheme } from '../theme/useResolvedTheme';
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
  // A9: the navigator paints every screen's backdrop with the app's theme, so no
  // light or dark flash from the library's default theme and nothing foreign
  // shows behind the translucent status bar during transitions.
  const resolvedTheme = useResolvedTheme();
  const colors = useThemeColors();
  const base = resolvedTheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: { ...base.colors, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, primary: colors.primary },
  };

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (isLoading) return null;

  return (
    <NavigationContainer theme={navigationTheme}>
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
