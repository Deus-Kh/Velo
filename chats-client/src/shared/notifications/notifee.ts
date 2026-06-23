import notifee, { AndroidImportance } from '@notifee/react-native';

const MESSAGE_CHANNEL_ID = 'messages';

let channelReadyPromise: Promise<string> | null = null;

export async function ensureMessageNotificationChannel() {
  if (!channelReadyPromise) {
    channelReadyPromise = notifee.createChannel({
      id: MESSAGE_CHANNEL_ID,
      name: 'Messages',
      importance: AndroidImportance.HIGH,
      vibration: true,
      lights: true,
    });
  }

  return channelReadyPromise;
}

export async function displayIncomingMessageNotification(params: {
  title: string;
  body: string;
  conversationId: string;
  fromUserId: string;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}) {
  const channelId = await ensureMessageNotificationChannel();

  await notifee.displayNotification({
    id: `message:${params.conversationId}:${Date.now()}`,
    title: params.title,
    body: params.body,
    android: {
      channelId,
      pressAction: {
        id: 'default',
      },
      smallIcon: 'ic_launcher',
      timestamp: Date.now(),
      showTimestamp: true,
      sound: params.soundEnabled ? 'default' : undefined,
      vibrationPattern: params.vibrationEnabled ? [300, 500] : [0],
    },
    data: {
      conversationId: params.conversationId,
      fromUserId: params.fromUserId,
    },
  });
}

export async function cancelConversationNotifications(conversationId: string) {
  const displayedNotifications = await notifee.getDisplayedNotifications();
  const matchingIds = displayedNotifications
    .filter(
      (item) => item.notification?.data?.conversationId === conversationId && item.id,
    )
    .map((item) => item.id as string);

  if (matchingIds.length === 0) {
    return;
  }

  await Promise.all(
    matchingIds.map((notificationId) =>
      notifee.cancelDisplayedNotification(notificationId),
    ),
  );
}
