/* eslint-disable no-bitwise */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter, NativeModules } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';
import type { BlobTarget } from '../../api/attachments.api';
import { saveMedia } from '../mediaStore';
import type { BlobTransport } from '../transport';
import {
  cancelVoiceRecording,
  currentPlayback,
  MIN_VOICE_NOTE_MS,
  pausePlayback,
  playVoiceNote,
  purgeStaleAudioFiles,
  recorderState,
  resumePlayback,
  seekPlayback,
  startVoiceRecording,
  stopPlayback,
  stopVoiceRecording,
  subscribeToPlayback,
  togglePlayback,
  sendVoiceNote,
  uploadVoiceNote,
  type PlaybackEvent,
} from '../voiceNotes';
import { subscribeToMessagePatches, type MessagePatch } from '../../chat/actions';
import { getUploadProgress } from '../uploadProgress';
import { sendContentMessage } from '../../socket/messaging';
import { WAVEFORM_BARS } from '../waveform';

/**
 * T8.4 — voice notes over the app's own audio module (mocked here): a
 * recording becomes an audio attachment with its duration and waveform and
 * the recording file is deleted; too-short recordings are dropped; a stop
 * that races the start still stops; playback decrypts to a temporary file,
 * pauses, resumes, seeks and removes the file after.
 */
const mockServer = { blobs: new Map<string, Uint8Array>(), reserved: new Map<string, number>() };
jest.mock('../../api/attachments.api', () => ({
  attachmentsApi: {
    reserve: jest.fn(async (size: number) => {
      const blobId = (mockServer.reserved.size + 1).toString(16).padStart(32, '0');
      mockServer.reserved.set(blobId, size);
      return { data: { blobId, size, upload: { url: `/blobs/${blobId}?exp=1&sig=x`, method: 'PUT', headers: {} }, expiresAt: 1 } };
    }),
    complete: jest.fn(async () => ({ data: { ok: true, size: 0 } })),
    download: jest.fn(),
  },
}));
jest.mock('../../socket/messaging', () => ({ sendContentMessage: jest.fn(), sendContent: jest.fn(), sendMessageV2: jest.fn() }));
jest.mock('../../crypto/sessionBootstrap', () => ({ ensureV2Session: jest.fn(async () => ({ initPacket: null })) }));
jest.mock('../../chat/groupMessaging', () => ({ sendGroupContentMessage: jest.fn(), sendGroupContent: jest.fn(), sendGroupMessage: jest.fn() }));

const fakeTransport: BlobTransport = {
  put: jest.fn(async (target: BlobTarget, bytes: Uint8Array) => {
    mockServer.blobs.set(target.url.split('/blobs/')[1]!.split('?')[0]!, new Uint8Array(bytes));
  }),
  get: jest.fn(async () => new Uint8Array()),
};
const fs = ReactNativeBlobUtil.fs as unknown as { writeFile: (p: string, d: string, e: string) => Promise<void>; exists: (p: string) => Promise<boolean> };
type NativeMock = { startRecording: jest.Mock; stopRecording: jest.Mock; startPlaying: jest.Mock; pausePlaying: jest.Mock; resumePlaying: jest.Mock; seekTo: jest.Mock; setPlaybackSpeed: jest.Mock; stopPlaying: jest.Mock };
const native = (NativeModules as Record<string, any>).VeloAudio as NativeMock;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = (elapsedMs: number, amplitude: number) => DeviceEventEmitter.emit('VeloAudio.recordTick', { elapsedMs, amplitude });

beforeEach(async () => {
  await AsyncStorage.clear();
  mockServer.blobs.clear();
  mockServer.reserved.clear();
  (ReactNativeBlobUtil as unknown as { __reset: () => void }).__reset();
  for (const m of Object.values(native)) if (typeof (m as jest.Mock).mockClear === 'function') (m as jest.Mock).mockClear();
  native.startRecording.mockImplementation(async (path: string) => path);
  native.stopRecording.mockImplementation(async () => ({ path: '', durationMs: 0 }));
  await cancelVoiceRecording();
  await stopPlayback();
});

