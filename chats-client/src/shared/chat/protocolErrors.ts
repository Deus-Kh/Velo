import { isProtocolError, type ProtocolErrorCode } from '@velo/protocol';
import type { PendingMessageErrorCode } from '../storage/pendingMessageStore';

/**
 * Code → what the user sees and what the app does (spec §8.3).
 * The two `securityWarning` entries must render differently from technical
 * errors.
 */
export type ProtocolErrorAction = 'auto-retry' | 'auto' | 'reset' | 'none' | 'log' | 'retry' | 'reset-local' | 'verify';

export type ProtocolErrorPresentation = {
  /** null means: do not show anything (silent drop). */
  userMessage: string | null;
  recoverable: boolean;
  action: ProtocolErrorAction;
  securityWarning: boolean;
};

const TABLE: Record<ProtocolErrorCode, (peerName: string) => ProtocolErrorPresentation> = {
  MISSING_BOOTSTRAP: () => ({ userMessage: 'Waiting for secure session…', recoverable: true, action: 'auto-retry', securityWarning: false }),
  NO_SESSION: () => ({ userMessage: 'Setting up encryption…', recoverable: true, action: 'auto', securityWarning: false }),
  STALE_SESSION: () => ({ userMessage: 'Secure session needs to be reset', recoverable: true, action: 'reset', securityWarning: false }),
  SESSION_RESET_REQUIRED: () => ({ userMessage: 'Secure session needs to be reset', recoverable: true, action: 'reset', securityWarning: false }),
  DECRYPT_FAILED: () => ({ userMessage: "This message couldn't be decrypted", recoverable: false, action: 'reset', securityWarning: false }),
  REPLAY_DETECTED: () => ({ userMessage: null, recoverable: false, action: 'log', securityWarning: false }),
  UNKNOWN_OLD_MESSAGE: () => ({ userMessage: 'Older message unavailable', recoverable: false, action: 'none', securityWarning: false }),
  TOO_MANY_SKIPPED: () => ({ userMessage: 'Too many missed messages', recoverable: true, action: 'reset', securityWarning: false }),
  SEND_FAILED: () => ({ userMessage: 'Not sent — tap to retry', recoverable: true, action: 'retry', securityWarning: false }),
  STORAGE_CORRUPTION: () => ({ userMessage: 'Local data problem', recoverable: false, action: 'reset-local', securityWarning: false }),
  INVALID_KEY_LENGTH: (peer) => ({ userMessage: 'Invalid key data from ' + peer, recoverable: false, action: 'reset', securityWarning: false }),
  IDENTITY_BINDING_INVALID: (peer) => ({ userMessage: 'Invalid key data from ' + peer, recoverable: false, action: 'reset', securityWarning: false }),
  HEADER_TAMPERED: () => ({ userMessage: 'Security warning: a message was modified in transit', recoverable: false, action: 'verify', securityWarning: true }),
  IDENTITY_MISMATCH: (peer) => ({ userMessage: 'Safety number with ' + peer + ' has changed', recoverable: false, action: 'verify', securityWarning: true }),
  // Phase 6' groups (T6.1)
  SENDER_KEY_MISSING: (peer) => ({ userMessage: 'Waiting for ' + peer + '\u2019s group key\u2026', recoverable: true, action: 'auto-retry', securityWarning: false }),
  SENDER_KEY_STALE: (peer) => ({ userMessage: 'Group key from ' + peer + ' is out of date', recoverable: true, action: 'auto-retry', securityWarning: false }),
  SENDER_KEY_SIGNATURE_INVALID: (peer) => ({ userMessage: 'Security warning: a group message claiming to be from ' + peer + ' was not signed by them', recoverable: false, action: 'verify', securityWarning: true }),
};

export function presentProtocolError(code: ProtocolErrorCode, peerName = 'this contact'): ProtocolErrorPresentation {
  return TABLE[code](peerName);
}

/** Codes after which the session is unusable until the user resets it. */
export function requiresSessionReset(code: ProtocolErrorCode): boolean {
  return presentProtocolError(code).action === 'reset';
}

/**
 * Maps any thrown value to the outgoing queue's error code. Typed protocol
 * errors are mapped by code; anything else falls back to the historical
 * message heuristics (socket and network failures are not protocol errors).
 */
export function classifyPendingMessageError(error: unknown): PendingMessageErrorCode {
  if (isProtocolError(error)) {
    switch (error.code) {
      case 'MISSING_BOOTSTRAP':
        return 'missing_bootstrap';
      case 'NO_SESSION':
      case 'STALE_SESSION':
      case 'SESSION_RESET_REQUIRED':
        return 'no_session';
      case 'DECRYPT_FAILED':
      case 'REPLAY_DETECTED':
      case 'UNKNOWN_OLD_MESSAGE':
      case 'TOO_MANY_SKIPPED':
      case 'HEADER_TAMPERED':
        return 'decrypt_failed';
      case 'STORAGE_CORRUPTION':
      case 'INVALID_KEY_LENGTH':
      case 'IDENTITY_BINDING_INVALID':
        return 'storage_corruption';
      case 'IDENTITY_MISMATCH':
        return 'identity_mismatch';
      case 'SEND_FAILED':
        return 'send_failed';
      case 'SENDER_KEY_MISSING':
      case 'SENDER_KEY_STALE':
        return 'no_session';
      case 'SENDER_KEY_SIGNATURE_INVALID':
        return 'decrypt_failed';
    }
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('Socket')) return 'socket_unavailable';
  if (message.includes('Missing v2 session and initPacket')) return 'missing_bootstrap';
  if (message.includes('No v2 session')) return 'no_session';
  if (message.includes('Decrypt')) return 'decrypt_failed';
  if (message.includes('storage')) return 'storage_corruption';
  if (message) return 'send_failed';
  return 'unknown';
}
