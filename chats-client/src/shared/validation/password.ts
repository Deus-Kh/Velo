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

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/**
 * Lightweight strength estimate for the meter in the registration form.
 * UX only: the server runs zxcvbn and a breach check and is the authority.
 */
export function estimatePasswordStrength(value: string): PasswordStrength {
  if (!value) return { score: 0, label: '' };
  const length = value.length;
  const classes =
    Number(/[a-z]/.test(value)) +
    Number(/[A-Z]/.test(value)) +
    Number(/\d/.test(value)) +
    Number(/[^A-Za-z0-9]/.test(value));
  const repetitive = /(.)\1{2,}/.test(value) || /^(..?)\1+$/.test(value);
  const common = /^(password|qwerty|letmein|welcome|iloveyou|admin|123456|abc123)/i.test(value);

  let score = 0;
  if (length >= PASSWORD_MIN_LENGTH) score += 1;
  if (length >= 14) score += 1;
  if (classes >= 3) score += 1;
  if (length >= 20 || (length >= 16 && classes >= 4)) score += 1;
  if (repetitive || common) score = Math.min(score, 1);

  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const;
  const bounded = Math.max(0, Math.min(4, score)) as PasswordStrength['score'];
  return { score: bounded, label: labels[bounded] };
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
