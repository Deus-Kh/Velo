import { describe, expect, it } from 'vitest';
import { protocolErrorCode } from '../src/errors';
import { decodeContent, encodeContent, isControlContent, textContent } from '../src/content/envelope';
import { createSenderKeyState, senderKeyDistributionMessage } from '../src/senderkey/state';

/**
 * T6.2 — the content envelope inside the pairwise ratchet.
 */
describe('T6.2 content envelope', () => {
  it('text round-trips through a versioned envelope; legacy bare text still reads as text', () => {
    const enc = encodeContent(textContent('hello, world'));
    expect(JSON.parse(enc)).toEqual({ v: 1, kind: 'text', text: 'hello, world' });
    expect(decodeContent(enc)).toEqual({ v: 1, kind: 'text', text: 'hello, world' });
    expect(decodeContent('plain old text')).toEqual({ v: 1, kind: 'text', text: 'plain old text' });
    expect(decodeContent('{not json')).toEqual({ v: 1, kind: 'text', text: '{not json' });
    expect(decodeContent('{"unrelated":true}')).toEqual({ v: 1, kind: 'text', text: '{"unrelated":true}' });
    expect(decodeContent('')).toEqual({ v: 1, kind: 'text', text: '' });
  });

  it('a sender-key distribution travels as control content and comes back intact', () => {
    const skdm = senderKeyDistributionMessage(createSenderKeyState());
    const enc = encodeContent({ v: 1, kind: 'skdm', groupId: 'g-1', skdm });
    const dec = decodeContent(enc);
    expect(dec).toEqual({ v: 1, kind: 'skdm', groupId: 'g-1', skdm });
    expect(isControlContent(dec)).toBe(true);
    expect(isControlContent(textContent('x'))).toBe(false);
    const req = decodeContent(encodeContent({ v: 1, kind: 'skdm-request', groupId: 'g-1' }));
    expect(req).toEqual({ v: 1, kind: 'skdm-request', groupId: 'g-1' });
  });

  it('malformed control content and unknown kinds are typed refusals, never silently text', () => {
    const code = (s: string) => {
      try {
        decodeContent(s);
        return null;
      } catch (e) {
        return protocolErrorCode(e);
      }
    };
    expect(code('{"v":1,"kind":"skdm","groupId":"g","skdm":{"v":1}}')).toBe('STORAGE_CORRUPTION');
    expect(code('{"v":1,"kind":"skdm-request"}')).toBe('STORAGE_CORRUPTION');
    expect(code('{"v":1,"kind":"reaction","emoji":"x"}')).toBe('STORAGE_CORRUPTION');
    // A future version is not ours to interpret either, but it must not be mistaken for a control message.
    expect(decodeContent('{"v":2,"kind":"skdm"}')).toEqual({ v: 1, kind: 'text', text: '{"v":2,"kind":"skdm"}' });
  });
});
