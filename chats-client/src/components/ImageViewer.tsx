import { Image, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';

/** T8.3: a full-screen look at a decrypted image; tap anywhere to close. */
export default function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible={Boolean(uri)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-black/95">
        {uri ? <Image source={{ uri }} style={{ width, height: height * 0.85 }} resizeMode="contain" accessibilityLabel="Photo, full screen" /> : null}
        <View className="absolute right-4 top-12 rounded-full bg-white/15 px-3 py-1.5">
          <Text className="text-sm font-semibold text-white">Close</Text>
        </View>
      </Pressable>
    </Modal>
  );
}