describe('T8.4 voice notes: recording', () => {
  it('a recording is read once, sent as audio/mp4 with its duration and a 64-bar waveform, and the file is deleted', async () => {
    const ticks: number[] = [];
    const path = await startVoiceRecording((t) => ticks.push(t.amplitude));
    expect(native.startRecording).toHaveBeenCalledWith(path);
    expect(recorderState()).toBe('recording');
    for (let i = 0; i < 30; i += 1) tick(i * 100, i < 15 ? 0.2 : 0.9); // quiet, then loud
    const audioBytes = new Uint8Array(3000).map((_, i) => (i * 7) & 0xff);
    await fs.writeFile(path, encodeBase64(audioBytes), 'base64'); // what the recorder produced
    await sleep(MIN_VOICE_NOTE_MS + 50);
    const rec = await stopVoiceRecording();
    expect(recorderState()).toBe('idle');
    expect(rec).not.toBeNull();
    expect(rec!.bytes.length).toBe(3000);
    expect(rec!.durationMs).toBeGreaterThanOrEqual(MIN_VOICE_NOTE_MS);
    expect(ticks).toHaveLength(30);
    expect(rec!.waveform).toHaveLength(WAVEFORM_BARS);
    expect(Math.max(...Array.from(rec!.waveform))).toBe(31);
    expect(rec!.waveform[0]!).toBeLessThan(rec!.waveform[WAVEFORM_BARS - 1]!); // the loud half is taller
    expect(await fs.exists(path)).toBe(false); // the plaintext recording does not linger

    const content = await uploadVoiceNote({ myUserId: 'me', recording: rec!, transport: fakeTransport });
    expect(content).toMatchObject({ kind: 'attachment', contentType: 'audio/mp4', size: 3000 });
    expect(content.durationMs).toBeGreaterThanOrEqual(MIN_VOICE_NOTE_MS);
    expect(decodeBase64(content.waveform!)).toHaveLength(WAVEFORM_BARS);
    expect(mockServer.blobs.get(content.blobId)!.length).toBeGreaterThan(3000); // ciphertext, MAC included
  });

  it('the duration reported by the module wins over the wall clock', async () => {
    native.stopRecording.mockImplementation(async () => ({ path: '', durationMs: 2345 }));
    const path = await startVoiceRecording();
    await fs.writeFile(path, encodeBase64(new Uint8Array(100)), 'base64');
    const rec = await stopVoiceRecording();
    expect(rec!.durationMs).toBe(2345);
  });

  it('a release before the minimum length keeps nothing; cancel keeps nothing at any length', async () => {
    const path = await startVoiceRecording();
    await fs.writeFile(path, encodeBase64(new Uint8Array(500)), 'base64');
    expect(await stopVoiceRecording()).toBeNull();
    expect(await fs.exists(path)).toBe(false);
    expect(await stopVoiceRecording()).toBeNull(); // idempotent

    native.stopRecording.mockImplementation(async () => ({ path: '', durationMs: 5000 }));
    const p2 = await startVoiceRecording();
    await fs.writeFile(p2, encodeBase64(new Uint8Array(500)), 'base64');
    await cancelVoiceRecording();
    expect(await fs.exists(p2)).toBe(false);
    expect(recorderState()).toBe('idle');
  });

  it('a stop that arrives while the start is still in flight waits for it and then stops (no stuck microphone)', async () => {
    let releaseStart: (p: string) => void = () => undefined;
    native.startRecording.mockImplementation((path: string) => new Promise<string>((r) => (releaseStart = () => r(path))));
    const starting = startVoiceRecording();
    expect(recorderState()).toBe('starting');
    const stopping = stopVoiceRecording(); // the finger lifted before the microphone was live
    expect(recorderState()).toBe('stopping');
    expect(native.stopRecording).not.toHaveBeenCalled();
    releaseStart('');
    await starting;
    expect(await stopping).toBeNull(); // far too short to keep
    expect(native.stopRecording).toHaveBeenCalledTimes(1);
    expect(recorderState()).toBe('idle');
    native.startRecording.mockImplementation(async (path: string) => path);
    await expect(startVoiceRecording()).resolves.toContain('velo-rec-'); // and a new one can start
    await cancelVoiceRecording();
  });

  it('a start that fails leaves the recorder idle and reports the error', async () => {
    native.startRecording.mockImplementation(async () => {
      throw new Error('mic busy');
    });
    await expect(startVoiceRecording()).rejects.toThrow('mic busy');
    expect(recorderState()).toBe('idle');
    expect(await stopVoiceRecording()).toBeNull();
  });

  it('stale recordings and playback copies from an earlier run are purged, the live one is kept', async () => {
    await fs.writeFile('/cache/velo-rec-1.m4a', 'x', 'base64');
    await fs.writeFile('/cache/velo-play-me-abc.m4a', 'x', 'base64');
    await fs.writeFile('/cache/other.txt', 'x', 'base64');
    const path = await startVoiceRecording();
    await sleep(0);
    expect(await fs.exists('/cache/velo-rec-1.m4a')).toBe(false);
    expect(await fs.exists('/cache/velo-play-me-abc.m4a')).toBe(false);
    expect(await fs.exists('/cache/other.txt')).toBe(true);
    await fs.writeFile(path, 'x', 'base64');
    expect(await purgeStaleAudioFiles()).toBe(0);
    expect(await fs.exists(path)).toBe(true);
    await cancelVoiceRecording();
  });
});

