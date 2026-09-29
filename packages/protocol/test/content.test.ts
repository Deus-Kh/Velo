import { describe, expect, it } from 'vitest';
import { protocolErrorCode } from '../src/errors';
import { decodeContent, encodeContent, isActionContent, isControlContent, textContent, MAX_AVATAR_BASE64_LENGTH, MAX_TIMER_SECONDS } from '../src/content/envelope';
import { groupDecrypt, groupDecryptContent, groupEncrypt, groupEncryptContent } from '../src/senderkey/message';
import { senderKeyStateFromDistribution } from '../src/senderkey/state';
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

/**
 * T7.1 — message actions and timers in the envelope; the group plaintext is the envelope too.
 */
describe('T7.1 content kinds for message actions', () => {
  const target = { senderUserId: 'u-alice', clientMessageId: 'c-1' };

  it('reaction, edit, delete and timer round-trip; they are actions, not control, not text', () => {
    const kinds = [
      { v: 1, kind: 'reaction', target, emoji: '\u{1F44D}' },
      { v: 1, kind: 'reaction', target, emoji: '\u{1F44D}', remove: true },
      { v: 1, kind: 'edit', target, text: 'corrected' },
      { v: 1, kind: 'delete', target },
      { v: 1, kind: 'timer', seconds: 86_400 },
      { v: 1, kind: 'timer', seconds: null },
    ] as const;
    for (const c of kinds) {
      const dec = decodeContent(encodeContent(c));
      expect(dec).toEqual(c);
      expect(isActionContent(dec)).toBe(true);
      expect(isControlContent(dec)).toBe(false);
    }
    expect(isActionContent(textContent('x'))).toBe(false);
    expect(isActionContent(decodeContent(encodeContent({ v: 1, kind: 'skdm-request', groupId: 'g' })))).toBe(false);
    // Fields the envelope does not know are dropped, never echoed.
    expect(JSON.parse(encodeContent({ v: 1, kind: 'reaction', target: { ...target, extra: 1 } as never, emoji: 'x' }))).toEqual({ v: 1, kind: 'reaction', target, emoji: 'x' });
  });

  it('a forwarded text carries its provenance; a text without it is unchanged on the wire', () => {
    const plain = encodeContent(textContent('hi'));
    expect(JSON.parse(plain)).toEqual({ v: 1, kind: 'text', text: 'hi' });
    const fwd = textContent('hi', { userId: 'u-bob', createdAt: 1_700_000_000_000 });
    expect(decodeContent(encodeContent(fwd))).toEqual(fwd);
    expect(() => decodeContent('{"v":1,"kind":"text","text":"x","forwardedFrom":{"userId":""}}')).toThrow();
    expect(() => encodeContent(textContent('x', { userId: 'u', createdAt: Number.NaN }))).toThrow();
  });

  it('malformed actions are typed refusals: bad target, empty or whitespace emoji, out-of-range timer', () => {
    const bad = [
      '{"v":1,"kind":"reaction","target":{"senderUserId":"a"},"emoji":"x"}',
      '{"v":1,"kind":"reaction","target":{"senderUserId":"a","clientMessageId":"c"},"emoji":""}',
      '{"v":1,"kind":"reaction","target":{"senderUserId":"a","clientMessageId":"c"},"emoji":"a b"}',
      '{"v":1,"kind":"reaction","target":{"senderUserId":"a","clientMessageId":"c"},"emoji":"' + 'x'.repeat(17) + '"}',
      '{"v":1,"kind":"edit","target":{"senderUserId":"a","clientMessageId":"c"}}',
      '{"v":1,"kind":"delete","target":"c"}',
      '{"v":1,"kind":"timer","seconds":0}',
      '{"v":1,"kind":"timer","seconds":1.5}',
      '{"v":1,"kind":"timer","seconds":' + String(MAX_TIMER_SECONDS + 1) + '}',
      '{"v":1,"kind":"timer","seconds":"60"}',
      '{"v":1,"kind":"reaction","target":{"senderUserId":"' + 'a'.repeat(129) + '","clientMessageId":"c"},"emoji":"x"}',
    ];
    for (const b of bad) {
      let code: string | null = null;
      try {
        decodeContent(b);
      } catch (e) {
        code = protocolErrorCode(e);
      }
      expect(code, b).toBe('STORAGE_CORRUPTION');
    }
    expect(() => encodeContent({ v: 1, kind: 'timer', seconds: -5 })).toThrow();
    expect(() => encodeContent({ v: 1, kind: 'reaction', target, emoji: '' })).toThrow();
  });

  it('group messages carry the envelope: text and actions decode on the other side; legacy bare text still reads', () => {
    const alice = createSenderKeyState();
    const bob = senderKeyStateFromDistribution(senderKeyDistributionMessage(alice));
    const ad = { groupId: 'g-1', senderUserId: 'u-alice' };
    const s1 = groupEncryptContent(alice, textContent('hello group'), ad);
    const s2 = groupEncryptContent(s1.state, { v: 1, kind: 'reaction', target, emoji: '\u2764' }, ad);
    const s3 = groupEncrypt(s2.state, 'bare legacy text', ad);
    const r1 = groupDecryptContent(bob, s1.message, ad);
    expect(r1.content).toEqual({ v: 1, kind: 'text', text: 'hello group' });
    const r2 = groupDecryptContent(r1.state, s2.message, ad);
    expect(r2.content).toEqual({ v: 1, kind: 'reaction', target, emoji: '\u2764' });
    const r3 = groupDecryptContent(r2.state, s3.message, ad);
    expect(r3.content).toEqual({ v: 1, kind: 'text', text: 'bare legacy text' });
    expect(groupDecrypt(r2.state, s3.message, ad).plaintext).toBe('bare legacy text');
    expect(r3.state.iteration).toBe(3);
  });
});

