import ReactNativeBlobUtil from 'react-native-blob-util';
import { cachedMediaDataUri, deleteAllMediaForUser, deleteMedia, hasMedia, isKnownLocal, mediaDataUri, rememberDataUri, saveMedia } from '../mediaStore';

/**
 * Roadmap §8.1 A2 — the process-wide "known local" set behind the instant
 * state of own attachments: saving marks a blob known, a disk check
 * refreshes it, deleting forgets it; the data-URI cache answers at once.
 */
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);

beforeEach(() => {
  (ReactNativeBlobUtil as unknown as { __reset: () => void }).__reset();
});

describe('known-local media', () => {
  it('a saved blob is known for its user only; a disk check confirms or forgets it', async () => {
    expect(isKnownLocal('me', ID_A)).toBe(false);
    await saveMedia({ myUserId: 'me', blobId: ID_A, bytes: new Uint8Array([1, 2, 3]) });
    expect(isKnownLocal('me', ID_A)).toBe(true);
    expect(isKnownLocal('other', ID_A)).toBe(false);
    expect(await hasMedia('other', ID_A)).toBe(false);
    expect(await hasMedia('me', ID_A)).toBe(true);
    (ReactNativeBlobUtil as unknown as { __reset: () => void }).__reset(); // the file vanished behind our back
    expect(await hasMedia('me', ID_A)).toBe(false);
    expect(isKnownLocal('me', ID_A)).toBe(false);
  });

  it('deleting one blob or a whole user forgets the right entries', async () => {
    await saveMedia({ myUserId: 'me', blobId: ID_A, bytes: new Uint8Array([1]) });
    await saveMedia({ myUserId: 'me', blobId: ID_B, bytes: new Uint8Array([2]) });
    await saveMedia({ myUserId: 'you', blobId: ID_A, bytes: new Uint8Array([3]) });
    await deleteMedia('me', ID_A);
    expect(isKnownLocal('me', ID_A)).toBe(false);
    expect(isKnownLocal('me', ID_B)).toBe(true);
    await deleteAllMediaForUser('me');
    expect(isKnownLocal('me', ID_B)).toBe(false);
    expect(isKnownLocal('you', ID_A)).toBe(true);
  });

  it('the data-URI cache answers synchronously once a URI was remembered or built', async () => {
    const id = 'd'.repeat(32);
    expect(cachedMediaDataUri(id)).toBeNull();
    rememberDataUri(id, 'data:image/png;base64,AAAA');
    expect(cachedMediaDataUri(id)).toBe('data:image/png;base64,AAAA');
    const built = 'e'.repeat(32);
    await saveMedia({ myUserId: 'me', blobId: built, bytes: new Uint8Array([9, 9]) });
    expect(cachedMediaDataUri(built)).toBeNull();
    const uri = await mediaDataUri('me', built, 'image/png');
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(cachedMediaDataUri(built)).toBe(uri);
    await deleteMedia('me', built);
    expect(cachedMediaDataUri(built)).toBeNull();
  });
});