describe('T8.4 voice notes: playback', () => {
  const blobId = 'b'.repeat(32);
  const meta = { blobId, key: 'k', digest: 'd', size: 2000, contentType: 'audio/mp4', durationMs: 4000 };
  const playTick = (positionMs: number, state: 'playing' | 'paused' | 'ended' | 'error') => DeviceEventEmitter.emit('VeloAudio.playTick', { positionMs, durationMs: 4000, state });

  beforeEach(async () => {
    await saveMedia({ myUserId: 'me', blobId, bytes: new Uint8Array(2000).map((_, i) => (i * 3) & 0xff) });
  });

  it('writes a temporary plaintext file for the player and removes it when stopped', async () => {
    const events: Array<{ blobId: string; ended: boolean }> = [];
    const unsub = subscribeToPlayback((e) => events.push({ blobId: e.blobId, ended: e.ended }));
    await playVoiceNote('me', meta);
    const tempPath = native.startPlaying.mock.calls.at(-1)![0] as string;
    expect(native.startPlaying.mock.calls.at(-1)![1]).toBe(0);
    expect(tempPath).toContain('/cache/velo-play-me-');
    expect(await fs.exists(tempPath)).toBe(true);
    expect(currentPlayback()).toMatchObject({ blobId, state: 'playing', positionMs: 0, durationMs: 4000 });
    await stopPlayback();
    expect(await fs.exists(tempPath)).toBe(false);
    expect(events.at(-1)).toEqual({ blobId, ended: true });
    expect(currentPlayback()).toBeNull();
    unsub();
    await expect(playVoiceNote('me', { ...meta, blobId: 'c'.repeat(32) })).rejects.toThrow(/not on the device/);
  });

  it('pause keeps the position, resume continues, seek jumps, the module ending the note cleans up', async () => {
    const events: PlaybackEvent[] = [];
    const unsub = subscribeToPlayback((e) => events.push(e));
    await playVoiceNote('me', meta);
    playTick(1200, 'playing');
    expect(currentPlayback()!.positionMs).toBe(1200);
    native.pausePlaying.mockImplementation(async () => 1250);
    await pausePlayback();
    expect(currentPlayback()).toMatchObject({ state: 'paused', positionMs: 1250 });
    expect(events.at(-1)).toMatchObject({ state: 'paused', positionMs: 1250, ended: false });
    await pausePlayback(); // no-op while paused
    expect(native.pausePlaying).toHaveBeenCalledTimes(1);
    await resumePlayback();
    expect(native.resumePlaying).toHaveBeenCalledTimes(1);
    expect(currentPlayback()!.state).toBe('playing');
    await seekPlayback({ fraction: 0.5 });
    expect(native.seekTo).toHaveBeenCalledWith(2000);
    expect(currentPlayback()!.positionMs).toBe(2000);
    await seekPlayback({ ms: 9999 });
    expect(native.seekTo).toHaveBeenLastCalledWith(4000); // clamped to the duration
    const tempPath = native.startPlaying.mock.calls.at(-1)![0] as string;
    playTick(4000, 'ended');
    await sleep(0);
    expect(currentPlayback()).toBeNull();
    expect(await fs.exists(tempPath)).toBe(false);
    expect(events.at(-1)).toMatchObject({ blobId, state: 'ended', ended: true });
    unsub();
  });

  it('toggle: plays, then pauses, then resumes the same note; another note replaces it', async () => {
    const other = { ...meta, blobId: 'e'.repeat(32) };
    await saveMedia({ myUserId: 'me', blobId: other.blobId, bytes: new Uint8Array(10) });
    await togglePlayback('me', meta);
    expect(currentPlayback()).toMatchObject({ blobId, state: 'playing' });
    await togglePlayback('me', meta);
    expect(currentPlayback()).toMatchObject({ blobId, state: 'paused' });
    await togglePlayback('me', meta);
    expect(currentPlayback()).toMatchObject({ blobId, state: 'playing' });
    const first = native.startPlaying.mock.calls.at(-1)![0] as string;
    await togglePlayback('me', other);
    expect(native.stopPlaying).toHaveBeenCalled();
    expect(await fs.exists(first)).toBe(false);
    expect(currentPlayback()).toMatchObject({ blobId: other.blobId, state: 'playing' });
    await stopPlayback();
  });
});

