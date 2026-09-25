import { createHash, randomBytes, randomUUID } from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { RefreshTokenModel } from '../models/RefreshToken';

/**
 * Session tokens (T1.10).
 *
 *  access token  — short-lived JWT (JWT_ACCESS_TTL, 15 min), stateless.
 *  refresh token — 32 random bytes (base64url), stored hashed, rotated on
 *                  every use, grouped in a family per login. Reuse of a
 *                  rotated-out token revokes the family: a stolen token that
 *                  is replayed after the legitimate client already rotated
 *                  locks the attacker out instead of granting a session.
 */

export const REFRESH_TOKEN_BYTES = 32;

const accessTokenSignOptions: SignOptions = {
  expiresIn: config.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  algorithm: config.JWT_ALGORITHM,
};

export function signAccessToken(userId: string): string {
  return jwt.sign({ userId }, config.JWT_SECRET, accessTokenSignOptions);
}

/** Seconds until an access token signed now expires (for the client's scheduler). */
export function accessTokenTtlSeconds(): number {
  const decoded = jwt.decode(signAccessToken('000000000000000000000000')) as { iat: number; exp: number };
  return decoded.exp - decoded.iat;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newRefreshTokenString(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

function refreshExpiry(): Date {
  return new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

/** Starts a new family (login / register). */
export async function issueTokenPair(userId: string, userAgent: string | null): Promise<TokenPair> {
  const refreshToken = newRefreshTokenString();
  await RefreshTokenModel.create({
    userId,
    family: randomUUID(),
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshExpiry(),
    userAgent,
  });
  return { accessToken: signAccessToken(userId), refreshToken, expiresIn: accessTokenTtlSeconds() };
}

export type RotateResult =
  | { ok: true; userId: string; pair: TokenPair }
  | { ok: false; code: 'NOT_FOUND' | 'REUSED' | 'EXPIRED' };

/** Exchanges a refresh token for a new pair; detects and punishes reuse. */
export async function rotateRefreshToken(presented: string, userAgent: string | null): Promise<RotateResult> {
  if (typeof presented !== 'string' || presented.length < 16) return { ok: false, code: 'NOT_FOUND' };
  const tokenHash = hashRefreshToken(presented);
  const current = await RefreshTokenModel.findOne({ tokenHash });
  if (!current) return { ok: false, code: 'NOT_FOUND' };

  if (current.revokedAt) {
    // Reuse detected: the legitimate client already rotated past this token,
    // or the family was revoked. Kill the whole family.
    await RefreshTokenModel.updateMany(
      { family: current.family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    console.error('[auth] refresh token reuse detected; family revoked', {
      userId: String(current.userId),
      family: current.family,
    });
    return { ok: false, code: 'REUSED' };
  }

  if (current.expiresAt.getTime() <= Date.now()) return { ok: false, code: 'EXPIRED' };

  const next = newRefreshTokenString();
  const nextHash = hashRefreshToken(next);
  const userId = String(current.userId);

  // Atomically revoke the presented token; if two concurrent refreshes race,
  // exactly one wins and the other sees a revoked token (→ REUSED), which is
  // the conservative outcome.
  const claimed = await RefreshTokenModel.findOneAndUpdate(
    { _id: current._id, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedBy: nextHash } },
  );
  if (!claimed) return { ok: false, code: 'REUSED' };

  await RefreshTokenModel.create({
    userId,
    family: current.family,
    tokenHash: nextHash,
    expiresAt: refreshExpiry(),
    userAgent,
  });

  return { ok: true, userId, pair: { accessToken: signAccessToken(userId), refreshToken: next, expiresIn: accessTokenTtlSeconds() } };
}

/** Logout: revoke the family the presented token belongs to (if it is the caller's). */
export async function revokeFamilyByToken(presented: string, userId: string): Promise<boolean> {
  const doc = await RefreshTokenModel.findOne({ tokenHash: hashRefreshToken(presented), userId });
  if (!doc) return false;
  await RefreshTokenModel.updateMany({ family: doc.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return true;
}

/** Password change / "log out everywhere": every family of the user. */
export async function revokeAllRefreshTokens(userId: string): Promise<number> {
  const result = await RefreshTokenModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return result.modifiedCount;
}
