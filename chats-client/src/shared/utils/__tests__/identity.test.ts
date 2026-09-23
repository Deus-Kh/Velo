import { contactSubtitle, formatHandle, shortSecureId } from '../identity';

describe('identity display helpers', () => {
  it('formats a handle and tolerates blanks', () => {
    expect(formatHandle('alice')).toBe('@alice');
    expect(formatHandle('  bob ')).toBe('@bob');
    expect(formatHandle('')).toBe('');
    expect(formatHandle(undefined)).toBe('');
  });

  it('shortens long secure IDs and leaves short ones alone', () => {
    expect(shortSecureId('65f000000000000000000001')).toBe('65f000…0001');
    expect(shortSecureId('abc')).toBe('abc');
    expect(shortSecureId(null)).toBe('');
  });

  it('prefers the handle for a contact subtitle', () => {
    expect(contactSubtitle({ username: 'alice', userId: '65f000000000000000000001' })).toBe('@alice');
    expect(contactSubtitle({ username: '', userId: '65f000000000000000000001' })).toBe('65f000…0001');
  });
});
