import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

export const encodeKey = (key: Uint8Array): string =>
  encodeBase64(key);

export const decodeKey = (key: string): Uint8Array =>
  decodeBase64(key);
