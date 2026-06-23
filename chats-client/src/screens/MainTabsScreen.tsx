import { ComponentProps, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
// import Feather from 'react-native-vector-icons/Feather';
// import Ionicons from '@react-native-vector-icons/ionicons';
// import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
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
import { useAppearanceStore } from '../store/appearance.store';
import { useAuthStore } from '../store/auth.store';
import { useContactsStore } from '../store/contacts.store';
import { useAppUiStore } from '../store/app-ui.store';
import { cancelConversationNotifications } from '../shared/notifications/notifee';
import { Icon } from '../components/Icon';

import { useColorScheme } from 'react-native';




type TabKey = 'chats' | 'new-chat' | 'settings';

type ActiveChat = {
  peerUserId: string;
  peerUsername?: string;
};
// function getIconComponent(lib: string) {
//   switch (lib) {
//     case 'Ionicons':
//       return Ionicons;
//     case 'MaterialIcons':
//       return MaterialIcons;
//     default:
//       return Feather;
//   }
// }

// const TABS: { key: TabKey; label: string; shortLabel: string }[] = [
//   { key: 'chats', label: 'Chats', shortLabel: 'CH' },
//   { key: 'new-chat', label: 'New Chat', shortLabel: 'NEW' },
//   { key: 'settings', label: 'Settings', shortLabel: 'SET' },
// ];
// const TABS: { key: TabKey; label: string; shortLabel: string }[] = [
//   { key: 'chats', label: 'Chats', shortLabel: 'CH' },
//   { key: 'new-chat', label: 'New Chat', shortLabel: 'NEW' },
//   { key: 'settings', label: 'Settings', shortLabel: 'SET' },
// ];


// const TABS: {
//   key: TabKey;
//   label: string;
//   icon: string;
//   lib: 'Feather' | 'Ionicons' | 'MaterialIcons';
// }[] = [
//   { key: 'chats', label: 'Chats', icon: 'chatbubble-outline', lib: 'Ionicons' },
//   { key: 'new-chat', label: 'New Chat', icon: 'edit', lib: 'Feather' },
//   { key: 'settings', label: 'Settings', icon: 'settings', lib: 'MaterialIcons' },
// ];


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

// function TabButton({
//   active,
//   label,
//   icon,
//   lib,
//   onPress,
// }: {
//   active: boolean;
//   label: string;
//   // shortLabel: string;
//   icon: string;
//   lib: 'Feather' | 'Ionicons' | 'MaterialIcons';
//   onPress: () => void;
// }) {
//   const interfaceDensity = useAppearanceStore((s) => s.interfaceDensity);
//   const IconComponent = getIconComponent(lib);
//   return (
//     <Pressable
//       onPress={onPress}
//       className={`flex-1 items-center justify-center rounded-[16px] px-2 active:opacity-80 ${
//         interfaceDensity === 'compact' ? 'py-2' : 'py-2.5'
//       } ${
//         active ? 'bg-surface-elevated' : ''
//       }`}
//     >
//         {/* <Text className={`text-[11px] font-semibold uppercase tracking-[1.2px] ${active ? 'text-primary' : 'text-muted'}`}>
//           {shortLabel}
//         </Text> */}
//         <IconComponent
//         name={icon}
//         size={active ? 20 : 18}
//         color={active ? 'text-primary' : 'text-muted'}
//       />
//       <Text className={`mt-0.5 text-xs font-medium ${active ? 'text-text' : 'text-muted'}`}>
//         {label}
//       </Text>
//     </Pressable>
//   );
// }

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

  const [tab, setTab] = useState<TabKey>('chats');
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [recentlyClosedChatPeerUserId, setRecentlyClosedChatPeerUserId] = useState<string | null>(null);

  const overlayTranslateX = useSharedValue(frame.width);
  const swipeStartedFromEdge = useSharedValue(false);

  const openChat = useCallback((chat: ActiveChat) => {
    if (userId) {
      recordRecentContact(userId, chat.peerUserId);
      const conversationId = [userId, chat.peerUserId].sort().join(':');
      cancelConversationNotifications(conversationId).catch((error) => {
        console.warn('[notifications] failed to clear chat notifications:', error);
      });
    }
    setActiveChat(chat);
    setActiveChatPeerUserId(chat.peerUserId);
  }, [recordRecentContact, setActiveChatPeerUserId, userId]);

  const finishCloseChat = useCallback(() => {
    setActiveChat(null);
    setActiveChatPeerUserId(null);
  }, [setActiveChatPeerUserId]);

  const closeChat = useCallback(() => {
    const peerUserId = activeChat?.peerUserId ?? null;
    overlayTranslateX.value = withTiming(frame.width, { duration: 220 }, () => {
      if (peerUserId) {
        runOnJS(setRecentlyClosedChatPeerUserId)(peerUserId);
      }
      runOnJS(finishCloseChat)();
    });
  }, [activeChat?.peerUserId, finishCloseChat, frame.width, overlayTranslateX]);

  useEffect(() => {
    if (!activeChat) {
      overlayTranslateX.value = frame.width;
      return;
    }

    overlayTranslateX.value = frame.width;
    overlayTranslateX.value = withTiming(0, { duration: 240 });
  }, [activeChat, frame.width, overlayTranslateX]);

  const overlayGesture = Gesture.Pan()
    .enabled(Boolean(activeChat))
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
              recentlyClosedChatPeerUserId={recentlyClosedChatPeerUserId}
              onHandledClosedChat={() => setRecentlyClosedChatPeerUserId(null)}
            />
          </View>
          <View style={{ width: frame.width }}>
            <NewChatScreen
              onOpenChat={openChat}
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

          <Animated.View className="absolute inset-0" style={overlayAnimatedStyle}>
            <ChatScreen
              peerUserId={activeChat.peerUserId}
              peerUsername={activeChat.peerUsername}
              onClose={closeChat}
              onVerify={() =>
                navigation.navigate('VerifyContact', {
                  peerUserId: activeChat.peerUserId,
                  peerUsername: activeChat.peerUsername,
                  source: 'chat',
                })
              }
            />

            <GestureDetector gesture={overlayGesture}>
              <View
                className="absolute left-0 bottom-0"
                style={{
                  top: insets.top + 76,
                  bottom: insets.bottom + BACK_SWIPE_GESTURE_BOTTOM_INSET,
                  width: frame.width * BACK_SWIPE_GESTURE_WIDTH_RATIO,
                }}
              />
            </GestureDetector>
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}
