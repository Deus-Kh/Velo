import { describeMessage, describeMessageForQuote, normalizeSnippet, SNIPPET_MAX_LENGTH, truncateSnippet } from '../describeMessage';

/**
 * Roadmap §8.1 A3 — the one-line description of a message, by kind. Plain
 * words plus an icon name; never an emoji in the text (owner's rule).
 */
const meta = (contentType: string, extra: Record<string, unknown> = {}) => ({ blobId: 'b'.repeat(32), key: 'k', digest: 'd', size: 10, contentType, ...extra });
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('describeMessage', () => {
  it('a text message is its text, whitespace collapsed, cut at the snippet length with an ellipsis; no icon', () => {
    expect(describeMessage({ text: '  hello\n\n  world ' })).toEqual({ kind: 'text', text: 'hello world', icon: null });
    const long = 'x'.repeat(SNIPPET_MAX_LENGTH + 10);
    const out = describeMessageForQuote({ text: long });
    expect(Array.from(out)).toHaveLength(SNIPPET_MAX_LENGTH);
    expect(out.endsWith('…')).toBe(true);
    expect(describeMessageForQuote({ text: 'short', attachment: null })).toBe('short');
    expect(describeMessageForQuote({})).toBe('');
  });

  it('a voice note names itself with its duration and the mic icon; without a duration, just the kind', () => {
    expect(describeMessage({ text: '', attachment: meta('audio/mp4', { durationMs: 12_400 }) })).toEqual({ kind: 'voice', text: 'Voice message · 0:12', icon: 'mic' });
    expect(describeMessageForQuote({ text: '', attachment: meta('audio/mp4', { durationMs: 61_000 }) })).toBe('Voice message · 1:01');
    expect(describeMessageForQuote({ text: '', attachment: meta('AUDIO/MP4') })).toBe('Voice message');
  });

  it('a photo is "Photo" or "Photo · caption" with the image icon; a file is "File · name" with the paperclip', () => {
    expect(describeMessage({ text: '', attachment: meta('image/jpeg') })).toEqual({ kind: 'photo', text: 'Photo', icon: 'image' });
    expect(describeMessageForQuote({ text: ' look at this ', attachment: meta('image/jpeg') })).toBe('Photo · look at this');
    expect(describeMessage({ text: '', attachment: meta('video/mp4') })).toEqual({ kind: 'video', text: 'Video', icon: 'video' });
    expect(describeMessage({ text: '', attachment: meta('application/pdf', { name: 'report.pdf' }) })).toEqual({ kind: 'file', text: 'File · report.pdf', icon: 'paperclip' });
    expect(describeMessageForQuote({ text: '', attachment: meta('application/octet-stream') })).toBe('File');
  });

  it('a deleted message is "Message deleted" whatever it was', () => {
    expect(describeMessage({ text: 'secret', deletedAt: 1 })).toEqual({ kind: 'deleted', text: 'Message deleted', icon: 'trash-2' });
    expect(describeMessageForQuote({ text: '', attachment: meta('audio/mp4', { durationMs: 5000 }), deletedAt: 1 })).toBe('Message deleted');
  });

  it('no description ever carries an emoji; the interface draws icons instead', () => {
    const samples = [
      { text: '', attachment: meta('audio/mp4', { durationMs: 1000 }) },
      { text: 'cap', attachment: meta('image/png') },
      { text: '', attachment: meta('video/mp4') },
      { text: '', attachment: meta('application/zip', { name: 'a.zip' }) },
      { text: 'x', deletedAt: 1 },
    ];
    for (const s of samples) expect(describeMessageForQuote(s)).not.toMatch(EMOJI);
  });

  it('the length limit is adjustable (notification bodies allow more)', () => {
    const caption = 'c'.repeat(100);
    expect(Array.from(describeMessageForQuote({ text: caption, attachment: meta('image/png') }, { maxLength: 240 }))).toHaveLength(108); // "Photo · " + 100 characters
    expect(Array.from(describeMessageForQuote({ text: caption, attachment: meta('image/png') }))).toHaveLength(SNIPPET_MAX_LENGTH);
  });

  it('helpers: normalize and truncate count characters, not UTF-16 units', () => {
    expect(normalizeSnippet(undefined)).toBe('');
    expect(truncateSnippet('🎤🎤🎤🎤', 3)).toBe('🎤🎤…');
    expect(truncateSnippet('abc', 3)).toBe('abc');
  });
});
