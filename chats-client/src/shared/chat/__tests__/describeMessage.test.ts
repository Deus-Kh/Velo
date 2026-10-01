import { describeMessageForQuote, normalizeSnippet, SNIPPET_MAX_LENGTH, truncateSnippet } from '../describeMessage';

/**
 * Roadmap §8.1 A3 — the one-line description of a message, by kind.
 */
const meta = (contentType: string, extra: Record<string, unknown> = {}) => ({ blobId: 'b'.repeat(32), key: 'k', digest: 'd', size: 10, contentType, ...extra });

describe('describeMessageForQuote', () => {
  it('a text message is its text, whitespace collapsed, cut at the snippet length with an ellipsis', () => {
    expect(describeMessageForQuote({ text: '  hello\n\n  world ' })).toBe('hello world');
    const long = 'x'.repeat(SNIPPET_MAX_LENGTH + 10);
    const out = describeMessageForQuote({ text: long });
    expect(Array.from(out)).toHaveLength(SNIPPET_MAX_LENGTH);
    expect(out.endsWith('…')).toBe(true);
    expect(describeMessageForQuote({ text: 'short', attachment: null })).toBe('short');
    expect(describeMessageForQuote({})).toBe('');
  });

  it('a voice note names itself with its duration; without one, just the kind', () => {
    expect(describeMessageForQuote({ text: '', attachment: meta('audio/mp4', { durationMs: 12_400 }) })).toBe('🎤 Voice message · 0:12');
    expect(describeMessageForQuote({ text: '', attachment: meta('audio/mp4', { durationMs: 61_000 }) })).toBe('🎤 Voice message · 1:01');
    expect(describeMessageForQuote({ text: '', attachment: meta('AUDIO/MP4') })).toBe('🎤 Voice message');
  });

  it('a photo is its caption or "Photo"; a file is its name or "File"', () => {
    expect(describeMessageForQuote({ text: '', attachment: meta('image/jpeg') })).toBe('📷 Photo');
    expect(describeMessageForQuote({ text: ' look at this ', attachment: meta('image/jpeg') })).toBe('📷 look at this');
    expect(describeMessageForQuote({ text: '', attachment: meta('video/mp4') })).toBe('🎬 Video');
    expect(describeMessageForQuote({ text: '', attachment: meta('application/pdf', { name: 'report.pdf' }) })).toBe('📎 report.pdf');
    expect(describeMessageForQuote({ text: '', attachment: meta('application/octet-stream') })).toBe('📎 File');
  });

  it('a deleted message is "Message deleted" whatever it was', () => {
    expect(describeMessageForQuote({ text: 'secret', deletedAt: 1 })).toBe('Message deleted');
    expect(describeMessageForQuote({ text: '', attachment: meta('audio/mp4', { durationMs: 5000 }), deletedAt: 1 })).toBe('Message deleted');
  });

  it('the length limit is adjustable (notification bodies allow more)', () => {
    const caption = 'c'.repeat(100);
    expect(Array.from(describeMessageForQuote({ text: caption, attachment: meta('image/png') }, { maxLength: 240 }))).toHaveLength(102); // 📷, space, 100 characters
    expect(Array.from(describeMessageForQuote({ text: caption, attachment: meta('image/png') }))).toHaveLength(SNIPPET_MAX_LENGTH);
  });

  it('helpers: normalize and truncate count characters, not UTF-16 units', () => {
    expect(normalizeSnippet(undefined)).toBe('');
    expect(truncateSnippet('🎤🎤🎤🎤', 3)).toBe('🎤🎤…');
    expect(truncateSnippet('abc', 3)).toBe('abc');
  });
});
