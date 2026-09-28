import { useEffect } from 'react';
import notifee, { EventType, type Event as NotifeeEvent } from '@notifee/react-native';
import { getMessaging, onMessage, setBackgroundMessageHandler, type RemoteMessage } from '@react-native-firebase/messaging';
import { useAppUiStore } from '../../store/app-ui.store';
import { currentUserIdForBackground, fetchAndIngestUndelivered } from './pushIngest';
import { parsePushData } from './pushPolicy';

/**
 * T3.3 wiring. A push is a data-only wake-up (see pushPolicy.parsePushData):
 * the device fetches, decrypts, stores, acks and renders. A tap on a
 * notification opens that chat, whether the app was in the foreground, the
 * background, or not running.
 */

async function handlePushWakeup(message: RemoteMessage): Promise<void> {
  const wakeup = parsePushData(message.data);
  if (!wakeup) return;
  try {
    const myUserId = await currentUserIdForBackground();
    if (!myUserId) return; // signed out: nothing to fetch, nothing to show
    await fetchAndIngestUndelivered(myUserId);
  } catch (e) {
    console.warn('[push] wake-up handling failed:', (e as Error)?.message ?? e);
  }
}

function peerFromNotification(event: NotifeeEvent): string | null {
  const data = event.detail?.notification?.data;
  const peer = data && typeof data.fromUserId === 'string' ? data.fromUserId : null;
  return peer || null;
}

let backgroundHandlersRegistered = false;

/** Called once from index.js, before the app registers: headless tasks need these at load time. */
export function registerBackgroundPushHandlers(): void {
  if (backgroundHandlersRegistered) return;
  backgroundHandlersRegistered = true;

  setBackgroundMessageHandler(getMessaging(), handlePushWakeup);

  notifee.onBackgroundEvent(async (event) => {
    if (event.type !== EventType.PRESS) return;
    const peer = peerFromNotification(event);
    if (peer) useAppUiStore.getState().setPendingOpenChatPeerUserId(peer);
  });
}

/**
 * Foreground wiring for the signed-in shell: a push while the app is open,
 * a tap while the app is open, and the notification that launched the app.
 */
export function usePushHandlers(enabled: boolean): void {
  const setPendingOpenChatPeerUserId = useAppUiStore((s) => s.setPendingOpenChatPeerUserId);

  useEffect(() => {
    if (!enabled) return;

    const unsubscribeMessage = onMessage(getMessaging(), handlePushWakeup);
    const unsubscribeForeground = notifee.onForegroundEvent((event) => {
      if (event.type !== EventType.PRESS) return;
      const peer = peerFromNotification(event);
      if (peer) setPendingOpenChatPeerUserId(peer);
    });

    notifee
      .getInitialNotification()
      .then((initial) => {
        const data = initial?.notification?.data;
        const peer = data && typeof data.fromUserId === 'string' ? data.fromUserId : null;
        if (peer) setPendingOpenChatPeerUserId(peer);
      })
      .catch((e) => console.warn('[push] initial notification lookup failed:', e));

    return () => {
      unsubscribeMessage();
      unsubscribeForeground();
    };
  }, [enabled, setPendingOpenChatPeerUserId]);
}
