/**
 * @format
 */
import "react-native-get-random-values";
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import "./global.css"

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerBackgroundPushHandlers } from './src/shared/notifications/pushHandlers';

// T3.3: the push wake-up and notification taps are handled in a headless task,
// so the handlers must exist before the app component is registered.
registerBackgroundPushHandlers();

AppRegistry.registerComponent(appName, () => App);
