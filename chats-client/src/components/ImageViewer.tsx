import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

export type ViewerImage = {
  uri: string;
  caption?: string;
};

/** T8.3/B12: an opaque image viewer with pinch, double-tap and swipe-down dismissal. */
export default function ImageViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: ViewerImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const activeIndex = useSharedValue(initialIndex);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    setIndex(initialIndex);
    activeIndex.value = initialIndex;
    if (images.length === 0) {
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    }
  }, [images.length, initialIndex, activeIndex, scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY]);

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
    .minDistance(12)
    .activeOffsetX([-18, 18])
    .activeOffsetY([-18, 18])
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
      if (scale.value === 1 && Math.abs(event.translationX) > 100 && Math.abs(event.translationX) > Math.abs(event.translationY)) {
        const nextIndex = event.translationX < 0
          ? Math.min(activeIndex.value + 1, images.length - 1)
          : Math.max(activeIndex.value - 1, 0);
        if (nextIndex !== activeIndex.value) {
          activeIndex.value = nextIndex;
          runOnJS(setIndex)(nextIndex);
        }
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
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

  const gestures = Gesture.Simultaneous(doubleTap, pan, pinch);
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const current = images[index];

  return (
    <Modal visible={images.length > 0} transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-black">
        <GestureDetector gesture={gestures}>
          <Animated.View className="items-center justify-center" style={imageStyle}>
            {current ? <Image source={{ uri: current.uri }} style={{ width, height: height * 0.85 }} resizeMode="contain" accessibilityLabel="Photo, full screen" /> : null}
          </Animated.View>
        </GestureDetector>
        {current?.caption ? (
          <Text className="absolute bottom-10 max-w-[90%] text-center text-sm text-white">
            {current.caption}
          </Text>
        ) : null}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" className="absolute right-4 top-12 rounded-full bg-white/15 px-3 py-1.5">
          <Text className="text-sm font-semibold text-white">Close</Text>
        </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
