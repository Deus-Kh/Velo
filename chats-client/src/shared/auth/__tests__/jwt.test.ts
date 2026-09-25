import { decodeUTF8, encodeBase64 } from 'tweetnacl-util';
import { isJwtExpiring, jwtExpiresAt, parseJwtPayload } from '../jwt';

function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) =>
    encodeBase64(decodeUTF8(s)).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/[=]+$/, '');
  return `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.sig`;
}

describe('jwt helpers', () => {
  it('parses the payload of a well-formed token', () => {
    expect(parseJwtPayload(fakeJwt({ userId: 'u1', exp: 1700000000 }))).toEqual({ userId: 'u1', exp: 1700000000 });
  });

  it('returns null for malformed tokens', () => {
    expect(parseJwtPayload('not.a.jwt.at.all')).toBeNull();
    expect(parseJwtPayload('a.b')).toBeNull();
    expect(parseJwtPayload('a.%%%.c')).toBeNull();
    expect(jwtExpiresAt('garbage')).toBeNull();
  });

  it('reports expiry in milliseconds and applies the skew', () => {
    const exp = 1_800_000_000;
    const token = fakeJwt({ exp });
    expect(jwtExpiresAt(token)).toBe(exp * 1000);
    expect(isJwtExpiring(token, exp * 1000 - 120_000)).toBe(false);
    expect(isJwtExpiring(token, exp * 1000 - 30_000)).toBe(true);
    expect(isJwtExpiring(token, exp * 1000 + 1)).toBe(true);
  });

  it('treats a token without exp as expiring', () => {
    expect(isJwtExpiring(fakeJwt({ userId: 'u' }), 0)).toBe(true);
  });
});
