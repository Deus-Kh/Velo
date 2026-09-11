/**
 * Single source of truth for the password rule on the client.
 *
 * The server enforces the same minimum (T1.8); client validation is UX only
 * and is never the security boundary. Applied on registration and password
 * change. Login only requires a non-empty value so that accounts created
 * under an older, weaker rule can still sign in and be prompted to upgrade.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function validatePassword(value: string): string | true {
  if (!value) return 'Password is required';
  if (value.length < PASSWORD_MIN_LENGTH) return `Minimum ${PASSWORD_MIN_LENGTH} characters`;
  if (value.length > PASSWORD_MAX_LENGTH) return `Maximum ${PASSWORD_MAX_LENGTH} characters`;
  if (!/[^\s]/.test(value)) return 'Password cannot be only whitespace';
  return true;
}

/** react-hook-form `rules` object for a new password. */
export const newPasswordRules = {
  required: 'Password is required',
  validate: validatePassword,
} as const;

/** react-hook-form `rules` object for a login password. */
export const loginPasswordRules = {
  required: 'Password is required',
} as const;
