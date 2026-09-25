import { decodeBase64, encodeUTF8 } from 'tweetnacl-util';

/**
 * Minimal, dependency-free JWT payload inspection. Verification is the
 * server's job; the client only needs `exp` to decide when to refresh.
 */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = encodeUTF8(decodeBase64(padded));
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Epoch milliseconds at which the token expires, or null when unknown. */
export function jwtExpiresAt(token: string): number | null {
  const exp = parseJwtPayload(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}

/**
 * True when the token is expired or will expire within `skewMs`. Unknown
 * expiry counts as "needs refresh" so a malformed token never gets reused.
 */
export function isJwtExpiring(token: string, now: number, skewMs = 60_000): boolean {
  const expiresAt = jwtExpiresAt(token);
  if (expiresAt === null) return true;
  return expiresAt - now <= skewMs;
}
