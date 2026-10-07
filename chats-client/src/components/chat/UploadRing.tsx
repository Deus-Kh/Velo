import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const SIZE = 44;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * Upload progress over a photo that is still being sent (Telegram-style):
 * a white ring on a dark disc, at least a sliver so it never looks stuck.
 * Inside a voice bubble's play button it draws only the ring, in the
 * button's icon colour.
 */
export default function UploadRing({ progress, color = '#FFFFFF', disc = true }: { progress: number; color?: string; disc?: boolean }) {
  const shown = Math.max(0.04, Math.min(1, progress));
  return (
    <View className={`h-11 w-11 items-center justify-center rounded-full ${disc ? 'bg-black/45' : ''}`} accessibilityLabel={`Uploading, ${Math.round(progress * 100)} percent`}>
      <Svg width={SIZE} height={SIZE}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${C * shown} ${C}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
    </View>
  );
}
