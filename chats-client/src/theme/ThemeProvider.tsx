import { View } from 'react-native';
import { vars } from 'nativewind';
import { lightTheme, darkTheme } from '../theme/theme';
import { themeColorSet } from './useThemeColors';
import { useResolvedTheme } from './useResolvedTheme';

/**
 * Supplies the NativeWind colour variables and paints the page background
 * itself. The status bar is translucent (and on Android 15+ edge-to-edge
 * is mandatory), so whatever is behind the bar shows through: with no
 * background here the window's own colour (black on a dark-system phone)
 * showed through under the status bar in the Light theme (roadmap A9).
 */
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const resolvedTheme = useResolvedTheme();
  const theme = resolvedTheme === 'dark' ? darkTheme : lightTheme;
  return (
    <View style={[vars(theme), { backgroundColor: themeColorSet(theme).background }]} className="flex-1">
      {children}
    </View>
  );
};
