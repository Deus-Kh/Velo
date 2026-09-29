import ReactNativeBlobUtil from 'react-native-blob-util';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import { getOrCreateSessionMasterKey } from '../crypto/sessionMasterKey';

/**
 * Decrypted media at rest (T8.3): one file per attachment under the app's
 * private documents directory, sealed under the per-user session master
 * key (XSalsa20-Poly1305, like every other record; the Keychain holds the
 * key). Files are base64 of `nonce ‖ box` so the file library can read and
 * write them without a byte API. A small in-memory cache keeps recently
 * shown data URIs so lists do not re-read files on every render.
 */
const DIR_NAME = 'velo-media';
const CACHE_LIMIT = 24;
const dataUriCache = new Map<string, string>();

export function mediaDir(myUserId: string): string {
  return `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/${DIR_NAME}/${myUserId}`;
}

export function mediaPath(myUserId: string, blobId: string): string {
  if (!/^[0-9a-f]{32}$/.test(blobId)) throw new Error('invalid blob id');
  return `${mediaDir(myUserId)}/${blobId}.sealed`;
}

export async function saveMedia(params: { myUserId: string; blobId: string; bytes: Uint8Array }): Promise<void> {
  const mk = await getOrCreateSessionMasterKey(params.myUserId);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(params.bytes, nonce, mk);
  const sealed = new Uint8Array(nonce.length + box.length);
  sealed.set(nonce, 0);
  sealed.set(box, nonce.length);
  const dir = mediaDir(params.myUserId);
  if (!(await ReactNativeBlobUtil.fs.exists(dir))) await ReactNativeBlobUtil.fs.mkdir(dir);
  await ReactNativeBlobUtil.fs.writeFile(mediaPath(params.myUserId, params.blobId), encodeBase64(sealed), 'base64');
}

export async function hasMedia(myUserId: string, blobId: string): Promise<boolean> {
  try {
    return await ReactNativeBlobUtil.fs.exists(mediaPath(myUserId, blobId));
  } catch {
    return false;
  }
}

/** The plaintext bytes, or null when the file is missing or does not open under this account's key. */
export async function loadMedia(myUserId: string, blobId: string): Promise<Uint8Array | null> {
  try {
    const path = mediaPath(myUserId, blobId);
    if (!(await ReactNativeBlobUtil.fs.exists(path))) return null;
    const raw = (await ReactNativeBlobUtil.fs.readFile(path, 'base64')) as string;
    const sealed = decodeBase64(raw);
    if (sealed.length <= nacl.secretbox.nonceLength) return null;
    const mk = await getOrCreateSessionMasterKey(myUserId);
    return nacl.secretbox.open(sealed.subarray(nacl.secretbox.nonceLength), sealed.subarray(0, nacl.secretbox.nonceLength), mk);
  } catch {
    return null;
  }
}

export async function deleteMedia(myUserId: string, blobId: string): Promise<void> {
  dataUriCache.delete(blobId);
  try {
    const path = mediaPath(myUserId, blobId);
    if (await ReactNativeBlobUtil.fs.exists(path)) await ReactNativeBlobUtil.fs.unlink(path);
  } catch {
    /* already gone */
  }
}

/** Logout / account deletion: the whole media directory of the account. */
export async function deleteAllMediaForUser(myUserId: string): Promise<void> {
  dataUriCache.clear();
  try {
    const dir = mediaDir(myUserId);
    if (await ReactNativeBlobUtil.fs.exists(dir)) await ReactNativeBlobUtil.fs.unlink(dir);
  } catch {
    /* nothing to remove */
  }
}

export function dataUriFor(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${encodeBase64(bytes)}`;
}

/** A displayable URI for a stored attachment, cached; null when it is not on the device. */
export async function mediaDataUri(myUserId: string, blobId: string, contentType: string): Promise<string | null> {
  const cached = dataUriCache.get(blobId);
  if (cached) return cached;
  const bytes = await loadMedia(myUserId, blobId);
  if (!bytes) return null;
  const uri = dataUriFor(contentType, bytes);
  dataUriCache.set(blobId, uri);
  if (dataUriCache.size > CACHE_LIMIT) {
    const oldest = dataUriCache.keys().next().value;
    if (oldest !== undefined) dataUriCache.delete(oldest);
  }
  return uri;
}

export function rememberDataUri(blobId: string, uri: string): void {
  dataUriCache.set(blobId, uri);
}

/** A plaintext copy in the cache directory for a player that needs a path (voice notes, T8.4); the caller deletes it. */
export async function writeTempPlaintext(myUserId: string, blobId: string, bytes: Uint8Array, extension: string): Promise<string> {
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/velo-play-${myUserId}-${blobId}.${extension}`;
  await ReactNativeBlobUtil.fs.writeFile(path, encodeBase64(bytes), 'base64');
  return path;
}

export async function deleteTempFile(path: string): Promise<void> {
  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) await ReactNativeBlobUtil.fs.unlink(path);
  } catch {
    /* ignore */
  }
}
