import { PROTOCOL_ERROR_CODES, ProtocolError } from '@velo/protocol';
import { classifyPendingMessageError, presentProtocolError, requiresSessionReset } from '../protocolErrors';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('presentProtocolError', () => {
  it('has an entry for every code and names the peer where the spec says so', () => {
    for (const code of PROTOCOL_ERROR_CODES) {
      const p = presentProtocolError(code, 'Ani');
      expect(typeof p.recoverable).toBe('boolean');
      expect(p.action).toBeTruthy();
    }
    expect(presentProtocolError('IDENTITY_MISMATCH', 'Ani').userMessage).toBe('Safety number with Ani has changed');
    expect(presentProtocolError('INVALID_KEY_LENGTH', 'Ani').userMessage).toBe('Invalid key data from Ani');
  });

  it('marks exactly the five security-warning codes and keeps replay silent', () => {
    const warnings = PROTOCOL_ERROR_CODES.filter((c) => presentProtocolError(c).securityWarning).sort();
    expect([...warnings].sort()).toEqual(['ATTACHMENT_DIGEST_MISMATCH', 'ATTACHMENT_MAC_INVALID', 'HEADER_TAMPERED', 'IDENTITY_MISMATCH', 'SENDER_KEY_SIGNATURE_INVALID']); // T8.1 adds the two attachment integrity failures
    expect(presentProtocolError('REPLAY_DETECTED').userMessage).toBeNull();
    expect(presentProtocolError('REPLAY_DETECTED').action).toBe('log');
  });

  it('reset is required after decrypt failure and key-data errors, not after bootstrap waits', () => {
    expect(requiresSessionReset('DECRYPT_FAILED')).toBe(true);
    expect(requiresSessionReset('STALE_SESSION')).toBe(true);
    expect(requiresSessionReset('MISSING_BOOTSTRAP')).toBe(false);
    expect(requiresSessionReset('SEND_FAILED')).toBe(false);
  });
});

describe('classifyPendingMessageError', () => {
  it('maps typed protocol errors by code', () => {
    expect(classifyPendingMessageError(new ProtocolError('MISSING_BOOTSTRAP', 'x'))).toBe('missing_bootstrap');
    expect(classifyPendingMessageError(new ProtocolError('NO_SESSION', 'x'))).toBe('no_session');
    expect(classifyPendingMessageError(new ProtocolError('DECRYPT_FAILED', 'x'))).toBe('decrypt_failed');
    expect(classifyPendingMessageError(new ProtocolError('STORAGE_CORRUPTION', 'x'))).toBe('storage_corruption');
    expect(classifyPendingMessageError(new ProtocolError('SEND_FAILED', 'x'))).toBe('send_failed');
  });

  it('keeps the message heuristics for non-protocol errors', () => {
    expect(classifyPendingMessageError(new Error('Socket not connected'))).toBe('socket_unavailable');
    expect(classifyPendingMessageError(new Error('network down'))).toBe('send_failed');
    expect(classifyPendingMessageError(undefined)).toBe('unknown');
  });
});
