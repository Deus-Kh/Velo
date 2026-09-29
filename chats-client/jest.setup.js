/**
 * Jest environment for the app (T4.7). Native modules the app touches at
 * import time are replaced by their official Jest mocks or by inert stubs,
 * so the default App smoke test and any screen test can render.
 */
/* eslint-env jest */
require('react-native-gesture-handler/jestSetup');

// Reanimated 4 runs on react-native-worklets; both ship a Jest mock.
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-keychain', () => {
  const store = new Map();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    getGenericPassword: jest.fn(async ({ service }) => (store.has(service) ? { service, username: 'u', password: store.get(service) } : false)),
    setGenericPassword: jest.fn(async (_u, password, { service }) => {
      store.set(service, password);
      return true;
    }),
    resetGenericPassword: jest.fn(async ({ service }) => store.delete(service)),
  };
});

jest.mock('@notifee/react-native', () => {
  const EventType = { UNKNOWN: -1, DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3, APP_BLOCKED: 4, CHANNEL_BLOCKED: 5, CHANNEL_GROUP_BLOCKED: 6, TRIGGER_NOTIFICATION_CREATED: 7 };
  return {
    __esModule: true,
    EventType,
    AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    default: {
      createChannel: jest.fn(async () => 'messages'),
      displayNotification: jest.fn(async () => 'id'),
      getDisplayedNotifications: jest.fn(async () => []),
      cancelDisplayedNotification: jest.fn(async () => undefined),
      onBackgroundEvent: jest.fn(),
      onForegroundEvent: jest.fn(() => () => {}),
      getInitialNotification: jest.fn(async () => null),
    },
  };
});

jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2, EPHEMERAL: 3, DENIED: 0, NOT_DETERMINED: -1 },
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(async () => 'fcm-token'),
  deleteToken: jest.fn(async () => undefined),
  hasPermission: jest.fn(async () => 1),
  requestPermission: jest.fn(async () => 1),
  isDeviceRegisteredForRemoteMessages: jest.fn(() => true),
  registerDeviceForRemoteMessages: jest.fn(async () => undefined),
  onMessage: jest.fn(() => () => {}),
  onTokenRefresh: jest.fn(() => () => {}),
  setBackgroundMessageHandler: jest.fn(),
  onNotificationOpenedApp: jest.fn(() => () => {}),
  getInitialNotification: jest.fn(async () => null),
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// T8.3/T8.4: media libraries. The file system is an in-memory map keyed by path.
jest.mock('react-native-blob-util', () => {
  const files = new Map();
  const fs = {
    dirs: { DocumentDir: '/doc', CacheDir: '/cache' },
    exists: jest.fn(async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + '/'))),
    mkdir: jest.fn(async () => undefined),
    writeFile: jest.fn(async (p, data) => {
      files.set(p, String(data));
    }),
    readFile: jest.fn(async (p) => {
      if (!files.has(p)) throw new Error('ENOENT ' + p);
      return files.get(p);
    }),
    unlink: jest.fn(async (p) => {
      files.delete(p);
      for (const k of [...files.keys()]) if (k.startsWith(p + '/')) files.delete(k);
    }),
    stat: jest.fn(async (p) => ({ size: (files.get(p) || '').length })),
  };
  return { __esModule: true, default: { fs, __reset: () => files.clear() }, ReactNativeBlobUtil: { fs } };
});
// T8.4: the app's own Android audio module (record / play) as the JS side sees it.
{
  const { NativeModules } = require('react-native');
  NativeModules.VeloAudio = {
    startRecording: jest.fn(async (path) => path),
    stopRecording: jest.fn(async () => ''),
    startPlaying: jest.fn(async () => 0),
    stopPlaying: jest.fn(async () => undefined),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
}
jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn(async () => ({ didCancel: true })), launchCamera: jest.fn(async () => ({ didCancel: true })) }));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { getString: jest.fn(async () => ''), setString: jest.fn() },
}));


// Vector icons render nothing in tests (the native font is not loaded).
jest.mock('@react-native-vector-icons/ionicons', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-vector-icons/lucide', () => ({ __esModule: true, default: () => null }));
