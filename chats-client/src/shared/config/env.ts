import { API_URL, SOCKET_URL } from '@env';
import { requireUrl } from './requireUrl';

/**
 * Runtime configuration injected at build time by react-native-dotenv from
 * `.env.development` (Metro in development mode), `.env.production` (release
 * bundles) or `.env.test` (Jest). See requireUrl.ts for the validation rules
 * (no cleartext in release).
 */
export const env = {
  API_URL: requireUrl('API_URL', API_URL, __DEV__),
  SOCKET_URL: requireUrl('SOCKET_URL', SOCKET_URL, __DEV__),
} as const;
