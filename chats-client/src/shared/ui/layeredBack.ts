import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * Hardware Back on a screen that stacks layers (a reply bar, an edit bar,
 * bottom sheets, a forward picker). One press closes the topmost open
 * layer; only when nothing is open does it leave the screen. Roadmap §8.1
 * A7: the chat used to call `onClose()` unconditionally, so Back with a
 * sheet open threw the user out of the conversation.
 *
 * `layers` are listed bottom to top: the last open one is the one a press
 * closes. A `Modal` (the image viewer) is not a layer here: Android hands
 * its Back to the modal's `onRequestClose` before any BackHandler listener.
 */
export type BackLayer = { open: boolean; close: () => void };

/** Pure: closes the topmost open layer and reports whether the press was consumed by a layer. */
export function resolveBackPress(layers: readonly BackLayer[], closeScreen: () => void): { consumedBy: 'layer' | 'screen' } {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i]!;
    if (layer.open) {
      layer.close();
      return { consumedBy: 'layer' };
    }
  }
  closeScreen();
  return { consumedBy: 'screen' };
}

export function useLayeredBackHandler(layers: readonly BackLayer[], closeScreen: () => void): void {
  const latest = useRef({ layers, closeScreen });
  latest.current = { layers, closeScreen };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      resolveBackPress(latest.current.layers, latest.current.closeScreen);
      return true; // handled here either way; the navigator must not also pop
    });
    return () => subscription.remove();
  }, []);
}
