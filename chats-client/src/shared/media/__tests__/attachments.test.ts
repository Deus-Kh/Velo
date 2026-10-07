/* eslint-disable no-bitwise */
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { decodeBase64 } from 'tweetnacl-util';
import { attachmentDecrypt } from '@velo/protocol';
import type { BlobTarget } from '../../api/attachments.api';
import { downloadAttachment, metaOf, pickImages, sendPhotos, uploadAttachment } from '../attachments';
import { subscribeToMessagePatches, type MessagePatch } from '../../chat/actions';
import { getUploadProgress } from '../uploadProgress';
import { sendContentMessage } from '../../socket/messaging';
import { deleteAllMediaForUser, deleteMedia, hasMedia, loadMedia, mediaDataUri, mediaPath, saveMedia } from '../mediaStore';
import type { BlobTransport } from '../transport';

/**
 * T8.3 — the attachment pipeline against a fake server and transport:
 * what leaves the device is ciphertext the message's key opens, what is
 * kept is sealed, and a swapped or damaged blob is refused with nothing kept.
 */
const mockServer: { blobs: Map<string, Uint8Array>; reserved: Map<string, number>; completed: string[] } = { blobs: new Map(), reserved: new Map(), completed: [] };
jest.mock('../../api/attachments.api', () => ({
  attachmentsApi: {
    reserve: jest.fn(async (size: number) => {
      const blobId = (mockServer.reserved.size + 1).toString(16).padStart(32, '0');
      mockServer.reserved.set(blobId, size);
      return { data: { blobId, size, upload: { url: `/blobs/${blobId}?exp=1&sig=x`, method: 'PUT', headers: {} }, expiresAt: 1 } };
    }),
    complete: jest.fn(async (blobId: string) => {
      mockServer.completed.push(blobId);
      return { data: { ok: true, size: mockServer.blobs.get(blobId)?.length ?? 0 } };
    }),
    download: jest.fn(async (blobId: string) => ({ data: { blobId, size: mockServer.blobs.get(blobId)?.length ?? 0, download: { url: `/blobs/${blobId}?exp=1&sig=y`, method: 'GET', headers: {} }, expiresAt: 1 } })),
  },
}));
jest.mock('../../socket/messaging', () => ({ sendContentMessage: jest.fn(), sendContent: jest.fn(), sendMessageV2: jest.fn() }));
jest.mock('../../crypto/sessionBootstrap', () => ({ ensureV2Session: jest.fn(async () => ({ initPacket: null })) }));
jest.mock('../../chat/groupMessaging', () => ({ sendGroupContentMessage: jest.fn(), sendGroupContent: jest.fn(), sendGroupMessage: jest.fn() }));
jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn(async () => ({ didCancel: true })) }));

const blobIdOf = (url: string) => url.split('/blobs/')[1]!.split('?')[0]!;
const fakeTransport: BlobTransport = {
  put: jest.fn(async (target: BlobTarget, bytes: Uint8Array) => {
    const id = blobIdOf(target.url);
    if (mockServer.reserved.get(id) !== bytes.length) throw new Error('size mismatch');
    mockServer.blobs.set(id, new Uint8Array(bytes));
  }),
  get: jest.fn(async (target: BlobTarget) => {
    const b = mockServer.blobs.get(blobIdOf(target.url));
    if (!b) throw new Error('404');
    return new Uint8Array(b);
  }),
};

