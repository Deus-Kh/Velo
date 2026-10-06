import { resolveVerifyView } from '../verifyState';

/**
 * Roadmap §8.1 A10 — the safety number comes from the local pin at once;
 * the server copy confirms it, reveals a change, or is simply not there.
 * C2 — "verified" needs the user's own mark on those keys; a silent
 * first-contact pin is "untrusted" (not verified yet).
 */
const SIGN_A = 'A'.repeat(43) + '=';
const DH_A = 'B'.repeat(43) + '=';
const SIGN_B = 'C'.repeat(43) + '=';
const DH_B = 'D'.repeat(43) + '=';
const pinA = { identitySignPublicKey: SIGN_A, identityDhPublicKey: DH_A };
const verifiedA = { identity: pinA, verified: true };
const pinnedA = { identity: pinA, verified: false };
const serverA = { identitySignPublicKey: SIGN_A, identityDhPublicKey: DH_A };
const serverB = { identitySignPublicKey: SIGN_B, identityDhPublicKey: DH_B };

describe('resolveVerifyView', () => {
  it('a verified contact shows its number immediately while the server is pending, unconfirmed', () => {
    const view = resolveVerifyView(verifiedA, { kind: 'pending' });
    expect(view.identity).toEqual(serverA);
    expect(view.status).toBe('verified');
    expect(view.confirmed).toBe(false);
    expect(view.note).toMatch(/saved on this phone/);
  });

  it('a silent first-contact pin shows its number early but is not verified', () => {
    const view = resolveVerifyView(pinnedA, { kind: 'pending' });
    expect(view.identity).toEqual(serverA);
    expect(view.status).toBe('untrusted');
    expect(resolveVerifyView(pinnedA, { kind: 'ok', identity: serverA }).status).toBe('untrusted');
    expect(resolveVerifyView(pinnedA, { kind: 'failed', message: 'Timed out' }).status).toBe('untrusted');
  });

  it('the server confirming a verified pin leaves it verified and confirmed; a different key means "changed"', () => {
    expect(resolveVerifyView(verifiedA, { kind: 'ok', identity: serverA })).toEqual({ identity: serverA, status: 'verified', confirmed: true, note: null });
    const changed = resolveVerifyView(verifiedA, { kind: 'ok', identity: serverB });
    expect(changed.status).toBe('changed');
    expect(changed.identity).toEqual(serverB);
    expect(changed.confirmed).toBe(true);
    expect(resolveVerifyView(pinnedA, { kind: 'ok', identity: serverB }).status).toBe('changed');
  });

  it('a server failure keeps the pinned number on screen with a note; without a pin there is nothing to show', () => {
    const view = resolveVerifyView(verifiedA, { kind: 'failed', message: 'Timed out' });
    expect(view.identity).toEqual(serverA);
    expect(view.status).toBe('verified');
    expect(view.note).toMatch(/Timed out/);
    const none = resolveVerifyView(null, { kind: 'failed', message: 'Timed out' });
    expect(none).toEqual({ identity: null, status: 'unknown', confirmed: false, note: 'Timed out' });
    expect(resolveVerifyView(null, { kind: 'pending' })).toEqual({ identity: null, status: 'unknown', confirmed: false, note: null });
  });

  it('a first contact is "untrusted" once the server answers; an old pin without a DH key cannot be shown early or count as verified', () => {
    expect(resolveVerifyView(null, { kind: 'ok', identity: serverA }).status).toBe('untrusted');
    const oldPin = { identity: { identitySignPublicKey: SIGN_A, identityDhPublicKey: null }, verified: false };
    expect(resolveVerifyView(oldPin, { kind: 'pending' }).identity).toBeNull();
    expect(resolveVerifyView(oldPin, { kind: 'ok', identity: serverA }).status).toBe('untrusted');
  });
});
