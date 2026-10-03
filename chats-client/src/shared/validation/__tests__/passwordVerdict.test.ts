import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password';
import { passwordVerdict } from '../passwordVerdict';

/**
 * Roadmap §8.1 A5 — the live verdict under the password field, by case.
 */
describe('passwordVerdict', () => {
  it('is silent while empty, counts the missing characters, and refuses blanks and over-long values', () => {
    expect(passwordVerdict('').status).toBe('empty');
    expect(passwordVerdict('abc')).toMatchObject({ status: 'fail', reason: `${PASSWORD_MIN_LENGTH - 3} more characters needed` });
    expect(passwordVerdict('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toMatchObject({ status: 'fail', reason: '1 more character needed' });
    expect(passwordVerdict(' '.repeat(PASSWORD_MIN_LENGTH))).toMatchObject({ status: 'fail', reason: 'Spaces alone are not a password' });
    expect(passwordVerdict('x'.repeat(PASSWORD_MAX_LENGTH + 1))).toMatchObject({ status: 'fail', reason: `At most ${PASSWORD_MAX_LENGTH} characters` });
  });

  it('refuses a password built on the username or the email local part, case-insensitively', () => {
    expect(passwordVerdict('Test1 is my name 2026', { username: 'Test1' })).toMatchObject({ status: 'fail', reason: 'Do not use your username or email in the password' });
    expect(passwordVerdict('vahagn-rocks-2026', { email: 'Vahagn@example.com' })).toMatchObject({ status: 'fail' });
    expect(passwordVerdict('correct horse battery staple', { username: 'ab', email: 'a@b.c' }).status).toBe('ok'); // fragments shorter than 3 are ignored
  });

  it('refuses weak long values and accepts a phrase, naming the strength', () => {
    expect(passwordVerdict('aaaaaaaaaaaaaaaa')).toMatchObject({ status: 'fail', reason: 'Too easy to guess. Try a longer phrase of several words' });
    expect(passwordVerdict('password12345')).toMatchObject({ status: 'fail' });
    expect(passwordVerdict('Tq9!vLm#2rXp@8w')).toMatchObject({ status: 'ok' });
    expect(passwordVerdict('correct horse battery staple 42')).toMatchObject({ status: 'ok', reason: 'Strong password' });
  });
});
