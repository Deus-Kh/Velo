import { ProtocolError } from '../errors';
import type { SenderKeyDistributionMessage } from '../senderkey/state';

/**
 * Content envelope (T6.2): what the plaintext of a pairwise message is.
 * Until Phase 6' the plaintext was the bare text. It is now a versioned
 * JSON document, so control messages (a sender-key distribution, a request
 * for one) travel inside the same authenticated pairwise session as text,
 * never through the server in the clear.
 *
 * Decoding is lenient in exactly one way: a plaintext that is not a v1
 * envelope is treated as legacy bare text. Both come from the same
 * authenticated peer, so a text that merely looks like an envelope gives
 * that peer nothing it could not send for real.
 */
export const CONTENT_VERSION = 1;

export type TextContent = { v: 1; kind: 'text'; text: string };
export type SenderKeyDistributionContent = { v: 1; kind: 'skdm'; groupId: string; skdm: SenderKeyDistributionMessage };
export type SenderKeyRequestContent = { v: 1; kind: 'skdm-request'; groupId: string };
export type Content = TextContent | SenderKeyDistributionContent | SenderKeyRequestContent;

export function textContent(text: string): TextContent {
  return { v: CONTENT_VERSION, kind: 'text', text };
}

export function encodeContent(content: Content): string {
  switch (content.kind) {
    case 'text':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'text', text: String(content.text) });
    case 'skdm':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'skdm', groupId: content.groupId, skdm: content.skdm });
    case 'skdm-request':
      return JSON.stringify({ v: CONTENT_VERSION, kind: 'skdm-request', groupId: content.groupId });
    default:
      throw new ProtocolError('STORAGE_CORRUPTION', 'Unknown content kind', { what: 'content.kind' });
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSkdm(v: unknown): v is SenderKeyDistributionMessage {
  return (
    isRecord(v) &&
    v.v === 1 &&
    typeof v.keyId === 'number' &&
    typeof v.iteration === 'number' &&
    typeof v.chainKey === 'string' &&
    typeof v.signingPublicKey === 'string' &&
    v.deviceId === 0
  );
}

/** A v1 envelope, or legacy bare text. Never throws on text. */
export function decodeContent(plaintext: string): Content {
  if (!plaintext.startsWith('{')) return textContent(plaintext);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return textContent(plaintext);
  }
  if (!isRecord(parsed) || parsed.v !== CONTENT_VERSION || typeof parsed.kind !== 'string') return textContent(plaintext);
  switch (parsed.kind) {
    case 'text':
      return textContent(typeof parsed.text === 'string' ? parsed.text : '');
    case 'skdm':
      if (typeof parsed.groupId === 'string' && parsed.groupId.length > 0 && isSkdm(parsed.skdm)) {
        return { v: CONTENT_VERSION, kind: 'skdm', groupId: parsed.groupId, skdm: parsed.skdm };
      }
      throw new ProtocolError('STORAGE_CORRUPTION', 'Malformed sender key distribution content', { what: 'content.skdm' });
    case 'skdm-request':
      if (typeof parsed.groupId === 'string' && parsed.groupId.length > 0) {
        return { v: CONTENT_VERSION, kind: 'skdm-request', groupId: parsed.groupId };
      }
      throw new ProtocolError('STORAGE_CORRUPTION', 'Malformed sender key request content', { what: 'content.skdm-request' });
    default:
      // A kind this build does not know: a newer peer. Not text, not ours to act on.
      throw new ProtocolError('STORAGE_CORRUPTION', 'Unknown content kind', { what: 'content.kind', value: String(parsed.kind) });
  }
}

export function isControlContent(content: Content): content is SenderKeyDistributionContent | SenderKeyRequestContent {
  return content.kind !== 'text';
}
