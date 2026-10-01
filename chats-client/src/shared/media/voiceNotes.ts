import { PermissionsAndroid, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { decodeBase64 } from 'tweetnacl-util';
import { MAX_ATTACHMENT_BYTES, type AttachmentContent } from '@velo/protocol';
import type { AttachmentMeta } from '../storage/messageStore';
import { uploadAttachment } from './attachments';
import { deleteTempFile, loadMedia, writeTempPlaintext } from './mediaStore';
import { nativeAudio } from './nativeAudio';
import type { BlobTransport, ProgressFn } from './transport';
import { buildWaveform, encodeWaveform, WAVEFORM_BARS } from './waveform';

/**
 * Voice notes (T8.4): recorded to the app's cache as AAC in an MP4
 * container by the app's own audio module, read once, encrypted and sent
 * on the attachment path with `contentType: 'audio/mp4'`, the duration and
 * a 64-bar waveform; the recording file is deleted right after. Playback
 * decrypts to a temporary file the player can open and deletes it when
 * playback ends or is stopped.
 *
 * The recorder is one explicit state machine (idle → starting → recording
 * → stopping → idle). A stop or cancel that arrives while the start is
 * still in flight waits for it and then stops: the earlier version lost
 * that race and left the microphone running with no way to stop it.
 */
export const VOICE_NOTE_CONTENT_TYPE = 'audio/mp4';
export const MIN_VOICE_NOTE_MS = 700;
export const MAX_VOICE_NOTE_MS = 5 * 60 * 1000;
export const PLAYBACK_SPEEDS = [1, 1.5, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export async function hasMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  } catch {
    return false;
  }
}

export async function ensureMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (await hasMicrophonePermission()) return true;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone',
    message: 'Velo needs the microphone to record a voice message. Recordings are encrypted before they leave this phone.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

// ───────── recorder ─────────

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';
export type RecorderTick = { elapsedMs: number; amplitude: number };
export type Recording = { bytes: Uint8Array; durationMs: number; waveform: Uint8Array };

type Session = {
  path: string;
  startedAt: number;
  samples: number[];
  onTick?: (t: RecorderTick) => void;
  unsubscribe: () => void;
  started: Promise<void>;
};

let state: RecorderState = 'idle';
let session: Session | null = null;
let stopping: Promise<Recording | null> | null = null;

export function recorderState(): RecorderState {
  return state;
}

export function isRecording(): boolean {
  return state === 'starting' || state === 'recording';
}

const clamp01 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Recordings and playback copies a crashed or killed app left behind in the cache. Best effort. */
export async function purgeStaleAudioFiles(): Promise<number> {
  const dir = ReactNativeBlobUtil.fs.dirs.CacheDir;
  let names: string[];
  try {
    names = (await ReactNativeBlobUtil.fs.ls(dir)) as string[];
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!/^velo-(rec|play)-.*\.m4a$/.test(name)) continue;
    if (session && `${dir}/${name}` === session.path) continue;
    if (playing && `${dir}/${name}` === playing.tempPath) continue;
    await deleteTempFile(`${dir}/${name}`);
    removed += 1;
  }
  return removed;
}

