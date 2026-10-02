import ReactTestRenderer from 'react-test-renderer';
import ReactNativeBlobUtil from 'react-native-blob-util';
import VoiceNoteView from '../VoiceNoteView';
import { Icon } from '../Icon';
import { hasMedia, saveMedia } from '../../shared/media/mediaStore';

/**
 * Roadmap §8.1 A2 — a voice note never shows the download icon while the
 * file check is still running; it shows it only once the check has said
 * the note is not on the device. An own note (saved at send time) starts
 * as local without any wait.
 */
jest.setTimeout(30_000);
jest.mock('../../shared/media/attachments', () => ({ AUTO_DOWNLOAD_BYTES: 2 * 1024 * 1024, downloadAttachment: jest.fn(async () => new Uint8Array()) }));
jest.mock('../../shared/media/mediaStore', () => {
  const actual = jest.requireActual('../../shared/media/mediaStore');
  return { ...actual, hasMedia: jest.fn(actual.hasMedia) };
});

const hasMediaMock = hasMedia as jest.MockedFunction<typeof hasMedia>;
const meta = (blobId: string, size = 4000) => ({ blobId, key: 'k', digest: 'd', size, contentType: 'audio/mp4', durationMs: 12_000 });
const TOO_BIG_TO_AUTO_DOWNLOAD = 3 * 1024 * 1024;
const iconNames = (tree: ReactTestRenderer.ReactTestRenderer): string[] => tree.root.findAllByType(Icon).map((i) => String(i.props.name));
const mainButtonDisabled = (tree: ReactTestRenderer.ReactTestRenderer, label: string): boolean =>
  tree.root.findAllByProps({ accessibilityLabel: label }).some((n) => n.props.disabled === true);

beforeEach(() => {
  (ReactNativeBlobUtil as unknown as { __reset: () => void }).__reset();
  hasMediaMock.mockReset();
});

describe('VoiceNoteView', () => {
  it('shows a dimmed, disabled play button while the file check runs, and the download icon only after a "not here"', async () => {
    let resolveCheck: (v: boolean) => void = () => undefined;
    hasMediaMock.mockImplementation(() => new Promise<boolean>((r) => (resolveCheck = r)));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      // above the auto-download size, so a "not here" leaves the download affordance instead of fetching at once
      tree = ReactTestRenderer.create(<VoiceNoteView myUserId="me" meta={meta('a'.repeat(32), TOO_BIG_TO_AUTO_DOWNLOAD)} mine={false} />);
    });
    expect(iconNames(tree)).toContain('play');
    expect(iconNames(tree)).not.toContain('download');
    expect(mainButtonDisabled(tree, 'Checking the voice message')).toBe(true);

    await ReactTestRenderer.act(async () => {
      resolveCheck(false);
    });
    expect(iconNames(tree)).toContain('download');
    expect(iconNames(tree)).not.toContain('play');
  });

  it('a note confirmed on the device becomes playable, never passing through the download state', async () => {
    let resolveCheck: (v: boolean) => void = () => undefined;
    hasMediaMock.mockImplementation(() => new Promise<boolean>((r) => (resolveCheck = r)));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<VoiceNoteView myUserId="me" meta={meta('b'.repeat(32))} mine={true} />);
    });
    await ReactTestRenderer.act(async () => {
      resolveCheck(true);
    });
    expect(iconNames(tree)).toContain('play');
    expect(iconNames(tree)).not.toContain('download');
    expect(mainButtonDisabled(tree, 'Play the voice message')).toBe(false);
  });

  it('an own note saved at send time starts as local: enabled play button before the check resolves', async () => {
    const blobId = 'c'.repeat(32);
    await saveMedia({ myUserId: 'me', blobId, bytes: new Uint8Array(10) });
    hasMediaMock.mockImplementation(() => new Promise<boolean>(() => undefined)); // never resolves
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<VoiceNoteView myUserId="me" meta={meta(blobId)} mine={true} />);
    });
    expect(iconNames(tree)).toContain('play');
    expect(iconNames(tree)).not.toContain('download');
    expect(mainButtonDisabled(tree, 'Play the voice message')).toBe(false);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Checking the voice message' })).toHaveLength(0);
  });
});
