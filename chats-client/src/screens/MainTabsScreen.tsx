import { ComponentProps, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { RootStackParamList } from '../app/Navigation';
import ChatListScreen from './ChatListScreen';
import NewChatScreen from './NewChatScreen';
import SettingsScreen from './SettingsScreen';
import ChatScreen from './ChatScreen';
import GroupChatScreen from './GroupChatScreen';
import { groupPeerKey } from '../shared/api/groups.api';
import { useAppearanceStore } from '../store/appearance.store';
import { useAuthStore } from '../store/auth.store';
import { useContactsStore } from '../store/contacts.store';
import { useAppUiStore } from '../store/app-ui.store';
import { cancelConversationNotifications } from '../shared/notifications/notifee';
import { usePushHandlers } from '../shared/notifications/pushHandlers';
import { useExpirySweeper } from '../shared/chat/useExpirySweeper';
import { useBlocksSync } from '../shared/chat/blocks';
import { useProfilesSync } from '../shared/chat/profile';
import { Icon } from '../components/Icon';

import { useColorScheme } from 'react-native';




type TabKey = 'chats' | 'new-chat' | 'settings';

type ActiveChat =
  | { kind: 'peer'; peerUserId: string; peerUsername?: string; jumpToMessageId?: string }
  | { kind: 'group'; groupId: string; name?: string; jumpToMessageId?: string };


const TABS: {
  key: TabKey;
  label: string;
  icon: ComponentProps<typeof Icon>;
}[] = [
  { key: 'chats',    label: 'Chats',    icon: { lib: 'Ionicons', name: 'chatbubbles-outline' } },
  { key: 'new-chat', label: 'New Chat', icon: { lib: 'Lucide',   name: 'user-round-search'} },
  { key: 'settings', label: 'Settings', icon: { lib: 'Lucide',   name: 'settings'} },
];
const BACK_SWIPE_GESTURE_WIDTH_RATIO = 0.5;
const BACK_SWIPE_DISTANCE_TRIGGER = 110;
const BACK_SWIPE_VELOCITY_TRIGGER = 900;
const BACK_SWIPE_GESTURE_BOTTOM_INSET = 118;
const BACK_SWIPE_GESTURE_TOP_INSET = 76;


function TabButton({
   active,
  label,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: ComponentProps<typeof Icon>;
  onPress: () => void;
}) {
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);

  const scheme = useColorScheme();

  const isDark = scheme === 'dark';


  const themeColors = isDark? {primary: '#f1f5f9', muted: '#94a3b8'}:{primary: '#0f172a', muted: '#64748b'};



  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center justify-center rounded-[16px] px-2 active:opacity-80 ${
        interfaceDensity === 'compact' ? 'py-2' : 'py-2.5'
      } ${active ? 'bg-surface-elevated' : ''}`}
    >
      <Icon
        {...icon}
        size={active ? 20 : 18}
        color={active ? themeColors.primary : themeColors.muted}
      />
      <Text className={`mt-0.5 text-xs font-medium ${active ? 'text-text' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
export default function MainTabsScreen() {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const pagerRef = useRef<ScrollView | null>(null);
  const pagerInitializedRef = useRef(false);
  const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
  const surfaceStyle = useAppearanceStore((s) => s.surfaceStyle);
  const userId = useAuthStore((s) => s.userId);
  const recordRecentContact = useContactsStore((s) => s.recordRecentContact);
  const setActiveChatPeerUserId = useAppUiStore((s) => s.setActiveChatPeerUserId);
  const pendingOpenChatPeerUserId = useAppUiStore((s) => s.pendingOpenChatPeerUserId);
  const setPendingOpenChatPeerUserId = useAppUiStore((s) => s.setPendingOpenChatPeerUserId);
  const savedContactsByUser = useContactsStore((s) => s.savedContactsByUser);

  const [tab, setTab] = useState<TabKey>('chats');
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [recentlyClosedChatPeerUserId, setRecentlyClosedChatPeerUserId] = useState<string | null>(null);

  const overlayTranslateX = useSharedValue(frame.width);
  const swipeStartedFromEdge = useSharedValue(false);

  const openChat = useCallback((chat: { peerUserId: string; peerUsername?: string; jumpToMessageId?: string }) => {
    if (userId) {
      recordRecentContact(userId, chat.peerUserId);
      const conversationId = [userId, chat.peerUserId].sort().join(':');
      cancelConversationNotifications(conversationId).catch((error) => {
        console.warn('[notifications] failed to clear chat notifications:', error);
      });
    }
    setActiveChat({ kind: 'peer', ...chat });
    setActiveChatPeerUserId(chat.peerUserId);
  }, [recordRecentContact, setActiveChatPeerUserId, userId]);

  // T6.4: a group occupies the same overlay; its "peer" slot is group:<id> (notifications, store).
  const openGroup = useCallback((group: { groupId: string; name?: string; jumpToMessageId?: string }) => {
    cancelConversationNotifications(groupPeerKey(group.groupId)).catch((error) => {
      console.warn('[notifications] failed to clear group notifications:', error);
    });
    setActiveChat({ kind: 'group', ...group });
    setActiveChatPeerUserId(groupPeerKey(group.groupId));
  }, [setActiveChatPeerUserId]);

  // T3.3: push in the foreground, notification taps, and the notification that launched the app.
  usePushHandlers(Boolean(userId));
  // T7.3: expired messages go when the app comes to the foreground.
  useExpirySweeper(userId);
  // T7.5: the block list is mirrored locally so inbound copies are dropped at once.
  useBlocksSync(userId);
  // T7.7: profiles (ours and contacts') from the sealed store into memory.
  useProfilesSync(userId);

  useEffect(() => {
    if (!pendingOpenChatPeerUserId || !userId) return;
    if (pendingOpenChatPeerUserId.startsWith('group:')) {
      openGroup({ groupId: pendingOpenChatPeerUserId.slice('group:'.length) });
      setPendingOpenChatPeerUserId(null);
      return;
    }
    const contact = (savedContactsByUser[userId] ?? []).find((c) => c.peerUserId === pendingOpenChatPeerUserId);
    openChat({ peerUserId: pendingOpenChatPeerUserId, peerUsername: contact?.peerUsername });
    setPendingOpenChatPeerUserId(null);
  }, [openChat, openGroup, pendingOpenChatPeerUserId, savedContactsByUser, setPendingOpenChatPeerUserId, userId]);

  const finishCloseChat = useCallback(() => {
    setActiveChat(null);
    setActiveChatPeerUserId(null);
  }, [setActiveChatPeerUserId]);

  const closeChat = useCallback(() => {
    const peerUserId = activeChat?.kind === 'peer' ? activeChat.peerUserId : null;
    overlayTranslateX.value = withTiming(frame.width, { duration: 220 }, () => {
      if (peerUserId) {
        runOnJS(setRecentlyClosedChatPeerUserId)(peerUserId);
      }
      runOnJS(finishCloseChat)();
    });
  }, [activeChat, finishCloseChat, frame.width, overlayTranslateX]);

  useEffect(() => {
    if (!activeChat) {
      overlayTranslateX.value = frame.width;
      return;
    }

    overlayTranslateX.value = frame.width;
    overlayTranslateX.value = withTiming(0, { duration: 240 });
  }, [activeChat, frame.width, overlayTranslateX]);

  // Back swipe: the pan is attached to the chat overlay itself, so taps and
  // the vertical scroll reach the chat's own views; hitSlop limits it to
  // touches that begin in the left half between the header and the
  // composer (an invisible strip on top of the chat used to do this and
  // swallowed every tap in that half: play buttons, photos, incoming bubbles).
  const overlayGesture = Gesture.Pan()
    .enabled(Boolean(activeChat))
    .hitSlop({
      left: 0,
      width: frame.width * BACK_SWIPE_GESTURE_WIDTH_RATIO,
      top: -(insets.top + BACK_SWIPE_GESTURE_TOP_INSET),
      bottom: -(insets.bottom + BACK_SWIPE_GESTURE_BOTTOM_INSET),
    })
    .activeOffsetX([12, 999])
    .failOffsetY([-14, 14])
    .onBegin((event) => {
      swipeStartedFromEdge.value = event.x <= frame.width * BACK_SWIPE_GESTURE_WIDTH_RATIO;
    })
    .onUpdate((event) => {
      if (!swipeStartedFromEdge.value) return;
      overlayTranslateX.value = Math.max(0, Math.min(event.translationX, frame.width));
    })
    .onEnd((event) => {
      if (!swipeStartedFromEdge.value) {
        overlayTranslateX.value = withTiming(0, { duration: 180 });
        return;
      }

      const shouldClose =
        event.translationX > BACK_SWIPE_DISTANCE_TRIGGER ||
        event.velocityX > BACK_SWIPE_VELOCITY_TRIGGER;

      if (shouldClose) {
        overlayTranslateX.value = withTiming(frame.width, { duration: 200 }, () => {
          runOnJS(finishCloseChat)();
        });
        return;
      }

      overlayTranslateX.value = withTiming(0, { duration: 180 });
    })
    .onFinalize(() => {
      swipeStartedFromEdge.value = false;
    });

  const overlayAnimatedStyle = useAnimatedStyle(() => {
    const isMoving = overlayTranslateX.value > 1 && overlayTranslateX.value < frame.width - 1;

    return {
      transform: [{ translateX: overlayTranslateX.value }],
      shadowColor: '#000',
      shadowOpacity: isMoving ? 0.16 : 0,
      shadowRadius: isMoving ? 20 : 0,
      shadowOffset: { width: -8, height: 0 },
      elevation: isMoving ? 10 : 0,
    };
  });

  const shellAnimatedStyle = useAnimatedStyle(() => {
    if (!activeChat || frame.width <= 0) {
      return {};
    }

    const progress = 1 - Math.min(overlayTranslateX.value / frame.width, 1);

    return {
      transform: [
        { translateX: interpolate(progress, [0, 1], [0, -14]) },
      ],
    };
  });

  const dimAnimatedStyle = useAnimatedStyle(() => {
    if (!activeChat || frame.width <= 0) {
      return {
        opacity: 0,
      };
    }

    const progress = 1 - Math.min(overlayTranslateX.value / frame.width, 1);

    return {
      opacity: interpolate(progress, [0, 1], [0, 0.1]),
    };
  });

  useEffect(() => {
    const tabIndex = TABS.findIndex((item) => item.key === tab);
    if (tabIndex < 0 || frame.width <= 0) return;

    pagerRef.current?.scrollTo({
      x: tabIndex * frame.width,
      animated: pagerInitializedRef.current,
    });

    if (!pagerInitializedRef.current) {
      pagerInitializedRef.current = true;
    }
  }, [frame.width, tab]);

  const handlePagerMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (frame.width <= 0) return;

      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / frame.width);
      const nextTab = TABS[nextIndex]?.key;

      if (nextTab && nextTab !== tab) {
        setTab(nextTab);
      }
    },
    [frame.width, tab],
  );

  return (
    <View className="flex-1 bg-background">
      <Animated.View className="flex-1" style={shellAnimatedStyle}>
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onMomentumScrollEnd={handlePagerMomentumEnd}
        >
          <View style={{ width: frame.width }}>
            <ChatListScreen
              onOpenChat={openChat}
              onOpenGroup={openGroup}
              recentlyClosedChatPeerUserId={recentlyClosedChatPeerUserId}
              onHandledClosedChat={() => setRecentlyClosedChatPeerUserId(null)}
            />
          </View>
          <View style={{ width: frame.width }}>
            <NewChatScreen
              onOpenChat={openChat}
              onOpenGroup={openGroup}
              onVerifyContact={({ peerUserId, peerUsername, peerEmail }) =>
                navigation.navigate('VerifyContact', {
                  peerUserId,
                  peerUsername,
                  peerEmail,
                  source: 'new-chat',
                })
              }
            />
          </View>
          <View style={{ width: frame.width }}>
            <SettingsScreen />
          </View>
        </ScrollView>

        <View
          className={`border-t border-border px-3 ${interfaceDensity === 'compact' ? 'pt-1.5' : 'pt-2'} ${
            surfaceStyle === 'glass' ? 'bg-background-alt/88' : 'bg-background-alt'
          }`}
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View
            className={`flex-row rounded-[20px] border border-border ${
              surfaceStyle === 'glass' ? 'bg-surface/82' : 'bg-surface-elevated'
            } ${interfaceDensity === 'compact' ? 'p-1' : 'p-1.5'}`}
          >
            {TABS.map((item) => (
              <TabButton
                key={item.key}
                active={tab === item.key}
                label={item.label}
                icon={item.icon}
                onPress={() => setTab(item.key)}
              />
            ))}
          </View>
        </View>
      </Animated.View>

      {activeChat ? (
        <>
          <Animated.View
            pointerEvents="none"
            className="absolute inset-0 bg-black"
            style={dimAnimatedStyle}
          />

          <GestureDetector gesture={overlayGesture}>
          <Animated.View className="absolute inset-0" style={overlayAnimatedStyle}>
            {activeChat.kind === 'group' ? (
              <GroupChatScreen groupId={activeChat.groupId} initialName={activeChat.name} jumpToMessageId={activeChat.jumpToMessageId} onClose={closeChat} />
            ) : (
            <ChatScreen
              peerUserId={activeChat.peerUserId}
              peerUsername={activeChat.peerUsername}
              jumpToMessageId={activeChat.jumpToMessageId}
              onClose={closeChat}
              onVerify={() =>
                navigation.navigate('VerifyContact', {
                  peerUserId: activeChat.peerUserId,
                  peerUsername: activeChat.peerUsername,
                  source: 'chat',
                })
              }
            />
            )}
          </Animated.View>
          </GestureDetector>
        </>
      ) : null}
    </View>
  );
}