const ME = 'me';
const bytes = (n: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

beforeEach(async () => {
  await AsyncStorage.clear();
  mockServer.blobs.clear();
  mockServer.reserved.clear();
  mockServer.completed.length = 0;
  (ReactNativeBlobUtil as unknown as { __reset: () => void }).__reset();
});

describe('T8.3 media store', () => {
  it('requests multi-select and preserves every picked image', async () => {
    const picker = jest.requireMock('react-native-image-picker').launchImageLibrary as jest.Mock;
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    picker.mockResolvedValueOnce({
      assets: [
        { base64: png, type: 'image/png', width: 1, height: 1, fileName: 'one.png' },
        { base64: png, type: 'image/png', width: 1, height: 1, fileName: 'two.png' },
      ],
    });

    const picked = await pickImages();

    expect(picked).toHaveLength(2);
    expect(picked.map((image) => image.name)).toEqual(['one.png', 'two.png']);
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ selectionLimit: 0 }));
  });

  it('keeps media sealed under the account key and opens it only for that account', async () => {
    const blobId = 'a'.repeat(32);
    const plain = bytes(5000);
    await saveMedia({ myUserId: ME, blobId, bytes: plain });
    expect(await hasMedia(ME, blobId)).toBe(true);
    const onDisk = (await ReactNativeBlobUtil.fs.readFile(mediaPath(ME, blobId), 'base64')) as string;
    expect(onDisk.length).toBeGreaterThan(0);
    expect(same(decodeBase64(onDisk).subarray(24 + 16), plain)).toBe(false); // not the plaintext
    expect(same((await loadMedia(ME, blobId))!, plain)).toBe(true);
    expect(await loadMedia('other', blobId)).toBeNull(); // another account's key does not open it (and its path differs)
    expect((await mediaDataUri(ME, blobId, 'image/jpeg'))!.startsWith('data:image/jpeg;base64,')).toBe(true);
    await deleteMedia(ME, blobId);
    expect(await hasMedia(ME, blobId)).toBe(false);
    await saveMedia({ myUserId: ME, blobId, bytes: plain });
    await deleteAllMediaForUser(ME);
    expect(await hasMedia(ME, blobId)).toBe(false);
  });
});

describe('T8.3 upload and download', () => {
  it('uploads ciphertext the message key opens, completes, keeps the plaintext; the server never sees plaintext', async () => {
    const plain = bytes(150_000, 7);
    const progress: number[] = [];
    const content = await uploadAttachment({ myUserId: ME, bytes: plain, contentType: 'image/jpeg', width: 1600, height: 900, caption: ' hi ', transport: fakeTransport, onProgress: (l, t) => progress.push(l / t) });
    expect(content).toMatchObject({ kind: 'attachment', size: plain.length, contentType: 'image/jpeg', width: 1600, height: 900, caption: 'hi' });
    expect(mockServer.completed).toEqual([content.blobId]);
    const stored = mockServer.blobs.get(content.blobId)!;
    expect(stored.length).toBe(mockServer.reserved.get(content.blobId));
    expect(same(stored, plain)).toBe(false);
    expect(Buffer.from(stored).includes(Buffer.from(plain.subarray(0, 64)))).toBe(false);
    const opened = attachmentDecrypt(stored, decodeBase64(content.key), { digest: decodeBase64(content.digest), size: content.size });
    expect(same(opened, plain)).toBe(true);
    expect(same((await loadMedia(ME, content.blobId))!, plain)).toBe(true); // the sender keeps its own copy

    // A recipient downloads, verifies and keeps it.
    const meta = metaOf(content);
    const got = await downloadAttachment({ myUserId: 'bob', meta, transport: fakeTransport });
    expect(same(got, plain)).toBe(true);
    expect(same((await loadMedia('bob', content.blobId))!, plain)).toBe(true);
  });

  it('a swapped blob is refused by digest and a damaged one by MAC; nothing is kept', async () => {
    const a = await uploadAttachment({ myUserId: ME, bytes: bytes(70_000, 1), contentType: 'image/png', transport: fakeTransport });
    const b = await uploadAttachment({ myUserId: ME, bytes: bytes(70_000, 2), contentType: 'image/png', transport: fakeTransport });
    // The server swaps b's bytes under a's id.
    mockServer.blobs.set(a.blobId, new Uint8Array(mockServer.blobs.get(b.blobId)!));
    await expect(downloadAttachment({ myUserId: 'bob', meta: metaOf(a), transport: fakeTransport })).rejects.toMatchObject({ code: 'ATTACHMENT_DIGEST_MISMATCH' });
    expect(await hasMedia('bob', a.blobId)).toBe(false);
    // A flipped byte in b (digest updated by an attacker who controls the server cannot be, since the digest is in the message).
    const damaged = new Uint8Array(mockServer.blobs.get(b.blobId)!);
    damaged[100] = damaged[100]! ^ 1;
    mockServer.blobs.set(b.blobId, damaged);
    await expect(downloadAttachment({ myUserId: 'bob', meta: metaOf(b), transport: fakeTransport })).rejects.toMatchObject({ code: 'ATTACHMENT_DIGEST_MISMATCH' });
    expect(await hasMedia('bob', b.blobId)).toBe(false);
  });

  it('retries the upload once, then gives up without completing', async () => {
    let calls = 0;
    const flaky: BlobTransport = { ...fakeTransport, put: jest.fn(async (t, by) => { calls += 1; if (calls === 1) throw new Error('network'); return fakeTransport.put(t, by); }) };
    const c = await uploadAttachment({ myUserId: ME, bytes: bytes(1000), contentType: 'image/jpeg', transport: flaky });
    expect(calls).toBe(2);
    expect(mockServer.completed).toEqual([c.blobId]);
    const dead: BlobTransport = { ...fakeTransport, put: jest.fn(async () => { throw new Error('network'); }) };
    await expect(uploadAttachment({ myUserId: ME, bytes: bytes(1000), contentType: 'image/jpeg', transport: dead })).rejects.toThrow('network');
    expect(mockServer.completed).toEqual([c.blobId]);
  });
});

