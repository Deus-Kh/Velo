import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  loginPasswordRules,
  newPasswordRules,
  validatePassword,
} from '../password';

describe('validatePassword', () => {
  it('requires a value', () => {
    expect(validatePassword('')).toBe('Password is required');
  });

  it('enforces the minimum length', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      `Minimum ${PASSWORD_MIN_LENGTH} characters`,
    );
    expect(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });

  it('enforces the maximum length', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(validatePassword('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
      `Maximum ${PASSWORD_MAX_LENGTH} characters`,
    );
  });

  it('rejects whitespace-only passwords even when long enough', () => {
    expect(validatePassword(' '.repeat(PASSWORD_MIN_LENGTH + 2))).toBe(
      'Password cannot be only whitespace',
    );
  });

  it('exposes one rule set for new passwords and a lighter one for login', () => {
    expect(newPasswordRules.validate).toBe(validatePassword);
    expect(newPasswordRules.required).toBe('Password is required');
    expect(loginPasswordRules).toEqual({ required: 'Password is required' });
  });
});
