import { createHash } from 'crypto';
import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../utils/validation';

/**
 * Password policy (T1.8 / P0-8): length, zxcvbn strength against the user's
 * own identifiers, and a breach check via the HaveIBeenPwned range API.
 *
 * The breach check is k-anonymous: only the first five hex characters of the
 * SHA-1 leave the server; the remainder is matched locally. It fails OPEN on
 * network trouble — a third-party outage must never block registration.
 */

zxcvbnOptions.setOptions({
  translations: zxcvbnEn.translations,
  graphs: zxcvbnCommon.adjacencyGraphs,
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
});

export const MIN_ZXCVBN_SCORE = 3;
export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: string };

/** Synchronous part: length + strength. */
export function checkPasswordStrength(password: string, userInputs: string[] = []): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `Password must be at most ${PASSWORD_MAX_LENGTH} characters` };
  }
  // The whole identifier, its local part (before '@'), and its fragments all
  // count as "known to an attacker" so passwords built from them score low.
  const inputs = userInputs
    .flatMap((s) => (s ? [s, s.split('@')[0], ...s.split(/[@._\-+]/)] : []))
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  const result = zxcvbn(password, inputs);
  if (result.score < MIN_ZXCVBN_SCORE) {
    const hint = result.feedback.warning || result.feedback.suggestions[0] || 'Choose a less predictable password';
    return { ok: false, reason: `Password is too weak. ${hint}` };
  }
  return { ok: true };
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Returns the number of times the password appears in known breaches, or
 * `null` when the check could not be completed (fail open). Never sends the
 * password or its full hash anywhere.
 */
export async function breachCount(
  password: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<number | null> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2500);
  try {
    const res = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
      signal: controller.signal,
      headers: { 'Add-Padding': 'true', 'User-Agent': 'velo-server' },
    });
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split(/\r?\n/)) {
      const [hashSuffix, count] = line.split(':');
      if (hashSuffix?.trim().toUpperCase() === suffix) {
        const n = Number(count);
        return Number.isFinite(n) ? n : 0;
      }
    }
    return 0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Full policy: strength, then breach (when enabled). */
export async function checkPasswordPolicy(
  password: string,
  opts: { userInputs?: string[]; breachCheck?: boolean; fetchImpl?: FetchLike },
): Promise<PasswordPolicyResult> {
  const strength = checkPasswordStrength(password, opts.userInputs ?? []);
  if (!strength.ok) return strength;

  if (opts.breachCheck ?? true) {
    const count = await breachCount(password, { fetchImpl: opts.fetchImpl });
    if (count !== null && count > 0) {
      return { ok: false, reason: 'This password has appeared in a known data breach. Choose a different one.' };
    }
  }
  return { ok: true };
}
