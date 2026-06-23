

import 'react-native-gesture-handler'; 

import { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import Navigation from './src/app/Navigation';
import './global.css';

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAppearanceStore } from './src/store/appearance.store';
import { ensureMessageNotificationChannel } from './src/shared/notifications/notifee';

const rootViewStyle = { flex: 1 } as const;

function App() {
  const systemColorScheme = useColorScheme();
  const themePreference = useAppearanceStore((s) => s.themePreference);
  const isDarkMode =
    themePreference === 'system' ? systemColorScheme === 'dark' : themePreference === 'dark';

  useEffect(() => {
    ensureMessageNotificationChannel().catch((error) => {
      console.warn('[notifications] failed to create message channel:', error);
    });
  }, []);

  return (
    <GestureHandlerRootView style={rootViewStyle}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StatusBar translucent barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
          <Navigation />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
