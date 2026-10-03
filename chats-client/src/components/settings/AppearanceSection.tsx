import { View } from 'react-native';

import SectionEyebrow from '../SectionEyebrow';
import { SegmentedSelector, SettingsGroup, SettingsRow, ThemeModeSelector } from './primitives';
import { useAppearanceStore, type InterfaceDensity, type SurfaceStyle } from '../../store/appearance.store';

/** Settings → Appearance: theme, density and surface style, straight from the appearance store. */
export default function AppearanceSection() {
  const themePreference = useAppearanceStore((s) => s.themePreference);
  const setThemePreference = useAppearanceStore((s) => s.setThemePreference);
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const setInterfaceDensity = useAppearanceStore((s) => s.setInterfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);
  const setSurfaceStyle = useAppearanceStore((s) => s.setSurfaceStyle);

  return (
    <>
      <SectionEyebrow
        title="Appearance"
        description="Visual preferences for messenger density and atmosphere."
      />
      <SettingsGroup>
        <SettingsRow
          title="Theme"
          subtitle="Choose whether the app follows the system theme or always stays light or dark."
        />
        <View className="px-4 pb-3">
          <ThemeModeSelector value={themePreference} onChange={setThemePreference} />
        </View>
        <SettingsRow
          title="Interface density"
          subtitle="Choose how tight or airy the messenger layout feels across chats and lists."
        />
        <View className="px-4 pb-3">
          <SegmentedSelector<InterfaceDensity>
            value={interfaceDensity}
            onChange={setInterfaceDensity}
            options={[
              { key: 'compact', label: 'Compact' },
              { key: 'comfortable', label: 'Comfort' },
            ]}
          />
        </View>
        <SettingsRow
          title="Surface style"
          subtitle="Switch between cleaner solid panels and lighter glass-like translucent surfaces."
          last
        />
        <View className="px-4 pb-3">
          <SegmentedSelector<SurfaceStyle>
            value={surfaceStyle}
            onChange={setSurfaceStyle}
            options={[
              { key: 'glass', label: 'Glass' },
              { key: 'solid', label: 'Solid' },
            ]}
          />
        </View>
      </SettingsGroup>
    </>
  );
}
