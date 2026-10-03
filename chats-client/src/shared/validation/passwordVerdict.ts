import { estimatePasswordStrength, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type PasswordStrength } from './password';

/**
 * The live verdict under the password field (roadmap §8.1 A5): from the
 * first character the form says whether the password meets the policy
 * and, when it does not, why, in one short line. UX only: the server runs
 * the real strength check and the breach lookup and is the authority; its
 * refusal lands on the same line through the form's field error.
 */
export type PasswordVerdict =
  | { status: 'empty'; strength: PasswordStrength }
  | { status: 'fail'; reason: string; strength: PasswordStrength }
  | { status: 'ok'; reason: string; strength: PasswordStrength };

/** The client's own bar: the server asks for zxcvbn ≥ 3, which the estimator's "Fair" roughly tracks. */
export const MIN_ACCEPTED_STRENGTH = 2;

function personalFragments(personal: { email?: string | null; username?: string | null }): string[] {
  const out: string[] = [];
  const username = (personal.username ?? '').trim().toLowerCase();
  if (username.length >= 3) out.push(username);
  const email = (personal.email ?? '').trim().toLowerCase();
  const local = email.split('@')[0] ?? '';
  if (local.length >= 3) out.push(local);
  return out;
}

export function passwordVerdict(password: string, personal: { email?: string | null; username?: string | null } = {}): PasswordVerdict {
  const strength = estimatePasswordStrength(password);
  if (!password) return { status: 'empty', strength };
  if (password.length < PASSWORD_MIN_LENGTH) {
    const left = PASSWORD_MIN_LENGTH - password.length;
    return { status: 'fail', reason: `${left} more character${left === 1 ? '' : 's'} needed`, strength };
  }
  if (password.length > PASSWORD_MAX_LENGTH) return { status: 'fail', reason: `At most ${PASSWORD_MAX_LENGTH} characters`, strength };
  if (!/[^\s]/.test(password)) return { status: 'fail', reason: 'Spaces alone are not a password', strength };
  const lower = password.toLowerCase();
  if (personalFragments(personal).some((fragment) => lower.includes(fragment))) {
    return { status: 'fail', reason: 'Do not use your username or email in the password', strength };
  }
  if (strength.score < MIN_ACCEPTED_STRENGTH) return { status: 'fail', reason: 'Too easy to guess. Try a longer phrase of several words', strength };
  return { status: 'ok', reason: strength.score >= 4 ? 'Strong password' : 'Good password', strength };
}