/** Start a recording; resolves with the file path once the microphone is live. `onTick` gets elapsed ms and a level 0..1. */
export async function startVoiceRecording(onTick?: (t: RecorderTick) => void): Promise<string> {
  if (state !== 'idle') throw new Error('already recording');
  state = 'starting';
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/velo-rec-${Date.now()}.m4a`;
  const s: Session = { path, startedAt: Date.now(), samples: [], onTick, unsubscribe: () => undefined, started: Promise.resolve() };
  s.unsubscribe = nativeAudio.onRecordTick((t) => {
    if (session !== s) return;
    const amplitude = clamp01(t.amplitude);
    s.samples.push(amplitude);
    s.onTick?.({ elapsedMs: t.elapsedMs, amplitude });
    if (t.elapsedMs >= MAX_VOICE_NOTE_MS) stopVoiceRecording().catch(() => undefined);
  });
  session = s;
  purgeStaleAudioFiles().catch(() => undefined);
  s.started = nativeAudio.startRecording(path).then(
    () => {
      s.startedAt = Date.now();
      if (session === s && state === 'starting') state = 'recording';
    },
    (e: unknown) => {
      if (session === s) {
        s.unsubscribe();
        session = null;
        state = 'idle';
      }
      throw e;
    },
  );
  await s.started;
  return path;
}

async function finishRecording(mode: 'stop' | 'cancel'): Promise<Recording | null> {
  if (stopping) return mode === 'cancel' ? stopping.then(() => null) : stopping;
  const s = session;
  if (!s) return null;
  session = null;
  state = 'stopping';
  const run = (async (): Promise<Recording | null> => {
    try {
      await s.started;
    } catch {
      return null; // never started: nothing to stop or keep
    }
    s.unsubscribe();
    let path = s.path;
    let durationMs = Date.now() - s.startedAt;
    try {
      const r = await nativeAudio.stopRecording();
      if (typeof r === 'string') {
        if (r.length > 0) path = r;
      } else if (r && typeof r === 'object') {
        if (typeof r.path === 'string' && r.path.length > 0) path = r.path;
        if (typeof r.durationMs === 'number' && r.durationMs > 0) durationMs = r.durationMs;
      }
    } catch (e) {
      console.warn('[voice] stopRecording:', (e as Error)?.message ?? e);
    }
    path = path.replace(/^file:\/\//, '');
    try {
      if (mode === 'cancel' || durationMs < MIN_VOICE_NOTE_MS) return null;
      if (!(await ReactNativeBlobUtil.fs.exists(path))) throw new Error('The recording was not saved');
      const b64 = (await ReactNativeBlobUtil.fs.readFile(path, 'base64')) as string;
      const bytes = decodeBase64(b64);
      if (bytes.length === 0) throw new Error('The recording is empty');
      if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('The recording is too large to send');
      return { bytes, durationMs, waveform: buildWaveform(s.samples, WAVEFORM_BARS) };
    } finally {
      await deleteTempFile(path);
    }
  })();
  stopping = run.finally(() => {
    stopping = null;
    state = 'idle';
  });
  return stopping;
}

/** Stop and read the recording (the file is deleted); null when it was too short to keep. Safe to call at any time. */
export function stopVoiceRecording(): Promise<Recording | null> {
  return finishRecording('stop');
}

/** Discard the recording, whatever its state. */
export async function cancelVoiceRecording(): Promise<void> {
  await finishRecording('cancel');
}

/** Encrypt and upload a recording; returns the content to send. */
export async function uploadVoiceNote(p: { myUserId: string; recording: Recording; onProgress?: ProgressFn; transport?: BlobTransport }): Promise<AttachmentContent> {
  return uploadAttachment({
    myUserId: p.myUserId,
    bytes: p.recording.bytes,
    contentType: VOICE_NOTE_CONTENT_TYPE,
    durationMs: Math.round(p.recording.durationMs),
    waveform: p.recording.waveform.length > 0 ? encodeWaveform(p.recording.waveform) : undefined,
    transport: p.transport,
    onProgress: p.onProgress,
  });
}

// ───────── playback ─────────

export type PlaybackState = 'playing' | 'paused' | 'ended';
export type PlaybackEvent = { blobId: string; positionMs: number; durationMs: number; state: PlaybackState; ended: boolean };
export type PlaybackSnapshot = { blobId: string; positionMs: number; durationMs: number; state: Exclude<PlaybackState, 'ended'> };

type Playing = { blobId: string; tempPath: string; positionMs: number; durationMs: number; state: Exclude<PlaybackState, 'ended'>; unsubscribe: () => void };
let playing: Playing | null = null;
let speed: PlaybackSpeed = 1;
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

function emitCurrent(): void {
  const p = playing;
  if (!p) return;
  emitPlayback({ blobId: p.blobId, positionMs: p.positionMs, durationMs: p.durationMs, state: p.state, ended: false });
}

/** The note that is playing or paused, with its position; null when none. */
export function currentPlayback(): PlaybackSnapshot | null {
  const p = playing;
  return p ? { blobId: p.blobId, positionMs: p.positionMs, durationMs: p.durationMs, state: p.state } : null;
}

/** The blob id that is audibly playing right now (not paused); null when none. */
export function currentlyPlaying(): string | null {
  return playing && playing.state === 'playing' ? playing.blobId : null;
}

export function playbackSpeed(): PlaybackSpeed {
  return speed;
}

/** Play a stored voice note (decrypted to a temporary file); any other playback stops first. */
export async function playVoiceNote(myUserId: string, meta: AttachmentMeta, opts: { startMs?: number } = {}): Promise<void> {
  await stopPlayback();
  const bytes = await loadMedia(myUserId, meta.blobId);
  if (!bytes) throw new Error('This voice message is not on the device yet');
  const tempPath = await writeTempPlaintext(myUserId, meta.blobId, bytes, 'm4a');
  const startMs = Math.max(0, Math.round(opts.startMs ?? 0));
  const p: Playing = { blobId: meta.blobId, tempPath, positionMs: startMs, durationMs: meta.durationMs ?? 0, state: 'playing', unsubscribe: () => undefined };
  p.unsubscribe = nativeAudio.onPlayTick((t) => {
    if (playing !== p) return;
    if (typeof t.durationMs === 'number' && t.durationMs > 0) p.durationMs = t.durationMs;
    if (typeof t.positionMs === 'number' && t.positionMs >= 0) p.positionMs = t.positionMs;
    const ended = t.state === 'ended' || t.state === 'error' || t.ended === true;
    if (ended) {
      if (t.state === 'error') console.warn('[voice] playback error:', t.message);
      stopPlayback().catch(() => undefined);
      return;
    }
    p.state = t.state === 'paused' ? 'paused' : 'playing';
    emitCurrent();
  });
  playing = p;
  try {
    const d = await nativeAudio.startPlaying(tempPath, startMs);
    if (typeof d === 'number' && d > 0) p.durationMs = d;
    if (playing === p) emitCurrent();
  } catch (e) {
    await stopPlayback();
    throw e;
  }
}

export async function pausePlayback(): Promise<void> {
  const p = playing;
  if (!p || p.state !== 'playing') return;
  if (!nativeAudio.hasPlaybackControls()) {
    await stopPlayback();
    return;
  }
  try {
    const pos = await nativeAudio.pausePlaying();
    if (typeof pos === 'number' && pos >= 0) p.positionMs = pos;
  } catch (e) {
    console.warn('[voice] pause:', (e as Error)?.message ?? e);
  }
  if (playing !== p) return;
  p.state = 'paused';
  emitCurrent();
}

export async function resumePlayback(): Promise<void> {
  const p = playing;
  if (!p || p.state !== 'paused') return;
  await nativeAudio.resumePlaying();
  if (playing !== p) return;
  p.state = 'playing';
  emitCurrent();
}

/** Jump inside the current note; a fraction 0..1 or milliseconds. */
export async function seekPlayback(to: { fraction: number } | { ms: number }): Promise<void> {
  const p = playing;
  if (!p) return;
  const target = 'ms' in to ? to.ms : to.fraction * p.durationMs;
  const ms = Math.max(0, Math.min(p.durationMs > 0 ? p.durationMs : target, Math.round(target)));
  p.positionMs = ms;
  if (nativeAudio.hasPlaybackControls()) await nativeAudio.seekTo(ms);
  if (playing === p) emitCurrent();
}

export async function setPlaybackSpeed(rate: PlaybackSpeed): Promise<void> {
  speed = rate;
  if (!nativeAudio.hasPlaybackControls()) return;
  try {
    await nativeAudio.setPlaybackSpeed(rate);
  } catch (e) {
    console.warn('[voice] speed:', (e as Error)?.message ?? e);
  }
}

export function nextPlaybackSpeed(current: PlaybackSpeed = speed): PlaybackSpeed {
  const i = PLAYBACK_SPEEDS.indexOf(current);
  return PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length]!;
}

/** Play / pause / resume this note (tap on the bubble's button). */
export async function togglePlayback(myUserId: string, meta: AttachmentMeta): Promise<void> {
  const p = playing;
  if (p && p.blobId === meta.blobId) {
    if (p.state === 'playing') await pausePlayback();
    else await resumePlayback();
    return;
  }
  await playVoiceNote(myUserId, meta);
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
  emitPlayback({ blobId: current.blobId, positionMs: 0, durationMs: current.durationMs, state: 'ended', ended: true });
}

export { formatDuration } from './duration';