/**
 * T7.7 — a profile (name + avatar) travels as action content over the session.
 */
describe('T7.7 profile content', () => {
  it('round-trips an emoji avatar, a jpeg avatar and no avatar; the name is trimmed; it is an action, not text', () => {
    const emoji = { v: 1, kind: 'profile', name: '  Alice  ', avatar: { kind: 'emoji', emoji: '\u{1F98A}', color: '#FFAA00' }, updatedAt: 1_700_000_000_000 } as const;
    const dec = decodeContent(encodeContent(emoji));
    expect(dec).toEqual({ v: 1, kind: 'profile', name: 'Alice', avatar: { kind: 'emoji', emoji: '\u{1F98A}', color: '#ffaa00' }, updatedAt: 1_700_000_000_000 });
    expect(isActionContent(dec)).toBe(true);
    expect(isControlContent(dec)).toBe(false);
    const jpeg = { v: 1, kind: 'profile', name: 'Bob', avatar: { kind: 'jpeg', data: 'AAAA'.repeat(100) }, updatedAt: 5 } as const;
    expect(decodeContent(encodeContent(jpeg))).toEqual(jpeg);
    const none = { v: 1, kind: 'profile', name: 'Carol', avatar: null, updatedAt: 0 } as const;
    expect(decodeContent(encodeContent(none))).toEqual(none);
  });

  it('malformed profiles are typed refusals: empty or long name, bad colour, oversized or non-base64 jpeg, bad updatedAt', () => {
    const bad = [
      '{"v":1,"kind":"profile","name":"","avatar":null,"updatedAt":1}',
      '{"v":1,"kind":"profile","name":"' + 'x'.repeat(65) + '","avatar":null,"updatedAt":1}',
      '{"v":1,"kind":"profile","name":"a","avatar":{"kind":"emoji","emoji":"x","color":"red"},"updatedAt":1}',
      '{"v":1,"kind":"profile","name":"a","avatar":{"kind":"emoji","emoji":"","color":"#000000"},"updatedAt":1}',
      '{"v":1,"kind":"profile","name":"a","avatar":{"kind":"jpeg","data":"' + 'A'.repeat(MAX_AVATAR_BASE64_LENGTH + 1) + '"},"updatedAt":1}',
      '{"v":1,"kind":"profile","name":"a","avatar":{"kind":"jpeg","data":"not base64!"},"updatedAt":1}',
      '{"v":1,"kind":"profile","name":"a","avatar":{"kind":"png","data":"AAAA"},"updatedAt":1}',
      '{"v":1,"kind":"profile","name":"a","avatar":null,"updatedAt":"now"}',
      '{"v":1,"kind":"profile","name":"a","avatar":null,"updatedAt":-1}',
    ];
    for (const b of bad) {
      let code: string | null = null;
      try {
        decodeContent(b);
      } catch (e) {
        code = protocolErrorCode(e);
      }
      expect(code, b.slice(0, 80)).toBe('STORAGE_CORRUPTION');
    }
    expect(() => encodeContent({ v: 1, kind: 'profile', name: ' ', avatar: null, updatedAt: 1 })).toThrow();
  });
});
