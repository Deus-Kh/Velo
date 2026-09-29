/* eslint-disable no-bitwise */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { encodeBase64 } from 'tweetnacl-util';
import type { BlobTarget } from '../../api/attachments.api';
import { saveMedia } from '../mediaStore';
import type { BlobTransport } from '../transport';
import { MIN_VOICE_NOTE_MS, playVoiceNote, startVoiceRecording, stopPlayback, stopVoiceRecording, subscribeToPlayback, uploadVoiceNote } from '../voiceNotes';

/**
 * T8.4 — voice notes over the app's own audio module (mocked here): a
 * recording becomes an audio attachment with its duration and the
 * recording file is deleted; too-short recordings are dropped; playback
 * decrypts to a temporary file and removes it after.
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
const native = (NativeModules as Record<string, any>).VeloAudio as { startRecording: jest.Mock; stopRecording: jest.Mock; startPlaying: jest.Mock; stopPlaying: jest.Mock };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockServer.blobs.clear();
  mockServer.reserved.clear();
  (ReactNativeBlobUtil as unknown as { __reset: () => void }).__reset();
  native.startRecording.mockClear();
  native.startPlaying.mockClear();
});

describe('T8.4 voice notes', () => {
  it('a recording is read once, sent as audio/mp4 with its duration, and the file is deleted', async () => {
    const path = await startVoiceRecording();
    expect(native.startRecording).toHaveBeenCalledWith(path);
    const audioBytes = new Uint8Array(3000).map((_, i) => (i * 7) & 0xff);
    await fs.writeFile(path, encodeBase64(audioBytes), 'base64'); // what the recorder produced
    await new Promise((r) => setTimeout(r, MIN_VOICE_NOTE_MS + 50));
    const rec = await stopVoiceRecording();
    expect(rec).not.toBeNull();
    expect(rec!.bytes.length).toBe(3000);
    expect(rec!.durationMs).toBeGreaterThanOrEqual(MIN_VOICE_NOTE_MS);
    expect(await fs.exists(path)).toBe(false); // the plaintext recording does not linger

    const content = await uploadVoiceNote({ myUserId: 'me', recording: rec!, transport: fakeTransport });
    expect(content).toMatchObject({ kind: 'attachment', contentType: 'audio/mp4', size: 3000 });
    expect(content.durationMs).toBeGreaterThanOrEqual(MIN_VOICE_NOTE_MS);
    expect(mockServer.blobs.get(content.blobId)!.length).toBeGreaterThan(3000); // ciphertext, MAC included
  });

  it('a release before the minimum length keeps nothing', async () => {
    const path = await startVoiceRecording();
    await fs.writeFile(path, encodeBase64(new Uint8Array(500)), 'base64');
    const rec = await stopVoiceRecording();
    expect(rec).toBeNull();
    expect(await fs.exists(path)).toBe(false);
    expect(await stopVoiceRecording()).toBeNull(); // idempotent
  });

  it('playback writes a temporary plaintext file for the player and removes it when stopped', async () => {
    const blobId = 'b'.repeat(32);
    const bytes = new Uint8Array(2000).map((_, i) => (i * 3) & 0xff);
    await saveMedia({ myUserId: 'me', blobId, bytes });
    const events: Array<{ blobId: string | null; ended: boolean }> = [];
    const unsub = subscribeToPlayback((e) => events.push({ blobId: e.blobId, ended: e.ended }));
    const meta = { blobId, key: 'k', digest: 'd', size: 2000, contentType: 'audio/mp4', durationMs: 4000 };
    await playVoiceNote('me', meta);
    const tempPath = native.startPlaying.mock.calls.at(-1)![0] as string;
    expect(tempPath).toContain('/cache/velo-play-me-');
    expect(await fs.exists(tempPath)).toBe(true);
    await stopPlayback();
    expect(await fs.exists(tempPath)).toBe(false);
    expect(events.at(-1)).toEqual({ blobId, ended: true });
    unsub();
    await expect(playVoiceNote('me', { ...meta, blobId: 'c'.repeat(32) })).rejects.toThrow(/not on the device/);
  });
});
