import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * T8.4: the app's own Android audio module (android/.../VeloAudioModule.kt):
 * MediaRecorder (AAC in MP4) and MediaPlayer behind a few methods and two
 * event streams. Written in the repository rather than taken from a
 * library: the one maintained library needs a build system this app does
 * not use, and the classic one no longer compiles against this React
 * Native. iOS has no implementation (deferred with the rest of iOS).
 */
export type StopRecordingResult = { path: string; durationMs: number } | string;

type VeloAudioSpec = {
  startRecording(path: string): Promise<string>;
  stopRecording(): Promise<StopRecordingResult>;
  startPlaying(path: string, startMs: number): Promise<number>;
  pausePlaying(): Promise<number>;
  resumePlaying(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  setPlaybackSpeed(rate: number): Promise<void>;
  stopPlaying(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

/** `amplitude` is a loudness level 0..1 (decibel scale over the recorder's peak); absent from older builds. */
export type RecordTick = { elapsedMs: number; amplitude?: number };
export type PlayTickState = 'playing' | 'paused' | 'ended' | 'error';
export type PlayTick = { positionMs: number; durationMs: number; state?: PlayTickState; ended?: boolean; message?: string };

function raw(): VeloAudioSpec | undefined {
  return (NativeModules as Record<string, unknown>).VeloAudio as VeloAudioSpec | undefined;
}

function module(): VeloAudioSpec {
  const m = raw();
  if (!m) throw new Error(Platform.OS === 'android' ? 'The audio module is not linked in this build' : 'Voice messages are not available on this platform yet');
  return m;
}

let emitter: NativeEventEmitter | null = null;
function events(): NativeEventEmitter {
  if (!emitter) emitter = new NativeEventEmitter(raw() as never);
  return emitter;
}

export const nativeAudio = {
  isAvailable(): boolean {
    return Boolean(raw());
  },
  /** False on an APK built before pause / seek / speed existed: the app must be rebuilt. */
  hasPlaybackControls(): boolean {
    const m = raw();
    return Boolean(m && typeof m.pausePlaying === 'function' && typeof m.seekTo === 'function');
  },
  startRecording: (path: string) => module().startRecording(path),
  stopRecording: () => module().stopRecording(),
  startPlaying: (path: string, startMs = 0) => module().startPlaying(path, startMs),
  pausePlaying: () => module().pausePlaying(),
  resumePlaying: () => module().resumePlaying(),
  seekTo: (positionMs: number) => module().seekTo(positionMs),
  setPlaybackSpeed: (rate: number) => module().setPlaybackSpeed(rate),
  stopPlaying: () => module().stopPlaying(),
  onRecordTick(cb: (t: RecordTick) => void): () => void {
    const sub = events().addListener('VeloAudio.recordTick', cb);
    return () => sub.remove();
  },
  onPlayTick(cb: (t: PlayTick) => void): () => void {
    const sub = events().addListener('VeloAudio.playTick', cb);
    return () => sub.remove();
  },
};