describe('B19 sending a voice message', () => {
  const recording = () => ({ bytes: new Uint8Array(600).fill(7), durationMs: 2300.4, waveform: new Uint8Array([10, 200, 90, 30]) });

  it('the bubble appears at once as a placeholder with its duration and waveform, then the sent message replaces it', async () => {
    const patches: MessagePatch[] = [];
    const unsubscribe = subscribeToMessagePatches((p) => patches.push(p));
    (sendContentMessage as jest.Mock).mockReset().mockResolvedValueOnce({ serverMessageId: 'v1', seq: 4 });

    await sendVoiceNote({ myUserId: 'me', target: { kind: 'peer', peerUserId: 'peer' }, recording: recording(), transport: fakeTransport });
    unsubscribe();

    const first = patches[0]!.message!;
    expect(first.status).toBe('sending');
    expect(first.attachment!.blobId.startsWith('local-')).toBe(true);
    expect(first.attachment!.durationMs).toBe(2300);
    expect(first.attachment!.waveform).toBe(encodeBase64(new Uint8Array([10, 200, 90, 30])));
    const last = patches[patches.length - 1]!;
    expect(last.id).toBe(first.id);
    expect(last.message!.status).toBe('sent');
    expect(last.message!.attachment!.blobId.startsWith('local-')).toBe(false);
    expect((sendContentMessage as jest.Mock).mock.calls[0][0].clientMessageId).toBe(first.id);
    expect(getUploadProgress(first.attachment!.blobId)).toBeUndefined();
  });

  it('a failed send leaves the bubble marked failed and reports the error', async () => {
    const patches: MessagePatch[] = [];
    const unsubscribe = subscribeToMessagePatches((p) => patches.push(p));
    (sendContentMessage as jest.Mock).mockReset().mockRejectedValueOnce(new Error('socket closed'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(sendVoiceNote({ myUserId: 'me', target: { kind: 'peer', peerUserId: 'peer' }, recording: recording(), transport: fakeTransport })).rejects.toThrow('socket closed');
    unsubscribe();
    warn.mockRestore();

    const last = patches[patches.length - 1]!.message!;
    expect(last.status).toBe('failed');
    expect(last.id).toBe(patches[0]!.message!.id);
    expect(last.attachment!.blobId.startsWith('local-')).toBe(false); // uploaded: the real blob, playable from this phone
  });
});
