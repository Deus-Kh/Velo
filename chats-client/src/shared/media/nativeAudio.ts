import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * T8.4: the app's own Android audio module (android/.../VeloAudioModule.kt):
 * MediaRecorder (AAC in MP4) and MediaPlayer behind four methods and two
 * event streams. Written in the repository rather than taken from a
 * library: the one maintained library needs a build system this app does
 * not use, and the classic one no longer compiles against this React
 * Native. iOS has no implementation (deferred with the rest of iOS).
 */
type VeloAudioSpec = {
  startRecording(path: string): Promise<string>;
  stopRecording(): Promise<string>;
  startPlaying(path: string): Promise<number>;
  stopPlaying(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

export type RecordTick = { elapsedMs: number };
export type PlayTick = { positionMs: number; durationMs: number; ended: boolean };

function module(): VeloAudioSpec {
  const m = (NativeModules as Record<string, unknown>).VeloAudio as VeloAudioSpec | undefined;
  if (!m) throw new Error(Platform.OS === 'android' ? 'The audio module is not linked in this build' : 'Voice messages are not available on this platform yet');
  return m;
}

let emitter: NativeEventEmitter | null = null;
function events(): NativeEventEmitter {
  if (!emitter) emitter = new NativeEventEmitter((NativeModules as Record<string, unknown>).VeloAudio as never);
  return emitter;
}

export const nativeAudio = {
  isAvailable(): boolean {
    return Boolean((NativeModules as Record<string, unknown>).VeloAudio);
  },
  startRecording: (path: string) => module().startRecording(path),
  stopRecording: () => module().stopRecording(),
  startPlaying: (path: string) => module().startPlaying(path),
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
