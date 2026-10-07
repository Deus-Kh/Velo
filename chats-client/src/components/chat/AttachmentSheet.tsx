import { Pressable, Text, View } from 'react-native';

import BottomSheetPanel from '../BottomSheetPanel';

export default function AttachmentSheet({
  onClose,
  onSendPhoto,
}: {
  onClose: () => void;
  onSendPhoto: () => void;
}) {
  return (
    <BottomSheetPanel title="Attachments" onClose={onClose}>
      <View className="flex-row gap-3 px-1">
        <Pressable
          onPress={() => {
            onClose();
            onSendPhoto();
          }}
          className="flex-1 items-center rounded-[18px] border border-border bg-background-alt/60 px-3 py-4 active:opacity-80"
        >
          <Text className="text-[15px] font-medium text-text">Photo</Text>
          <Text className="mt-1 text-center text-[12px] leading-4 text-muted">Choose a photo from this device.</Text>
        </Pressable>
      </View>
    </BottomSheetPanel>
  );
}
