import { describeSessionHealth } from '../sessionHealthPresentation';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('T4.8 session health presentation', () => {
  it('healthy shows nothing', () => {
    expect(describeSessionHealth({ status: 'healthy' })).toBeNull();
  });

  it('a changed identity is a security warning that blocks the composer and names the contact', () => {
    const d = describeSessionHealth({ status: 'identity_changed', reason: 'x', code: 'IDENTITY_MISMATCH' }, 'Ani')!;
    expect(d.tone).toBe('danger');
    expect(d.securityWarning).toBe(true);
    expect(d.title).toBe('Safety number with Ani has changed');
    expect(d.composerDisabledReason).not.toBeNull();
    expect(d.action).toBe('verify');
  });

  it('reset required is a technical warning that blocks the composer, with the body for its code', () => {
    const d = describeSessionHealth({ status: 'reset_required', reason: 'x', code: 'TOO_MANY_SKIPPED' })!;
    expect(d.tone).toBe('warning');
    expect(d.securityWarning).toBe(false);
    expect(d.body).toContain('Reset the secure session');
    expect(d.composerDisabledReason).not.toBeNull();
    expect(d.action).toBe('reset');
    expect(describeSessionHealth({ status: 'reset_required', reason: 'x' })!.code).toBe('SESSION_RESET_REQUIRED');
  });

  it('a degraded session keeps the composer open; tampering renders as danger, a plain decrypt failure as warning', () => {
    const tampered = describeSessionHealth({ status: 'degraded', reason: 'x', code: 'HEADER_TAMPERED' })!;
    expect(tampered.tone).toBe('danger');
    expect(tampered.composerDisabledReason).toBeNull();
    expect(tampered.title).toContain('Security warning');
    const failed = describeSessionHealth({ status: 'degraded', reason: 'x', code: 'DECRYPT_FAILED' })!;
    expect(failed.tone).toBe('warning');
    expect(failed.title).toBe("This message couldn't be decrypted");
    expect(failed.action).toBe('reset');
    const old = describeSessionHealth({ status: 'degraded', reason: 'x', code: 'UNKNOWN_OLD_MESSAGE' })!;
    expect(old.action).toBe('none');
  });
});
