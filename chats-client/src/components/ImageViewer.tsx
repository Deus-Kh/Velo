import { useEffect } from 'react';
import { Image, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

/** T8.3/B12: an opaque image viewer with pinch, double-tap and swipe-down dismissal. */
export default function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    if (!uri) {
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    }
  }, [uri, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

  const resetZoom = () => {
    'worklet';
    scale.value = withSpring(1);
    savedScale.value = 1;
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.max(1, Math.min(savedScale.value * event.scale, 4));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) resetZoom();
    });

  const pan = Gesture.Pan()
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd((event) => {
      if (scale.value === 1 && Math.abs(event.translationY) > 120 && Math.abs(event.translationY) > Math.abs(event.translationX)) {
        runOnJS(onClose)();
        return;
      }
      if (scale.value === 1) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) resetZoom();
      else {
        scale.value = withSpring(2);
        savedScale.value = 2;
      }
    });

  const gestures = Gesture.Simultaneous(Gesture.Exclusive(doubleTap, pan), pinch);
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal visible={Boolean(uri)} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black">
        <GestureDetector gesture={gestures}>
          <Animated.View className="items-center justify-center" style={imageStyle}>
            {uri ? <Image source={{ uri }} style={{ width, height: height * 0.85 }} resizeMode="contain" accessibilityLabel="Photo, full screen" /> : null}
          </Animated.View>
        </GestureDetector>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" className="absolute right-4 top-12 rounded-full bg-white/15 px-3 py-1.5">
          <Text className="text-sm font-semibold text-white">Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
