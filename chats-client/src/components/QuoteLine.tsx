import { Text, View } from 'react-native';
import { Icon } from './Icon';
import { useThemeColors } from '../theme/useThemeColors';
import { describeMessage, type DescribableMessage } from '../shared/chat/describeMessage';

/**
 * One line that stands for a message, with the kind's icon in front of the
 * text (a mic for a voice note, an image for a photo): the "Replying to"
 * and "Editing" bars, and any other place that quotes a message outside a
 * bubble. The bubble's own quote block draws the same pair itself.
 */
export default function QuoteLine({
  message,
  className = '',
  textClassName = 'text-[13px] leading-5 text-muted',
  iconColor,
  iconSize = 14,
}: {
  message: DescribableMessage;
  className?: string;
  textClassName?: string;
  iconColor?: string;
  iconSize?: number;
}) {
  const colors = useThemeColors();
  const description = describeMessage(message);
  return (
    <View className={`flex-row items-center ${className}`}>
      {description.icon ? (
        <View className="mr-1.5">
          <Icon lib="Lucide" name={description.icon} size={iconSize} color={iconColor ?? colors.muted} />
        </View>
      ) : null}
      <Text className={`shrink ${textClassName}`} numberOfLines={1}>
        {description.text}
      </Text>
    </View>
  );
}
