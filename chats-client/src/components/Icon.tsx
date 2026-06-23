// components/Icon.tsx
import type { ComponentProps } from 'react';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import { Lucide } from '@react-native-vector-icons/lucide/static';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];
type LucideName = ComponentProps<typeof Lucide>['name'];

type IconProps =
  | { lib: 'Ionicons'; name: IoniconsName; size?: number; color?: string }
  | { lib: 'Lucide'; name: LucideName; size?: number; color?: string };

export function Icon({ lib, name, size = 24, color = '#000' }: IconProps) {
  if (lib === 'Ionicons') {
    return <Ionicons name={name} size={size} color={color} />;
  }
  return <Lucide name={name} size={size} color={color} />;
}