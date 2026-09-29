import { PermissionsAndroid, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { decodeBase64 } from 'tweetnacl-util';
import { MAX_ATTACHMENT_BYTES, type AttachmentContent } from '@velo/protocol';
import type { AttachmentMeta } from '../storage/messageStore';
import { uploadAttachment } from './attachments';
import { deleteTempFile, loadMedia, writeTempPlaintext } from './mediaStore';
import { nativeAudio } from './nativeAudio';
import type { BlobTransport, ProgressFn } from './transport';

/**
 * Voice notes (T8.4): recorded to the app's cache as AAC in an MP4
 * container by the app's own audio module, read once, encrypted and sent
 * on the attachment path with `contentType: 'audio/mp4'` and the
 * duration; the recording file is deleted right after. Playback decrypts
 * to a temporary file the player can open and deletes it when playback
 * ends or is stopped.
 */
export const VOICE_NOTE_CONTENT_TYPE = 'audio/mp4';
export const MIN_VOICE_NOTE_MS = 700;
export const MAX_VOICE_NOTE_MS = 5 * 60 * 1000;

export async function ensureMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone',
    message: 'Velo needs the microphone to record a voice message. Recordings are encrypted before they leave this phone.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

let recording: { path: string; startedAt: number; unsubscribe: () => void } | null = null;

export function isRecording(): boolean {
  return recording !== null;
}

/** Start a recording; resolves with the file path. `onTick` gets the elapsed ms. */
export async function startVoiceRecording(onTick?: (elapsedMs: number) => void): Promise<string> {
  if (recording) throw new Error('already recording');
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/velo-rec-${Date.now()}.m4a`;
  const unsubscribe = nativeAudio.onRecordTick((t) => {
    onTick?.(t.elapsedMs);
    if (t.elapsedMs >= MAX_VOICE_NOTE_MS) stopVoiceRecording().catch(() => undefined);
  });
  try {
    await nativeAudio.startRecording(path);
  } catch (e) {
    unsubscribe();
    throw e;
  }
  recording = { path, startedAt: Date.now(), unsubscribe };
  return path;
}

export type Recording = { bytes: Uint8Array; durationMs: number };

/** Stop and read the recording (the file is deleted); null when it was too short to keep. */
export async function stopVoiceRecording(): Promise<Recording | null> {
  const current = recording;
  if (!current) return null;
  recording = null;
  current.unsubscribe();
  let path = current.path;
  try {
    const r = await nativeAudio.stopRecording();
    if (typeof r === 'string' && r.length > 0) path = r;
  } catch (e) {
    console.warn('[voice] stopRecording:', (e as Error)?.message ?? e);
  }
  const durationMs = Date.now() - current.startedAt;
  path = path.replace(/^file:\/\//, '');
  try {
    if (durationMs < MIN_VOICE_NOTE_MS) return null;
    if (!(await ReactNativeBlobUtil.fs.exists(path))) throw new Error('The recording was not saved');
    const b64 = (await ReactNativeBlobUtil.fs.readFile(path, 'base64')) as string;
    const bytes = decodeBase64(b64);
    if (bytes.length === 0) throw new Error('The recording is empty');
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('The recording is too large to send');
    return { bytes, durationMs };
  } finally {
    await deleteTempFile(path);
  }
}

export async function cancelVoiceRecording(): Promise<void> {
  const current = recording;
  if (!current) return;
  recording = null;
  current.unsubscribe();
  try {
    await nativeAudio.stopRecording();
  } catch {
    /* nothing to stop */
  }
  await deleteTempFile(current.path.replace(/^file:\/\//, ''));
}

/** Encrypt and upload a recording; returns the content to send. */
export async function uploadVoiceNote(p: { myUserId: string; recording: Recording; onProgress?: ProgressFn; transport?: BlobTransport }): Promise<AttachmentContent> {
  return uploadAttachment({ myUserId: p.myUserId, bytes: p.recording.bytes, contentType: VOICE_NOTE_CONTENT_TYPE, durationMs: Math.round(p.recording.durationMs), transport: p.transport, onProgress: p.onProgress });
}

// ───────── playback ─────────

export type PlaybackEvent = { blobId: string | null; positionMs: number; durationMs: number; ended: boolean };
let playing: { blobId: string; tempPath: string; unsubscribe: () => void } | null = null;
const playbackListeners = new Set<(evt: PlaybackEvent) => void>();

export function subscribeToPlayback(l: (evt: PlaybackEvent) => void): () => void {
  playbackListeners.add(l);
  return () => {
    playbackListeners.delete(l);
  };
}

function emitPlayback(evt: PlaybackEvent): void {
  for (const l of playbackListeners) l(evt);
}

export function currentlyPlaying(): string | null {
  return playing?.blobId ?? null;
}

/** Play a stored voice note (decrypted to a temporary file); any other playback stops first. */
export async function playVoiceNote(myUserId: string, meta: AttachmentMeta): Promise<void> {
  await stopPlayback();
  const bytes = await loadMedia(myUserId, meta.blobId);
  if (!bytes) throw new Error('This voice message is not on the device yet');
  const tempPath = await writeTempPlaintext(myUserId, meta.blobId, bytes, 'm4a');
  const unsubscribe = nativeAudio.onPlayTick((t) => {
    emitPlayback({ blobId: meta.blobId, positionMs: t.positionMs, durationMs: t.durationMs || meta.durationMs || 0, ended: t.ended });
    if (t.ended) stopPlayback().catch(() => undefined);
  });
  playing = { blobId: meta.blobId, tempPath, unsubscribe };
  try {
    await nativeAudio.startPlaying(tempPath);
  } catch (e) {
    await stopPlayback();
    throw e;
  }
}

export async function stopPlayback(): Promise<void> {
  const current = playing;
  if (!current) return;
  playing = null;
  current.unsubscribe();
  try {
    await nativeAudio.stopPlaying();
  } catch {
    /* already stopped */
  }
  await deleteTempFile(current.tempPath);
  emitPlayback({ blobId: current.blobId, positionMs: 0, durationMs: 0, ended: true });
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
