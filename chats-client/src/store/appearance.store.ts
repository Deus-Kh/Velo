import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type InterfaceDensity = 'compact' | 'comfortable';
export type SurfaceStyle = 'glass' | 'solid';

interface AppearanceState {
  themePreference: ThemePreference;
  interfaceDensity: InterfaceDensity;
  surfaceStyle: SurfaceStyle;
  setThemePreference: (themePreference: ThemePreference) => void;
  setInterfaceDensity: (interfaceDensity: InterfaceDensity) => void;
  setSurfaceStyle: (surfaceStyle: SurfaceStyle) => void;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      themePreference: 'system',
      interfaceDensity: 'comfortable',
      surfaceStyle: 'glass',
      setThemePreference: (themePreference) => set({ themePreference }),
      setInterfaceDensity: (interfaceDensity) => set({ interfaceDensity }),
      setSurfaceStyle: (surfaceStyle) => set({ surfaceStyle }),
    }),
    {
      name: 'appearance-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
