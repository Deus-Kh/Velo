

import 'react-native-gesture-handler'; 

import { useEffect } from 'react';
import { StatusBar } from 'react-native';
import Navigation from './src/app/Navigation';
import './global.css';

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useResolvedTheme } from './src/theme/useResolvedTheme';
import { themeColorSet } from './src/theme/useThemeColors';
import { darkTheme, lightTheme } from './src/theme/theme';
import { ensureMessageNotificationChannel } from './src/shared/notifications/notifee';

function App() {
  // A9: the bar's icon colour and the root background follow the theme the app shows,
  // never the system scheme on its own; the bar itself stays transparent (edge-to-edge).
  const resolvedTheme = useResolvedTheme();
  const isDarkMode = resolvedTheme === 'dark';
  const rootViewStyle = { flex: 1, backgroundColor: themeColorSet(isDarkMode ? darkTheme : lightTheme).background };

  useEffect(() => {
    ensureMessageNotificationChannel().catch((error) => {
      console.warn('[notifications] failed to create message channel:', error);
    });
  }, []);

  return (
    <GestureHandlerRootView style={rootViewStyle}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StatusBar translucent backgroundColor="transparent" barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
          <Navigation />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
