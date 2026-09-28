/**
 * Typed protocol errors (spec T2.3, §8.3).
 *
 * Every throw in this package is a ProtocolError. The client maps `code`
 * to a user-facing string and an action; it never parses `message`.
 *
 * `context` carries only scalars that help diagnose (counters, lengths,
 * what was being checked). It must never carry key material (R3): no
 * private, chain, root or message keys, in any encoding, not even
 * truncated. Public keys, if ever needed, go in truncated.
 */
export type ProtocolErrorCode =
  | 'MISSING_BOOTSTRAP'
  | 'NO_SESSION'
  | 'STALE_SESSION'
  | 'DECRYPT_FAILED'
  | 'REPLAY_DETECTED'
  | 'UNKNOWN_OLD_MESSAGE'
  | 'SEND_FAILED'
  | 'STORAGE_CORRUPTION'
  | 'TOO_MANY_SKIPPED'
  | 'HEADER_TAMPERED'
  | 'INVALID_KEY_LENGTH'
  | 'SESSION_RESET_REQUIRED'
  | 'IDENTITY_MISMATCH'
  | 'IDENTITY_BINDING_INVALID'
  // Phase 6' groups (T6.1)
  | 'SENDER_KEY_MISSING'
  | 'SENDER_KEY_STALE'
  | 'SENDER_KEY_SIGNATURE_INVALID';

export const PROTOCOL_ERROR_CODES: readonly ProtocolErrorCode[] = [
  'MISSING_BOOTSTRAP',
  'NO_SESSION',
  'STALE_SESSION',
  'DECRYPT_FAILED',
  'REPLAY_DETECTED',
  'UNKNOWN_OLD_MESSAGE',
  'SEND_FAILED',
  'STORAGE_CORRUPTION',
  'TOO_MANY_SKIPPED',
  'HEADER_TAMPERED',
  'INVALID_KEY_LENGTH',
  'SESSION_RESET_REQUIRED',
  'IDENTITY_MISMATCH',
  'IDENTITY_BINDING_INVALID',
  'SENDER_KEY_MISSING',
  'SENDER_KEY_STALE',
  'SENDER_KEY_SIGNATURE_INVALID',
];

/** Scalars only, so key material cannot be attached by accident. */
export type ProtocolErrorContext = Readonly<Record<string, string | number | boolean | null>>;

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly context: ProtocolErrorContext;

  constructor(code: ProtocolErrorCode, message: string, context: ProtocolErrorContext = {}) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.context = context;
    // Keep instanceof working when the class is transpiled to ES5 (Metro/Babel).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isProtocolError(e: unknown): e is ProtocolError {
  return e instanceof ProtocolError || (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'ProtocolError' && typeof (e as { code?: unknown }).code === 'string');
}

/** The code of a ProtocolError, or null for any other value. */
export function protocolErrorCode(e: unknown): ProtocolErrorCode | null {
  return isProtocolError(e) ? e.code : null;
}