describe('B18 sending several photos', () => {
  it('shows every photo at once as one album, sends them in order, and a failure in the middle does not stop the rest', async () => {
    const patches: MessagePatch[] = [];
    const unsubscribe = subscribeToMessagePatches((p) => patches.push(p));
    const send = sendContentMessage as jest.Mock;
    send.mockReset();
    send
      .mockResolvedValueOnce({ serverMessageId: 's1', seq: 1 })
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce({ serverMessageId: 's3', seq: 3 });
    const images = [bytes(3000, 1), bytes(4000, 2), bytes(5000, 3)].map((b, i) => ({ bytes: b, contentType: 'image/jpeg', width: 1200, height: 1600, name: `p${i}.jpg` }));
    const progress: number[] = [];

    const result = await sendPhotos({ myUserId: ME, target: { kind: 'peer', peerUserId: 'peer' }, images, caption: ' hello ', transport: fakeTransport, onProgress: (f) => progress.push(f) });
    unsubscribe();

    // the three placeholders come first, before any upload finished: one album, local previews, in order
    const placeholders = patches.slice(0, 3).map((p) => p.message!);
    expect(placeholders.map((m) => m.status)).toEqual(['sending', 'sending', 'sending']);
    expect(placeholders.every((m) => m.attachment!.blobId.startsWith('local-'))).toBe(true);
    const albumId = placeholders[0]!.attachment!.album!.id;
    expect(placeholders.map((m) => m.attachment!.album)).toEqual([0, 1, 2].map((index) => ({ id: albumId, index, count: 3 })));
    expect(placeholders.map((m) => m.text)).toEqual(['hello', '', '']);
    expect(placeholders[0]!.createdAt).toBeLessThan(placeholders[1]!.createdAt);

    // sent in album order, each replacing its own placeholder (same id), the failed one marked failed
    expect(send.mock.calls.map((c) => c[0].content.album.index)).toEqual([0, 1, 2]);
    expect(send.mock.calls.map((c) => c[0].clientMessageId)).toEqual(placeholders.map((m) => m.id));
    const last = new Map(patches.map((p) => [p.id, p.message!]));
    expect(placeholders.map((m) => last.get(m.id)!.status)).toEqual(['sent', 'failed', 'sent']);
    expect(last.get(placeholders[0]!.id)!.attachment!.blobId.startsWith('local-')).toBe(false);
    expect(last.get(placeholders[0]!.id)!.attachment!.album).toEqual({ id: albumId, index: 0, count: 3 });
    expect(result).toEqual({ sent: 2, failed: 1 });

    // progress ends complete and nothing is left in the progress store
    expect(progress[progress.length - 1]).toBe(1);
    expect(placeholders.map((m) => getUploadProgress(m.attachment!.blobId))).toEqual([undefined, undefined, undefined]);
  });
});
