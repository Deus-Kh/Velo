import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { classifySwipe, lockAxis, pageAfterSwipe, type SwipeAxis } from '../shared/media/viewerGestures';

export type ViewerImage = {
  uri: string;
  caption?: string;
};

const AXIS_NONE = 0;
const AXIS_HORIZONTAL = 1;
const AXIS_VERTICAL = 2;
const AXIS_ZOOM = 3;
function axisCode(axis: SwipeAxis | null): number {
  'worklet';
  return axis === 'horizontal' ? AXIS_HORIZONTAL : axis === 'vertical' ? AXIS_VERTICAL : AXIS_NONE;
}

/** One photo of the strip; only the photo on screen takes the zoom and its pan. */
function ViewerPage({
  image,
  index,
  active,
  width,
  height,
  scale,
  zoomX,
  zoomY,
}: {
  image: ViewerImage;
  index: number;
  active: boolean;
  width: number;
  height: number;
  scale: SharedValue<number>;
  zoomX: SharedValue<number>;
  zoomY: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() =>
    active ? { transform: [{ translateX: zoomX.value }, { translateY: zoomY.value }, { scale: scale.value }] } : { transform: [] },
  );
  return (
    <View className="absolute top-0 items-center justify-center" style={{ left: index * width, width, height }}>
      <Animated.View style={style}>
        <Image source={{ uri: image.uri }} style={{ width, height: height * 0.85 }} resizeMode="contain" accessibilityLabel="Photo, full screen" />
      </Animated.View>
    </View>
  );
}

/**
 * T8.3/B12, reworked: an opaque viewer that behaves like Telegram's. The
 * first movement of a one-finger drag locks its direction: sideways pages
 * through the photos (the neighbours slide in with the finger, the strip
 * snaps to a page), up or down moves the photo away with the black fading
 * out and closes the viewer when let go far or fast enough. Zoomed in
 * (pinch or double tap), a drag pans the photo instead.
 */
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
  // the strip of all photos: photo i sits at i * width, so a page change never re-positions anything
  const stripX = useSharedValue(-initialIndex * width);
  const dismissY = useSharedValue(0);
  const axis = useSharedValue(AXIS_NONE);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const zoomX = useSharedValue(0);
  const zoomY = useSharedValue(0);
  const savedZoomX = useSharedValue(0);
  const savedZoomY = useSharedValue(0);

  useEffect(() => {
    setIndex(initialIndex);
    activeIndex.value = initialIndex;
    stripX.value = -initialIndex * width;
    dismissY.value = 0;
    scale.value = 1;
    savedScale.value = 1;
    zoomX.value = 0;
    zoomY.value = 0;
    savedZoomX.value = 0;
    savedZoomY.value = 0;
  }, [images, initialIndex, width, activeIndex, stripX, dismissY, scale, savedScale, zoomX, zoomY, savedZoomX, savedZoomY]);

  const resetZoom = () => {
    'worklet';
    scale.value = withSpring(1);
    savedScale.value = 1;
    zoomX.value = withSpring(0);
    zoomY.value = withSpring(0);
    savedZoomX.value = 0;
    savedZoomY.value = 0;
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
    .minDistance(8)
    .onStart(() => {
      axis.value = AXIS_NONE;
      savedZoomX.value = zoomX.value;
      savedZoomY.value = zoomY.value;
    })
    .onUpdate((event) => {
      if (axis.value === AXIS_NONE) {
        axis.value = scale.value > 1.01 || event.numberOfPointers > 1 ? AXIS_ZOOM : axisCode(lockAxis(event.translationX, event.translationY));
      }
      if (axis.value === AXIS_ZOOM) {
        zoomX.value = savedZoomX.value + event.translationX;
        zoomY.value = savedZoomY.value + event.translationY;
      } else if (axis.value === AXIS_HORIZONTAL) {
        const atEdge =
          (activeIndex.value === 0 && event.translationX > 0) || (activeIndex.value === images.length - 1 && event.translationX < 0);
        // past the first or last photo the strip follows with resistance
        stripX.value = -activeIndex.value * width + event.translationX * (atEdge ? 0.3 : 1);
      } else if (axis.value === AXIS_VERTICAL) {
        dismissY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (axis.value === AXIS_HORIZONTAL) {
        const swipe = classifySwipe({ axis: 'horizontal', dx: event.translationX, dy: event.translationY, vx: event.velocityX, vy: event.velocityY, width, height });
        const next = pageAfterSwipe(activeIndex.value, images.length, swipe);
        if (next !== activeIndex.value) {
          activeIndex.value = next;
          runOnJS(setIndex)(next);
        }
        stripX.value = withTiming(-next * width, { duration: 220 });
      } else if (axis.value === AXIS_VERTICAL) {
        const swipe = classifySwipe({ axis: 'vertical', dx: event.translationX, dy: event.translationY, vx: event.velocityX, vy: event.velocityY, width, height });
        if (swipe === 'dismiss') {
          const away = event.translationY < 0 ? -height : height;
          dismissY.value = withTiming(away, { duration: 180 }, (finished) => {
            if (finished) runOnJS(onClose)();
          });
        } else {
          dismissY.value = withSpring(0, { damping: 20, stiffness: 220 });
        }
      }
      axis.value = AXIS_NONE;
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

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: stripX.value }, { translateY: dismissY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(dismissY.value) / (height * 0.6)) }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: dismissY.value === 0 ? 1 : Math.max(0, 1 - Math.abs(dismissY.value) / 120) }));

  const current = images[index];

  return (
    <Modal visible={images.length > 0} transparent animationType="fade" onRequestClose={onClose}>
      {/* a plain style: GestureHandlerRootView does not take className, and at zero size no touch reaches the gestures */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View className="absolute inset-0 bg-black" style={backdropStyle} />
        <GestureDetector gesture={gestures}>
          <View className="flex-1 overflow-hidden">
            <Animated.View className="absolute left-0 top-0" style={[{ width: width * Math.max(1, images.length), height }, stripStyle]}>
              {images.map((image, i) =>
                // only the photo on screen and its neighbours are mounted
                Math.abs(i - index) <= 1 ? (
                  <ViewerPage key={i} image={image} index={i} active={i === index} width={width} height={height} scale={scale} zoomX={zoomX} zoomY={zoomY} />
                ) : null,
              )}
            </Animated.View>
          </View>
        </GestureDetector>
        <Animated.View pointerEvents="box-none" className="absolute inset-0" style={chromeStyle}>
          {current?.caption ? (
            <Text className="absolute bottom-10 max-w-[90%] self-center text-center text-sm text-white">{current.caption}</Text>
          ) : null}
          {images.length > 1 ? (
            <Text className="absolute left-4 top-14 text-sm font-semibold text-white/80">{`${index + 1} of ${images.length}`}</Text>
          ) : null}
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" className="absolute right-4 top-12 rounded-full bg-white/15 px-3 py-1.5">
            <Text className="text-sm font-semibold text-white">Close</Text>
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
