// Polyfill globalThis.crypto.getRandomValues for the Hermes runtime on iOS/Android.
// MUST come before anything that touches `crypto` (e.g. src/auth/anonymous.ts).
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
