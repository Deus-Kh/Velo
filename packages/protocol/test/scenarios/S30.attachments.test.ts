/**
 * S30 — Attachments (T8.1–T8.4).
 * Spec §7d T8.5. The attachment reference (blob id, key, digest) travels
 * only inside the session: the wire and the server see neither; the blob
 * is opaque bytes a swapped or damaged copy of which is refused before any
 * key is used; the key opens exactly the sender's bytes. The transport is
 * the app's (Jest-tested); the harness carries the reference like text.
 * Expected: green from the start (written with T8.5).
 */
import { describe, expect, it } from 'vitest';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { attachmentDecrypt, attachmentEncrypt } from '../../src/attachment/cipher';
import { generateAttachmentKey } from '../../src/attachment/keys';
import { stripImageMetadata } from '../../src/attachment/metadata';
import { protocolErrorCode } from '../../src/errors';
import { makeWorld } from '../harness';

const bytes = (n: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};
const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return protocolErrorCode(e);
  }
};

describe('S30 attachments', () => {
  it('the reference crosses the pairwise session opaque to the wire; the recipient opens exactly the sender’s bytes', { timeout: 30_000 }, () => {
    const { server, network, clients } = makeWorld();
    const { A, B } = clients;
    A!.send('B', 'hello');

    // A prepares a "photo": metadata stripped, encrypted under a fresh key. What a server would store is `blob`.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2, 0xff, 0xda, 0, 2, 0xaa, 0xff, 0xd9]);
    const stripped = stripImageMetadata(jpeg);
    expect(stripped.removed).toBe(1);
    const key = generateAttachmentKey();
    const enc = attachmentEncrypt(stripped.bytes, key);
    const blobStore = new Map<string, Uint8Array>([['0123456789abcdef0123456789abcdef', enc.blob]]);
    const content = { v: 1 as const, kind: 'attachment' as const, blobId: '0123456789abcdef0123456789abcdef', key: encodeBase64(key), digest: encodeBase64(enc.digest), size: enc.size, contentType: 'image/jpeg', width: 4, height: 3, caption: 'look' };

    A!.sendContent('B', content);
    const r = network.log.at(-1)!;
    expect(r.ok).toBe(true);
    // The wire carried none of the reference.
    const wire = JSON.stringify(r.dto);
    for (const secret of [content.key, content.digest, content.blobId, 'look', 'attachment']) expect(wire).not.toContain(secret);
    // The server holds nothing once acked; the blob store holds opaque bytes only.
    expect(server.heldCiphertextCount('A:B')).toBe(0);
    expect(Buffer.from(blobStore.get(content.blobId)!).includes(Buffer.from(stripped.bytes))).toBe(false);

    // B received the reference decoded and authenticated, never as text.
    expect(B!.attachmentInbox.map((a) => [a.fromUserId, a.content.blobId, a.content.caption])).toEqual([['A', content.blobId, 'look']]);
    expect(B!.inbox.map((m) => m.text)).toEqual(['hello']);
    const got = B!.attachmentInbox[0]!.content;
    const opened = attachmentDecrypt(blobStore.get(got.blobId)!, decodeBase64(got.key), { digest: decodeBase64(got.digest), size: got.size });
    expect(Array.from(opened)).toEqual(Array.from(stripped.bytes));
  });

  it('a swapped blob is refused by the digest in the message, a damaged one by the MAC, a wrong key opens nothing', () => {
    const key = generateAttachmentKey();
    const a = attachmentEncrypt(bytes(100_000, 1), key);
    const b = attachmentEncrypt(bytes(100_000, 2), key);
    expect(codeOf(() => attachmentDecrypt(b.blob, key, { digest: a.digest }))).toBe('ATTACHMENT_DIGEST_MISMATCH');
    const damaged = new Uint8Array(a.blob);
    damaged[70_000] = damaged[70_000]! ^ 0x80;
    expect(codeOf(() => attachmentDecrypt(damaged, key))).toBe('ATTACHMENT_MAC_INVALID');
    expect(codeOf(() => attachmentDecrypt(a.blob, generateAttachmentKey()))).toBe('ATTACHMENT_MAC_INVALID');
    expect(Array.from(attachmentDecrypt(a.blob, key, { digest: a.digest, size: a.size }).subarray(0, 8))).toEqual(Array.from(bytes(100_000, 1).subarray(0, 8)));
  });

  it('on the group chain the reference reaches every member and survives reordering, like any content', { timeout: 30_000 }, () => {
    const { network, clients } = makeWorld(['A', 'B', 'C']);
    const { A, B, C } = clients;
    const g = A!.createGroup(['B', 'C']);
    const key = generateAttachmentKey();
    const enc = attachmentEncrypt(bytes(1000), key);
    const content = { v: 1 as const, kind: 'attachment' as const, blobId: 'f'.repeat(32), key: encodeBase64(key), digest: encodeBase64(enc.digest), size: enc.size, contentType: 'audio/mp4', durationMs: 4200 };
    network.hold('C');
    A!.sendGroup(g, 'before');
    expect(A!.sendGroupContent(g, content).ok).toBe(true);
    network.reorder('C', 'reverse');
    expect(network.release('C').every((r) => r.ok)).toBe(true);
    for (const m of [B!, C!]) {
      expect(m.attachmentInbox.map((a) => [a.fromUserId, a.groupId, a.content.contentType, a.content.durationMs])).toEqual([['A', g, 'audio/mp4', 4200]]);
      expect(m.groupMessages(g)).toEqual(['before']);
    }
  });
});
