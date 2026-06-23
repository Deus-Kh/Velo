import { View, useColorScheme } from 'react-native';
import { vars } from 'nativewind';
import { lightTheme, darkTheme } from '../theme/theme';
import { useAppearanceStore } from '../store/appearance.store';

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const systemColorScheme = useColorScheme();
  const themePreference = useAppearanceStore((s) => s.themePreference);
  const resolvedTheme =
    themePreference === 'system' ? (systemColorScheme === 'dark' ? 'dark' : 'light') : themePreference;

  return (
    <View
      style={vars(resolvedTheme === 'dark' ? darkTheme : lightTheme)}
      className="flex-1"
    >
      {children}
    </View>
  );
};
